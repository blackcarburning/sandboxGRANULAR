"""Account-local editable snapshots paired with rendered WAVs.

Called inside the host's existing authenticated, account-pinned storage lock.
Legacy WAVs have no sidecars and gain no new browser controls.
"""
import hashlib
import json
import pathlib
import wave
import zipfile
from io import BytesIO
from urllib.parse import parse_qs, quote, urlparse

MAX_WAV = 64 * 1024 * 1024
MAX_PATTERN = 128 * 1024 * 1024
MAX_BUNDLE = MAX_WAV + MAX_PATTERN + 4096


def signature(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError('Saved render or pattern is unavailable.')
    stat = path.stat()
    return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns]


def paths(root, filename):
    if not isinstance(filename, str) or pathlib.PurePosixPath(filename).name != filename or '\\' in filename or not filename.lower().endswith('.wav') or filename.startswith('.'):
        raise ValueError('Choose a rendered WAV filename.')
    root = pathlib.Path(root)
    folder = root / '.pattern-exports'
    if root.is_symlink() or folder.is_symlink():
        raise ValueError('Invalid pattern storage.')
    key = hashlib.sha256(filename.encode('utf-8')).hexdigest()
    return root / filename, folder / (key + '.zip'), folder / (key + '.json')


def info(root, filename):
    try:
        wav, archive, metadata = paths(root, filename)
        if metadata.is_symlink() or metadata.stat().st_size > 4096:
            return None
        saved = json.loads(metadata.read_text())
        if saved.get('wavSignature') != signature(wav) or saved.get('patternSignature') != signature(archive):
            return None
        if not isinstance(saved.get('sha256'), str) or len(saved['sha256']) != 64:
            return None
        return {'url': '/mygrain-wavs/api/pattern?filename=' + quote(filename, safe=''),
                'filename': pathlib.PurePosixPath(filename).stem + '.zip',
                'size': archive.stat().st_size, 'sha256': saved['sha256']}
    except (ValueError, OSError, TypeError, AttributeError):
        return None


def decorate(root, files):
    for entry in files:
        pattern = info(root, entry['name'])
        if pattern:
            entry['patternExport'] = pattern
    return files


def read_pattern(root, filename):
    details = info(root, filename)
    if not details:
        raise FileNotFoundError('No editable pattern export exists for this WAV.')
    _, archive, _ = paths(root, filename)
    body = archive.read_bytes()
    if hashlib.sha256(body).hexdigest() != details['sha256']:
        raise ValueError('The saved pattern failed its integrity check.')
    return body


def validate_bundle(body, validate_pattern):
    if not 0 < len(body) <= MAX_BUNDLE:
        raise ValueError('Rendered WAV and pattern bundle is too large.')
    with zipfile.ZipFile(BytesIO(body)) as bundle:
        entries = bundle.infolist()
        if len(entries) != 2 or {e.filename for e in entries} != {'render.wav', 'pattern.zip'}:
            raise ValueError('Expected one rendered WAV and one editable pattern ZIP.')
        for entry in entries:
            limit = MAX_WAV if entry.filename == 'render.wav' else MAX_PATTERN
            if entry.compress_type != zipfile.ZIP_STORED or entry.flag_bits & 1 or not 0 < entry.file_size <= limit or entry.compress_size != entry.file_size:
                raise ValueError('Invalid or oversized render bundle entry.')
        wav_body, pattern = bundle.read('render.wav'), bundle.read('pattern.zip')
    with wave.open(BytesIO(wav_body), 'rb') as wav:
        if wav.getnchannels() not in (1, 2) or wav.getsampwidth() not in (2, 3) or not 8000 <= wav.getframerate() <= 192000 or not wav.getnframes():
            raise ValueError('Render must contain PCM WAV audio.')
        if len(wav.readframes(wav.getnframes())) != wav.getnframes() * wav.getnchannels() * wav.getsampwidth():
            raise ValueError('Rendered WAV is truncated.')
    validate_render_pattern(pattern, validate_pattern)
    return wav_body, pattern


