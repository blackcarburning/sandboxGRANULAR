'use strict';
const fs=require('node:fs'),DSP=require('../mastering-dsp.js');
const [input,output,config]=process.argv.slice(2),cfg=JSON.parse(fs.readFileSync(config,'utf8')),values=DSP.settings(cfg.settings,true),rate=48000;
const pcm=fs.readFileSync(input);if(pcm.length%8||!pcm.length)throw Error('Invalid stereo PCM');const frames=pcm.length/8,dsp=new DSP.Processor(rate,values);
// A loop starts in settled state. Warm with its immediately preceding samples.
if(cfg.loop){const warm=Math.ceil(rate*2/frames)*frames;for(let i=0;i<warm;i++){const j=i%frames;dsp.process(pcm.readFloatLE(j*8),pcm.readFloatLE(j*8+4));}}
const rendered=Buffer.alloc(pcm.length);let maxReduction=0,maxBassReduction=0;
for(let i=0;i<frames+dsp.delay;i++){const at=i<frames?i:cfg.loop?i%frames:-1;dsp.process(at<0?0:pcm.readFloatLE(at*8),at<0?0:pcm.readFloatLE(at*8+4));if(i>=dsp.delay){const j=(i-dsp.delay)*8;rendered.writeFloatLE(dsp.outL,j);rendered.writeFloatLE(dsp.outR,j+4);maxReduction=Math.max(maxReduction,dsp.reduction);maxBassReduction=Math.max(maxBassReduction,dsp.bassReduction);}}
fs.writeFileSync(output,rendered);process.stdout.write(JSON.stringify({engine:DSP.VERSION,frames,sampleRate:rate,latencySamples:dsp.delay,maxReductionDb:maxReduction,maxBassReductionDb:maxBassReduction,settings:values}));
