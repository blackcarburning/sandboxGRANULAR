#!/usr/bin/env python3
"""Validate final universal bundles on macOS and package those exact bytes."""
import hashlib,json,os,pathlib,re,shutil,subprocess,sys,zipfile
build,sdk,output=map(lambda v:pathlib.Path(v).resolve(),sys.argv[1:]);output.mkdir(parents=True,exist_ok=True)
src=pathlib.Path(__file__).resolve().parents[1]
def run(*args,log=None):
 result=subprocess.run(list(map(str,args)),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True);print(result.stdout,flush=True)
 if log:log.write_text(result.stdout)
 if result.returncode:raise RuntimeError(f'{args}: exit {result.returncode}')
 return result.stdout
def tool(name):
 matches=[p for p in build.rglob(name) if p.is_file() and os.access(p,os.X_OK)]
 assert matches,(name,build);return matches[0]
validator,moduleinfo,host=tool('validator'),tool('moduleinfotool'),tool('mac-plugin-host')
for title,version,cid,kind in [('MYGRAIN Bridge','0.7.0','5DF4D5FA7A0E4BC6B61AE9056DA13821','bridge'),('MYGRAIN FX','0.3.0','80192C741FCA4FA0A638DE42F66C7D18','fx')]:
 bundles=list(build.rglob(title+'.vst3'));assert len(bundles)==1,bundles
 bundle=bundles[0];binary=bundle/'Contents/MacOS'/title
 assert binary.is_file(),list(bundle.rglob('*'))
 run('plutil','-lint',bundle/'Contents/Info.plist')
 architecture=run('lipo','-archs',binary);assert set(architecture.split())=={'arm64','x86_64'}
 imports=run('otool','-L',binary);assert '/opt/homebrew/' not in imports and '/usr/local/' not in imports
 exports=run('nm','-gU',binary);assert all(name in exports for name in ['_bundleEntry','_bundleExit','_GetPluginFactory'])
 resources=bundle/'Contents/Resources';resources.mkdir(exist_ok=True)
 metadata=resources/'moduleinfo.json'
 run(moduleinfo,'-create','-version',version,'-path',bundle,'-output',metadata)
 info=json.loads(re.sub(r',\s*([}\]])',r'\1',metadata.read_text()));assert info['Classes'][0]['CID']==cid
 metadata.write_text(json.dumps(info,indent=2)+'\n')
 run('codesign','--force','--sign','-','--timestamp=none',bundle)
 run('codesign','--verify','--deep','--strict',bundle)
 validation=run(validator,bundle,log=output/(kind+'-validator.txt'))
 assert '0 tests failed' in validation or '0 test(s) failed' in validation or re.search(r'Failed\s*:\s*0',validation),validation[-2000:]
 run(sys.executable,src/'tests/mac_integration.py',host,bundle,output/(kind+'-native.f32'),log=output/(kind+'-native.txt'))
 stage=output/(kind+'-package');stage.mkdir(exist_ok=True);shutil.copytree(bundle,stage/bundle.name,dirs_exist_ok=True)
 shutil.copy2(src/'mac/Install-MYGRAIN.command',stage/'Install MYGRAIN.command')
 (stage/'LICENSES').mkdir(exist_ok=True);shutil.copy2(sdk/'LICENSE.txt',stage/'LICENSES/Steinberg-VST3-SDK-MIT.txt')
 (stage/'README-FIRST.txt').write_text(f'''{title} {version} — macOS universal VST3 preview (Apple Silicon ARM64 + Intel x86_64), macOS 11+.

1. Extract the ZIP and close Bitwig Studio.
2. Open Terminal and enter the extracted folder: type cd followed by a space,
   drag the EXTRACTED FOLDER into Terminal, then press Return. Run:

   ./"Install MYGRAIN.command"

   Use the capital I in Install. The ./ means the current folder; the quotes
   keep the filename's space together. Keep the installer, plugin bundle and
   SHA256SUMS.txt together in this extracted folder. Close Bitwig first.
   If you get "Permission denied", run this alternative from the same folder:

   bash "./Install MYGRAIN.command"

   No administrator password is needed.
   Installer verifies hashes and signatures, copies ONLY this plugin to
   ~/Library/Audio/Plug-Ins/VST3 and removes its download quarantine flag.
   This is ad-hoc signed, not Apple Developer ID signed or notarized.
   No global security setting is changed. Existing plugin is backed up outside
   the VST3 folder before replacement.
3. Bitwig > Settings > Locations > Plug-in Locations: include
   ~/Library/Audio/Plug-Ins/VST3 and rescan VST3.
4. Add {title} as {'a stereo audio EFFECT' if kind=='fx' else 'an INSTRUMENT'}.
5. Open the native plugin window and click Open MYGRAIN in Chrome.
   Chrome must be installed on this same Mac. Sign in normally, allow local
   network access if asked, and press Start MYGRAIN once if audio needs a gesture.
6. Press green Arm. Use a separate browser tab for each plugin instance.

''' + ('''FX: choose DAW INPUT routing/effects in Chrome. DAW audio passes through
Chrome and back to the insert. Fixed 1,000 ms delay is reported for compensation;
delayed dry and wet are aligned. Stop, disconnect, bypass, offline or missing
return uses delayed dry. Print wet audio in REAL TIME; this is not low-latency
live monitoring. DAW Play/BPM clocks silent patch modulation sources. Avoid
routing the output back to its own input.
''' if kind=='fx' else '''BRIDGE: Live streams patch edits after buffering and keeps running over DAW
loops/seeks. Rendered follows the DAW timeline, including offline playback.
First Live start schedules a future bar. Store in Rendered mode also embeds
the retained loop, so saved audio plays natively without Chrome running.
''')+'''
In Chrome press Store MYGRAIN in project, wait for Ready for DAW save, then
save the DAW project. This embeds the editable patch and its required sounds.
Connect Chrome after reopening to recall the saved patch automatically.
Later edits need Store again, then DAW Save. It stores the current patch,
not the Songs library or account credentials. Browser login/audio gesture may
still be needed. FX still needs Chrome for real-time wet processing.
Arm remains latched through reconnect/processing changes; explicit Stop disarms.
Closing only the editor does not disconnect. Manual fallback: Copy code, then
paste into Chrome's VST3 panel (Bridge) or DAW INPUT card (FX).
To remove: close Bitwig and remove this bundle from the user VST3 directory.
Automated macOS/native host verification is included; physical Mac/Bitwig and
CoreAudio-driver recording alignment remain unverified.
Native plugin controls: Sparse Random / Mega Random replace the current patch
using Chrome; Undo remains in MYGRAIN. The status box reports actual layer jobs
and warnings. Lit layer buttons are On; dark buttons are muted. These mirror
the browser Layers section, including global reverb/delay. Existing solo states
still apply. In Rendered mode use Refresh render after edits (stop DAW first).
Store in project stores the editable patch and retained Rendered loop; wait for
Ready for DAW save, then Save in the DAW. Chrome must stay connected for these
patch controls; they do not add native synthesis. FX source layers are silent
modulation sources, not an additional audible mix into the FX return.

https://openclaw.blackcarburning.com/mygrain/vst3-setup.html#mac
''')
 verification=f'{title} {version}\nSDK pinned: 3cdf9ca5d1f5b1b21e0a86832aa4abe55607bd96\nmacOS runner: '+run('sw_vers')+'\nUniversal architectures: '+architecture+'\nAd-hoc signature verified. System frameworks only. Core/transport/FX CTest checks passed.\nActual Mach-O factory/editor/socket/callback PCM, editor reopen, saved-state roundtrip, Arm/Stop, offline output tested on runner architecture.\n'+(output/(kind+'-native.f32.json')).read_text()+'\n\nPhysical Mac/Bitwig/CoreAudio tests NOT performed. No Developer ID notarization.\n\n'+validation
 (stage/'VERIFICATION.txt').write_text(verification)
 files=sorted(p for p in stage.rglob('*') if p.is_file());(stage/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+str(p.relative_to(stage))+'\n' for p in files))
 release=output/f'mygrain-{kind}-macos-{version}.zip'
 with zipfile.ZipFile(release,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for p in sorted(stage.rglob('*')):
   if p.is_file():z.write(p,p.relative_to(stage))
 with zipfile.ZipFile(release) as z:
  assert z.testzip() is None;assert z.read(bundle.name+'/Contents/MacOS/'+title)==binary.read_bytes()
 print(json.dumps({'release':str(release),'sha256':hashlib.sha256(release.read_bytes()).hexdigest(),'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest()}))
