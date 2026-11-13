import math
import hashlib
import copy
import fcntl
import json
import os
import pathlib
import re
import secrets
import shutil
import subprocess
import threading
import time
import wave
import zipfile
from io import BytesIO
from collections import OrderedDict
from contextlib import contextmanager
from urllib.parse import parse_qs, unquote, urlparse


# EQ conversion is metadata-only, used by server preparation and lane copies.
import importlib.util as _eq_import
_eq_spec = _eq_import.spec_from_file_location('mygrain_channel_eq', pathlib.Path(__file__).with_name('mygrain_channel_eq.py'))
_drum_spec = _eq_import.spec_from_file_location('mygrain_drum_patterns', pathlib.Path(__file__).with_name('mygrain_drum_patterns.py'))
DRUM_PATTERNS = _eq_import.module_from_spec(_drum_spec)
_drum_spec.loader.exec_module(DRUM_PATTERNS)
CHANNEL_EQ = _eq_import.module_from_spec(_eq_spec)
_eq_spec.loader.exec_module(CHANNEL_EQ)


_acoustic_spec = _eq_import.spec_from_file_location('mygrain_acoustic_fx', pathlib.Path(__file__).with_name('mygrain_acoustic_fx.py'))
ACOUSTIC_FX = _eq_import.module_from_spec(_acoustic_spec)
_acoustic_spec.loader.exec_module(ACOUSTIC_FX)

_mutilator_spec = _eq_import.spec_from_file_location('mygrain_mutilator', pathlib.Path(__file__).with_name('mygrain_mutilator.py'))
MUTILATOR = _eq_import.module_from_spec(_mutilator_spec)
_mutilator_spec.loader.exec_module(MUTILATOR)

# Optional character inserts use normalized existing-control snapshots, never factory IDs.
CHARACTER_INPUTS = ('all', 'A', 'B', 'C', 'D', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+', 'generated', 'sample', 'K', 'K1', 'K2', 'K3', 'K4', 'K5', 'drums', 'drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll', 'N', 'DAW')
BASS_FACE_STRAINS = ('velvet-valve', 'warm-biscuit', 'tape-hug', 'copper-heart', 'pillowy-punch', 'subtle-beast', 'rubber-soul', 'rounded-square', 'bloom-box', 'iron-cheek', 'diode-disco', 'octave-orbit', 'neon-fangs', 'gravel-grin', 'acid-jaw', 'molten-molar', 'bass-barnacle', 'saw-tooth-smile', 'carbon-crunch', 'hot-rod', 'broken-speaker', 'doom-dentist', 'octopus-prime', 'pixel-piranha', 'ripped-cone', 'feral-fold', 'voltage-vampire', 'black-hole-teeth', 'mutant-mandible', 'full-bass-face')
def validate_master_baker(value):
    if value is None:
        return
    if not isinstance(value, dict) or value.get('version') != 1 or type(value.get('enabled')) is not bool:
        raise ValueError('Invalid Master Baker settings.')
    if value.get('preset', 'clean') not in ('clean', 'punch', 'dense', 'loud', 'hot', 'level'):
        raise ValueError('Invalid Master Baker preset.')
    # Same bounds as the shared live/WAV engine; no arbitrary controls accepted.
    limits = {'subcut': (0, 60), 'drive': (-24, 36), 'bass': (0, 100), 'compression': (0, 100), 'ceiling': (-6, -.3), 'lowEQ': (-12, 12), 'midEQ': (-12, 12), 'highEQ': (-12, 12), 'lowComp': (0, 100), 'midComp': (0, 100), 'highComp': (0, 100), 'exciter': (0, 100), 'outputDrive': (0, 24), 'maximiser': (0, 1), 'targetLufs': (-24, -6), 'tape': (0, 1), 'tapeDrive': (0, 24), 'tapeSpeed': (7.5, 30)}
    settings = value.get('settings', {})
    if not isinstance(settings, dict) or set(settings) - set(limits):
        raise ValueError('Invalid Master Baker controls.')
    for key, v in settings.items():
        low, high = limits[key]
        if type(v) not in (float, int) or not math.isfinite(v) or not low <= v <= high or key in ('tape', 'maximiser') and v not in (0, 1) or key == 'tapeSpeed' and v not in (7.5, 15, 30):
            raise ValueError('Invalid Master Baker ' + key)


def needs_effect_output_render(state):
    modes = state.get('modes', {})
    wasp = modes.get('wasp') or {}
    if wasp.get('enabled') or (wasp.get('playground') or {}).get('enabled') or (modes.get('turntable') or {}).get('enabled'):
        return True
    if any((modes.get(k) or {}).get('enabled') for k in ('resonatorR', 'wireWorld', 'sonicCrystal', 'bubbleChamber', 'bassFace')):
        return True
    return bool(((modes.get('loopD') or {}).get('mutilator') or {}).get('enabled'))


SAMPLE_CUT_LANES = {
    'bastardA': 'bastardLoopEnabled', 'bastardB': 'bastardLoop2Enabled',
    'bastardC': 'bastardLoop3Enabled', 'bastardV': 'bastardLoopVEnabled',
    'bastardW': 'bastardLoopWEnabled', 'bastardP': 'bastardLoopPEnabled',
    'bastardO': 'bastardLoopOEnabled', 'bastardM': 'bastardLoopMEnabled',
    'bastardMPlus': 'bastardLoopMPlusEnabled', 'bastardK': 'bastardLoopKEnabled',
    'dropboxSample': 'dropboxSampleLayerEnabled', 'bastardL': 'bastardLoopLEnabled',
    'bastardX': 'bastardLoopXEnabled',
}


def sample_cut_version(snapshot):
    modes = snapshot.get('state', {}).get('modes', {})
    for asset in snapshot.get('assets', []):
        key = asset.get('key')
        if key == 'bastardD' and modes.get('loopD', {}).get('enabled') is True:
            return 1
        if key in SAMPLE_CUT_LANES and modes.get(SAMPLE_CUT_LANES[key]) is True:
            if key in ('bastardL', 'bastardX') and modes.get('bastardLoop' + key[-1] + 'SourceMode') == 'synth':
                continue
            return 1
    return 0


def routed_solo_effects(state, extra=None):
    """Derived from saved source masks; never persist monitoring effect selections."""
    modes = state.get('modes', {})
    def selected(v):
        return [str(k).strip() for k in (v if isinstance(v, list) else str(v or '').split(',')) if str(k).strip().lower() not in ('', 'none')]
    loops = selected(modes.get('loopLayerSolo'))
    source = selected((extra or {}).get('performanceSourceLayerSolo'))
    sources = set()
    for key in ('A','B','C','D','V','W','P','O','L','X','Q','M','M+'):
        if 'bastard' + ('mplus' if key == 'M+' else key.lower()) in loops:
            sources.add(key)
    if 'dropbox' in loops: sources.add('sample')
    if 'noise' in loops: sources.add('N')
    if 'bastardk' in loops: sources.update('K' + str(i) for i in range(1, 6))
    lanes = ('kick','snare','hat','perc','clap','cymbals','etc','roll') if 'drums' in loops else selected(modes.get('drumMachineLaneSolos'))
    sources.update('drum' + lane[0].upper() + lane[1:].lower() for lane in lanes)
    if modes.get('generatedSampleSolo') is True or 'loop' in source or 'generated' in selected(modes.get('sourceWaveformSolo')):
        sources.add('generated')
    if source or loops or selected(modes.get('grainLayerSolo')) or selected(modes.get('sourceWaveformSolo')):
        sources.add('*')
    def matches(selection):
        return bool(sources) if selection == 'all' else any(k != '*' and (selection == k or selection == 'K' and k in ('K1','K2','K3','K4','K5') or selection == 'drums' and k.startswith('drum')) for k in sources)
    values = {**modes, 'mutilator': (modes.get('loopD') or {}).get('mutilator') or {}, 'resonator': modes.get('resonatorR') or {}, 'playground': (modes.get('wasp') or {}).get('playground') or {}}
    out = []
    for key in ('resonator','turntable','playground','mutilator','bassFace','sonicCrystal','bubbleChamber','wireWorld','wasp'):
        v = values.get(key) or {}
        if v.get('enabled') is not True: continue
        if key == 'resonator':
            inputs = [s.get('source') or 'drumKick' for i, s in enumerate(v.get('slots', [{'enabled': True, 'source': 'drumKick', 'level': .45}])) if s.get('enabled', i == 0) and s.get('level', .45) > 0]
        elif key == 'wasp':
            if v.get('blend', .5) <= 0: continue
            inputs = [k for s in v.get('routes', [])[:2] if s.get('enabled') and s.get('depth') != 0 for k in (s.get('source') or 'V', s.get('destination') or 'X')]
        elif key == 'turntable':
            inputs = [v.get('input') or ('drums' if v.get('route') == 'drums' else 'all')]
        elif key == 'playground':
            if v.get('mix', .5) <= 0: continue
            inputs = [v.get('input') or 'all']
        elif key in ('mutilator', 'bassFace'):
            if v.get('mix', .5) <= 0 or v.get('amount', .5) <= 0: continue
            inputs = [v.get('input') or ('D' if key == 'mutilator' else 'X')]
        else:
            if v.get('level', .5) <= 0: continue
            inputs = [v.get('source') or 'all']
        if any(matches(k) for k in inputs): out.append(key)
    return out


def effect_output_render_version(state, extra=None):
    modes = state.get('modes', {})
    if routed_solo_effects(state, extra):
        return 5
    if (modes.get('masterBaker') or {}).get('enabled') is True:
        return 4
    if (modes.get('effectOutput') or {}).get('mainMuted') is True:
        return 3
    def selected(value):
        values = value if isinstance(value, list) else str(value or '').split(',')
        return any(str(v).strip().lower() not in ('', 'none') for v in values)
    if (modes.get('generatedSampleSolo') is True
            or any(selected(modes.get(k)) for k in ('loopLayerSolo', 'grainLayerSolo', 'sourceWaveformSolo', 'drumMachineLaneSolos'))
            or selected((extra or {}).get('performanceSourceLayerSolo'))):
        return 2
    return 1 if needs_effect_output_render(state) else 0


COOKING_POT_KEYS = ('mutilator', 'bassFace', 'turntable', 'resonator', 'wireWorld', 'sonicCrystal', 'bubbleChamber', 'wasp', 'playground')
def validate_cooking_pot(value):
    if value is None:
        return
    if not isinstance(value, dict) or value.get('version') != 1 or type(value.get('enabled')) is not bool:
        raise ValueError('Invalid cooking pot settings.')
    order = value.get('order')
    if not isinstance(order, list) or len(order) != len(COOKING_POT_KEYS) or any(not isinstance(k, str) for k in order) or set(order) != set(COOKING_POT_KEYS):
        raise ValueError('The cooking pot must contain each of the nine effects exactly once.')

def needs_cooking_pot_render(state):
    return bool((state.get('modes', {}).get('cookingPot') or {}).get('enabled') and needs_effect_output_render(state))

def cooking_pot_render_version(state):
    if not needs_cooking_pot_render(state):
        return 0
    modes = state['modes']
    w = modes.get('wasp') or {}
    values = {**modes, 'mutilator': (modes.get('loopD') or {}).get('mutilator') or {}, 'resonator': modes.get('resonatorR') or {}, 'wasp': w, 'playground': w.get('playground') or {}}
    def slots(v):
        raw = v.get('slots') or []
        return [{**{'enabled': i == 0, 'level': .45, 'source': 'drumKick' if i == 0 else 'X'}, **(raw[i] if i < len(raw) else {})} for i in range(2)]
    def scope(key):
        v = values.get(key) or {}
        if key == 'resonator':
            return [x['source'] for x in slots(v) if x['enabled'] and x['level'] > 0]
        if key == 'wasp':
            return ['all']
        if key == 'turntable':
            return [v.get('input') or ('drums' if v.get('route') == 'drums' else 'all')]
        return [v.get('input') or v.get('source') or ('D' if key == 'mutilator' else 'X' if key == 'bassFace' else 'all')]
    def leaves(keys):
        return {leaf for key in keys for leaf in ([f'K{i}' for i in range(1, 6)] if key == 'K' else [k for k in CHARACTER_INPUTS if k.startswith('drum') and k != 'drums'] if key == 'drums' else [key])}
    active = []
    for key in (modes.get('cookingPot') or {}).get('order', COOKING_POT_KEYS):
        v = values.get(key) or {}
        if not v.get('enabled'):
            continue
        if key == 'resonator' and not scope(key):
            continue
        if key in ('mutilator', 'bassFace') and (v.get('mix', .5) <= 0 or v.get('amount', .5) <= 0):
            continue
        if key in ('wireWorld', 'sonicCrystal', 'bubbleChamber') and v.get('level', .5) <= 0:
            continue
        selections = [[x['source']] for x in slots(v) if x['enabled'] and x['level'] > 0] if key == 'resonator' else [scope(key)]
        if any('all' not in selection and not leaves(scope(prior)).issubset(leaves(selection)) for selection in selections for prior in active):
            return 3
        active.append(key)
    return 2


def apply_cooking_pot_content(content, state):
    modes = state['modes']
    content['state']['modes'].pop('cookingPot', None)
    if not needs_cooking_pot_render(state):
        return False
    # Routing v3 keeps source provenance across serial wet branches.
    # Keep them in the content identity; only affected Pot-on freezes regenerate.
    target = content['state']['modes']
    target['cookingPot'] = json.loads(json.dumps(modes['cookingPot']))
    content['cookingPotEngineRevision'] = cooking_pot_render_version(state)
    for key in ('bassFace', 'turntable', 'resonatorR', 'wireWorld', 'sonicCrystal', 'bubbleChamber', 'wasp'):
        value = modes.get(key)
        if value and (value.get('enabled') or key == 'wasp' and (value.get('playground') or {}).get('enabled')):
            target[key] = json.loads(json.dumps(value))
    mutilator = (modes.get('loopD') or {}).get('mutilator')
    if mutilator and mutilator.get('enabled'):
        target['loopD'] = {**target.get('loopD', {}), 'mutilator': json.loads(json.dumps(mutilator))}
    return True


def validate_effect_output(value):
    if value is None:
        return
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('throughMain'), dict):
        raise ValueError('Invalid effect output routing.')
    if 'mainMuted' in value and type(value['mainMuted']) is not bool:
        raise ValueError('Invalid main-output mute switch.')
    allowed = {'resonator', 'turntable', 'playground', 'mutilator', 'bassFace', 'sonicCrystal', 'bubbleChamber', 'wireWorld', 'wasp'}
    if any(k not in allowed or type(v) is not bool for k, v in value['throughMain'].items()):
        raise ValueError('Invalid effect main-output switch.')


def validate_character_fx(modes):
    bass = modes.get('bassFace')
    if bass is not None:
        if not isinstance(bass, dict) or bass.get('version', 1) != 1:
            raise ValueError('Invalid Bass Face settings.')
        if bass.get('input', 'X') not in CHARACTER_INPUTS or bass.get('strain', 'velvet-valve') not in BASS_FACE_STRAINS:
            raise ValueError('Invalid Bass Face input or strain.')
        for key in ('enabled', 'rhythm'):
            if key in bass and type(bass[key]) is not bool:
                raise ValueError('Invalid Bass Face switch.')
        for key in ('amount', 'tone', 'mix', 'body'):
            if key in bass and (type(bass[key]) not in (float, int) or not math.isfinite(bass[key]) or not 0 <= bass[key] <= 1):
                raise ValueError('Invalid Bass Face '+key+'.')
    mutilator = (modes.get('loopD') or {}).get('mutilator') or {}
    if isinstance(mutilator, dict) and 'input' in mutilator and mutilator['input'] not in CHARACTER_INPUTS:
        raise ValueError('Invalid Mutilator input.')

def needs_character_fx(modes):
    bass = modes.get('bassFace') or {}
    mutilator = (modes.get('loopD') or {}).get('mutilator') or {}
    def active(value, default_input):
        if not isinstance(value, dict) or value.get('enabled') is not True or value.get('input', default_input) == 'DAW':
            return False
        try:
            return float(value.get('amount', .5)) > 0 and float(value.get('mix', .5)) > 0
        except (TypeError, ValueError):
            return False
    return active(bass, 'X') or (isinstance(mutilator, dict) and mutilator.get('input', 'D') != 'D' and active(mutilator, 'D'))

