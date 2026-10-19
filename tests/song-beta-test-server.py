import importlib.util
import pathlib
import os
import signal
import sys
import tempfile
from contextlib import nullcontext
from http.server import ThreadingHTTPServer


workspace = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('song_test_documenter', workspace / 'fs7300-documenter' / 'server.py')
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)
signal.signal(signal.SIGTERM, lambda *args: sys.exit(0))

test_root = os.environ.get('MYGRAIN_TEST_ROOT')
if test_root:
    candidate = pathlib.Path(test_root).absolute()
    server_module._accounts_module.checked_path(candidate, pathlib.Path(tempfile.gettempdir()))
    if candidate == pathlib.Path(tempfile.gettempdir()):
        raise ValueError('Choose a dedicated test directory beneath the temporary directory.')
    candidate.mkdir(parents=True, exist_ok=True, mode=0o700)
storage = nullcontext(str(candidate)) if test_root else tempfile.TemporaryDirectory(prefix='mygrain-song-test-')


class IsolatedHandler(server_module.DocumenterHandler):
    def dispatch_mygrain_request(self, dispatch, *args, **kwargs):
        if not self.path.startswith('/mygrain'):
            self.send_error(404)
            return
        return super().dispatch_mygrain_request(dispatch, *args, **kwargs)


with storage as folder:
    root = pathlib.Path(folder)
    accounts = server_module.init_account_store(root)
    server_module._song_module.EDIT_LEASE_SECONDS = int(os.environ.get('SONG_LOCK_TEST_LEASE_SECONDS', '600'))
    server_module.AUTH_CONFIG_PATH = root / 'auth' / 'documenter.json'
    server_module.CUSTOMER_CHAT_STORE_PATH = root / 'customer_chat.json'
    for source in server_module.MYGRAIN_BASTARDLOOP_SOURCE_CONFIG.values():
        (server_module.MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT / source['local_dir']).mkdir(parents=True, exist_ok=True)
    with ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 18765), IsolatedHandler) as server:
        print('Isolated MYGRAIN stores and auth:', root, flush=True)
        server.serve_forever()
