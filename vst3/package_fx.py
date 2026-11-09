#!/usr/bin/env python3
"""Package the separately validated stereo FX bundle, never the instrument."""
import argparse,hashlib,json,pathlib,zipfile
p=argparse.ArgumentParser()
for name in ('bundle','setup','verification','sdk','output'):p.add_argument('--'+name,required=True,type=pathlib.Path)
a=p.parse_args();assert a.bundle.name=='MYGRAIN FX.vst3'
binary=a.bundle/'Contents/x86_64-win/MYGRAIN FX.vst3';assert binary.read_bytes()[:2]==b'MZ'
info=json.loads((a.bundle/'Contents/Resources/moduleinfo.json').read_text())
assert info['Version']=='0.3.0' and info['Classes'][0]['CID']=='80192C741FCA4FA0A638DE42F66C7D18'
assert info['Classes'][0]['Sub Categories']==['Fx','Filter']
files={q.relative_to(a.bundle.parent).as_posix():q.read_bytes() for q in a.bundle.rglob('*') if q.is_file()}
assert len(files)==2
files['SETUP.html']=a.setup.read_bytes();assert b'id="fx"' in files['SETUP.html']
files['VERIFICATION.txt']=a.verification.read_bytes()
files['README-FIRST.txt']=b'''MYGRAIN FX 0.3.0 - Windows x64 stereo VST3 effect preview

1. Extract this ZIP; close the DAW.
2. Copy the WHOLE "MYGRAIN FX.vst3" folder into:
   C:\\Program Files\\Common Files\\VST3\\
3. Re-scan VST3 plugins. Add MYGRAIN FX as a STEREO EFFECT, not an instrument.
4. Open its window, click Open MYGRAIN in Chrome. Sign in normally.
   It connects automatically; allow local-network access if requested.
   Press Start MYGRAIN once if Chrome needs an audio gesture.
   Manual fallback: Copy code -> DAW INPUT card -> Connect FX.
5. Enable DAW track monitoring/processing; press green Arm.
6. In DAW INPUT choose filters/main/final-stage/direct routing, gain and mute.
   R source All receives DAW input. Configure effects in their usual cards.
   Generators are optional; Start MYGRAIN generators mixes them into the return.
7. Dry/wet mixes time-aligned dry and returned audio in the plugin.

FIXED 1,000 ms transport delay, reported to the DAW for compensation.
This is a creative send/return, NOT low-latency live-instrument monitoring.
Record or export in REAL TIME to include Chrome effects.
Offline bounce/freeze, bypass, Stop, disconnect and missing returns use the
SAME delayed DRY path. Initial one-second fill is silent.
Arm stays latched through routing/processing interruptions and reconnects.
Only explicit Stop/disarm clears it. Projects save Arm, bypass and dry/wet.
Store MYGRAIN in project captures the editable patch, required sounds and
input gain/routing. Wait for Ready for DAW save, then save the DAW project.
On reopening, connect Chrome to recall. Later edits need Store again.
Input gain/routing remain separate from Song content.
To use DAW-processed material in a saved Song, print to audio and import it.

One FX instance per tab. Use a different tab for the Bridge instrument.
Never route the DAW return back into its own input. Chrome monitor is muted
while connected; normal monitoring is restored on disconnect.
Stereo input/output; float32/float64; 8-192 kHz; native bypass automation.
No helper EXE, installer, virtual cable, service or extra runtime installation.
Keep the Bridge instrument if wanted: this has a separate plugin identity.
See SETUP.html and VERIFICATION.txt for limits and actual test coverage.
Physical Windows/ASIO/commercial-DAW validation remains outstanding.

Native plugin controls: Sparse Random / Mega Random replace the current patch
using Chrome; Undo remains in MYGRAIN. The status box reports actual layer jobs
and warnings. Lit layer buttons are On; dark buttons are muted. These mirror
the browser Layers section, including global reverb/delay. Existing solo states
still apply. In Rendered mode use Refresh render after edits (stop DAW first).
Store in project stores the editable patch and retained Rendered loop; wait for
Ready for DAW save, then Save in the DAW. Chrome must stay connected for these
patch controls; they do not add native synthesis. FX source layers are silent
modulation sources, not an additional audible mix into the FX return.

https://openclaw.blackcarburning.com/mygrain/vst3-setup.html#fx
'''
files['LICENSES/Steinberg-VST3-SDK-MIT.txt']=(a.sdk/'LICENSE.txt').read_bytes()
for src,name in [('/usr/share/common-licenses/GPL-3','GPL-3.txt'),('/usr/share/doc/gcc-mingw-w64-base/copyright','GCC-MinGW-copyright-and-runtime-exception.txt'),('/usr/share/doc/mingw-w64-common/copyright','MinGW-w64-copyright.txt')]:files['LICENSES/'+name]=pathlib.Path(src).read_bytes()
files['SHA256SUMS.txt']=''.join(hashlib.sha256(body).hexdigest()+'  '+name+'\n' for name,body in sorted(files.items())).encode()
a.output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(a.output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name,body in sorted(files.items()):
        item=zipfile.ZipInfo(name,date_time=(2026,11,9,0,0,0));item.external_attr=0o100644<<16;item.compress_type=zipfile.ZIP_DEFLATED;z.writestr(item,body)
with zipfile.ZipFile(a.output) as z:
    assert z.testzip() is None
    for name,body in files.items():assert z.read(name)==body
print(json.dumps({'file':str(a.output),'bytes':a.output.stat().st_size,'sha256':hashlib.sha256(a.output.read_bytes()).hexdigest(),'binarySha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'entries':len(files)},indent=2))