SONGS_ROOT = pathlib.Path('/srv/sftp/mark_sftp/files/mygrain-songs')
MAX_UPLOAD = 128 * 1024 * 1024
MAX_PARTS = 64
SONG_LOCK = threading.RLock()
EDIT_LEASE_SECONDS = 600
ACCOUNT_IDENTITY = lambda: None
PART_MANIFEST_CACHE = OrderedDict()
PART_MANIFEST_CACHE_LOCK = threading.Lock()
PART_MANIFEST_CACHE_BYTES = 8 * 1024 * 1024
SERVER_ARM_MODULE = None
SERVER_ARM_MODULE_LOCK = threading.Lock()
K_CONVERSION_LOCK = threading.Lock()
K_CONVERSION_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'convert-k-snapshot.cjs'
FX_CONVERSION_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'convert-fx-snapshot.cjs'
W_CONVERSION_SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'convert-w-snapshot.cjs'


def server_arm_module():
    global SERVER_ARM_MODULE
    if SERVER_ARM_MODULE is None:
        # Song locks are account-scoped; simultaneous accounts must still share
        # one queue/executor, including the very first capability request.
        with SERVER_ARM_MODULE_LOCK:
            if SERVER_ARM_MODULE is None:
                import importlib.util
                spec = importlib.util.spec_from_file_location('mygrain_server_arm', pathlib.Path(__file__).with_name('mygrain_server_arm.py'))
                module = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(module)
                SERVER_ARM_MODULE = module
    return SERVER_ARM_MODULE


def convert_snapshot_metadata(snapshot, script, lane):
    """Use the canonical, bounded server migration without decoding any audio."""
    if not shutil.which('node') or not script.is_file():
        raise ValueError(f'Server {lane} conversion is unavailable. No saved part was changed.')
    try:
        result = subprocess.run(['node', '--max-old-space-size=128', str(script)],
            input=json.dumps(snapshot), text=True, capture_output=True, timeout=15)
    except subprocess.TimeoutExpired:
        raise ValueError(f'Server {lane} conversion timed out. No saved part was changed.') from None
    if result.returncode:
        raise ValueError(f'Server {lane} conversion failed: ' + result.stderr.strip()[:500])
    converted = json_object(json.loads(result.stdout))
    if json_object(converted.get('snapshot')).get('assets') != snapshot['assets']:
        raise ValueError(f'{lane} conversion attempted to change recorded audio. Nothing was saved.')
    return converted


def convert_k_snapshot(snapshot):
    return convert_snapshot_metadata(snapshot, K_CONVERSION_SCRIPT, 'K')


def convert_w_snapshot(snapshot):
    return convert_snapshot_metadata(snapshot, W_CONVERSION_SCRIPT, 'W')


def convert_song_k(folder, original, edit_headers):
    return convert_song_metadata(folder, original, edit_headers, convert_k_snapshot, K_CONVERSION_SCRIPT, 'K')


def convert_song_w(folder, original, edit_headers):
    return convert_song_metadata(folder, original, edit_headers, convert_w_snapshot, W_CONVERSION_SCRIPT, 'W')


def convert_fx_snapshot(snapshot):
    return convert_snapshot_metadata(snapshot, FX_CONVERSION_SCRIPT, 'FX')


def convert_song_fx(folder, original, edit_headers):
    return convert_song_metadata(folder, original, edit_headers, convert_fx_snapshot, FX_CONVERSION_SCRIPT, 'FX')


def convert_song_metadata(folder, original, edit_headers, converter, script, lane):
    """Stage metadata-only lane conversions; commit the whole Song in one revision.

    The canonical JS migration runs on the server. WAV entries are streamed
    unchanged, old archives remain in history, and no browser/source decode is
    involved. The account/storage lock is already held by the route.
    """
    if not shutil.which('node') or not script.is_file():
        raise ValueError(f'Server {lane} conversion is unavailable. No saved part was changed.')
    with K_CONVERSION_LOCK:
        song = copy.deepcopy(original)
        used = {part.get('sourcePartId', part['id']) for part in song['parts']}
        sources = [part for part in song['parts'] + song.get('sharedParts', [])
                   if 'sourcePartId' not in part and part['id'] in used]
        staged, published = [], []
        committed = False
        try:
            for part in sources:
                record = read_part_manifest_record(folder, part)
                snapshot = record['snapshot']
                expected_audio = {asset['path']: asset['sha256'] for asset in record['audioAssets']}
                converted = converter(snapshot)
                if converted.get('changed') is not True:
                    continue
                updated_snapshot = json_object(converted.get('snapshot'))
                if updated_snapshot.get('assets') != snapshot['assets']:
                    raise ValueError(f'{lane} conversion attempted to change recorded audio. Nothing was saved.')
                filename = f'{part["id"]}-{secrets.token_hex(16)}.zip'
                temporary = folder / 'parts' / f'.convert-{lane.lower()}-{secrets.token_hex(16)}.tmp'
                staged.append((temporary, folder / 'parts' / filename))
                with zipfile.ZipFile(folder / 'parts' / part.get('archive', f'{part["id"]}.zip')) as source, \
                     zipfile.ZipFile(temporary, 'w', compression=zipfile.ZIP_STORED) as target:
                    for entry in source.infolist():
                        if entry.filename == 'song-part.json':
                            target.writestr(copy.copy(entry), json.dumps(updated_snapshot, separators=(',', ':')).encode())
                        else:
                            with source.open(entry) as incoming, target.open(copy.copy(entry), 'w') as outgoing:
                                audio_hash = hashlib.sha256()
                                for chunk in iter(lambda: incoming.read(1024 * 1024), b''):
                                    audio_hash.update(chunk)
                                    outgoing.write(chunk)
                                if audio_hash.hexdigest() != expected_audio.get(entry.filename):
                                    raise ValueError('Recorded audio changed during conversion. No saved part was changed.')
                with temporary.open('rb') as saved:
                    os.fsync(saved.fileno())
                body = temporary.read_bytes()
                if len(body) > MAX_UPLOAD:
                    raise ValueError('Converted part exceeds the 128 MB saved-part limit. No saved part was changed.')
                details = validate_part_zip(body)
                digest, length = hashlib.sha256(body).hexdigest(), len(body)
                del body
                song.setdefault('history', []).append(copy.deepcopy(part))
                old_digest = part['sha256']
                part.update(details, sha256=digest, bytes=length, archive=filename,
                            revision=part.get('revision', 1) + 1, updatedAt=time.time())
                if 'qVersion' not in details:
                    part.pop('qVersion', None)
                # This migration is exclusively metadata: all source WAVs and
                # existing playback files remain archived byte-for-byte. FX renders
                # are refreshed explicitly by Arm using loopFxVersion.
                if part.get('render', {}).get('sourceSha256') == old_digest:
                    part['render'] = {**part['render'], 'sourceSha256': digest}
                else:
                    part.pop('render', None)
            if not staged:
                return original, 0
            require_song_editor(folder, original, edit_headers)
            for temporary, destination in staged:
                # Never replace an existing source or cache file, even on failure.
                os.link(temporary, destination)
                published.append(destination)
                temporary.unlink()
            write_song(folder, song, edit_headers=edit_headers)
            committed = True
            return song, len(staged)
        finally:
            for temporary, _ in staged:
                temporary.unlink(missing_ok=True)
            if not committed:
                for destination in published:
                    destination.unlink(missing_ok=True)


class PartConflictError(ValueError):
    pass


class SongEditError(ValueError):
    def __init__(self, message, status=423, code='SONG_LOCK_REQUIRED', lock=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.lock = lock


@contextmanager
def song_storage_lock():
    with SONG_LOCK:
        SONGS_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
        with (SONGS_ROOT / '.storage.lock').open('a') as lock_file:
            fcntl.flock(lock_file, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file, fcntl.LOCK_UN)


def read_edit_lock(folder):
    path = folder / '.edit-lock.json'
    if not path.exists():
        return None
    lock = json.loads(path.read_text())
    return lock if lock['expiresAt'] > time.time() else None


def public_edit_lock(lock):
    return {'label': lock['label'], 'expiresAt': lock['expiresAt'],
            'recoveryId': hashlib.sha256(('mygrain-song-recovery:' + lock['tokenHash']).encode('ascii')).hexdigest()} if lock else None


def write_edit_lock(folder, lock):
    temporary = folder / f'.lock-{secrets.token_hex(8)}.tmp'
    try:
        with temporary.open('x', encoding='utf-8') as output:
            json.dump(lock, output)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(folder / '.edit-lock.json')
    finally:
        temporary.unlink(missing_ok=True)


def matches_edit_lock(lock, headers):
    token = headers.get('X-Mygrain-Song-Lock', '')
    return bool(lock and re.fullmatch(r'[a-f0-9]{64}', token)
                and secrets.compare_digest(lock['tokenHash'], hashlib.sha256(token.encode('ascii')).hexdigest())
                and lock['sessionId'] == headers.get('X-Mygrain-Song-Session')
                and lock['deviceId'] == headers.get('X-Mygrain-Song-Device'))


def check_song_revision(song, headers):
    if headers.get('If-Match') != f'"{song.get("revision", 1)}"':
        raise SongEditError('This song changed on the server. Refresh Songs before editing; your live pattern has not been discarded.', 409, 'SONG_REVISION_CONFLICT')


def require_song_editor(folder, song, headers):
    lock = read_edit_lock(folder)
    if not matches_edit_lock(lock, headers):
        raise SongEditError('This song is read-only. Use Edit Song to obtain a current editing lock.', lock=public_edit_lock(lock))
    check_song_revision(song, headers)


def handle_edit_lock(handler, folder, song, action):
    lock = read_edit_lock(folder)
    token = None
    if action in ('acquire', 'recover'):
        if lock and action == 'acquire':
            raise SongEditError(f'This song is being edited on {lock["label"]}. Playback is still available.', code='SONG_LOCKED', lock=public_edit_lock(lock))
        payload = json_object(handler.read_json())
        for field in ('deviceId', 'sessionId'):
            if not isinstance(payload.get(field), str) or not re.fullmatch(r'[a-f0-9]{32}', payload[field]):
                raise ValueError('A valid browser installation and editing session are required.')
        label = clean_name(payload.get('label'))
        check_song_revision(song, handler.headers)
        if action == 'recover':
            expected = payload.get('recoveryId')
            if not lock or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected) or not secrets.compare_digest(expected, public_edit_lock(lock)['recoveryId']):
                raise SongEditError('The editing lock changed. Check the current lock before recovering it.', code='SONG_LOCK_CHANGED', lock=public_edit_lock(lock))
            if label.lower() != lock['label'].strip().lower():
                raise SongEditError('Only a lock with the same device name can be cleared here.', code='SONG_LOCK_NAME_MISMATCH', lock=public_edit_lock(lock))
        token = secrets.token_hex(32)
        lock = {**{field: payload[field] for field in ('deviceId', 'sessionId')}, 'label': label,
                'tokenHash': hashlib.sha256(token.encode('ascii')).hexdigest(), 'expiresAt': time.time() + EDIT_LEASE_SECONDS}
        write_edit_lock(folder, lock)
    elif action in ('renew', 'release'):
        if not matches_edit_lock(lock, handler.headers):
            raise SongEditError('Your editing lock expired or belongs to another session. Refresh Songs and use Edit Song again.', code='SONG_LOCK_LOST', lock=public_edit_lock(lock))
        if action == 'release':
            (folder / '.edit-lock.json').unlink(missing_ok=True)
            lock = None
        else:
            lock['expiresAt'] = time.time() + EDIT_LEASE_SECONDS
            write_edit_lock(folder, lock)
    else:
        raise FileNotFoundError('Song endpoint not found.')
    return {'ok': True, 'lock': public_edit_lock(lock), 'serverTime': time.time(), 'leaseSeconds': EDIT_LEASE_SECONDS,
            **({'token': token, 'song': public_song(song)} if token else {})}


def owner_hash(headers):
    account = ACCOUNT_IDENTITY()
    if account is not None:
        return hashlib.sha256(f'mygrain-account:{account["id"]}'.encode('ascii')).hexdigest()
    key = headers.get('X-Mygrain-Song-Key', '')
    if not re.fullmatch(r'[a-f0-9]{64}', key):
        raise PermissionError('A song-library key is required.')
    return hashlib.sha256(key.encode('ascii')).hexdigest()


def clean_name(value):
    name = str(value or '').strip()
    if not name or len(name) > 100 or any(ord(character) < 32 for character in name):
        raise ValueError('Use a name between 1 and 100 characters.')
    return name


def json_object(value):
    if not isinstance(value, dict):
        raise ValueError('Expected a JSON object.')
    return value


def checked_repeats(value):
    if isinstance(value, bool) or not re.fullmatch(r'\d{1,2}', str(value)):
        raise ValueError('Pattern repeats must be a whole number from 1 to 64.')
    repeats = int(value)
    if not 1 <= repeats <= 64:
        raise ValueError('Pattern repeats must be a whole number from 1 to 64.')
    return repeats


def full_pattern_steps(part):
    return part['patternSteps'] * part.get('patternCycleMultiplier', 1)


def checked_playback_steps(value, source):
    if type(value) is not int or not 1 <= value <= full_pattern_steps(source):
        raise ValueError(f'Part steps must be a whole number from 1 to {full_pattern_steps(source)}.')
    return value


def checked_colour(value):
    if value is None:
        return None
    if not isinstance(value, str) or not re.fullmatch(r'#[a-fA-F0-9]{6}', value):
        raise ValueError('Choose a six-digit hex colour or clear the colour.')
    return value.lower()


def song_path(song_id):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}-[a-f0-9]{8}', song_id):
        raise ValueError('Invalid song ID.')
    path = SONGS_ROOT / song_id
    if path.is_symlink() or path.resolve().parent != SONGS_ROOT.resolve():
        raise ValueError('Invalid song path.')
    return path


def read_song(song_id, owner):
    folder = song_path(song_id)
    manifest_path = folder / 'song.json'
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise FileNotFoundError('Song not found.')
    song = json.loads(manifest_path.read_text())
    account = ACCOUNT_IDENTITY()
    if not (account is not None and account['is_admin']) and not secrets.compare_digest(song.get('ownerHash', ''), owner):
        raise FileNotFoundError('Song not found.')
    song.setdefault('revision', 1)
    return folder, song


def source_part(song, part):
    source_id = part.get('sourcePartId', part['id'])
    source = next((entry for entry in song['parts'] + song.get('sharedParts', []) if entry['id'] == source_id and 'sourcePartId' not in entry), None)
    if source is None:
        raise ValueError('The reused part source is unavailable.')
    return source


def public_song(song):
    result = {key: value for key, value in song.items() if key not in ('ownerHash', 'deletedParts', 'history', 'sharedParts')}
    result['parts'] = []
    for part in song['parts']:
        source = source_part(song, part)
        merged = {**source, **part}
        # Playback cuts belong to occurrences, never inherited from the source.
        if 'playbackSteps' in source or 'playbackSteps' in part:
            merged['playbackSteps'] = part.get('playbackSteps', full_pattern_steps(source))
        result['parts'].append(merged)
    result['revision'] = song.get('revision', 1)
    return result


def upload_body(handler):
    length = int(handler.headers.get('Content-Length', '0'))
    if not 1 <= length <= MAX_UPLOAD:
        raise ValueError('Upload must be between 1 byte and 128 MB.')
    body = handler.rfile.read(length)
    if len(body) != length:
        raise ValueError('Upload was interrupted.')
    return body


def publish_asset(folder, song, filename, body, edit_headers=None, advance_revision=True):
    destination = folder / 'parts' / filename
    temporary = destination.with_suffix(f'.{secrets.token_hex(8)}.tmp')
    existed = destination.exists()
    try:
        with temporary.open('xb') as output:
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(destination)
        write_song(folder, song, edit_headers=edit_headers, advance_revision=advance_revision)
    except Exception:
        if not existed:
            destination.unlink(missing_ok=True)
        raise
    finally:
        temporary.unlink(missing_ok=True)


