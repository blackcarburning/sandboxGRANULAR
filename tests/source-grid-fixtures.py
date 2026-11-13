"""Seed synthetic audio only below a dedicated disposable /tmp account store."""
from pathlib import Path
import sys
import wave
import numpy as np

root = Path(sys.argv[1]).resolve()
if not root.is_relative_to(Path('/tmp')) or root == Path('/tmp'):
    raise ValueError('Choose a dedicated store beneath /tmp.')
folders = ['SAMPLEDROP', 'SAMPLEDROP2', 'SAMPLEDROP_CLAW', 'SAMPLES_MODULAR',
           'SAMPLES_VOCAL', 'SAMPLES_NCRVOCALS', 'SAMPLES_PIANO', 'SAMPLES_ORCH',
           'SAMPLES_TERRA', 'SAMPLES_LEADS', 'SAMPLES_BASS', 'SAMPLES_KICKS',
           'SAMPLES_SNARES', 'SAMPLES_HATS', 'SAMPLES_CRASH', 'SAMPLES_CLAP',
           'SAMPLES_PERC', 'SAMPLES_LOOPS']

def tone(path, number):
    pcm = (6000 * np.sin(2 * np.pi * (140 + number % 11 * 27) * np.arange(24000) / 24000)).astype('<i2')
    with wave.open(str(path), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(24000)
        output.writeframes(pcm.tobytes())

for folder in folders:
    target = root / 'admin/source_mirrors' / folder / 'Nested'
    target.mkdir(parents=True, exist_ok=True)
    for number in range(207 if folder in ['SAMPLEDROP', 'SAMPLES_KICKS'] else 4):
        tone(target / f'Tone_{number:03}_C4.wav', number)
target = root / 'SAMPLES_LOOPSTORE'
target.mkdir(parents=True, exist_ok=True)
for number in range(10):
    tone(target / f'Tone_{number:03}_C4.wav', number)
print(root)
