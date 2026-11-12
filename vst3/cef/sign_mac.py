#!/usr/bin/env python3
"""Ad-hoc sign private runtime from leaves outward, then verify the whole bundle."""
import pathlib,subprocess,sys
bundle=pathlib.Path(sys.argv[1]);magic={b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe'}
def sign(p):subprocess.run(['codesign','--force','--sign','-','--timestamp=none',str(p)],check=True)
for p in sorted(bundle.rglob('*'),key=lambda p:len(p.parts),reverse=True):
 if p.is_symlink():continue
 if p.is_file():
  with p.open('rb') as f:kind=f.read(4)
  if kind in magic:sign(p)
 elif p.suffix in ['.framework','.app']:sign(p)
sign(bundle)
subprocess.run(['codesign','--verify','--deep','--strict','--verbose=2',str(bundle)],check=True)