def read_part_manifest_record(folder, part):
    # Cache only small JSON, never original/decoded audio. File identity and the
    # exact source hash prevent reuse across amendments, accounts or file edits.
    filename = part.get('archive', f'{part["id"]}.zip')
    if not re.fullmatch(r'[a-f0-9-]+\.zip', filename):
        raise ValueError('Invalid part asset.')
    path = folder / 'parts' / filename
    if path.is_symlink() or not path.is_file():
        raise FileNotFoundError('Part asset not found.')
    stat = path.stat()
    if not 1 <= stat.st_size <= MAX_UPLOAD:
        raise ValueError('Invalid saved part size.')
    identity = (str(path.resolve()), part['sha256'], stat.st_dev, stat.st_ino,
                stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
    with PART_MANIFEST_CACHE_LOCK:
        cached = PART_MANIFEST_CACHE.get(identity)
        if cached is not None:
            PART_MANIFEST_CACHE.move_to_end(identity)
    if cached is not None:
        return json.loads(cached)
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != part['sha256']:
        raise ValueError('Saved part integrity check failed. No audio was prepared.')
    # Keep full archive/audio validation on the server before allowing a client
    # to trust metadata in place of downloading and inspecting the entire ZIP.
    validate_part_zip(body)
    with zipfile.ZipFile(BytesIO(body)) as archive:
        snapshot = json.loads(archive.read('song-part.json'))
        audio_assets = []
        for asset in snapshot['assets']:
            audio = archive.read(asset['path'])
            audio_assets.append({'key': asset['key'], 'path': asset['path'],
                                 'bytes': len(audio), 'sha256': hashlib.sha256(audio).hexdigest(),
                                 'pcm16': (audio[12:20] == b'fmt \x10\0\0\0' and audio[20:22] == b'\x01\0'
                                           and audio[34:38] == b'\x10\0da' and audio[36:40] == b'data'
                                           and len(audio) == 44 + int.from_bytes(audio[40:44], 'little'))})
        snapshot = json.dumps({'snapshot': snapshot, 'audioAssets': audio_assets}, separators=(',', ':')).encode('utf-8')
    after = path.stat()
    if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) != identity[2:]:
        raise PartConflictError('The saved part changed during inspection. Refresh Songs and arm again.')
    with PART_MANIFEST_CACHE_LOCK:
        PART_MANIFEST_CACHE[identity] = snapshot
        PART_MANIFEST_CACHE.move_to_end(identity)
        while PART_MANIFEST_CACHE and (len(PART_MANIFEST_CACHE) > 64
                or sum(map(len, PART_MANIFEST_CACHE.values())) > PART_MANIFEST_CACHE_BYTES):
            PART_MANIFEST_CACHE.popitem(last=False)
    return json.loads(snapshot)


def read_part_manifest(folder, part):
    return read_part_manifest_record(folder, part)['snapshot']


def read_part_audio(folder, part, key):
    # Resolve only a validated manifest key, never a caller-supplied ZIP path.
    record = read_part_manifest_record(folder, part)
    asset = next((asset for asset in record['audioAssets'] if asset['key'] == key), None)
    if asset is None:
        raise FileNotFoundError('Saved sound not found.')
    filename = part.get('archive', f'{part["id"]}.zip')
    with zipfile.ZipFile(folder / 'parts' / filename) as archive:
        body = archive.read(asset['path'])
    if len(body) != asset['bytes'] or hashlib.sha256(body).hexdigest() != asset['sha256']:
        raise ValueError('Saved sound integrity check failed. No audio was prepared.')
    return body


def send_asset(handler, folder, filename, content_type):
    if not re.fullmatch(r'[a-f0-9-]+\.(zip|wav)', filename):
        raise ValueError('Invalid part asset.')
    source_path = folder / 'parts' / filename
    if source_path.is_symlink() or not source_path.is_file():
        raise FileNotFoundError('Part asset not found.')
    handler.send_response(200)
    handler.send_header('Content-Type', content_type)
    handler.send_header('Content-Length', str(source_path.stat().st_size))
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()
    with source_path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            handler.wfile.write(chunk)


def full_copy_part(folder, song, occurrence, part, edit_headers):
    if len(song['parts']) >= MAX_PARTS:
        raise ValueError('The beta supports up to 64 parts per song.')

    def checked_asset(filename, digest, extension):
        if not re.fullmatch(r'[a-f0-9-]+\.' + extension, filename):
            raise ValueError('Invalid copied part asset.')
        path = folder / 'parts' / filename
        if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_UPLOAD:
            raise ValueError('The saved part asset is unavailable or too large.')
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != digest:
            raise ValueError('Saved part integrity check failed. No copy was created.')
        return body

    archive = checked_asset(part.get('archive', f'{part["id"]}.zip'), part['sha256'], 'zip')
    details = validate_part_zip(archive)
    part_id = secrets.token_hex(16)
    suffix = '_full_copy'
    copied = {**copy.deepcopy(part), **details, 'id': part_id,
              'name': part['name'][:100 - len(suffix)] + suffix, 'repeats': occurrence['repeats'],
              'createdAt': time.time(), 'revision': 1, 'archive': f'{part_id}.zip', 'bytes': len(archive)}
    for field in ('sourcePartId', 'updatedAt', 'render'):
        copied.pop(field, None)
    copied.pop('playbackSteps', None)
    if 'playbackSteps' in occurrence:
        copied['playbackSteps'] = checked_playback_steps(occurrence['playbackSteps'], part)
    assets = {copied['archive']: archive}
    render = part.get('render')
    if render and render.get('sourceSha256') == part['sha256']:
        body = checked_asset(render['file'], render['sha256'], 'wav')
        validate_render(body, copied)
        filename = f'{part_id}-{render["sha256"]}.wav'
        copied['render'] = {**copy.deepcopy(render), 'file': filename}
        assets[filename] = body
    published = []
    temporary = None
    owns_temporary = False
    try:
        for filename, body in assets.items():
            destination = folder / 'parts' / filename
            if destination.exists() or destination.is_symlink():
                raise ValueError('Copy identity collision. Try again.')
            temporary = folder / 'parts' / f'.full-copy-{secrets.token_hex(8)}.tmp'
            with temporary.open('xb') as output:
                owns_temporary = True
                output.write(body)
                output.flush()
                os.fsync(output.fileno())
            temporary.replace(destination)
            owns_temporary = False
            published.append(destination)
        song['parts'].append(copied)
        write_song(folder, song, edit_headers=edit_headers)
    except Exception:
        for path in published:
            path.unlink(missing_ok=True)
        raise
    finally:
        if temporary is not None and owns_temporary:
            temporary.unlink(missing_ok=True)
    return copied


