#!/usr/bin/env python3
"""Package validated runtime bytes only; do not build or change existing releases."""
import argparse,hashlib,json,pathlib,zipfile,stat
p=argparse.ArgumentParser();p.add_argument('--bundle',type=pathlib.Path,required=True);p.add_argument('--platform',choices=['windows','macos'],required=True);p.add_argument('--verification',type=pathlib.Path,required=True);p.add_argument('--sdk',type=pathlib.Path,required=True);p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args()
source=pathlib.Path(__file__).parent;app=source.parents[1];assert a.bundle.name=='MyGrain CEF.vst3'
info=json.loads((a.bundle/'Contents/Resources/moduleinfo.json').read_text());assert info['Version']=='0.1.1' and info['Classes'][0]['CID']=='A44B25E13DE64853A16CC63921C9D4B2'
files={};modes={};links={}
for file in a.bundle.rglob('*'):
 if file.is_symlink():links[file.relative_to(a.bundle.parent).as_posix()]=str(file.readlink()).encode();continue
 if not file.is_file():continue
 key=file.relative_to(a.bundle.parent).as_posix();files[key]=file.read_bytes();modes[key]=stat.S_IMODE(file.stat().st_mode)
if a.platform=='windows':
 assert files['MyGrain CEF.vst3/Contents/x86_64-win/MyGrain CEF.vst3'][:2]==b'MZ'
 assert any(k.endswith('/cef/libcef.dll') for k in files)
 install='Close the DAW. Copy the WHOLE MyGrain CEF.vst3 folder into C:\\Program Files\\Common Files\\VST3\\, then rescan VST3. Do not copy only the inner binary.'
else:
 assert files['MyGrain CEF.vst3/Contents/MacOS/MyGrain CEF'][:4]==b'\xca\xfe\xba\xbe'
 files['Install MyGrain CEF.command']=(source/'Install-MyGrain-CEF.command').read_bytes();modes['Install MyGrain CEF.command']=0o755
 install='macOS 13+. Close the DAW. From the extracted folder run ./"Install MyGrain CEF.command" (or bash "./Install MyGrain CEF.command"). Installs only this plugin in your user VST3 folder. Ad-hoc signed, not Developer-ID signed/notarized.'
files['README-FIRST.txt']=('''MyGrain CEF 0.1.1 preview - '''+a.platform+'''\n\n'''+install+'''

Add MyGrain CEF as an INSTRUMENT, open its window and sign in. The app is
embedded; no external Chrome window or connection-code copying is needed.
Press Start MYGRAIN if asked. Arm follows the DAW; Stop disarms.

AUTO-SAVE IS RETAINED: On by default, check every 60 seconds (15-3600 adjustable).
Store now is also available. Wait for Ready for DAW save, then SAVE YOUR DAW
PROJECT NORMALLY. Automatic patch storage does not invoke DAW File > Save.
Settings, required samples and a retained prepared loop are embedded in the
latest completed snapshot. A DAW save during transfer uses the previous complete
snapshot. A failed transfer does not erase it. Auto-store runs with the editor
closed. New instances recall the editable patch after signing in/starting audio.
Auto-store preferences are retained in that patch snapshot.

The current hosted app loads on a new instance. Store + reload app safely stores
before refreshing/reconnecting to the current app; this interrupts Live audio.
Closing/reopening the window resumes the existing app, without restarting it.
Profiles are per-instance and temporary. Sign in for each new instance.
The hosted app needs internet. Prepared Rendered audio can play offline/native
without the browser; refresh its render after sound changes. Live needs real-time
playback and retains Bridge timing/buffering limits. No new DAW automation.
Native OS-file drag/drop and international IME are not integrated; use file pickers.

This is a separate plugin. MYGRAIN Bridge 0.8.0 and MYGRAIN FX 0.4.0 are unchanged.
Keep all CEF runtime/helper/resources/credits in the bundle. CEF runtime or bridge
protocol upgrades may need a plugin update; normal app edits do not.

Preview: see VERIFICATION.txt for measured tests and untested physical DAWs/devices.
Setup: https://openclaw.blackcarburning.com/mygrain/cef-setup.html
''').encode()
files['SETUP.html']=(app/'cef-setup.html').read_bytes();files['VERIFICATION.txt']=a.verification.read_bytes();files['LICENSES/Steinberg-VST3-SDK-MIT.txt']=(a.sdk/'LICENSE.txt').read_bytes()
if a.platform=='windows':
 for fn in ['/usr/share/doc/mingw-w64-common/copyright','/usr/share/doc/gcc-mingw-w64-base/copyright']:
  src=pathlib.Path(fn)
  if src.exists():files['LICENSES/'+src.parent.name+'-copyright.txt']=src.read_bytes()
files['SHA256SUMS.txt']=''.join(hashlib.sha256(v).hexdigest()+'  '+k+'\n' for k,v in sorted(files.items())).encode()
a.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(a.output,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for k,v in sorted(files.items()):
  i=zipfile.ZipInfo(k);i.create_system=3;i.external_attr=(stat.S_IFREG|modes.get(k,0o644))<<16;i.compress_type=zipfile.ZIP_DEFLATED;z.writestr(i,v)
 for k,v in sorted(links.items()):
  i=zipfile.ZipInfo(k);i.create_system=3;i.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(i,v)
with zipfile.ZipFile(a.output) as z:
 assert z.testzip() is None
 for k,v in files.items():assert z.read(k)==v
print(json.dumps({'file':str(a.output),'bytes':a.output.stat().st_size,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest()},indent=2))
