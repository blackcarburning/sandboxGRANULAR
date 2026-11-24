"""Cross-service, credential-free admission for canonical MYGRAIN renderers.

One SQLite WAL queue counts actual Chromium decks (not HTTP coordinators).
Completed audio never lives here: scratch directories are disposable workspaces.
"""
import contextlib
import hashlib
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import tempfile
import threading
import time


class Cancelled(Exception):
    pass


def enabled():
    return bool(os.environ.get('MYGRAIN_WORKER_DB'))


def workers():
    return 10 if enabled() else 1


def _identity(pid=None):
    try:
        # /proc stat comm can contain spaces/parentheses; field 22 follows ')'.
        return Path(f'/proc/{pid or os.getpid()}/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (OSError, IndexError):
        return ''


def _connect():
    path = Path(os.environ['MYGRAIN_WORKER_DB'])
    c = sqlite3.connect(path, timeout=30, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA busy_timeout=30000')
    c.execute('PRAGMA journal_mode=WAL')
    c.execute('PRAGMA synchronous=FULL')
    c.execute('''CREATE TABLE IF NOT EXISTS jobs (
        ticket INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL, owner TEXT NOT NULL, units INTEGER NOT NULL,
        pid INTEGER NOT NULL, process_start TEXT NOT NULL, boot TEXT NOT NULL,
        state TEXT NOT NULL, created REAL NOT NULL, started REAL, updated REAL NOT NULL)''')
    c.execute('CREATE INDEX IF NOT EXISTS jobs_active ON jobs(state,ticket)')
    c.execute('CREATE INDEX IF NOT EXISTS jobs_updated ON jobs(updated)')
    # SQLite derives WAL/SHM modes from this mode, including across service UIDs.
    if path.stat().st_mode & 0o777 != 0o660:
        os.chmod(path, 0o660)
    return c


def _reap(c):
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    for row in c.execute("SELECT * FROM jobs WHERE state IN ('queued','running')").fetchall():
        if row['boot'] != boot or _identity(row['pid']) != row['process_start']:
            c.execute("UPDATE jobs SET state='interrupted',updated=? WHERE id=?", (time.time(), row['id']))
    # Keep an operational history without unbounded queue metadata growth.
    c.execute("DELETE FROM jobs WHERE state NOT IN ('queued','running') AND updated<?", (time.time()-7*86400,))


def status():
    if not enabled():
        return dict(enabled=False, capacity=1)
    with contextlib.closing(_connect()) as c:
        c.execute('BEGIN IMMEDIATE')
        _reap(c)
        rows = [dict(r) for r in c.execute("SELECT id,kind,units,state,created,started FROM jobs WHERE state IN ('queued','running') ORDER BY ticket")]
        c.commit()
    return dict(enabled=True, capacity=workers(), used=sum(r['units'] for r in rows if r['state']=='running'),
                queued=sum(r['state']=='queued' for r in rows), jobs=rows)


class Lease:
    def __init__(self, identity):
        self.identity = identity
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._heartbeat, daemon=True, name='mygrain-lease')
        self.thread.start()

    def _heartbeat(self):
        while not self.stopped.wait(5):
            try:
                with contextlib.closing(_connect()) as c:
                    c.execute("UPDATE jobs SET updated=? WHERE id=? AND state='running'", (time.time(), self.identity))
            except sqlite3.Error:
                # Liveness is PID + start time + boot, not a fragile heartbeat TTL.
                pass

    def close(self, state='done'):
        self.stopped.set()
        self.thread.join(timeout=6)
        with contextlib.closing(_connect()) as c:
            c.execute('UPDATE jobs SET state=?,updated=? WHERE id=?', (state, time.time(), self.identity))


class NoLease:
    def close(self, state='done'):
        pass


def try_acquire(kind, owner=''):
    """Borrow one idle slot only; never jump ahead of a queued render task."""
    if not enabled():
        return None
    ident, now = secrets.token_hex(16), time.time()
    with contextlib.closing(_connect()) as c:
        c.execute('BEGIN IMMEDIATE')
        _reap(c)
        queued = c.execute("SELECT count(*) FROM jobs WHERE state='queued'").fetchone()[0]
        used = c.execute("SELECT coalesce(sum(units),0) FROM jobs WHERE state='running'").fetchone()[0]
        available = next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
        floor = int(os.environ.get('MYGRAIN_MIN_AVAILABLE_MB', '2048')) * 1024**2
        if queued or used >= workers() or available < floor:
            c.commit()
            return None
        c.execute('INSERT INTO jobs(id,kind,owner,units,pid,process_start,boot,state,created,started,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
                  (ident, kind, hashlib.sha256(str(owner).encode()).hexdigest()[:24], 1,
                   os.getpid(), _identity(), Path('/proc/sys/kernel/random/boot_id').read_text().strip(), 'running', now, now, now))
        c.commit()
    return Lease(ident)


def acquire(kind, owner='', units=1, cancelled=lambda: False, waiting=lambda position: None, timeout=7200):
    if not enabled():
        return NoLease()
    if units not in (1, 2, 3, 4):
        raise ValueError('Invalid render slot count.')
    ident = secrets.token_hex(16)
    now = time.time()
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    with contextlib.closing(_connect()) as c:
        c.execute('BEGIN IMMEDIATE')
        _reap(c)
        if c.execute("SELECT count(*) FROM jobs WHERE state='queued'").fetchone()[0] >= 64:
            c.rollback()
            raise ValueError('The shared render queue is full. Saved files are unchanged; retry shortly.')
        c.execute('INSERT INTO jobs(id,kind,owner,units,pid,process_start,boot,state,created,updated) VALUES(?,?,?,?,?,?,?,?,?,?)',
                  (ident, kind, hashlib.sha256(str(owner).encode()).hexdigest()[:24], units,
                   os.getpid(), _identity(), boot, 'queued', now, now))
        c.commit()
    deadline, last_position = time.monotonic()+timeout, None
    try:
        while True:
            if cancelled():
                raise Cancelled('Render cancelled while queued. Saved files are unchanged.')
            if time.monotonic() > deadline:
                raise TimeoutError('Waiting for a render worker timed out. Saved files are unchanged.')
            with contextlib.closing(_connect()) as c:
                c.execute('BEGIN IMMEDIATE')
                _reap(c)
                own = c.execute('SELECT ticket FROM jobs WHERE id=?', (ident,)).fetchone()
                position = 1 + c.execute("SELECT count(*) FROM jobs WHERE state='queued' AND ticket<?", (own['ticket'],)).fetchone()[0]
                used = c.execute("SELECT coalesce(sum(units),0) FROM jobs WHERE state='running'").fetchone()[0]
                available = next(int(line.split()[1])*1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))
                floor = int(os.environ.get('MYGRAIN_MIN_AVAILABLE_MB', '2048')) * 1024**2
                if position == 1 and used+units <= workers() and available >= floor:
                    c.execute("UPDATE jobs SET state='running',started=?,updated=? WHERE id=?", (time.time(), time.time(), ident))
                    c.commit()
                    return Lease(ident)
                c.commit()
            if position != last_position:
                waiting(position)
                last_position = position
            time.sleep(.2)
    except BaseException:
        with contextlib.closing(_connect()) as c:
            c.execute("UPDATE jobs SET state='cancelled',updated=? WHERE id=?", (time.time(), ident))
        raise