def validate_render(body, part):
    with wave.open(BytesIO(body), 'rb') as audio:
        frames = audio.getnframes()
        rate = audio.getframerate()
        duration = 60 / part['bpm'] * part['patternSteps'] / 4 * part.get('patternCycleMultiplier', 1)
        if audio.getnchannels() != 2 or audio.getsampwidth() != 2 or not 8000 <= rate <= 192000 or abs(frames - round(duration * rate)) > 1:
            raise ValueError('Song render must be stereo PCM16 and exactly one saved pattern long.')
        if len(audio.readframes(frames)) != frames * 4:
            raise ValueError('Song render is truncated.')
    return {'frames': frames, 'sampleRate': rate, 'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'sourceSha256': part['sha256'], 'version': 1}


def write_song(folder, song, edit_headers=None, advance_revision=True):
    if edit_headers is not None:
        require_song_editor(folder, song, edit_headers)
    if advance_revision:
        song['revision'] = song.get('revision', 0) + 1
    temporary = folder / f'.song-{secrets.token_hex(8)}.tmp'
    try:
        with temporary.open('x', encoding='utf-8') as output:
            json.dump(song, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        temporary.replace(folder / 'song.json')
    finally:
        temporary.unlink(missing_ok=True)


def validate_q_piano(state, assets):
    piano = state.get('q')
    asset = next((item for item in assets if item.get('key') == 'bastardQ'), None)
    if piano is None:
        if asset:
            raise ValueError('Q piano audio has no saved settings.')
        return False
    if not isinstance(piano, dict) or type(piano.get('version')) is not int or piano['version'] != 1:
        raise ValueError('Unsupported Q piano version.')
    instrument = piano.get('instrument', 'piano')
    if instrument not in ('piano', 'strings'):
        raise ValueError('Unsupported Q instrument.')
    source = piano.get('soundSource', instrument)
    if source not in ('piano','strings','osc','grain','sample'):
        raise ValueError('Unsupported Q sound source.')
    string_sections = {'cello': [36, 40, 43, 47], 'viola': [48, 50, 52, 55, 59, 62],
                       'violin': [66, 69, 72, 76, 79, 83, 86]}
    string_roots = [pitch for section in string_sections.values() for pitch in section]
    expected_bank = 'vsco2-ce-q-strings-2layer-44100-v1' if instrument == 'strings' else 'salamander-v3-q-4layer-44100-v1'
    for key, minimum, maximum, default in [('room', 0, 1, 0), ('delay', 0, 1, 0), ('feedback', 0, .8, .32), ('delayBeats', 1 / 12, 6, .5)]:
        value = piano.get(key, default)
        if type(value) not in (int, float) or not minimum <= value <= maximum:
            raise ValueError('Invalid Q piano effect setting.')
    if 'paletteTranspose' in piano and (type(piano['paletteTranspose']) is not int or not -24 <= piano['paletteTranspose'] <= 24):
        raise ValueError('Invalid Q candidate transpose.')
    if 'chordHold' in piano and type(piano['chordHold']) is not bool:
        raise ValueError('Invalid Q chord hold flag.')
    if 'arpEnabled' in piano and type(piano['arpEnabled']) is not bool:
        raise ValueError('Invalid Q arpeggiator enabled flag.')
    if piano.get('arpPattern', 'up') not in ('up', 'down', 'updown', 'odds', 'evens', 'custom') or piano.get('arpRepeat', 'once') not in ('once', 'until-next'):
        raise ValueError('Invalid Q arpeggiator order or repeat mode.')
    if 'performanceVersion' in piano and (type(piano['performanceVersion']) is not int or piano['performanceVersion'] != 6):
        raise ValueError('Unsupported Q performance version.')
    for key in ('sampleLength', 'sampleDecay'):
        value = piano.get(key, 1)
        if type(value) not in (int, float) or not .05 <= value <= 1:
            raise ValueError('Invalid Q sample length or decay.')
    arp_steps = piano.get('arpSteps')
    if 'arpSteps' in piano or piano.get('arpPattern') == 'custom':
        if not isinstance(arp_steps, list) or not 1 <= len(arp_steps) <= 32 or any(type(rank) is not int or not 0 <= rank <= 8 for rank in arp_steps):
            raise ValueError('Invalid Q custom arp pulses.')
    division = piano.get('arpDivision', .25)
    if type(division) not in (int, float) or not .03125 <= division <= 4:
        raise ValueError('Invalid Q arpeggiator time division.')
    sequence = piano.get('sequence')
    if not isinstance(sequence, list) or len(sequence) != 64:
        raise ValueError('Q piano sequence is incomplete.')
    for step in sequence:
        if step is None:
            continue
        if isinstance(step, dict) and step.get('kind') == 'accent' and step.get('notes') == [] and step.get('accent') is True and step.get('rest') is not True:
            continue
        if not isinstance(step, dict) or not isinstance(step.get('notes'), list) or not 1 <= len(step['notes']) <= 8 or any(type(note) is not int or not 21 <= note <= 108 for note in step['notes']):
            raise ValueError('Invalid Q chord notes.')
        if 'customChord' in step and type(step['customChord']) is not bool:
            raise ValueError('Invalid Q custom chord origin.')
        if 'customChordId' in step and (step.get('customChord') is not True or not isinstance(step['customChordId'], str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', step['customChordId'])):
            raise ValueError('Invalid Q custom chord identity.')
        if 'customChordColour' in step and (step.get('customChord') is not True or type(step['customChordColour']) is not int or not 0 <= step['customChordColour'] < 3600):
            raise ValueError('Invalid Q custom chord colour.')
        if type(step.get('velocity')) is not int or not 1 <= step['velocity'] <= 127 or not isinstance(step.get('gate'), (int, float)) or not .1 <= step['gate'] <= 64:
            raise ValueError('Invalid Q chord velocity or length.')
    if source in ('osc','grain','sample'):
        if piano.get('bank') or asset:
            raise ValueError('Q live sources must not contain a piano bank.')
        needed = any(step and step.get('notes') and not step.get('rest') for step in sequence)
        if source == 'sample' and needed and not any(item.get('key') == 'qSourceSample' for item in assets):
            raise ValueError('Q sample audio is missing.')
        if source == 'grain' and needed and not any(item.get('key') in ('grainMainSample','grainASample','grainBSample','grainAMic','grainBMic','mic') for item in assets):
            raise ValueError('Q grain audio sources are missing.')
        return piano.get('enabled') is True and needed
    bank = piano.get('bank')
    if not any(step and step.get('notes') and not step.get('rest') for step in sequence) and not bank and not asset:
        return False
    if not isinstance(bank, dict) or bank.get('version') != 1 or not asset or asset.get('channels') != 2 or bank.get('sampleRate') != asset.get('sampleRate'):
        raise ValueError('Q piano bank is incomplete.')
    if bank.get('instrument', 'salamander-v3-q-4layer-44100-v1') != expected_bank:
        raise ValueError('Q instrument and sample bank do not match.')
    samples = bank.get('samples')
    if not isinstance(samples, list) or not 1 <= len(samples) <= (34 if instrument == 'strings' else 120):
        raise ValueError('Q sample inventory is incomplete.')
    identities = set()
    previous_end = 0
    for sample in samples:
        if not isinstance(sample, dict):
            raise ValueError('Invalid Q sample.')
        match = re.fullmatch(r'(cello|viola|violin)(\d{2})v(32|96)' if instrument == 'strings' else r'([A-G])(s?)(\d)v(4|8|12|16)', str(sample.get('id', '')))
        if not match or sample['id'] in identities:
            raise ValueError('Invalid or duplicate Q sample identity.')
        if instrument == 'strings':
            midi, velocity = int(match[2]), int(match[3])
            if midi not in string_sections[match[1]]:
                raise ValueError('Invalid Q string section mapping.')
            if any(type(sample.get(key)) is not int for key in ('loopStart', 'loopEnd', 'frames')) or not 0 < sample['loopStart'] < sample['loopEnd'] <= sample['frames']:
                raise ValueError('Invalid Q string sustain loop.')
        else:
            midi = (int(match[3]) + 1) * 12 + {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}[match[1]] + bool(match[2])
            velocity = round(int(match[4]) / 16 * 127)
        if sample.get('midi') != midi or sample.get('velocity') != velocity or type(sample.get('offset')) is not int or type(sample.get('frames')) is not int or sample['offset'] < previous_end or sample['frames'] < 1 or sample['offset'] + sample['frames'] > asset.get('frames', 0):
            raise ValueError('Q sample dimensions or pitch mapping are invalid.')
        previous_end = sample['offset'] + sample['frames']
        identities.add(sample['id'])
    for step in sequence:
        if not step or not step.get('notes') or step.get('rest'):
            continue
        velocity = min(127, int(step['velocity'] * (1 + piano.get('accentAmount', .25) if step.get('accent') else 1) + .5))
        layer = min([32, 96] if instrument == 'strings' else [32, 64, 95, 127], key=lambda value: abs(value - velocity))
        for note in step['notes']:
            pitch = note + piano.get('transpose', 0)
            if not 21 <= pitch <= 108:
                raise ValueError('Q transposition is outside the piano range.')
            sampled_pitch = min(string_roots, key=lambda value: abs(value - pitch)) if instrument == 'strings' else min(108, max(21, 21 + int((pitch - 21) / 3 + .5) * 3))
            if not any(sample['midi'] == sampled_pitch and sample['velocity'] == layer for sample in samples):
                raise ValueError('Q piano bank is missing a required pitch or velocity layer.')
    return piano.get('enabled') is True


def q_render_version(piano):
    if piano.get('soundSource') in ('osc','grain','sample'):
        return 9
    if piano.get('chordHold') is True and piano.get('arpEnabled') is not True:
        return 8
    if piano.get('sampleLength', 1) < 1 or piano.get('sampleDecay', 1) < 1:
        return 7
    if piano.get('performanceVersion') == 6 or piano.get('arpPattern') == 'custom' or any(step and step.get('accent') is True for step in piano['sequence']):
        return 6
    return 5 if piano.get('instrument') == 'strings' else 4 if piano.get('room', 0) > 0 else 3 if piano.get('arpEnabled') else 1


def validate_drum_roll_cycle(state, cycle, steps):
    roll = state['modes'].get('drumMachineRoll')
    valid = (1, 2, 4, 8)
    if roll is not None:
        if (not isinstance(roll, dict) or type(roll.get('version')) is not int or roll['version'] != 1
            or type(roll.get('length')) is not int or not 1 <= roll['length'] <= 1024
            or not isinstance(roll.get('pattern'), list) or len(roll['pattern']) != roll['length']
            or any(type(x) is not bool for x in roll['pattern'])
            or not isinstance(roll.get('ratchets'), list) or len(roll['ratchets']) != roll['length']
            or any(type(x) is not int or not 0 <= x <= 8 for x in roll['ratchets'])):
            raise ValueError('Invalid snare Roll pattern.')
        if state['modes'].get('drumMachineEnabled') is True and any(roll['pattern']):
            valid = tuple(math.lcm(steps * base, roll['length']) // steps for base in valid)
    if type(cycle) is not int or cycle not in valid:
        raise ValueError('Invalid part pattern cycle length.')


def validate_loop_fx(value):
    if value is None:
        return
    keys = {'A', 'B', 'C', 'V', 'W', 'P', 'O', 'L', 'X', 'M', 'M+', 'Q', 'K1', 'K2', 'K3', 'K4', 'K5'}
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('channels'), dict) or not keys <= set(value['channels']) <= keys | {'N', 'D', 'sample'}:
        raise ValueError('Unsupported or incomplete standard loop FX settings.')
    ranges = {'cutoff': (20, 20000), 'resonance': (.1, 4), 'lfoBeats': (1/16, 64), 'lfoDepth': (0, 1), 'room': (0, 1), 'reverbDecay': (.5, 12), 'reverbSize': (0, 1), 'reverbPredelay': (0, 200), 'reverbDamping': (1000, 18000), 'reverbLowcut': (20, 1500), 'reverbWidth': (0, 1), 'delay': (0, 1), 'delayBeats': (1/12, 6), 'feedback': (0, .7), 'delayCutoff': (200, 18000)}
    for channel in value['channels'].values():
        if not isinstance(channel, dict) or channel.get('filterType') not in ('lowpass', 'highpass') or channel.get('filterSlope') not in (12, 24, 36, 48, 96) or channel.get('lfoWave') not in ('sine', 'triangle', 'sawtooth', 'ramp', 'square'):
            raise ValueError('Invalid standard loop filter settings.')
        if any(type(channel.get(key)) is not bool for key in ('filterEnabled', 'lfoInvert', 'pingPong')):
            raise ValueError('Invalid standard loop FX switch.')
        for key, (minimum, maximum) in ranges.items():
            number = channel.get(key)
            if type(number) not in (int, float) or not minimum <= number <= maximum:
                raise ValueError('Invalid standard loop FX control: ' + key)
        if 'pan' in channel and (type(channel['pan']) not in (int, float) or not -1 <= channel['pan'] <= 1):
            raise ValueError('Invalid loop pan.')
        if 'legacyHighpass' in channel and (type(channel['legacyHighpass']) not in (int, float) or not 20 <= channel['legacyHighpass'] <= 10000):
            raise ValueError('Invalid legacy Q high-pass cutoff.')


def needs_kick_routing_render(state, assets):
    """Invalidate only saved audio affected by formerly unconditional SC-kick routing."""
    modes = state.get('modes', {})
    sliders = state.get('sliders', {})
    def control(key, default):
        try:
            value = float(sliders.get(key, default))
            return value if math.isfinite(value) else default
        except (ValueError, TypeError):
            return default
    if (modes.get('drumMachineEnabled') is False or modes.get('finalCompressorSidechainSource') != 'kick'
            or not any(a.get('key') == 'drumKick' for a in assets)
            or not any(modes.get('drumMachineKickPattern') or [])
            or control('drumMachineKickLevel', 100) <= 0 or control('performanceDrumMachineLevel', 65) <= 0):
        return False
    solos = modes.get('drumMachineLaneSolos') or []
    if solos and 'kick' not in solos:
        return False
    muted = bool(state.get('fxMuted', modes.get('fxMuted', False)))
    amount, comp = control('finalSidechainAmount', 0), control('finalCompressorAmount', 30)
    if not muted and amount > .1 and comp > 0:
        return False
    pg = (modes.get('wasp') or {}).get('playground') or {}
    route_changed = modes.get('drumMachineDirectOutput', True) is not True and not (pg.get('enabled') and pg.get('routeKick'))
    trim_changed = control('finalSidechainKickLevel', 100) != 100
    duck_changed = not muted and amount > .1 and comp <= 0
    return route_changed or trim_changed or duck_changed


DRUM_SAMPLE_LANES = ('kick', 'snare', 'hat', 'perc', 'clap', 'cymbals', 'etc')
MAX_DRUM_NORMALIZE_GAIN = 10 ** (24 / 20)


def drum_sample_processing(value):
    if value is None:
        value = {}
    elif not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('lanes'), dict):
        raise ValueError('Unsupported drum sample processing.')
    if value.get('snareDrive', 'legacy') not in ('smooth', 'legacy') or not isinstance(value.get('autoNormalize', True), bool):
        raise ValueError('Invalid drum sample processing controls.')
    lanes = {}
    for kind in DRUM_SAMPLE_LANES:
        lane = value.get('lanes', {}).get(kind, {})
        if not isinstance(lane, dict):
            raise ValueError('Invalid drum sample lane.')
        gain, peak = lane.get('gain', 1), lane.get('peak')
        if isinstance(gain, bool) or not isinstance(gain, (int, float)) or not math.isfinite(gain) or not 0 < gain <= MAX_DRUM_NORMALIZE_GAIN:
            raise ValueError('Invalid drum normalization gain.')
        if peak is not None and (isinstance(peak, bool) or not isinstance(peak, (int, float)) or not math.isfinite(peak) or peak < 0):
            raise ValueError('Invalid drum sample peak.')
        if not isinstance(lane.get('enabled', False), bool):
            raise ValueError('Invalid drum normalization bypass.')
        lanes[kind] = {'enabled': lane.get('enabled') is True, 'gain': gain, 'peak': peak}
    return {'version': 1, 'autoNormalize': value.get('autoNormalize') is not False, 'snareDrive': value.get('snareDrive', 'legacy'), 'lanes': lanes}


def drum_processing_render_state(state, assets):
    modes = state.get('modes', {})
    processing = drum_sample_processing(modes.get('drumMachineSampleProcessing'))
    sliders = state.get('sliders', {})
    if modes.get('drumMachineEnabled') is not True or float(sliders.get('performanceDrumMachineLevel', 65)) <= 0:
        return None
    keys, gains, snare_active = {a['key'] for a in assets}, {}, False
    for kind in DRUM_SAMPLE_LANES:
        name = kind[0].upper() + kind[1:]
        extra = modes.get('drumMachineExtraTracks', {}).get(kind)
        pattern = (extra or {}).get('pattern') if kind in ('clap', 'cymbals', 'etc') else modes.get('drumMachine' + name + 'Pattern')
        roll = kind == 'snare' and any(modes.get('drumMachineRoll', {}).get('pattern', []))
        level = (extra or {}).get('level', 1) if extra is not None else float(sliders.get('drumMachine' + name + 'Level', 100)) / 100
        if 'drum' + name not in keys or not (any(pattern or []) or roll) or level <= 0:
            continue
        if kind == 'snare':
            snare_active = True
        lane = processing['lanes'][kind]
        if lane['enabled'] and lane['gain'] != 1:
            gains[kind] = lane['gain']
    smooth = snare_active and processing['snareDrive'] == 'smooth' and float(sliders.get('drumMachineSnareDistortion', 0)) > 0
    return {'version': 1, 'gains': gains, **({'snareDrive': 'smooth'} if smooth else {})} if gains or smooth else None


def validate_part_zip(body):
    with zipfile.ZipFile(BytesIO(body)) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 42 or len(set(names)) != len(names):
            raise ValueError('Invalid part archive entries.')
        if sum(entry.file_size for entry in entries) > MAX_UPLOAD:
            raise ValueError('Part archive is too large.')
        for entry in entries:
            if entry.compress_type != zipfile.ZIP_STORED or entry.flag_bits & 1:
                raise ValueError('Part archives must use unencrypted stored entries.')
            if not re.fullmatch(r'(song-part\.json|audio/[A-Za-z0-9_-]+\.wav)', entry.filename):
                raise ValueError('Invalid part asset path.')
        manifest_entry = archive.getinfo('song-part.json')
        if manifest_entry.file_size > 2 * 1024 * 1024:
            raise ValueError('Part settings are too large.')
        snapshot = json_object(json.loads(archive.read('song-part.json')))
        if snapshot.get('format') != 'mygrain-song-part' or snapshot.get('version') != 1:
            raise ValueError('Unsupported song-part format.')
        state = snapshot.get('state')
        extra = snapshot.get('extra')
        if not isinstance(state, dict) or not isinstance(state.get('modes'), dict) or not isinstance(extra, dict):
            raise ValueError('Part is missing its complete settings snapshot.')
        validate_master_baker(state['modes'].get('masterBaker'))
        validate_effect_output(state['modes'].get('effectOutput'))
        validate_cooking_pot(state['modes'].get('cookingPot'))
        validate_character_fx(state['modes'])
        MUTILATOR.validate(state['modes'])
        ACOUSTIC_FX.validate(state['modes'])
        validate_resonator(state['modes'].get('resonatorR'))
        v_repositories = state['modes'].get('loopSampleRepositories', {})
        if not isinstance(v_repositories, dict) or ('V' in v_repositories and v_repositories['V'] not in ('samples_ncrvocals', 'samples_vocal')):
            raise ValueError('Invalid Loop V library.')
        if 'W' in v_repositories and v_repositories['W'] not in ('samples_modular', 'samples_loops', 'samples_loopstore'):
            raise ValueError('Invalid Loop W library.')
        d_repository = (state['modes'].get('loopD') or {}).get('repository')
        if d_repository is not None and d_repository not in ('samples_loopstore', 'samples_loops'):
            raise ValueError('Invalid Loop D library.')
        m = (state['modes'].get('loopD') or {}).get('mutilator')
        if isinstance(m, dict) and 'rhythm' in m and type(m['rhythm']) is not bool:
            raise ValueError('Invalid Mutilator rhythm switch.')
        validate_wasp(state['modes'].get('wasp'))
        validate_turntable(state['modes'].get('turntable'))
        validate_loop_fx(state['modes'].get('loopFx'))
        eq = CHANNEL_EQ.normalize(state['modes'].get('channelEq'))
        eq_active = any(CHANNEL_EQ.audible(channel) for channel in eq['channels'].values())
        extended_eq = any(key not in ('X', 'L') and channel.get('manualBypass') is not True and channel.get('automation', {}).get('read') is True and any(point.get('enabled') for point in channel.get('automation', {}).get('points', [])) for key, channel in eq['channels'].items())
        steps = int(state.get('patternLength', 0))
        bpm = float(state.get('globalBpm', 0))
        if not 8 <= steps <= 64 or not 40 <= bpm <= 300 or float(state.get('patternLength', 0)) != steps:
            raise ValueError('Invalid part pattern length or tempo.')
        sequence = extra.get('sequencerSteps')
        cycle = extra.get('patternCycleMultiplier', 1)
        validate_drum_roll_cycle(state, cycle, steps)
        if not isinstance(sequence, list) or len(sequence) != steps:
            raise ValueError('Part is missing its sequencer pattern.')
        assets = snapshot.get('assets')
        # Five K recorder takes add four raw WAVs to a fully loaded part.
        if not isinstance(assets, list) or len(assets) > 41:
            raise ValueError('Invalid part audio manifest.')
        keys = set()
        paths = set()
        audio_hashes = {}
        for asset in assets:
            asset = json_object(asset)
            key = asset.get('key', '')
            asset_path = asset.get('path', '')
            if not re.fullmatch(r'[A-Za-z0-9_-]+', key) or asset_path != f'audio/{key}.wav':
                raise ValueError('Invalid audio asset.')
            if key in keys or asset_path in paths or asset_path not in names:
                raise ValueError('Missing or duplicate audio asset.')
            keys.add(key)
            paths.add(asset_path)
            audio_body = archive.read(asset_path)
            audio_hashes[asset_path] = hashlib.sha256(audio_body).hexdigest()
            with wave.open(BytesIO(audio_body), 'rb') as audio:
                if audio.getnchannels() not in (1, 2) or audio.getnframes() < 1:
                    raise ValueError('Invalid part WAV audio.')
                dimensions = {'channels': audio.getnchannels(), 'frames': audio.getnframes(), 'sampleRate': audio.getframerate()}
                if any(field in asset and (type(asset[field]) is not int or asset[field] != value) for field, value in dimensions.items()):
                    raise ValueError('Part audio dimensions do not match its manifest.')
                if len(audio.readframes(audio.getnframes())) != audio.getnframes() * audio.getnchannels() * audio.getsampwidth():
                    raise ValueError('Part WAV audio is truncated.')
        if set(names) != paths | {'song-part.json'}:
            raise ValueError('Unlisted part assets are not allowed.')
        freeze_version = extra.get('freezeStateVersion')
        if freeze_version is not None and (type(freeze_version) is not int or freeze_version != 1):
            raise ValueError('Unsupported portable-freeze version.')
        if freeze_version == 1:
            inventory = extra.get('audioSlots')
            if not isinstance(inventory, dict) or not inventory or any(type(present) is not bool for present in inventory.values()):
                raise ValueError('Part is missing its audio inventory.')
            if {key for key, present in inventory.items() if present} != keys:
                raise ValueError('Part audio inventory does not match its saved samples.')
        piano_active = validate_q_piano(state, assets)
        content = {key: value for key, value in snapshot.items() if key != 'createdAt'}
        content['state'] = {key: value for key, value in state.items() if key != 'timestamp'}
        content['state']['modes'] = dict(state['modes'])
        if unified_inputs_version(state['modes']):
            content['unifiedInputsEngineRevision'] = unified_inputs_version(state['modes'])
        if not state['modes'].get('turntable', {}).get('enabled'):
            content['state']['modes'].pop('turntable', None)
        else:
            content['state']['modes']['turntable'] = dict(state['modes']['turntable'])
            if state['modes']['turntable'].get('input') in CHARACTER_INPUTS:
                content['state']['modes']['turntable']['route'] = 'drums' if state['modes']['turntable']['input'] == 'drums' else 'mix'
                if state['modes']['turntable']['input'] in ('all', 'drums'):
                    content['state']['modes']['turntable'].pop('input', None)
            if state['modes']['turntable'].get('rpm', 33) == 33:
                content['state']['modes']['turntable'].pop('rpm', None)
            if state['modes']['turntable'].get('mainsHz', 50) == 50 or not state['modes']['turntable'].get('hum', 0):
                content['state']['modes']['turntable'].pop('mainsHz', None)
            if content['state']['modes']['turntable'].get('route', 'mix') == 'mix':
                content['state']['modes']['turntable'].pop('route', None)
            content['turntableEngineRevision'] = 4 if state['modes']['turntable'].get('rpm', 33) != 33 and any(state['modes']['turntable'].get(key, 0) > 0 for key in ('wow', 'flutter')) else 3 if content['state']['modes']['turntable'].get('route') == 'drums' else 2 if any(state['modes']['turntable'].get(key, 0) > 0 for key in ('wow', 'flutter')) else 1
        # Bypassed EQ edits must not invalidate an otherwise identical legacy render.
        content['state']['modes'].pop('channelEq', None)
        if not (state['modes'].get('wasp', {}).get('enabled') or state['modes'].get('wasp', {}).get('playground', {}).get('enabled')):
            content['state']['modes'].pop('wasp', None)
        else:
            wasp = state['modes']['wasp']
            content['state']['modes']['wasp'] = dict(wasp)
            # Q now controls the final cutoff section as well as the independent peak.
            # Comb modes already used Q for feedback and are audibly unchanged.
            pg = wasp.get('playground', {})
            content['waspEngineRevision'] = 10 if playground_render_version(pg) == 3 else 9 if playground_render_version(pg) == 2 else (7 if pg.get('mode', 'lowpass') in {'comb', 'combNegative'} else 8) if pg.get('enabled') else 4 if wasp.get('filter', {}).get('enabled') else 3
            if wasp.get('enabled') and sum(route.get('enabled') is True for route in wasp.get('routes', [])[:2]) > 1:
                content['waspSourceRevision'] = 1
            if pg.get('enabled'):
                canonical_pg = dict(pg)
                if canonical_pg.get('input', 'all') == 'all': canonical_pg.pop('input', None)
                rm = canonical_pg.get('rateMod')
                if not isinstance(rm, dict) or not rm.get('enabled') or rm.get('depth', 1) == 0:
                    canonical_pg.pop('rateMod', None)
                for name, default in [('glide', .35), ('motion', 1), ('mix', 1)]:
                    if canonical_pg.get(name) == default: canonical_pg.pop(name, None)
                content['state']['modes']['wasp']['playground'] = canonical_pg
            if not wasp.get('enabled'):
                content['state']['modes']['wasp'] = {'playground': content['state']['modes']['wasp']['playground']}
            if not wasp.get('filter', {}).get('enabled'):
                content['state']['modes']['wasp'].pop('filter', None)
            if not wasp.get('playground', {}).get('enabled'):
                content['state']['modes']['wasp'].pop('playground', None)
        resonator = state['modes'].get('resonatorR', {})
        slots = [slot for slot in resonator.get('slots', []) if slot.get('enabled') and slot.get('level', 0) > 0]
        if not resonator.get('enabled') or not slots or resonator.get('outputLevel', 1) == 0:
            content['state']['modes'].pop('resonatorR', None)
        else:
            content['resonatorEngineRevision'] = 3 if any(slot.get('object') == 'door' for slot in slots) else 2 if any('excitationCurve' in slot for slot in slots) else 1
            content['state']['modes']['resonatorR'] = {'version': 1, 'enabled': True, 'slots': slots}
            if resonator.get('outputLevel', 1) != 1:
                content['state']['modes']['resonatorR']['outputLevel'] = resonator['outputLevel']
            delay = resonator.get('delay', {})
            if delay.get('mode') == 'sync' or (delay.get('mode') == 'ms' and delay.get('ms', 0) > 0):
                content['state']['modes']['resonatorR']['delay'] = delay
                content['resonatorEngineRevision'] = 4
        if eq_active:
            content['state']['modes']['channelEq'] = {'version': 1, 'channels': {key: value for key, value in eq['channels'].items() if CHANNEL_EQ.audible(value)}}
        # Only the new audible D processor adds this signature; legacy/off renders stay reusable.
        loop_d = state.get('modes', {}).get('loopD') or {}
        mutilator = loop_d.get('mutilator')
        if loop_d.get('enabled') and 'bastardD' in keys and isinstance(mutilator, dict) and mutilator.get('enabled') is True and mutilator.get('input', 'D') == 'D':
            # Match existing client scalar defaulting, without tightening legacy ZIP validation.
            def positive_control(key):
                value = mutilator.get(key, .5)
                try:
                    number = 0.0 if value is None or value == '' else float(value)
                except (TypeError, ValueError):
                    number = .5
                return not math.isfinite(number) or number > 0
            new_strain = mutilator.get('strain') in ('diode', 'cinder', 'shred', 'vortex', 'maw')
            rhythmic = mutilator.get('rhythm') is True and positive_control('mix') and positive_control('amount')
            content['mutilatorEngineRevision'] = (5 if new_strain else 3) if rhythmic else 4 if new_strain else 2 if mutilator.get('strain') in ('scab', 'venom', 'hollow', 'splinter') else 1
            if mutilator.get('rhythm') is False:
                content['state']['modes']['loopD'] = dict(loop_d)
                content['state']['modes']['loopD']['mutilator'] = {k: v for k, v in mutilator.items() if k != 'rhythm'}
        if isinstance(mutilator, dict) and mutilator.get('rhythm') is False:
            content['state']['modes']['loopD'] = dict(content['state']['modes'].get('loopD', loop_d))
            content['state']['modes']['loopD']['mutilator'] = {k: v for k, v in mutilator.items() if k != 'rhythm'}
        current_mutilator = bool(content.get('mutilatorEngineRevision') and positive_control('mix') and positive_control('amount') and ('rhythm' in mutilator or mutilator.get('strain') in ('diode', 'cinder', 'shred', 'vortex', 'maw')))
        character_active = needs_character_fx(state['modes'])
        if character_active:
            content['characterFxEngineRevision'] = 1
        bass = state['modes'].get('bassFace') or {}
        if not bass.get('enabled') or not bass.get('amount', .35) or not bass.get('mix', .5) or bass.get('input') == 'DAW':
            content['state']['modes'].pop('bassFace', None)
        # Explicit default D routing must hash exactly like the legacy implicit route.
        cm = (content['state']['modes'].get('loopD') or {}).get('mutilator')
        if isinstance(cm, dict) and cm.get('input') == 'D':
            content['state']['modes']['loopD'] = {**content['state']['modes']['loopD'], 'mutilator': {key: value for key, value in cm.items() if key != 'input'}}
        mutilator_controls = MUTILATOR.apply_content(content, state['modes'], keys)
        if not (state['modes'].get('masterBaker') or {}).get('enabled'):
            content['state']['modes'].pop('masterBaker', None)
        else:
            content['masterBakerEngineRevision'] = 1
        effect_output = effect_output_render_version(state, snapshot.get('extra'))
        output_routing = state['modes'].get('effectOutput') or {}
        content['state']['modes'].pop('effectOutput', None)
        if effect_output:
            content['effectOutputEngineRevision'] = effect_output
            switches = {k: True for k, v in output_routing.get('throughMain', {}).items() if v is True}
            muted = output_routing.get('mainMuted') is True
            if switches or muted:
                content['state']['modes']['effectOutput'] = {'version': 1, 'throughMain': switches, **({'mainMuted': True} if muted else {})}
        processing = drum_processing_render_state(state, assets)
        content['state']['modes'].pop('drumMachineSampleProcessing', None)
        if processing:
            content['state']['modes']['drumMachineSampleProcessing'] = processing
            content['drumProcessingEngineRevision'] = 1
        acoustic_active = ACOUSTIC_FX.apply_content(content, state['modes'])
        kick_routing = needs_kick_routing_render(state, assets)
        if kick_routing:
            content['kickRoutingEngineRevision'] = 1
        cooking_pot = apply_cooking_pot_content(content, state)
        d_max = state['modes'].get('loopD', {}).get('maximiser', 0)
        if isinstance(d_max, bool) or not isinstance(d_max, (int, float)) or not 0 <= d_max <= 100:
            raise ValueError('Invalid D maximiser amount.')
        # D library selection affects the next load, not the stored original PCM.
        if isinstance(content['state']['modes'].get('loopD'), dict):
            content['state']['modes']['loopD'] = {k: v for k, v in content['state']['modes']['loopD'].items() if k != 'repository' and not (k == 'maximiser' and not d_max)}
        # Next-load V choice is not audio; preserve legacy render identities.
        repositories = content['state']['modes'].get('loopSampleRepositories')
        if isinstance(repositories, dict) and 'V' in repositories:
            repositories = {k: v for k, v in repositories.items() if k != 'V'}
            content['state']['modes']['loopSampleRepositories'] = repositories
            if not repositories:
                content['state']['modes'].pop('loopSampleRepositories')
        # New W next-load option aliases its historical default identity. Keep
        # every previously supported W choice's digest unchanged. Stored PCM and
        # provenance, not the next folder to browse, determine audible content.
        repositories = content['state']['modes'].get('loopSampleRepositories')
        if isinstance(repositories, dict) and repositories.get('W') == 'samples_loopstore':
            content['state']['modes']['loopSampleRepositories'] = {**repositories, 'W': 'samples_modular'}
        sample_cuts = sample_cut_version(snapshot)
        if sample_cuts:
            content['sampleCutEngineRevision'] = sample_cuts
        content['assets'] = sorted(assets, key=lambda asset: asset['key'])
        content['audioHashes'] = audio_hashes
        digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(',', ':')).encode('utf-8')).hexdigest()
        return {**({'sampleCutVersion': sample_cuts} if sample_cuts else {}), **({'unifiedInputsVersion': unified_inputs_version(state['modes'])} if unified_inputs_version(state['modes']) else {}), 'bpm': bpm, 'patternSteps': steps, 'patternCycleMultiplier': cycle, 'audioAssets': len(assets), 'contentSha256': digest, **({'drumProcessingVersion': 1} if processing else {}), **({'waspSourceVersion': 1} if state.get('modes', {}).get('wasp', {}).get('enabled') and sum(route.get('enabled') is True for route in state['modes']['wasp'].get('routes', [])[:2]) > 1 else {}), **({'mutilatorVersion': 2} if current_mutilator else {}), **({'mutilatorControlsVersion': 1} if mutilator_controls else {}), **({'characterFxVersion': 1} if character_active else {}), **({'acousticFxVersion': acoustic_active} if acoustic_active else {}), **({'cookingPotVersion': cooking_pot_render_version(state)} if cooking_pot else {}), **({'effectOutputVersion': effect_output} if effect_output else {}), **({'kickRoutingVersion': 1} if kick_routing else {}), **({'playgroundVersion': playground_render_version(state.get('modes', {}).get('wasp', {}).get('playground'))} if playground_render_version(state.get('modes', {}).get('wasp', {}).get('playground')) else {}), **({'loopFxVersion': 1} if state.get('modes', {}).get('loopFx', {}).get('version') == 1 else {}), **({'loopDVersion': 2 if d_max > 0 else 1} if state.get('modes', {}).get('loopD', {}).get('enabled') is True and 'bastardD' in keys else {}), **({'eqVersion': 3 if extended_eq else 1} if eq_active else {}), **({'qVersion': q_render_version(state['q'])} if piano_active else {})}


LOOP_LAYERS = ('A', 'B', 'C', 'D', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+')
LOOP_ASSETS = {layer: {f'bastard{layer}'} for layer in LOOP_LAYERS}
LOOP_ASSETS['Q'].add('qSourceSample')
LOOP_ASSETS['M'] = {'bastardM', 'bastardMRender'}
LOOP_ASSETS['M+'] = {'bastardMPlus', 'bastardMPlusRender'}
DRUM_LANES = ('drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll')
K_TRACKS = ('K1', 'K2', 'K3', 'K4', 'K5')
K_ASSETS = {track: {'bastardK', 'bastardKRender'} if index == 0 else {f'bastardKTrack{index + 1}'}
            for index, track in enumerate(K_TRACKS)}
EQ_LAYERS = tuple('eq:' + key for key in CHANNEL_EQ.KEYS)
COPY_LAYERS = (*LOOP_LAYERS, *K_TRACKS, 'drums', *DRUM_LANES, *EQ_LAYERS)


def copy_layers(value):
    """Accept legacy single-loop payloads and a bounded multi-selection."""
    values = [value] if isinstance(value, str) else value
    if not isinstance(values, list) or not values or len(values) > len(COPY_LAYERS) or any(not isinstance(item, str) or item not in COPY_LAYERS for item in values):
        raise ValueError('Choose one or more supported loops, K tracks, drum lanes or channel EQs.')
    return tuple(item for item in COPY_LAYERS if item in values and not (item in DRUM_LANES and 'drums' in values))


def setting_drum_layer(key):
    for prefix in ('drumMachine', 'performanceDrumMachine'):
        if key.startswith(prefix):
            suffix = key[len(prefix):]
            for lane in DRUM_LANES:
                name = lane[4:]
                if suffix.startswith(name) and (len(suffix) == len(name) or not suffix[len(name)].islower()):
                    return lane
            return 'drums'
    return 'drums' if key.startswith('drumSend') else None


def merged_pattern_cycle(snapshot):
    """Same full-cycle calculation as the live Song capture adapter."""
    state = snapshot['state']
    modes = state['modes']
    steps = int(state['patternLength'])
    multiplier = 1
    for lane in ('L', 'X'):
        prefix = f'bastardLoop{lane}'
        sequence = modes.get(prefix + 'Sequence') or []
        if modes.get(prefix + 'Enabled') is True and any(step and step.get('note') and not step.get('rest') for step in sequence[:steps]):
            index = modes.get(prefix + 'TimingIndex', 3)
            timing = (.125, .25, .5, 1, 2, 4, 8)[index] if type(index) is int and 0 <= index <= 6 else 1
            multiplier = max(multiplier, timing)
    piano = state.get('q') or {}
    if piano.get('enabled') is True and any(step and step.get('notes') and not step.get('rest') for step in piano.get('sequence', [])[:steps]):
        rate = piano.get('rate', 1)
        if rate in (.25, .5, 1, 2, 4):
            multiplier = max(multiplier, 1 / rate)
    roll = modes.get('drumMachineRoll')
    if modes.get('drumMachineEnabled') is True and roll and any(roll['pattern']):
        multiplier = math.lcm(steps * int(multiplier), roll['length']) // steps
    return int(multiplier)


def setting_loop_layer(key):
    if key in ('loopD', 'loopDFill', 'loopDPitch', 'loopDSpeed') or key.startswith('loopDMutilator'):
        return 'D'
    match = re.match(r'^(?:performance)?[bB]astard(?:Loop)?(.*)$', key)
    if not match:
        return None
    suffix = match[1]
    # K's shared master/legacy controls are not part of loop A or a K track.
    if suffix.startswith('K') and (len(suffix) == 1 or not suffix[1].islower()):
        return None
    for prefix, layer in [('MPlus', 'M+'), ('2', 'B'), ('3', 'C'), *[(layer, layer) for layer in ('D', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M')]]:
        if suffix.startswith(prefix) and (len(suffix) == len(prefix) or not suffix[len(prefix)].islower()):
            return layer
    return 'A'


def replace_loop_settings(destination, source, layer):
    destination = json_object(destination)
    source = json_object(source)
    result = {key: value for key, value in destination.items() if setting_loop_layer(key) != layer}
    result.update({key: copy.deepcopy(value) for key, value in source.items() if setting_loop_layer(key) == layer})
    return result


def paste_loop_archive(destination_body, source_body, layer, eq_map=None):
    layers = copy_layers(layer)
    # A bounded, explicit destination->source map permits one copied EQ to
    # several channels, but never to an unchosen/unvalidated source EQ.
    if eq_map is None:
        eq_map = {item[3:]: item[3:] for item in layers if item in EQ_LAYERS}
    if not isinstance(eq_map, dict) or len(eq_map) > len(CHANNEL_EQ.KEYS) or any(
            target not in CHANNEL_EQ.KEYS or not isinstance(source, str) or 'eq:' + source not in layers
            for target, source in eq_map.items()):
        raise ValueError('Choose valid EQ destinations for the copied EQs.')
    if any(item in EQ_LAYERS for item in layers) and not eq_map:
        raise ValueError('Choose at least one EQ destination.')
    validate_part_zip(source_body)
    validate_part_zip(destination_body)
    asset_keys = set().union(*(LOOP_ASSETS.get(item, K_ASSETS.get(item, {item} if item in DRUM_LANES and item != 'drumRoll' else set())) for item in layers))
    if 'drums' in layers:
        asset_keys.update(item for item in DRUM_LANES if item != 'drumRoll')

    def selected(key):
        loop = setting_loop_layer(key)
        drum = setting_drum_layer(key)
        return loop in layers or drum in layers or ('drums' in layers and drum is not None)

    def replace_selected(destination, source):
        destination, source = json_object(destination), json_object(source)
        result = {key: value for key, value in destination.items() if not selected(key)}
        result.update({key: copy.deepcopy(value) for key, value in source.items() if selected(key)})
        return result

    with zipfile.ZipFile(BytesIO(source_body)) as source_zip, zipfile.ZipFile(BytesIO(destination_body)) as destination_zip:
        source = json.loads(source_zip.read('song-part.json'))
        destination = json.loads(destination_zip.read('song-part.json'))
        if all(item in EQ_LAYERS for item in layers):
            # EQ-only migration is deliberately metadata-only. Do not run the
            # full lane/K converter or add defaults to unrelated legacy fields.
            eq_source = CHANNEL_EQ.normalize(source['state']['modes'].get('channelEq'))
            eq_destination = CHANNEL_EQ.normalize(destination['state']['modes'].get('channelEq'))
            for target_key, source_key in eq_map.items():
                eq_destination['channels'][target_key] = copy.deepcopy(eq_source['channels'][source_key])
            destination['state']['modes']['channelEq'] = eq_destination
            destination['createdAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            output = BytesIO()
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as result:
                for entry in destination_zip.infolist():
                    result.writestr(entry.filename, json.dumps(destination, separators=(',', ':')) if entry.filename == 'song-part.json' else destination_zip.read(entry.filename))
                    if output.tell() > MAX_UPLOAD:
                        raise ValueError('The pasted part exceeds the 128 MB limit.')
            return output.getvalue()
        if any(item in K_TRACKS for item in layers):
            # Legacy shared processing becomes per-track processing on the
            # server. Keep destination selection/master and every unchosen take.
            with K_CONVERSION_LOCK:
                source = convert_k_snapshot(source)['snapshot']
                destination = convert_k_snapshot(destination)['snapshot']
            for index, track in enumerate(K_TRACKS):
                if track in layers:
                    destination['state']['modes']['kMultitrack']['tracks'][index] = copy.deepcopy(
                        source['state']['modes']['kMultitrack']['tracks'][index])
        if 'X' in layers:
            bass = source['state']['modes'].get('bassFace')
            if bass is None:
                destination['state']['modes'].pop('bassFace', None)
            else:
                destination['state']['modes']['bassFace'] = copy.deepcopy(bass)
        if 'D' in layers:
            destination['state']['modes']['loopD'] = copy.deepcopy(source['state']['modes'].get('loopD'))
        for section in ('modes', 'sliders', 'selects'):
            destination['state'][section] = replace_selected(destination['state'].get(section, {}), source['state'].get(section, {}))
        fx_layers = [key for key in layers if key in LOOP_LAYERS or key in K_TRACKS]
        if fx_layers and (source['state']['modes'].get('loopFx') is not None or destination['state']['modes'].get('loopFx') is not None):
            source_fx = convert_fx_snapshot(source)['snapshot']['state']['modes']['loopFx']
            destination_fx = convert_fx_snapshot(destination)['snapshot']['state']['modes']['loopFx']
            for key in fx_layers:
                destination_fx['channels'][key] = copy.deepcopy(source_fx['channels'][key])
            destination['state']['modes']['loopFx'] = destination_fx
        eq_source = CHANNEL_EQ.normalize(source['state']['modes'].get('channelEq'))
        eq_destination = CHANNEL_EQ.normalize(destination['state']['modes'].get('channelEq'))
        for channel_key in CHANNEL_EQ.KEYS:
            if channel_key in layers or ('drums' in layers and channel_key in DRUM_LANES):
                eq_destination['channels'][channel_key] = copy.deepcopy(eq_source['channels'][channel_key])
        for target_key, source_key in eq_map.items():
            eq_destination['channels'][target_key] = copy.deepcopy(eq_source['channels'][source_key])
        if eq_map or source['state']['modes'].get('channelEq') is not None or destination['state']['modes'].get('channelEq') is not None:
            destination['state']['modes']['channelEq'] = eq_destination
        # Old archives may predate some drum lanes. An absent selected pattern
        # means empty, not "leave whichever pattern is currently live" on recall.
        for item in ('drumKick', 'drumSnare', 'drumHat', 'drumPerc'):
            key = 'drumMachine' + item[4:] + 'Pattern'
            if ('drums' in layers or item in layers) and key not in source['state']['modes']:
                destination['state']['modes'][key] = [False] * int(destination['state']['patternLength'])
        if 'drums' in layers and 'drumMachineEnabled' not in source['state']['modes']:
            destination['state']['modes']['drumMachineEnabled'] = False
        if 'drums' not in layers:
            extra_lanes = [item[4:].lower() for item in layers if item in ('drumClap', 'drumCymbals', 'drumEtc')]
            if extra_lanes:
                tracks = json_object(destination['state']['modes'].setdefault('drumMachineExtraTracks', {}))
                source_tracks = json_object(source['state']['modes'].get('drumMachineExtraTracks', {}))
                for kind in extra_lanes:
                    tracks.pop(kind, None)
                    if kind in source_tracks:
                        tracks[kind] = copy.deepcopy(source_tracks[kind])
        selected_drums = [item[4:].lower() for item in layers if item in DRUM_LANES and item != 'drumRoll']
        if 'drums' not in layers and selected_drums:
            processing = drum_sample_processing(destination['state']['modes'].get('drumMachineSampleProcessing'))
            source_processing = drum_sample_processing(source['state']['modes'].get('drumMachineSampleProcessing'))
            for kind in selected_drums:
                processing['lanes'][kind] = copy.deepcopy(source_processing['lanes'][kind])
            if 'snare' in selected_drums:
                processing['snareDrive'] = source_processing['snareDrive']
            destination['state']['modes']['drumMachineSampleProcessing'] = processing
        destination_toggles = json_object(destination['state'].get('toggles', {}))
        source_toggles = json_object(source['state'].get('toggles', {}))
        for modulation in set(destination_toggles) | set(source_toggles):
            destination['state'].setdefault('toggles', {})[modulation] = replace_selected(
                destination['state']['toggles'].get(modulation, {}), source['state'].get('toggles', {}).get(modulation, {}))
        if 'Q' in layers:
            destination['state']['q'] = copy.deepcopy(source['state'].get('q'))
        source_trace = json_object(source['state'].get('bastardLoopTrace', {}))
        trace = json_object(destination['state'].get('bastardLoopTrace', {}))
        for item in layers:
            if item not in LOOP_LAYERS:
                continue
            trace.pop(item, None)
            if item in source_trace:
                destination['state'].setdefault('bastardLoopTrace', {})[item] = copy.deepcopy(source_trace[item])
        destination['extra']['controls'] = [control for control in destination['extra'].get('controls', []) if not selected(control['id'])]
        destination['extra']['controls'].extend(copy.deepcopy(control) for control in source['extra'].get('controls', []) if selected(control['id']))
        metadata = json_object(destination['extra'].setdefault('metadata', {}))
        for key in asset_keys:
            metadata.pop(key, None)
            if key in source['extra'].get('metadata', {}):
                metadata[key] = copy.deepcopy(source['extra']['metadata'][key])
        destination['assets'] = [asset for asset in destination['assets'] if asset['key'] not in asset_keys]
        destination['assets'].extend(copy.deepcopy(asset) for asset in source['assets'] if asset['key'] in asset_keys)
        if destination['extra'].get('freezeStateVersion') == 1:
            present = {asset['key'] for asset in destination['assets']}
            destination['extra']['audioSlots'].update({key: key in present for key in asset_keys})
        if any(item in layers for item in ('drums', 'drumRoll', 'L', 'X', 'Q')):
            destination['extra']['patternCycleMultiplier'] = merged_pattern_cycle(destination)
        destination['createdAt'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        output = BytesIO()
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as result:
            result.writestr('song-part.json', json.dumps(destination, separators=(',', ':')))
            for asset in destination['assets']:
                archive = source_zip if asset['key'] in asset_keys else destination_zip
                result.writestr(asset['path'], archive.read(asset['path']))
                if output.tell() > MAX_UPLOAD:
                    raise ValueError('The pasted part exceeds the 128 MB limit. Shorten its source audio.')
        body = output.getvalue()
        if len(body) > MAX_UPLOAD:
            raise ValueError('The pasted part exceeds the 128 MB limit.')
        return body


def copied_loop_body(payload, owner):
    payload = json_object(payload)
    layers = copy_layers(payload.get('layers', payload.get('layer')))
    source_id = payload.get('sourcePartId', '')
    digest = payload.get('sourceSha256', '')
    if not isinstance(source_id, str) or not re.fullmatch(r'[a-f0-9]{32}', source_id) or not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('Copy items from a saved part first.')
    folder, song = read_song(payload.get('sourceSongId', ''), owner)
    candidates = [part for section in ('parts', 'sharedParts', 'history', 'deletedParts') for part in song.get(section, [])]
    saved = next((part for part in candidates if part['id'] == source_id and part.get('sha256') == digest), None)
    if not saved:
        raise ValueError('The copied revision is unavailable. Copy the loop again.')
    filename = saved.get('archive', f'{source_id}.zip')
    path = folder / 'parts' / filename
    if not re.fullmatch(r'[a-f0-9-]+\.zip', filename) or path.is_symlink() or path.stat().st_size > MAX_UPLOAD:
        raise ValueError('Invalid copied part archive.')
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != digest:
        raise ValueError('Copied part integrity check failed. No part was changed.')
    return body, list(layers)


def handle_song_request(handler, method, inner_path):
    if inner_path == '/api/drum-patterns' or inner_path.startswith('/api/drum-patterns/'):
        return DRUM_PATTERNS.handle(handler, method, inner_path, SONGS_ROOT)
    if inner_path != '/api/songs' and not inner_path.startswith('/api/songs/'):
        return False
    headers = {'Cache-Control': 'no-store'}
    try:
        owner = owner_hash(handler.headers)
        segments = [unquote(segment) for segment in inner_path.split('/')[3:] if segment]
        query = parse_qs(urlparse(handler.path).query)
        with song_storage_lock():
            if not segments and method == 'GET':
                songs = []
                for folder in SONGS_ROOT.iterdir():
                    if not folder.is_dir() or folder.is_symlink():
                        continue
                    try:
                        _, song = read_song(folder.name, owner)
                        songs.append(public_song(song))
                    except (FileNotFoundError, ValueError, OSError):
                        continue
                handler.send_json({'ok': True, 'songs': sorted(songs, key=lambda song: song['createdAt']), 'features': {'editingLocks': 1, 'editLeaseSeconds': EDIT_LEASE_SECONDS, 'songRevisions': 1, 'exactPatternRenders': 1, 'keyboardRenders': 1, 'grainFadeRenders': 1, 'grainSustainRenders': 2, 'grainControlRenders': 3, 'grainEdgeRenders': 4, 'grainLoopRenders': 5, 'vocalCutRenders': 1, 'vocalRepeatRenders': 1, 'drumLaneRenders': 1, 'drumSampleRenders': 1, 'drumProcessingRenders': 1, 'drumAccentRenders': 1, 'drumRollRenders': 1, 'portableFreezeRenders': 1, 'qPianoRenders': 9, 'kHallReverbRenders': 1, 'contentHashes': 1, 'partManifests': 1, 'partAudioAssets': 1, 'serverPreparation': 1 if ACCOUNT_IDENTITY() is not None and server_arm_module().available() else 0, 'serverKConversion': 1 if K_CONVERSION_SCRIPT.is_file() and shutil.which('node') else 0, 'loopFxRenders': 1, 'serverFxConversion': 1 if FX_CONVERSION_SCRIPT.is_file() and shutil.which('node') else 0, 'serverWConversion': 1 if W_CONVERSION_SCRIPT.is_file() and shutil.which('node') else 0, 'renameSongs': True, 'amendParts': True, 'deleteParts': True, 'reuseParts': True}}, extra_headers=headers)
            elif not segments and method == 'POST':
                name = clean_name(json_object(handler.read_json()).get('name'))
                slug = re.sub(r'[^A-Za-z0-9_-]+', '-', name).strip('-_') or 'song'
                song_id = f'{slug[:100]}-{secrets.token_hex(4)}'
                folder = song_path(song_id)
                folder.mkdir(mode=0o700)
                (folder / 'parts').mkdir(mode=0o700)
                song = {'id': song_id, 'name': name, 'version': 1, 'createdAt': time.time(), 'ownerHash': owner, 'parts': []}
                write_song(folder, song)
                handler.send_json({'ok': True, 'song': public_song(song)}, status=201, extra_headers=headers)
            elif segments:
                folder, song = read_song(segments[0], owner)
                is_render = len(segments) == 4 and segments[1] == 'parts' and segments[3] in ('render', 'server-arm')
                if method == 'POST' and segments[1:2] != ['lock'] and not is_render:
                    require_song_editor(folder, song, handler.headers)
                if segments[1:] == ['lock'] and method == 'GET':
                    handler.send_json({'ok': True, 'lock': public_edit_lock(read_edit_lock(folder)), 'serverTime': time.time(), 'leaseSeconds': EDIT_LEASE_SECONDS, 'revision': song['revision']}, extra_headers=headers)
                elif len(segments) == 3 and segments[1] == 'lock' and method == 'POST':
                    handler.send_json(handle_edit_lock(handler, folder, song, segments[2]), extra_headers=headers)
                elif len(segments) == 1 and method == 'GET':
                    handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                elif segments[1:] == ['convert-k'] and method == 'POST':
                    song, converted = convert_song_k(folder, song, handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song), 'converted': converted}, extra_headers=headers)
                elif segments[1:] == ['convert-fx'] and method == 'POST':
                    song, converted = convert_song_fx(folder, song, handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song), 'converted': converted}, extra_headers=headers)
                elif segments[1:] == ['convert-w'] and method == 'POST':
                    song, converted = convert_song_w(folder, song, handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song), 'converted': converted}, extra_headers=headers)
                elif segments[1:] == ['rename'] and method == 'POST':
                    song['name'] = clean_name(json_object(handler.read_json()).get('name'))
                    write_song(folder, song, edit_headers=handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                elif segments[1:] == ['parts'] and method == 'POST':
                    if len(song['parts']) >= MAX_PARTS:
                        raise ValueError('The beta supports up to 64 parts per song.')
                    name = clean_name((query.get('name') or [''])[0])
                    repeats = checked_repeats((query.get('repeats') or ['1'])[0])
                    length = int(handler.headers.get('Content-Length', '0'))
                    if not 1 <= length <= MAX_UPLOAD:
                        raise ValueError('Part upload must be between 1 byte and 128 MB.')
                    body = handler.rfile.read(length)
                    if len(body) != length:
                        raise ValueError('Part upload was interrupted.')
                    details = validate_part_zip(body)
                    part_id = secrets.token_hex(16)
                    archive_path = folder / 'parts' / f'{part_id}.zip'
                    temporary = archive_path.with_suffix('.tmp')
                    try:
                        with temporary.open('xb') as output:
                            output.write(body)
                            output.flush()
                            os.fsync(output.fileno())
                        temporary.replace(archive_path)
                        song['parts'].append({'id': part_id, 'name': name, 'repeats': repeats, 'createdAt': time.time(), 'bytes': length, 'sha256': hashlib.sha256(body).hexdigest(), **details})
                        write_song(folder, song, edit_headers=handler.headers)
                    except Exception:
                        temporary.unlink(missing_ok=True)
                        archive_path.unlink(missing_ok=True)
                        raise
                    handler.send_json({'ok': True, 'song': public_song(song)}, status=201, extra_headers=headers)
                elif segments[1:] == ['arrange'] and method == 'POST':
                    requested = json_object(handler.read_json()).get('parts')
                    originals = {part['id']: part for part in song['parts']}
                    if not isinstance(requested, list) or len(requested) != len(originals):
                        raise ValueError('Arrangement must contain every saved part exactly once.')
                    ordered = []
                    seen = set()
                    source_names = {}
                    for part in requested:
                        part = json_object(part)
                        part_id = part.get('id')
                        if part_id not in originals or part_id in seen:
                            raise ValueError('Invalid or duplicate part in arrangement.')
                        seen.add(part_id)
                        original = originals[part_id]
                        source = source_part(song, original)
                        name = clean_name(part.get('name'))
                        if source['id'] in source_names and source_names[source['id']] != name:
                            raise ValueError('Reused occurrences must share the same part name.')
                        source_names[source['id']] = name
                        arranged = {**original, 'repeats': checked_repeats(part.get('repeats'))}
                        if 'playbackSteps' in part:
                            arranged['playbackSteps'] = checked_playback_steps(part['playbackSteps'], source)
                        ordered.append(arranged)
                    for source_id, name in source_names.items():
                        source_part(song, {'id': source_id})['name'] = name
                    for part in ordered:
                        if 'sourcePartId' not in part:
                            part['name'] = source_names[part['id']]
                    song['parts'] = ordered
                    write_song(folder, song, edit_headers=handler.headers)
                    handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                elif len(segments) in (3, 4) and segments[1] == 'parts':
                    occurrence = next((part for part in song['parts'] if part['id'] == segments[2]), None)
                    if not occurrence or not re.fullmatch(r'[a-f0-9]{32}', segments[2]):
                        raise FileNotFoundError('Part not found.')
                    part = source_part(song, occurrence)
                    action = segments[3] if len(segments) == 4 else ''
                    if method == 'POST' and (query.get('sha256') or [''])[0] != part['sha256']:
                        raise PartConflictError('This part changed on the server. Refresh Songs and recall it again before saving.')
                    if method == 'POST' and action == 'reuse':
                        if len(song['parts']) >= MAX_PARTS:
                            raise ValueError('The beta supports up to 64 parts per song.')
                        reused = {'id': secrets.token_hex(16), 'sourcePartId': part['id'], 'repeats': occurrence['repeats'], 'createdAt': time.time()}
                        if 'playbackSteps' in occurrence:
                            reused['playbackSteps'] = occurrence['playbackSteps']
                        song['parts'].append(reused)
                        write_song(folder, song, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, status=201, extra_headers=headers)
                    elif method == 'POST' and action == 'full-copy':
                        copied = full_copy_part(folder, song, occurrence, part, handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song), 'partId': copied['id']}, status=201, extra_headers=headers)
                    elif method == 'GET' and not action:
                        send_asset(handler, folder, part.get('archive', f'{part["id"]}.zip'), 'application/zip')
                    elif method == 'GET' and action == 'manifest':
                        if (query.get('sha256') or [''])[0] != part['sha256']:
                            raise PartConflictError('This part changed on the server. Refresh Songs and arm again.')
                        record = read_part_manifest_record(folder, part)
                        handler.send_json({'ok': True, 'format': 'mygrain-song-part-manifest', 'version': 1,
                                           'sourceSha256': part['sha256'], **record}, extra_headers=headers)
                    elif method == 'GET' and action == 'audio':
                        if (query.get('sha256') or [''])[0] != part['sha256']:
                            raise PartConflictError('This part changed on the server. Refresh Songs and recall it again.')
                        body = read_part_audio(folder, part, (query.get('key') or [''])[0])
                        handler.send_response(200)
                        handler.send_header('Content-Type', 'audio/wav')
                        handler.send_header('Content-Length', str(len(body)))
                        handler.send_header('Cache-Control', 'no-store')
                        handler.end_headers()
                        handler.wfile.write(body)
                    elif action == 'server-arm' and method in ('POST', 'GET'):
                        if ACCOUNT_IDENTITY() is None:
                            raise PermissionError('Sign into MYGRAIN to prepare audio on the server.')
                        if (query.get('sha256') or [''])[0] != part['sha256']:
                            raise PartConflictError('This part changed on the server. Refresh Songs and arm again.')
                        service = server_arm_module()
                        scope = str(folder.parent.resolve())
                        if method == 'POST':
                            job = service.start(scope, song['id'], part,
                                f'http://127.0.0.1:{handler.server.server_address[1]}/mygrain/', handler.headers.get('Cookie', ''), occurrence['id'])
                        else:
                            job = service.status(scope, song['id'], part['id'], part['sha256'])
                        handler.send_json({'ok': True, 'job': job, **({'song': public_song(song)} if job['state'] == 'done' else {})}, extra_headers=headers)
                    elif method == 'GET' and action == 'render':
                        render = part.get('render')
                        if not render or render.get('sourceSha256') != part['sha256']:
                            raise FileNotFoundError('Arm Cache to render this part first.')
                        if int(render.get('sampleCutVersion', 0)) < sample_cut_version(read_part_manifest_record(folder, part)['snapshot']):
                            raise FileNotFoundError('Arm Cache to refresh sample crossfades for this part.')
                        saved_snapshot = read_part_manifest_record(folder, part)['snapshot']
                        required_output = max(int(part.get('effectOutputVersion', 0)), effect_output_render_version(saved_snapshot['state'], saved_snapshot.get('extra')))
                        if int(render.get('effectOutputVersion', 0)) < required_output:
                            raise FileNotFoundError('Arm Cache to refresh routed-effect Solo audio for this part.')
                        send_asset(handler, folder, render['file'], 'audio/wav')
                    elif method == 'POST' and action == 'render':
                        sample_cuts = (query.get('samplecuts') or [''])[0]
                        if sample_cuts not in ('', '1'):
                            raise ValueError('Unsupported sample-crossfade render version.')
                        if int(sample_cuts or 0) < sample_cut_version(read_part_manifest_record(folder, part)['snapshot']):
                            raise ValueError('This part requires current sample-crossfade rendering. Reload MYGRAIN and arm again.')
                        wasp_source = (query.get('waspsource') or [''])[0]
                        if wasp_source not in ('', '1'):
                            raise ValueError('Unsupported Wasp source-limit render version.')
                        if part.get('waspSourceVersion') and wasp_source != '1':
                            raise ValueError('This part requires a current single-source Wasp render. Reload MYGRAIN and arm again.')
                        keyboard = (query.get('keyboard') or [''])[0]
                        if keyboard not in ('', '1'):
                            raise ValueError('Unsupported keyboard render version.')
                        grain = (query.get('grain') or [''])[0]
                        if grain not in ('', '1', '2', '3', '4', '5'):
                            raise ValueError('Unsupported grain render version.')
                        vocal_cut = (query.get('vocalcut') or [''])[0]
                        if vocal_cut not in ('', '1'):
                            raise ValueError('Unsupported vocal-cut render version.')
                        vocal_repeat = (query.get('vocalrepeat') or [''])[0]
                        if vocal_repeat not in ('', '1'):
                            raise ValueError('Unsupported vocal section-repeat render version.')
                        drum_lanes = (query.get('drumlanes') or [''])[0]
                        if drum_lanes not in ('', '1'):
                            raise ValueError('Unsupported drum-lane render version.')
                        drum_accent = (query.get('drumaccent') or [''])[0]
                        if drum_accent not in ('', '1'):
                            raise ValueError('Unsupported drum accent render version.')
                        drum_sample = (query.get('drumsample') or [''])[0]
                        if drum_sample not in ('', '1'):
                            raise ValueError('Unsupported drum-sample render version.')
                        drum_processing = (query.get('drumprocessing') or [''])[0]
                        if drum_processing not in ('', '1'):
                            raise ValueError('Unsupported drum processing render version.')
                        if part.get('drumProcessingVersion') and drum_processing != '1':
                            raise ValueError('This part requires drum normalization / smooth drive rendering.')
                        drum_roll = (query.get('drumroll') or [''])[0]
                        if drum_roll not in ('', '1'):
                            raise ValueError('Unsupported snare Roll render version.')
                        portable = (query.get('portable') or [''])[0]
                        if portable not in ('', '1'):
                            raise ValueError('Unsupported portable-freeze render version.')
                        loop_d = (query.get('loopd') or [''])[0]
                        if loop_d not in ('', '1', '2'):
                            raise ValueError('Unsupported D loop render version.')
                        d_state = read_part_manifest_record(folder, part)['snapshot']['state'].get('modes', {}).get('loopD', {})
                        required_d = max(int(part.get('loopDVersion', 0)), 2 if d_state.get('enabled') and d_state.get('maximiser', 0) > 0 else 0)
                        if int(loop_d or 0) < required_d:
                            raise ValueError('This part requires current D maximiser rendering.')
                        unified_inputs = (query.get('unifiedinputs') or [''])[0]
                        if unified_inputs not in ('', '1', '2', '3'):
                            raise ValueError('Unsupported unified effects input render version.')
                        if int(unified_inputs or 0) < max(int(part.get('unifiedInputsVersion', 0)), unified_inputs_version(read_part_manifest_record(folder, part)['snapshot']['state'].get('modes', {}))):
                            raise ValueError('This part requires current effects input routing.')
                        cooking_pot = (query.get('cookingpot') or [''])[0]
                        if cooking_pot not in ('', '1', '2', '3'):
                            raise ValueError('Unsupported cooking pot render version.')
                        required_pot = max(int(part.get('cookingPotVersion', 0)), cooking_pot_render_version(read_part_manifest_record(folder, part)['snapshot']['state']))
                        if int(cooking_pot or 0) < required_pot:
                            raise ValueError('This part requires cooking pot serial rendering.')
                        effect_output = (query.get('effectoutput') or [''])[0]
                        if effect_output not in ('', '1', '2', '3', '4', '5'):
                            raise ValueError('Unsupported effect output render version.')
                        saved_snapshot = read_part_manifest_record(folder, part)['snapshot']
                        required_output = max(int(part.get('effectOutputVersion', 0)), effect_output_render_version(saved_snapshot['state'], saved_snapshot.get('extra')))
                        if int(effect_output or 0) < required_output:
                            raise ValueError('This part requires independent effect outputs.')
                        kick_routing = (query.get('kickrouting') or [''])[0]
                        if kick_routing not in ('', '1'):
                            raise ValueError('Unsupported kick routing render version.')
                        if part.get('kickRoutingVersion') and kick_routing != '1':
                            raise ValueError('This part requires corrected kick sidechain routing.')
                        acoustic_fx = (query.get('acousticfx') or [''])[0]
                        if acoustic_fx not in ('', '1', '2'):
                            raise ValueError('Unsupported acoustic effects render version.')
                        if int(acoustic_fx or 0) < max(int(part.get('acousticFxVersion', 0)), ACOUSTIC_FX.apply_content({'state': {'modes': {}}}, read_part_manifest_record(folder, part)['snapshot']['state'].get('modes', {}))):
                            raise ValueError('This part requires acoustic effects rendering.')
                        character_fx = (query.get('characterfx') or [''])[0]
                        if character_fx not in ('', '1'):
                            raise ValueError('Unsupported Bass Face / routed Mutilator render version.')
                        if part.get('characterFxVersion') and character_fx != '1':
                            raise ValueError('This part requires Bass Face / routed Mutilator rendering.')
                        mutilator_controls = (query.get('mutilatorcontrols') or [''])[0]
                        if mutilator_controls not in ('', '1'):
                            raise ValueError('Unsupported expanded Mutilator render version.')
                        if part.get('mutilatorControlsVersion') and mutilator_controls != '1':
                            raise ValueError('This part requires expanded Mutilator controls.')
                        mutilator = (query.get('mutilator') or [''])[0]
                        if mutilator not in ('', '1', '2'):
                            raise ValueError('Unsupported Mutilator rhythm render version.')
                        if int(part.get('mutilatorVersion', 0)) > int(mutilator or 0):
                            raise ValueError('This part requires switchable Mutilator rendering.')
                        loop_fx = (query.get('loopfx') or [''])[0]
                        if loop_fx not in ('', '1'):
                            raise ValueError('Unsupported loop FX render version.')
                        if part.get('loopFxVersion') == 1 and loop_fx != '1':
                            raise ValueError('This part requires standard loop FX-aware rendering.')
                        playground = (query.get('playground') or [''])[0]
                        if playground not in ('', '1', '2', '3'):
                            raise ValueError('Unsupported Playground resonance render version.')
                        if int(part.get('playgroundVersion', 0)) > int(playground or 0):
                            raise ValueError('This part requires current transport-locked Playground rendering.')
                        channel_eq = (query.get('channeleq') or [''])[0]
                        if channel_eq not in ('', '1', '2', '3'):
                            raise ValueError('Unsupported channel EQ render version.')
                        if part.get('eqVersion', 0) and int(channel_eq or 0) < (3 if part['eqVersion'] >= 3 else 1):
                            raise ValueError('This part requires channel EQ-aware rendering.')
                        k_reverb = (query.get('kreverb') or [''])[0]
                        if k_reverb not in ('', '1'):
                            raise ValueError('Unsupported K Hall reverb render version.')
                        piano = (query.get('q') or [''])[0]
                        if piano not in ('', '1', '2', '3', '4', '5', '6', '7', '8', '9'):
                            raise ValueError('Unsupported Q piano render version.')
                        if part.get('qVersion', 0) > int(piano or '0'):
                            raise ValueError('This part requires Q-aware rendering.')
                        body = upload_body(handler)
                        render = validate_render(body, part)
                        if sample_cuts:
                            render['sampleCutVersion'] = 1
                        if keyboard == '1':
                            render['keyboardVersion'] = 1
                        if grain:
                            render['grainVersion'] = int(grain)
                        if vocal_cut == '1':
                            render['vocalCutVersion'] = 1
                        if vocal_repeat == '1':
                            render['vocalRepeatVersion'] = 1
                        if drum_lanes == '1':
                            render['drumLanesVersion'] = 1
                        if drum_accent == '1':
                            render['drumAccentVersion'] = 1
                        if drum_sample == '1':
                            render['drumSampleVersion'] = 1
                        if drum_processing == '1':
                            render['drumProcessingVersion'] = 1
                        if drum_roll == '1':
                            render['drumRollVersion'] = 1
                        if portable == '1':
                            render['portableVersion'] = 1
                        if wasp_source:
                            render['waspSourceVersion'] = 1
                        if loop_d:
                            render['loopDVersion'] = int(loop_d)
                        if character_fx:
                            render['characterFxVersion'] = 1
                        if acoustic_fx:
                            render['acousticFxVersion'] = int(acoustic_fx)
                        if unified_inputs:
                            render['unifiedInputsVersion'] = int(unified_inputs)
                        if cooking_pot:
                            render['cookingPotVersion'] = int(cooking_pot)
                        if effect_output:
                            render['effectOutputVersion'] = int(effect_output)
                        if kick_routing:
                            render['kickRoutingVersion'] = 1
                        if mutilator:
                            render['mutilatorVersion'] = int(mutilator)
                        if mutilator_controls:
                            render['mutilatorControlsVersion'] = 1
                        if loop_fx:
                            render['loopFxVersion'] = 1
                        if playground:
                            render['playgroundVersion'] = int(playground)
                        if channel_eq:
                            render['channelEqVersion'] = int(channel_eq)
                        if k_reverb:
                            render['kReverbVersion'] = 1
                        if piano:
                            render['qVersion'] = int(piano)
                        render['file'] = f'{part["id"]}-{render["sha256"]}.wav'
                        part['render'] = render
                        publish_asset(folder, song, render['file'], body, advance_revision=False)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    elif method == 'POST' and action in ('save', 'paste-loop'):
                        if action == 'paste-loop':
                            paste_payload = json_object(handler.read_json())
                            source_body, layer = copied_loop_body(paste_payload, owner)
                            archive_path = folder / 'parts' / part.get('archive', f'{part["id"]}.zip')
                            if archive_path.is_symlink() or archive_path.stat().st_size > MAX_UPLOAD:
                                raise ValueError('Invalid destination part archive.')
                            destination_body = archive_path.read_bytes()
                            if hashlib.sha256(destination_body).hexdigest() != part['sha256']:
                                raise ValueError('Destination part integrity check failed. No part was changed.')
                            body = paste_loop_archive(destination_body, source_body, layer, paste_payload.get('eqMap'))
                        else:
                            body = upload_body(handler)
                        details = validate_part_zip(body)
                        digest = hashlib.sha256(body).hexdigest()
                        previous_content = part.get('contentSha256')
                        if previous_content is None:
                            archive_path = folder / 'parts' / part.get('archive', f'{part["id"]}.zip')
                            previous_content = validate_part_zip(archive_path.read_bytes())['contentSha256']
                        repeats = occurrence['repeats'] if action == 'paste-loop' else checked_repeats((query.get('repeats') or [str(occurrence['repeats'])])[0])
                        name = part['name'] if action == 'paste-loop' else clean_name((query.get('name') or [part['name']])[0])
                        updated = {**part, **details, 'name': name, 'repeats': repeats if occurrence is part else part['repeats'], 'sha256': digest, 'bytes': len(body), 'archive': f'{part["id"]}-{secrets.token_hex(16)}.zip', 'revision': part.get('revision', 1) + 1, 'updatedAt': time.time()}
                        old_steps, new_steps = full_pattern_steps(part), full_pattern_steps(updated)
                        for slot in [updated] + [entry for entry in song['parts'] if 'sourcePartId' in entry]:
                            if slot.get('sourcePartId', slot['id']) == part['id'] and 'playbackSteps' in slot:
                                slot['playbackSteps'] = new_steps if slot['playbackSteps'] == old_steps else min(slot['playbackSteps'], new_steps)
                        if 'sampleCutVersion' not in details:
                            updated.pop('sampleCutVersion', None)
                        if 'qVersion' not in details:
                            updated.pop('qVersion', None)
                        if 'playgroundVersion' not in details:
                            updated.pop('playgroundVersion', None)
                        if 'waspSourceVersion' not in details:
                            updated.pop('waspSourceVersion', None)
                        if 'acousticFxVersion' not in details:
                            updated.pop('acousticFxVersion', None)
                        if 'unifiedInputsVersion' not in details:
                            updated.pop('unifiedInputsVersion', None)
                        if 'cookingPotVersion' not in details:
                            updated.pop('cookingPotVersion', None)
                        if 'effectOutputVersion' not in details:
                            updated.pop('effectOutputVersion', None)
                        if 'kickRoutingVersion' not in details:
                            updated.pop('kickRoutingVersion', None)
                        if 'characterFxVersion' not in details:
                            updated.pop('characterFxVersion', None)
                        if 'mutilatorControlsVersion' not in details:
                            updated.pop('mutilatorControlsVersion', None)
                        if 'mutilatorVersion' not in details:
                            updated.pop('mutilatorVersion', None)
                        if 'loopDVersion' not in details:
                            updated.pop('loopDVersion', None)
                        if 'eqVersion' not in details:
                            updated.pop('eqVersion', None)
                        if previous_content == details['contentSha256'] and part.get('render', {}).get('sourceSha256') == part['sha256']:
                            updated['render'] = {**part['render'], 'sourceSha256': digest}
                        else:
                            updated.pop('render', None)
                        song.setdefault('history', []).append(dict(part))
                        occurrence['repeats'] = repeats
                        song['parts'] = [updated if entry['id'] == part['id'] else entry for entry in song['parts']]
                        if 'sharedParts' in song:
                            song['sharedParts'] = [updated if entry['id'] == part['id'] else entry for entry in song['sharedParts']]
                        publish_asset(folder, song, updated['archive'], body, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    elif method == 'POST' and action == 'colour':
                        payload = json_object(handler.read_json())
                        if 'colour' not in payload:
                            raise ValueError('Choose a colour or explicitly clear it.')
                        part['colour'] = checked_colour(payload['colour'])
                        write_song(folder, song, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    elif method == 'POST' and action == 'delete':
                        song.setdefault('deletedParts', []).append({**part, **occurrence, 'deletedAt': time.time()})
                        song['parts'] = [entry for entry in song['parts'] if entry['id'] != occurrence['id']]
                        if occurrence is part and any(entry.get('sourcePartId') == part['id'] for entry in song['parts']):
                            song.setdefault('sharedParts', []).append(part)
                        song['sharedParts'] = [entry for entry in song.get('sharedParts', []) if any(slot.get('sourcePartId') == entry['id'] for slot in song['parts'])]
                        write_song(folder, song, edit_headers=handler.headers)
                        handler.send_json({'ok': True, 'song': public_song(song)}, extra_headers=headers)
                    else:
                        raise FileNotFoundError('Song endpoint not found.')
                else:
                    raise FileNotFoundError('Song endpoint not found.')
            else:
                raise FileNotFoundError('Song endpoint not found.')
    except SongEditError as error:
        handler.send_json({'ok': False, 'error': str(error), 'code': error.code, 'lock': error.lock, 'serverTime': time.time()}, status=error.status, extra_headers=headers)
    except PartConflictError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=409, extra_headers=headers)
    except PermissionError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=403, extra_headers=headers)
    except FileNotFoundError as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=404, extra_headers=headers)
    except (ValueError, TypeError, KeyError, EOFError, zipfile.BadZipFile, wave.Error) as error:
        handler.send_json({'ok': False, 'error': str(error)}, status=400, extra_headers=headers)
    except OSError:
        handler.send_json({'ok': False, 'error': 'Song storage is unavailable; the save did not complete.'}, status=500, extra_headers=headers)
    return True


