#!/usr/bin/env python3
"""Combine the pinned Intel/Apple Silicon CEF runtimes without losing V8 data."""
import pathlib,shutil,subprocess,sys
arm,intel,arm_helper,intel_helper,destination,helper=map(pathlib.Path,sys.argv[1:])
shutil.copytree(arm,destination,symlinks=True,dirs_exist_ok=True)
framework=pathlib.Path('Release/Chromium Embedded Framework.framework')
magic={b'\xcf\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xca\xfe\xba\xbe'}
for p in (intel/framework).rglob('*'):
 if not p.is_file() or p.is_symlink():continue
 relative=p.relative_to(intel);target=destination/relative;target.parent.mkdir(parents=True,exist_ok=True)
 with p.open('rb') as f:kind=f.read(4)
 if kind in magic and (arm/relative).is_file():
  subprocess.run(['lipo','-create',str(arm/relative),str(p),'-output',str(target)],check=True)
 elif not target.exists():shutil.copy2(p,target)
subprocess.run(['lipo','-create',str(arm_helper),str(intel_helper),'-output',str(helper)],check=True)
for cpu in ['arm64','x86_64']:assert (destination/framework/'Resources'/('v8_context_snapshot.'+cpu+'.bin')).is_file()
