import importlib.util
import pathlib
import tempfile
import unittest
import wave
import numpy as np

spec = importlib.util.spec_from_file_location('mastering', pathlib.Path(__file__).resolve().parents[1] / 'backend/mygrain_mastering.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

class Mastering(unittest.TestCase):
    def test_presets_loop_and_song(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            rate = 48000
            t = np.arange(rate * 3) / rate
            x = (.18*np.sin(2*np.pi*80*t) + .07*np.sin(2*np.pi*1600*t))
            x += .3*np.exp(-((t % .5) / .018)**2) * np.sin(2*np.pi*160*t)
            stereo = np.stack([x, x*.95], axis=1)
            source = root/'source.wav'
            with wave.open(str(source), 'wb') as w:
                w.setparams((2, 2, rate, 0, 'NONE', 'not compressed'))
                w.writeframes((stereo*32767).astype('<i2').tobytes())
            original = source.read_bytes()
            for preset, loop in [('clean', True), ('punch', True), ('dense', True), ('level', True), ('clean', False)]:
                output = root/(preset+str(loop)+'.wav')
                report = m.process(source, output, preset, loop)
                self.assertEqual(report['frames'], len(t))
                self.assertLessEqual(report['after']['truePeakDb'], -1)
                self.assertNotEqual(output.read_bytes(), original)
                self.assertEqual(source.read_bytes(), original)
                if preset == 'dense':
                    self.assertGreater(report['makeupDb'], .3)
                    self.assertLess(abs(report['after']['lufs'] - m.PRESETS[preset][0]), .3)
                print(preset, loop, report)
            loud = m.process(source, root/'loud-song.wav', 'dense', False, -6)
            self.assertLess(abs(loud['after']['lufs'] + 6), .4)
            self.assertLessEqual(loud['after']['truePeakDb'], -1)
            self.assertEqual(loud['frames'], len(t))
            self.assertEqual(source.read_bytes(), original)
    def test_rates_short_loops_and_alignment(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            for rate in (8000, 44100, 96000):
                n = int(rate * .25)
                x = .1 * np.sin(2*np.pi*80*np.arange(n)/rate)
                source = root / 'short.wav'
                with wave.open(str(source), 'wb') as w:
                    w.setparams((1,2,rate,0,'NONE','not compressed'))
                    w.writeframes((x*32767).astype('<i2').tobytes())
                report = m.process(source, root/'out.wav', 'clean', True)
                self.assertEqual(report['frames'], n)
                # Seam is comparable to the ordinary adjacent step of this sine.
                with wave.open(str(root/'out.wav'), 'rb') as w:
                    raw = w.readframes(n)
                values = np.array([int.from_bytes(raw[i:i+3], 'little', signed=True)/8388608 for i in range(0,len(raw),6)])
                self.assertLess(report['seamStep'], float(np.max(np.abs(np.diff(values)))) * 1.5)
                x[:] = 0
                x[n//2] = .2
                with wave.open(str(source), 'wb') as w:
                    w.setparams((1,2,rate,0,'NONE','not compressed'))
                    w.writeframes((x*32767).astype('<i2').tobytes())
                m.process(source, root/'out.wav', 'clean', False)
                with wave.open(str(root/'out.wav'), 'rb') as w:
                    raw = w.readframes(n)
                values = [int.from_bytes(raw[i:i+3], 'little', signed=True) for i in range(0,len(raw),6)]
                self.assertEqual(max(range(n),key=lambda i: abs(values[i])), n//2)

    def test_target_validation(self):
        for value in (-25, -5, float('nan'), float('inf'), True, '-6'):
            with self.assertRaises(ValueError):
                m.target_lufs('dense', value)
        self.assertEqual(m.target_lufs('dense', -6), -6)
        self.assertEqual(m.target_lufs('clean'), -16)

    def test_silent_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            source = pathlib.Path(folder)/'silent.wav'
            with wave.open(str(source), 'wb') as w:
                w.setparams((1,2,44100,0,'NONE','not compressed'));w.writeframes(bytes(88200))
            with self.assertRaisesRegex(ValueError, 'No measurable'):
                m.process(source, pathlib.Path(folder)/'out.wav')

if __name__ == '__main__': unittest.main()
