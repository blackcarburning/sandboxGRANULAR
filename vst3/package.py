#!/usr/bin/env python3
"""Assemble a prebuilt, validated portable bundle; never build or install a plugin."""
import argparse, hashlib, json, pathlib, re, shutil, zipfile
parser=argparse.ArgumentParser()
parser.add_argument('--bundle',required=True,type=pathlib.Path)
parser.add_argument('--verification',required=True,type=pathlib.Path)
parser.add_argument('--sdk',required=True,type=pathlib.Path)
parser.add_argument('--setup',type=pathlib.Path,help='Setup HTML from the staged release (defaults to app copy)')
parser.add_argument('--output',required=True,type=pathlib.Path)
args=parser.parse_args()
app=pathlib.Path(__file__).resolve().parent.parent
assert args.bundle.name=='MYGRAIN Bridge.vst3'
binary=args.bundle/'Contents/x86_64-win/MYGRAIN Bridge.vst3'
assert binary.read_bytes()[:2]==b'MZ'
metadata=json.loads((args.bundle/'Contents/Resources/moduleinfo.json').read_text())
assert metadata['Classes'][0]['CID']=='5DF4D5FA7A0E4BC6B61AE9056DA13821'
assert metadata['Version']=='0.8.0'
files={p.relative_to(args.bundle.parent).as_posix():p.read_bytes() for p in args.bundle.rglob('*') if p.is_file()}
assert set(files)=={'MYGRAIN Bridge.vst3/Contents/x86_64-win/MYGRAIN Bridge.vst3','MYGRAIN Bridge.vst3/Contents/Resources/moduleinfo.json'}
files['SETUP.html']=(args.setup or app/'vst3-setup.html').read_bytes()
assert b'0.8.0' in files['SETUP.html'] and b'Playback mode' in files['SETUP.html']
files['VERIFICATION.txt']=args.verification.read_bytes()
files['LICENSES/Steinberg-VST3-SDK-MIT.txt']=(args.sdk/'LICENSE.txt').read_bytes()
for filename,destination in [('/usr/share/common-licenses/GPL-3','GPL-3.txt'),('/usr/share/doc/gcc-mingw-w64-base/copyright','GCC-MinGW-copyright-and-runtime-exception.txt'),('/usr/share/doc/mingw-w64-common/copyright','MinGW-w64-copyright.txt')]:
    files['LICENSES/'+destination]=pathlib.Path(filename).read_bytes()
files['README-FIRST.txt']=b'''MYGRAIN Bridge 0.8.0 - Windows x64 VST3 preview

1. Extract this ZIP.
2. Copy the WHOLE "MYGRAIN Bridge.vst3" folder into:
   C:\\Program Files\\Common Files\\VST3\\
3. Re-scan VST3 plugins in your 64-bit Windows DAW.
4. Add MYGRAIN Bridge as an INSTRUMENT. Open its window.
5. Click Open MYGRAIN in Chrome. It fills the code and connects automatically.
   Allow local-network access if asked; press Start MYGRAIN only if Chrome
   needs a first audio gesture. Sign in as usual, then load a patch.
   Manual: Copy code, paste into Windows VST3 in Chrome, click Connect.
   Only one tab/browser can control this plugin at a time. Choose Playback mode:
6. Green Arm follows your DAW. Red Stop disarms. Orange Play auditions.
   Arm stays latched through routing/processing changes and reconnects.
   Only Stop/disarm turns it off. DAW projects retain the Arm preference.
   Live (default): Arm and DAW Play; edit sounds without rendering.
   Loops/seeks keep MYGRAIN advancing, NOT rewinding with the DAW.
7. Rendered: stop the DAW, Render / refresh loop, then Arm and Play.
   Warm-up cycle, then exact sample-aligned capture; no startup fade in loop.
   Starts at timeline zero; follows DAW position. Refresh after patch edits.
   Switching back to Rendered reuses the last snapshot without a new render.

No installer, helper app, virtual audio cable, service or VC runtime install.
Do not copy only the inner binary. Read SETUP.html (or the online copy):
Native plugin controls: Sparse Random / Mega Random replace the current patch
using Chrome; Undo remains in MYGRAIN. The status box reports actual layer jobs
and warnings. Lit layer buttons are On; dark buttons are muted. These mirror
the browser Layers section, including global reverb/delay. Existing solo states
still apply. In Rendered mode use Refresh render after edits (stop DAW first).
Auto-store / Store now stores the editable patch and retained Rendered loop; wait for
Ready for DAW save, then Save in the DAW. Chrome must stay connected for these
patch controls; they do not add native synthesis. FX source layers are silent
modulation sources, not an additional audible mix into the FX return.

https://openclaw.blackcarburning.com/mygrain/vst3-setup.html

Preview limits: real Windows DAW testing still pending; live patch output
stream plus optional prepared DAW-loop snapshot. Preparation uses whole-number
BPM 1-300. Offline output is supported only for a prepared loop, not live stream.
No DAW automation.
Auto-store is On by default, checking every 60 seconds (15-3600 adjustable).
Wait for a completed store, or press Store now,
then save your DAW project. Reopen it and connect Chrome to recall the patch.
The snapshot embeds settings and required samples. Automatic storage includes later edits at the selected interval.
Keep Chrome connected. Live first start uses a future bar; edits have buffering
delay. Loops/seeks do not reset Live, even without host cycle metadata.
Tempo/meter changes, stop/restart or starvation can still cause a re-arm gap.
Rendered mode has no live edits: refresh after changes. Store in Rendered mode
also embeds the retained loop; native timeline/offline playback needs no Chrome. See VERIFICATION.txt.

To remove: close the DAW and remove the copied .vst3 folder, then re-scan.
'''
files['SHA256SUMS.txt']=''.join(hashlib.sha256(v).hexdigest()+'  '+k+'\n' for k,v in sorted(files.items())).encode()
args.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(args.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for name,body in sorted(files.items()):
        info=zipfile.ZipInfo(name,date_time=(2026,11,9,0,0,0));info.external_attr=0o100644<<16
        info.compress_type=zipfile.ZIP_DEFLATED;archive.writestr(info,body)
with zipfile.ZipFile(args.output) as archive:
    assert archive.testzip() is None
    for name,body in files.items(): assert archive.read(name)==body
print(json.dumps({'file':str(args.output),'bytes':args.output.stat().st_size,'sha256':hashlib.sha256(args.output.read_bytes()).hexdigest(),'entries':len(files)},indent=2))
