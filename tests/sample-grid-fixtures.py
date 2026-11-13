"""Seed the chooser tests below a dedicated /tmp test-account store only."""
from pathlib import Path
import math
import struct
import sys
import wave

root = Path(sys.argv[1]).resolve()
if not root.is_relative_to(Path('/tmp')) or root == Path('/tmp'):
    raise ValueError('Use a dedicated disposable directory beneath /tmp.')
for folder in ('SAMPLES_KICKS', 'SAMPLES_SNARES', 'SAMPLES_HATS', 'SAMPLES_CLAP',
               'SAMPLES_CRASH', 'SAMPLES_PERC', 'SAMPLEDROP'):
    target = root / 'admin/source_mirrors' / folder / 'Nested'
    target.mkdir(parents=True, exist_ok=True)
    for number in range(417 if folder == 'SAMPLES_KICKS' else 4):
        frames = b''.join(struct.pack('<h', round(4000 * math.sin(
            2 * math.pi * (160 + (number % 13) * 37) * i / 24000
        ) * math.exp(-i / 12000))) for i in range(12000))
        with wave.open(str(target / f'Tone_{number:03}.wav'), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(24000)
            output.writeframes(frames)
print(root)
