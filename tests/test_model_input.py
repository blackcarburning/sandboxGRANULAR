"""Regression: large prompts on nonblocking stdin must not fail with EAGAIN."""
import os
import pathlib
import subprocess
import unittest

MODULE = (pathlib.Path(__file__).parents[1] / 'backend/mygrain_model_input.mjs').as_uri()
SCRIPT = f"import {{readModelMessage}} from '{MODULE}'; process.stdout.write(await readModelMessage());"

class ModelInput(unittest.TestCase):
    def read(self, text):
        def nonblocking():
            os.set_blocking(0, False)
        return subprocess.run(['/usr/bin/node', '--input-type=module', '-e', SCRIPT],
                              input=text, text=True, capture_output=True,
                              preexec_fn=nonblocking, timeout=10)

    def test_large_unicode_prompt_over_nonblocking_pipe(self):
        text = ('D&B 174 BPM — modular / Terra 🎵\n' * 4000)
        self.assertGreater(len(text.encode()), 65536)
        for _ in range(3):
            result = self.read(text)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, text)

    def test_empty_and_oversized_requests_rejected(self):
        for text in ['', 'a' * 250001]:
            with self.subTest(size=len(text)):
                result = self.read(text)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('Invalid recipe request.', result.stderr)

if __name__ == '__main__':
    unittest.main()