def playground_render_version(pg):
    if not isinstance(pg, dict) or pg.get('enabled') is not True:
        return 0
    if pg.get('input', 'all') != 'all' and pg.get('mix', 1) > 0:
        return 3
    dynamic = any(lane.get('source', 'off') != 'off' and lane.get('amount', .65) != 0 for lane in pg.get('modulation', {}).values()) and pg.get('motion', 1) > 0
    if dynamic or pg.get('mix', 1) != 1:
        return 2
    return 0 if pg.get('mode', 'lowpass') in {'comb', 'combNegative'} else 1


def unified_inputs_version(modes):
    bass, mutilator, tt, wasp = modes.get('bassFace') or {}, (modes.get('loopD') or {}).get('mutilator') or {}, modes.get('turntable') or {}, modes.get('wasp') or {}
    active = lambda v: v.get('enabled') and v.get('mix', .5) > 0 and v.get('amount', .5) > 0
    channels = (modes.get('loopFx') or {}).get('channels')
    equalized = [key for key, value in CHANNEL_EQ.normalize(modes.get('channelEq'))['channels'].items() if CHANNEL_EQ.audible(value)]
    local_fx = lambda v: v and (v.get('filterEnabled') or v.get('reverbEnabled') and v.get('room', 0) > 0 or v.get('delayEnabled') and v.get('delay', 0) > 0)
    if equalized and (any(active(v) for v in (bass, mutilator)) or any(v.get('enabled') for v in (tt, wasp, wasp.get('playground') or {}, modes.get('resonatorR') or {}, modes.get('wireWorld') or {}, modes.get('sonicCrystal') or {}, modes.get('bubbleChamber') or {})) or any(local_fx((channels or {}).get(key)) for key in equalized)):
        return 3
    for v, default in ((bass, 'X'), (mutilator, 'D')):
        selected = v.get('input', default)
        if active(v) and selected != 'DAW' and (channels is None or any((selected == 'all' or selected == key or selected == 'K' and key in ('K1','K2','K3','K4','K5')) and (s.get('filterEnabled') or s.get('reverbEnabled') and s.get('room', 0) > 0 or s.get('delayEnabled') and s.get('delay', 0) > 0) for key, s in channels.items())):
            return 2
    if not (modes.get('cookingPot') or {}).get('enabled') and (modes.get('loopD') or {}).get('enabled') and active(mutilator) and mutilator.get('input', 'D') == 'D':
        return 2
    character = any(v.get('enabled') and v.get('input') == 'all' and v.get('mix', .5) > 0 and v.get('amount', .5) > 0 for v in (bass, mutilator))
    selected_tt = tt.get('enabled') and tt.get('input') in CHARACTER_INPUTS and tt.get('input') not in ('all', 'drums')
    driver = wasp.get('enabled') and any(r.get('enabled') and (r.get('source') in ('D', 'DAW') or r.get('source') == 'all' and (modes.get('loopD') or {}).get('enabled')) and r.get('depth', 0) != 0 for r in wasp.get('routes', [])[:2])
    host_r = (modes.get('resonatorR') or {}).get('enabled') and any(s.get('enabled') and s.get('source') == 'DAW' for s in (modes.get('resonatorR') or {}).get('slots', []))
    return 1 if character or selected_tt or driver or host_r else 0


