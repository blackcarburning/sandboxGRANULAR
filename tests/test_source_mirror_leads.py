import ast
import pathlib
import re
import subprocess
import types
import unittest
from unittest.mock import Mock, patch


WORKSPACE = pathlib.Path(__file__).resolve().parents[2]
SCRIPT_PATH = WORKSPACE / 'scripts' / 'sync_mygrain_source_mirrors.sh'
SERVER_PATH = WORKSPACE / 'fs7300-documenter' / 'server.py'
MIRROR_ROOT = '/srv/sftp/mark_sftp/files/mygrain-source-mirrors'
TRANSFERS = [
    ('dropbox:SAMPLEDROP', 'SAMPLEDROP'),
    ('dropbox:SAMPLEDROP_2', 'SAMPLEDROP2'),
    ('dropbox:SPLICE_CLAW', 'SAMPLEDROP_CLAW'),
    ('dropbox:SAMPLES_KICKS', 'SAMPLES_KICKS'),
    ('dropbox:SAMPLES_SNARES', 'SAMPLES_SNARES'),
    ('dropbox:SAMPLES_HATS', 'SAMPLES_HATS'),
    ('dropbox:SAMPLES_CLAP', 'SAMPLES_CLAP'),
    ('dropbox:SAMPLES_CRASH', 'SAMPLES_CRASH'),
    ('dropbox:SAMPLES_BASS', 'SAMPLES_BASS'),
    ('dropbox:SAMPLES_LEADS', 'SAMPLES_LEADS'),
    ('dropbox:SAMPLES_PIANO', 'SAMPLES_PIANO'),
    ('dropbox:SAMPLES_ORCH', 'SAMPLES_ORCH'),
    ('dropbox:SAMPLES_VOCAL', 'SAMPLES_VOCAL'),
]


