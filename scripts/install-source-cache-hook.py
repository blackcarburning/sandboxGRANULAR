#!/usr/bin/env python3
"""Install content-addressed source preparation; fetch still checks access every time."""
import pathlib
import re
import sys
root = pathlib.Path(__file__).resolve().parents[1]
server = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'fs7300-documenter/server.py'
source = server.read_text()
if '# MYGRAIN bounded source preparation cache' in source:
    print('Source cache hook already installed')
    sys.exit(0)
hook = '''
# MYGRAIN bounded source preparation cache
_cache_spec = importlib.util.spec_from_file_location('mygrain_source_cache', pathlib.Path(__file__).resolve().parent.parent / 'sandboxGRANULAR/backend/mygrain_source_cache.py')
_source_cache_module = importlib.util.module_from_spec(_cache_spec)
_cache_spec.loader.exec_module(_source_cache_module)
_source_cache = _source_cache_module.CACHE


def prepare_bastardloop_source(source_key, relative_path, bpm):
    # Never bypass current account/path checks, including FTP; hash bytes so edited
    # or remote files invalidate immediately, irrespective of timestamps/TTL.
    payload = fetch_bastardloop_sample_bytes(source_key, relative_path)
    user = _accounts_module.current_user()
    scope = (str(MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT), user['id'] if user else None,
             str(get_bastardloop_local_source_root(source_key)))
    identity = (scope, source_key, relative_path, hashlib.sha256(payload).digest(), MYGRAIN_BASTARDLOOP_TARGET_SAMPLE_RATE, 'pcm-v1')
    def decode():
        source_rate, raw_data = wavfile.read(BytesIO(payload))
        samples = ensure_stereo(resample_audio_channels(audio_samples_to_float32(raw_data), int(source_rate), MYGRAIN_BASTARDLOOP_TARGET_SAMPLE_RATE))
        return samples, {}
    def conform():
        samples, _ = _source_cache.get(('decode', identity), decode)
        return maybe_prepare_bar_locked_bastardloop_source(samples, MYGRAIN_BASTARDLOOP_TARGET_SAMPLE_RATE, source_key, relative_path, bpm)
    if os.environ.get('MYGRAIN_SOURCE_CACHE', 'on').lower() in ('off', '0', 'false'):
        samples, _ = decode()
        return maybe_prepare_bar_locked_bastardloop_source(samples, MYGRAIN_BASTARDLOOP_TARGET_SAMPLE_RATE, source_key, relative_path, bpm)
    return _source_cache.get(('conform', identity, float(bpm)), conform)

'''
anchor = '\ndef generate_bastardloop_file('
pattern = r'                payload = fetch_bastardloop_sample_bytes\(source_key, relative_path\)\n.*?                    bpm_value,\n                \)'
source, count = re.subn(pattern, '                samples, prep_meta = prepare_bastardloop_source(source_key, relative_path, bpm_value)', source, flags=re.S)
if count != 2 or source.count(anchor) != 1:
    raise SystemExit('Unexpected source preparation anchors; no changes made')
source = source.replace(anchor, '\n' + hook + anchor, 1)
compile(source, str(server), 'exec')
server.write_text(source)
print('Source preparation cache installed')