def validate_wasp(value):
    if value is None:
        return
    if not isinstance(value, dict) or value.get('version') != 1 or not isinstance(value.get('routes'), list) or len(value['routes']) != 6:
        raise ValueError('Wasp requires version 1 and six modulation routes.')
    keys = {'A','B','C','V','W','P','O','L','X','Q','M','M+','K1','K2','K3','K4','K5','generated','sample','N','drumKick','drumSnare','drumHat','drumPerc','drumClap','drumCymbals','drumEtc','drumRoll','K','drums','all'}
    methods = {'am','ring','duck','frequency','phase','lowpass','highpass','bandpass','notch'}
    def bounded(obj, name, low, high):
        number = obj.get(name)
        if not isinstance(number, (int, float)) or isinstance(number, bool) or not math.isfinite(number) or not low <= number <= high:
            raise ValueError('Invalid Wasp ' + name + '.')
    if type(value.get('enabled')) is not bool:
        raise ValueError('Invalid Wasp power state.')
    for name, low, high in [('melt',0,1),('blend',0,1),('output',-24,6)]:
        bounded(value,name,low,high)
    for route in value['routes']:
        if not isinstance(route, dict) or type(route.get('enabled')) is not bool or route.get('source') not in set(CHARACTER_INPUTS) or route.get('destination') not in keys or route.get('method') not in methods or route.get('mode') not in {'audio','envelope'}:
            raise ValueError('Invalid Wasp modulation route.')
        for name, low, high in [('depth',-1,1),('level',-24,6),('cutoff',30,18000),('resonance',.3,4),('attack',.5,500),('release',5,2000),('sensitivity',.1,32)]:
            bounded(route,name,low,high)

    if 'filter' in value:
        f = value['filter']
        if not isinstance(f, dict) or type(f.get('enabled')) is not bool or f.get('mode') not in {'lowpass','highpass','bandpass','notch'} or type(f.get('slope')) is not int or f['slope'] not in {12,24,36,48,60,72,84,96} or f.get('wave') not in {'sine','triangle','saw','square'}:
            raise ValueError('Invalid Wasp end filter.')
        for name, low, high in [('cutoff',30,18000),('resonance',.5,4),('highpass',20,18000),('lowpass',30,20000),('rate',.02,20),('sweep',0,5),('envelope',-4,4),('attack',.5,500),('release',5,2000)]:
            bounded(f,name,low,high)

    if 'playground' in value:
        pg = value['playground']
        if not isinstance(pg, dict) or type(pg.get('enabled')) is not bool or pg.get('mode') not in {'lowpass','highpass','bandpass','notch','comb','combNegative','allpass','peak','lowshelf','highshelf'} or type(pg.get('slope')) is not int or pg['slope'] not in {12,24,36,48,60,72,84,96}:
            raise ValueError('Invalid Wasp Filter Playground.')
        for name, low, high in [('cutoff',20,20000),('resonant',20,20000),('q',.2,24),('rate',.02,20),('sensitivity',1,32),('attack',.5,500),('release',5,2000)]:
            bounded(pg, name, low, high)
        if 'input' in pg and (not isinstance(pg['input'], str) or pg['input'] not in keys | {'D','DAW'}):
            raise ValueError('Invalid Playground input.')
        if 'routeKick' in pg and type(pg['routeKick']) is not bool:
            raise ValueError('Invalid Playground bass drum route.')
        if 'tempo' in pg:
            bounded(pg, 'tempo', 1, 300)
        for name, low, high in [('glide',.05,40), ('motion',0,1), ('mix',0,1)]:
            if name in pg: bounded(pg, name, low, high)
        if 'rateMod' in pg:
            rm = pg['rateMod']
            if not isinstance(rm, dict) or type(rm.get('enabled')) is not bool or rm.get('target') not in {'all','cutoff','resonant','q'} or rm.get('clock') not in {'hz','sync'}:
                raise ValueError('Invalid Playground rate sculptor.')
            for name, low, high in [('hz',.02,1000),('depth',0,6)]: bounded(rm, name, low, high)
            for name, allowed in [('beats',{.125,.25,.5,1,2,4,8}),('multiplier',{.125,.25,.5,1,2,4,8}),('timing',{'straight','triplet','dotted'})]:
                if type(rm.get(name)) is bool or not isinstance(rm.get(name),(str,int,float)) or rm[name] not in allowed: raise ValueError('Invalid Playground rate ' + name + '.')
            c = rm.get('curve')
            if not isinstance(c,list) or len(c) != 64 or any(type(v) not in (int,float) or not math.isfinite(v) or not -1 <= v <= 1 for v in c):
                raise ValueError('Invalid Playground rate curve.')
        modulation = pg.get('modulation')
        if not isinstance(modulation, dict) or set(modulation) != {'cutoff','resonant','q'}:
            raise ValueError('Invalid Playground modulation controls.')
        for lane in modulation.values():
            if not isinstance(lane, dict) or lane.get('source') not in keys | {'D','off','drawn'}:
                raise ValueError('Invalid Playground modulation source.')
            bounded(lane, 'amount', -1, 1)
            if 'phaseOffset' in lane: bounded(lane, 'phaseOffset', 0, 1)
            if 'interpolation' in lane and lane['interpolation'] not in ('auto','hold','linear'): raise ValueError('Invalid Playground interpolation.')
            for name, low, high in [('hz',.02,1000),('bpm',1,300)]:
                if name in lane:
                    bounded(lane, name, low, high)
            for name, allowed in [('clock',{'hz','bpm','sync'}),('timing',{'straight','triplet','dotted'}),('snapTiming',{'straight','triplet','dotted'}),('beats',{.125,.25,.5,1,2,4,8}),('multiplier',{.125,.25,.5,1,2,4,8}),('snap',{0,.125,.25,.5,1,2,4,8})]:
                if name in lane and (type(lane[name]) is bool or not isinstance(lane[name], (str,int,float)) or lane[name] not in allowed):
                    raise ValueError('Invalid Playground curve ' + name + '.')

            curve = lane.get('curve')
            if not isinstance(curve, list) or len(curve) != 64 or any(type(point) not in (int,float) or not math.isfinite(point) or not -1 <= point <= 1 for point in curve):
                raise ValueError('Invalid Playground drawn curve.')


