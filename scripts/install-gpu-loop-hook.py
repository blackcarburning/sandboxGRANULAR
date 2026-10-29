#!/usr/bin/env python3
"""Install the optional loop-preparation hook into the sibling documenter server.
No service restart, dependency installation or source-media changes are performed.
"""
import pathlib
import sys
root = pathlib.Path(__file__).resolve().parents[1]
server = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / 'fs7300-documenter/server.py'
source = server.read_text()
hook = (root / 'backend/gpu-documenter-hook.txt').read_text()
if '# MYGRAIN optional CUDA loop preparation;' in source:
    print('GPU loop hook already installed')
    sys.exit(0)
signature = 'def time_stretch_audio_preserve_pitch(samples, rate):'
anchor = '\ndef maybe_prepare_bar_locked_bastardloop_source('
if source.count(signature) != 1 or source.count(anchor) != 1:
    raise SystemExit('Unrecognised documenter DSP version; no change made')
source = source.replace(signature, 'def time_stretch_audio_preserve_pitch_cpu(samples, rate):', 1)
source = source.replace(anchor, hook + anchor, 1)
compile(source, str(server), 'exec')
server.write_text(source)
print('Installed optional CUDA loop hook; restart documenter to activate')
