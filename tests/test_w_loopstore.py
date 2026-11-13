"""W's new next-load folder is saved without changing already loaded PCM."""
import os
from pathlib import Path
import unittest
from test_song_backend import SONGS, part_zip, rewrite_part

class WLoopStoreTests(unittest.TestCase):
    def setUp(self):
        self.validate = SONGS.validate_part_zip
        if os.environ.get('MYGRAIN_SONG_STAGE'):
            import ast
            source = Path(os.environ['MYGRAIN_SONG_STAGE']).read_text()
            tree = ast.parse(source)
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'validate_part_zip')
            namespace = dict(SONGS.__dict__)
            exec(ast.get_source_segment(source, node), namespace)
            self.validate = namespace['validate_part_zip']
    def body(self, repository):
        return rewrite_part(part_zip(), lambda m: m['state']['modes'].update(loopSampleRepositories={'A':'sampledrop','B':'sampledrop2','C':'splice_claw','W':repository}))
    def test_loopstore_aliases_existing_default_without_rewriting_source(self):
        current = self.body('samples_loopstore')
        before = bytes(current)
        self.assertEqual(self.validate(current), self.validate(self.body('samples_modular')))
        self.assertEqual(current, before)
    def test_existing_repositories_keep_previous_hashes(self):
        # The original stored options stay distinct for historical cache identity.
        values = [self.validate(self.body(repo))['contentSha256'] for repo in ['samples_modular','samples_loops']]
        self.assertNotEqual(*values)
    def test_invalid_sources_rejected(self):
        for value in ['../private','user_ftp',False,None,{}]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError,'Loop W library'):
                self.validate(self.body(value))

if __name__ == '__main__':
    unittest.main()