def validate_render_pattern(body, validate_pattern):
    """A new render may pair one patch or all distinct patches of a Song."""
    with zipfile.ZipFile(BytesIO(body)) as archive:
        if 'render-patches.json' not in archive.namelist():
            validate_pattern(body)
            return
        manifest_entry = archive.getinfo('render-patches.json')
        if manifest_entry.file_size > 256 * 1024:
            raise ValueError('Song patch manifest is too large.')
        manifest = json.loads(archive.read(manifest_entry))
        if not isinstance(manifest, dict):
            raise ValueError('Invalid Song patch manifest.')
        patches, arrangement = manifest.get('patches'), manifest.get('arrangement')
        if manifest.get('format') != 'mygrain-render-patches' or manifest.get('version') != 1 or not isinstance(patches, list) or not 1 <= len(patches) <= 256 or not isinstance(arrangement, list) or not 1 <= len(arrangement) <= 256:
            raise ValueError('Invalid Song patch ZIP.')
        expected = {'render-patches.json'}
        ids = set()
        for index, patch in enumerate(patches, 1):
            path = f'patches/{index}.zip'
            if not isinstance(patch, dict) or patch.get('path') != path or not isinstance(patch.get('id'), str) or patch['id'] in ids or not isinstance(patch.get('name'), str):
                raise ValueError('Invalid Song patch entry.')
            ids.add(patch['id'])
            expected.add(path)
        entries = archive.infolist()
        if len(entries) != len(expected) or {entry.filename for entry in entries} != expected:
            raise ValueError('Unexpected or missing Song patch files.')
        if any(entry.compress_type != zipfile.ZIP_STORED or entry.flag_bits & 1 or entry.file_size != entry.compress_size for entry in entries):
            raise ValueError('Song patches must use stored ZIP entries.')
        if any(not isinstance(part, dict) or part.get('patch') not in ids for part in arrangement):
            raise ValueError('Invalid Song patch order.')
        for patch in patches:
            validate_pattern(archive.read(patch['path']))


def save_bundle(root, filename, body, unique_name, validate_pattern, wav_created):
    wav_body, pattern = validate_bundle(body, validate_pattern)
    name = unique_name(filename)
    wav, archive, metadata = paths(root, name)
    archive.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if archive.exists() or archive.is_symlink() or metadata.exists() or metadata.is_symlink():
        raise ValueError('That render name already has a pattern export. Choose another name.')
    created = []
    try:
        for path, content in [(wav, wav_body), (archive, pattern)]:
            with path.open('xb') as handle:
                created.append(path)
                handle.write(content)
        record = {'wavSignature': signature(wav), 'patternSignature': signature(archive), 'sha256': hashlib.sha256(pattern).hexdigest()}
        with metadata.open('x') as handle:
            created.append(metadata)
            json.dump(record, handle)
        wav_created(name)
    except Exception:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise
    return {'ok': True, 'savedName': name, 'size': len(wav_body), 'url': '/mygrain-wavs/' + quote(name), 'patternExport': info(root, name)}


def rename(root, old_name, new_name):
    if old_name == new_name:
        return
    # Called after the WAV rename: inode/size/mtime identity remains valid.
    _, old_archive, old_metadata = paths(root, old_name)
    _, new_archive, new_metadata = paths(root, new_name)
    if old_archive.is_symlink() or old_metadata.is_symlink():
        raise ValueError('Invalid pattern storage.')
    if not old_archive.exists() and not old_metadata.exists():
        return
    if new_archive.exists() or new_metadata.exists() or new_archive.is_symlink() or new_metadata.is_symlink():
        raise ValueError('Destination pattern already exists.')
    moved = []
    try:
        for source, target in [(old_archive, new_archive), (old_metadata, new_metadata)]:
            if source.exists():
                source.rename(target)
                moved.append((source, target))
    except Exception:
        for source, target in reversed(moved):
            target.rename(source)
        raise


def delete(root, filename):
    _, archive, metadata = paths(root, filename)
    for path in (metadata, archive):
        path.unlink(missing_ok=True)


def handle_request(handler, method, path, *, root, unique_name, validate_pattern, wav_created):
    if path not in ('/api/render-with-pattern', '/api/pattern'):
        return False
    try:
        filename = (parse_qs(urlparse(handler.path).query).get('filename') or [''])[0]
        if path == '/api/render-with-pattern' and method == 'POST':
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_BUNDLE:
                raise ValueError('Rendered WAV and pattern bundle is too large.')
            body = handler.rfile.read(length)
            if len(body) != length:
                raise ValueError('Render bundle upload was interrupted.')
            result = save_bundle(root, filename, body, unique_name, validate_pattern, wav_created)
            handler.send_json(result, status=201, extra_headers={'Cache-Control': 'no-store'})
        elif path == '/api/pattern' and method in ('GET', 'HEAD'):
            body = read_pattern(root, filename)
            download_name = pathlib.PurePosixPath(filename).stem + '.zip'
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/zip')
            handler.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(download_name, safe=''))
            handler.send_header('Cache-Control', 'private, no-store')
            handler.send_header('X-Content-Type-Options', 'nosniff')
            handler.send_header('Content-Length', str(len(body)))
            handler.end_headers()
            if method != 'HEAD':
                handler.wfile.write(body)
        else:
            handler.send_json({'ok': False, 'error': 'Method not allowed.'}, status=405)
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404)
    except (ValueError, OSError, zipfile.BadZipFile, wave.Error) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400)
    return True
