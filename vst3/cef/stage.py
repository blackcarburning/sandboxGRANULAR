#!/usr/bin/env python3
"""Stage CEF's private runtime beside the separate plugin. Never touches Bridge/FX."""
import argparse,pathlib,shutil,json,plistlib,os,subprocess
p=argparse.ArgumentParser();p.add_argument('platform',choices=['windows','macos']);p.add_argument('--plugin',required=True,type=pathlib.Path);p.add_argument('--helper',required=True,type=pathlib.Path);p.add_argument('--sdk',required=True,type=pathlib.Path);p.add_argument('--output',required=True,type=pathlib.Path);p.add_argument('--fx',action='store_true');a=p.parse_args()
name='MyGrain CEF FX' if a.fx else 'MyGrain CEF'
version='0.1.1' if a.fx else '0.1.4'
browser_id='com.blackcarburning.mygrain.cef.fx.browser' if a.fx else 'com.blackcarburning.mygrain.cef.browser'
bundle=a.output/(name+'.vst3')
if a.platform=='windows':
 binary=bundle/('Contents/x86_64-win/'+name+'.vst3');binary.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a.plugin,binary)
 runtime=binary.parent/'cef';runtime.mkdir(exist_ok=True)
 for folder in ['Release','Resources']:
  for item in (a.sdk/folder).iterdir():
   if item.suffix in ['.lib','.pdb','.exp']:continue
   if item.is_dir():shutil.copytree(item,runtime/item.name,dirs_exist_ok=True)
   else:shutil.copy2(item,runtime/item.name)
 shutil.copy2(a.helper,runtime/'MyGrainCEF.exe')
else:
 shutil.copytree(a.plugin,bundle,dirs_exist_ok=True)
 app=bundle/'Contents/Resources/MyGrainCEF.app';content=app/'Contents';(content/'MacOS').mkdir(parents=True,exist_ok=True)
 shutil.copy2(a.helper,content/'MacOS/MyGrainCEF')
 frameworks=content/'Frameworks';frameworks.mkdir(exist_ok=True)
 framework='Chromium Embedded Framework.framework';shutil.copytree(a.sdk/'Release'/framework,frameworks/framework,symlinks=True,dirs_exist_ok=True)
 info={'CFBundleExecutable':'MyGrainCEF','CFBundleIdentifier':browser_id,'CFBundleName':'MyGrain CEF Browser','CFBundlePackageType':'APPL','CFBundleVersion':version,'LSUIElement':True,'NSHighResolutionCapable':True,'LSMinimumSystemVersion':'13.0','NSMicrophoneUsageDescription':'MyGrain can record audio only when you explicitly enable its microphone input.'}
 (content/'Info.plist').write_bytes(plistlib.dumps(info))
 helper=frameworks/'MyGrainCEF Helper.app/Contents';(helper/'MacOS').mkdir(parents=True,exist_ok=True);shutil.copy2(a.helper,helper/'MacOS/MyGrainCEF Helper')
 subprocess.run(['install_name_tool','-change','@executable_path/../Frameworks/Chromium Embedded Framework.framework/Chromium Embedded Framework','@executable_path/../../../Chromium Embedded Framework.framework/Chromium Embedded Framework',str(helper/'MacOS/MyGrainCEF Helper')],check=True)
 info.update(CFBundleExecutable='MyGrainCEF Helper',CFBundleIdentifier=browser_id+'.helper',CFBundleName='MyGrain CEF Helper');(helper/'Info.plist').write_bytes(plistlib.dumps(info))
licenses=bundle/'Contents/Resources/CEF-LICENSES';licenses.mkdir(parents=True,exist_ok=True)
shutil.copy2(a.sdk/'LICENSE.txt',licenses/'CEF-LICENSE.txt')
for name in ['CREDITS.html','chrome_credits.html','credits.html']:
 for source in a.sdk.rglob(name):
  if source.is_file():shutil.copy2(source,licenses/source.name);break
print(bundle.resolve())