class SourceMirrorTransferTests(unittest.TestCase):
    def test_thirteen_mirrors_and_transfers_copy_only_leads(self):
        script = re.sub(
            r'^(LOCK_FILE|LOG_FILE)=.*$',
            r'\1="/dev/null"',
            SCRIPT_PATH.read_text(),
            flags=re.MULTILINE,
        )
        self.assertEqual(script.count('LOCK_FILE="/dev/null"'), 1)
        self.assertEqual(script.count('LOG_FILE="/dev/null"'), 1)
        stubs = '''
record() { printf '%s' "$1"; shift; printf '\\t%s' "$@"; printf '\\n'; }
rclone() { record rclone "$@"; }
mkdir() { record mkdir "$@"; }
chgrp() { record chgrp "$@"; }
chmod() { record chmod "$@"; }
flock() { return 0; }
date() { printf 'test-time\\n'; }
dirname() { printf '/unused-log-directory\\n'; }
'''
        result = subprocess.run(
            ['/bin/bash', '--noprofile', '--norc', '-s'],
            input=stubs + script,
            env={'PATH': '/no-system-commands'},
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        self.assertEqual(result.stderr, '')
        commands = [line.split('\t') for line in result.stdout.splitlines()]
        transfers = [command[1:] for command in commands if command[0] == 'rclone']
        flags = ['--create-empty-src-dirs', '--transfers', '8', '--checkers', '16', '--fast-list']
        self.assertEqual(transfers, [
            ['copy' if directory == 'SAMPLES_LEADS' else 'sync', remote, f'{MIRROR_ROOT}/{directory}', *flags]
            for remote, directory in TRANSFERS
        ])
        mirrors = [command[1:] for command in commands if command[0] == 'mkdir']
        self.assertEqual(mirrors, [
            ['-p', '/unused-log-directory'],
            *[['-p', f'{MIRROR_ROOT}/{directory}'] for _, directory in TRANSFERS],
        ])
        for command, arguments in [('chgrp', ['sftpusers']), ('chmod', ['2755'])]:
            with self.subTest(command=command):
                self.assertEqual(
                    [entry[1:] for entry in commands if entry[0] == command],
                    [[*arguments, f'{MIRROR_ROOT}/{directory}'] for _, directory in TRANSFERS],
                )


class LeadsSourceScanTests(unittest.TestCase):
    def setUp(self):
        self.root = pathlib.Path('/in-memory/source-mirrors')
        self.leads = self.root / 'SAMPLES_LEADS'
        self.files = [self.leads / 'local-only.wav']
        functions = {
            'normalize_bastardloop_source_key',
            'get_bastardloop_source_config',
            'get_bastardloop_local_source_root',
            'resolve_existing_bastardloop_local_source_root',
            'list_local_bastardloop_source_files',
            'list_bastardloop_source_files',
        }
        constants = {
            'MYGRAIN_BASTARDLOOP_SOURCE_CONFIG',
            'MYGRAIN_BASTARDLOOP_DEFAULT_SOURCE',
            'MYGRAIN_BASTARDLOOP_LIST_CACHE_SECONDS',
        }
        nodes = [
            node for node in ast.parse(SERVER_PATH.read_text()).body
            if (isinstance(node, ast.FunctionDef) and node.name in functions)
            or (isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id in constants
                for target in node.targets
            ))
        ]
        self.assertEqual(len(nodes), len(functions) + len(constants))
        self.clock = Mock(return_value=1000.0)
        self.remote_run = Mock(side_effect=AssertionError('Remote scans are forbidden'))
        self.accounts = types.SimpleNamespace(current_user=Mock(return_value=None), checked_path=Mock())
        self.server = {
            'pathlib': pathlib,
            'time': types.SimpleNamespace(time=self.clock),
            'subprocess': types.SimpleNamespace(run=self.remote_run),
            '_accounts_module': self.accounts,
            'MYGRAIN_BASTARDLOOP_LOCAL_SOURCE_ROOT': self.root,
            'MYGRAIN_BASTARDLOOP_SAMPLE_CACHE': {},
        }
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SERVER_PATH), 'exec'), self.server)
        self.scan = self.enterContext(patch.object(pathlib.Path, 'rglob', return_value=self.files))
        self.enterContext(patch.object(pathlib.Path, 'resolve', autospec=True, side_effect=lambda path: path))
        self.enterContext(patch.object(pathlib.Path, 'exists', return_value=True))
        self.enterContext(patch.object(
            pathlib.Path, 'is_symlink', autospec=True,
            side_effect=lambda path: path.name == 'linked.wav',
        ))
        self.enterContext(patch.object(
            pathlib.Path, 'is_file', autospec=True,
            side_effect=lambda path: path.name != 'directory.wav',
        ))
        self.list_files = self.server['list_bastardloop_source_files']
        self.addCleanup(self.remote_run.assert_not_called)

    def test_loop_l_scan_includes_new_nested_wav_case_insensitively_not_aiff(self):
        self.files.extend(self.leads / relative for relative in [
            'new.wav', 'nested/new.WAV', 'nested/deeper/new.WaV',
            'excluded.aif', 'nested/excluded.AIF', 'excluded.aiff', 'nested/excluded.AiFf',
            'notes.txt', 'linked.wav', 'directory.wav',
        ])
        self.assertEqual(self.server['get_bastardloop_local_source_root']('L'), self.leads)
        self.assertEqual(self.server['MYGRAIN_BASTARDLOOP_SOURCE_CONFIG']['samples_leads']['remote'],
                         'dropbox:SAMPLES_LEADS')
        self.assertEqual(self.list_files('L'), [
            'local-only.wav', 'nested/deeper/new.WaV', 'nested/new.WAV', 'new.wav',
        ])
        self.assertEqual(self.accounts.checked_path.call_count, 4)
        self.scan.assert_called_once_with('*')

    def test_new_wav_appears_when_existing_cache_expires(self):
        self.assertEqual(self.list_files('L'), ['local-only.wav'])
        self.files.append(self.leads / 'nested/new.WAV')
        expires_at = 1000.0 + self.server['MYGRAIN_BASTARDLOOP_LIST_CACHE_SECONDS']
        self.clock.return_value = expires_at - 1
        self.assertEqual(self.list_files('samples_leads'), ['local-only.wav'])
        self.assertEqual(self.scan.call_count, 1)
        self.clock.return_value = expires_at
        self.assertEqual(self.list_files('L'), ['local-only.wav', 'nested/new.WAV'])
        self.assertEqual(self.scan.call_count, 2)

    def test_force_refresh_finds_new_wav_before_cache_expiry(self):
        self.assertEqual(self.list_files('L'), ['local-only.wav'])
        self.files.append(self.leads / 'nested/new.WaV')
        self.assertEqual(self.list_files('L'), ['local-only.wav'])
        self.assertEqual(self.scan.call_count, 1)
        self.assertEqual(self.list_files('L', force_refresh=True), ['local-only.wav', 'nested/new.WaV'])
        self.assertEqual(self.scan.call_count, 2)


if __name__ == '__main__':
    unittest.main()
