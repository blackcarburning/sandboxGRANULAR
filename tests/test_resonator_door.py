"""Door contact timbre regressions at both normal audio sample rates."""
import json
import pathlib
import subprocess
import unittest
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[1]

class DoorContactTests(unittest.TestCase):
    def test_contacts_are_bandlimited_with_short_midrange_ring(self):
        for rate in (44100, 48000):
            for material in ('hollowWood', 'wood', 'metal'):
                with self.subTest(rate=rate, material=material):
                    script = r'''
const R=require('./resonator-dsp.js'),rate=RATE,material=MATERIAL;
const s=R.normalize({enabled:true,slots:[{object:'door',material,source:'A',band:'full',drive:30,level:.8,pan:0,gap:2,looseness:.7},{enabled:false}]}),e=new R.Engine(rate,s),pcm=new Float32Array(rate*2);
for(let n=0;n<pcm.length;n+=128){const a=Float32Array.from({length:128},(_,i)=>{const t=(n+i)/rate;return .12*Math.sin(2*Math.PI*73*t)*(.5+.5*Math.sin(2*Math.PI*2*t));}),o=[[new Float32Array(128),new Float32Array(128)]];e.process([[a]],o);pcm.set(o[0][0].subarray(0,Math.min(128,pcm.length-n)),n);}
if(e.bodies[0].impacts<100)throw Error('Fixture must trigger repeated door contact');
process.stdout.write(Buffer.from(pcm.buffer));
'''.replace('RATE', str(rate)).replace('MATERIAL', json.dumps(material))
                    pcm=np.frombuffer(subprocess.check_output(['node','-e',script],cwd=ROOT),dtype=np.float32)
                    self.assertTrue(np.isfinite(pcm).all())
                    self.assertGreater(float(np.sqrt(np.mean(pcm**2))), .001)
                    self.assertLess(float(np.max(np.abs(pcm))), .66)
                    spectrum=np.abs(np.fft.rfft(pcm*np.hanning(len(pcm))))**2
                    frequencies=np.fft.rfftfreq(len(pcm),1/rate)
                    total=spectrum.sum()
                    self.assertLess(float(spectrum[frequencies>=4000].sum()/total), .0002)
                    self.assertGreater(float(spectrum[(frequencies>=700)&(frequencies<3500)].sum()/total), .0018)