def validate_turntable(value):
    if value is None:
        return
    if not isinstance(value, dict) or value.get('version') != 1 or type(value.get('enabled')) is not bool:
        raise ValueError('Invalid Turntable settings.')
    if 'input' in value and (not isinstance(value['input'], str) or value['input'] not in CHARACTER_INPUTS):
        raise ValueError('Invalid Turntable input.')
    if value.get('route', 'mix') not in ('mix', 'drums'):
        raise ValueError('Invalid Turntable route.')
    if type(value.get('rpm', 33)) not in (int, float) or value.get('rpm', 33) not in (33, 45, 78):
        raise ValueError('Invalid Turntable speed.')
    if type(value.get('mainsHz', 50)) not in (int, float) or value.get('mainsHz', 50) not in (50, 60):
        raise ValueError('Invalid mains frequency.')
    if value.get('needle') not in ('old', 'modern'):
        raise ValueError('Invalid Turntable needle.')
    from datetime import datetime, timezone
    limits = {'year': (1920, datetime.now(timezone.utc).year), 'wow': (0, 1), 'flutter': (0, 1), 'hum': (0, 1), 'clicks': (0, 1), 'crackle': (0, 1), 'wear': (0, 1), 'output': (-18, 3)}
    for key, (low, high) in limits.items():
        number = value.get(key)
        if type(number) not in (int, float) or not low <= number <= high:
            raise ValueError('Invalid Turntable ' + key + '.')