def scratch_root():
    root = Path(os.environ['MYGRAIN_SCRATCH_ROOT'])
    # Fail closed: never silently fill the OS disk if the striped volume is absent.
    if not Path('/scratch').is_mount() or root.is_symlink() or Path('/scratch') not in root.parents:
        raise ValueError('The scratch volume is unavailable. Saved audio is unchanged.')
    root.mkdir(parents=True, mode=0o700, exist_ok=True)
    if shutil.disk_usage(root).free < 8*1024**3:
        raise ValueError('The scratch volume needs more free space. Saved audio is unchanged.')
    return root


def workspace(prefix):
    return Path(tempfile.mkdtemp(prefix=prefix, dir=scratch_root() if enabled() else None))


def pending(root, ident):
    if not enabled():
        return Path(root)/'.pending'/ident
    parent = scratch_root()/'dfeeder'
    parent.mkdir(mode=0o700, exist_ok=True)
    return parent/(hashlib.sha256(str(Path(root).absolute()).encode()).hexdigest()[:16]+'-'+ident)


def child_env(folder=None):
    env = dict(os.environ)
    if enabled():
        # Chromium singleton Unix sockets have a 108-byte path limit.
        # A short per-service temp root is safe; Chromium randomizes profiles.
        target = scratch_root()/'tmp'
        target.mkdir(mode=0o700, parents=True, exist_ok=True)
        env['TMPDIR'] = str(target)
    return env


def publish_file(source, target, mode):
    """Stage on the destination filesystem, fsync, then atomically publish.

    Creating the destination temp here also inherits library/SFTP default ACLs.
    """
    source, target = Path(source), Path(target)
    temporary = target.with_name('.'+target.name+'-'+secrets.token_hex(8)+'.pending')
    try:
        with source.open('rb') as inp, temporary.open('xb') as out:
            shutil.copyfileobj(inp, out, 1024**2)
            out.flush()
            os.fsync(out.fileno())
        temporary.chmod(mode)
        os.replace(temporary, target)
        fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        source.unlink()
    finally:
        temporary.unlink(missing_ok=True)


def startup():
    """Service pre-start only: prior cgroup children are already stopped.

    Services have separate private scratch roots, so cleaning this service's
    abandoned work cannot touch the other app, libraries or published audio.
    """
    root = scratch_root()
    if root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o077:
        raise ValueError('Scratch workspaces must be private to their service user.')
    for path in root.iterdir():
        if path.name not in ('tmp', 'dfeeder') and not path.name.startswith('mygrain-daw-'):
            continue
        if path.is_symlink():
            path.unlink()
        elif path.is_dir():
            shutil.rmtree(path)
    return status()


if __name__ == '__main__':
    import json
    import sys
    print(json.dumps(startup() if sys.argv[1:] == ['startup'] else status()))
