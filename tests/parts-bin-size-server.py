"""Local-only size regression server; real isolated account/library stores.

Extends the common isolated server only with its safety marker and an immutable
binary project fixture GET. No large PCM travels through browser automation JSON.
MYGRAIN_TEST_ROOT must name a dedicated directory under /tmp; MYGRAIN_TEST_OUTPUT
is the evidence directory shared with parts-bin-size-browser.cjs.
"""
import os
from pathlib import Path

p = Path(__file__).with_name('song-beta-test-server.py')
s = p.read_text()
assert os.environ.get('MYGRAIN_TEST_ROOT') and os.environ.get('MYGRAIN_TEST_OUTPUT')
extra = '''
def isolated_headers(self):
    self.send_header('X-Mygrain-Isolated-Test', 'plugin-library')
    server_module.DocumenterHandler.end_headers(self)
IsolatedHandler.end_headers = isolated_headers
_original_size_get = IsolatedHandler.do_GET
def size_fixture_get(self):
    if self.path == '/mygrain/__test-native-project':
        body = pathlib.Path(os.environ['MYGRAIN_TEST_OUTPUT']) / 'fixture-native-project.bin'
        if not body.is_file():
            self.send_error(404)
            return
        return self.send_mygrain_bytes(body.read_bytes(), 'application/octet-stream')
    return _original_size_get(self)
IsolatedHandler.do_GET = size_fixture_get

'''
assert s.count('with storage as folder:') == 1
s = s.replace('with storage as folder:', extra + 'with storage as folder:')
exec(compile(s, str(p), 'exec'), {'__name__': '__main__', '__file__': str(p)})