def validate_resonator(value):
    if value is None:
        return
    if not isinstance(value, dict) or type(value.get('version')) is not int or value['version'] != 1 or type(value.get('enabled')) is not bool:
        raise ValueError('Unsupported R resonator settings.')
    if 'outputLevel' in value and (type(value['outputLevel']) not in (int, float) or not 0 <= value['outputLevel'] <= 1):
        raise ValueError('Invalid R output volume.')
    if 'delay' in value:
        delay = value['delay']
        if (not isinstance(delay, dict) or delay.get('mode') not in ('ms', 'sync')
                or type(delay.get('ms')) not in (int, float) or not 0 <= delay['ms'] <= 2000
                or type(delay.get('division')) is not int or delay['division'] not in (64, 32, 16, 8, 4, 2)):
            raise ValueError('Invalid R wet delay.')
    slots = value.get('slots')
    if not isinstance(slots, list) or len(slots) != 2:
        raise ValueError('R needs two complete object slots.')
    materials = {'door': ('hollowWood','wood','metal'), 'wall': ('plaster','plywood','metal'), 'pipe': ('metal','plastic','wood'), 'cone': ('paper','plastic','metal')}
    sources = set(CHARACTER_INPUTS)
    ranges = {'drive': (0,36), 'damping': (0,1), 'level': (0,1), 'pan': (-1,1), 'width': (.15,5), 'height': (.15,5), 'thickness': (1,100), 'depth': (.01,1), 'gap': (0,20), 'looseness': (0,1), 'length': (.1,8), 'diameter': (.01,.6), 'radius': (.025,.5), 'tear': (0,1), 'rub': (0,1)}
    for slot in slots:
        if not isinstance(slot, dict) or type(slot.get('enabled')) is not bool or slot.get('object') not in materials:
            raise ValueError('Invalid R object.')
        if slot.get('material') not in materials[slot['object']] or slot.get('source') not in sources or slot.get('band') not in ('full','bass','mid','treble') or slot.get('ends') not in ('open','closed'):
            raise ValueError('Invalid R material, source or excitation band.')
        if 'excitationCurve' in slot:
            curve = slot['excitationCurve']
            if not isinstance(curve, list) or len(curve) != 16 or any(type(point) not in (int, float) or not -36 <= point <= 0 for point in curve):
                raise ValueError('Invalid R excitation curve: use sixteen gains from -36 to 0 dB.')
        for key, (low, high) in ranges.items():
            if type(slot.get(key)) not in (int,float) or not low <= slot[key] <= high:
                raise ValueError('Invalid R object control: ' + key)
