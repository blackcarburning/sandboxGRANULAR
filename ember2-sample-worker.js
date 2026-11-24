/* Verified 24kHz mono industry corpus -> short DC-free, de-clicked, peak-normalised voices. */
'use strict';
function pitchCut(source,pitch,base){
 if(!pitch?.semitones)return source;
 if(!Number.isInteger(pitch.semitones)||Math.abs(pitch.semitones)>24||!['keep','speed'].includes(pitch.mode))throw Error('Invalid Ember global pitch');
 const ratio=2**(pitch.semitones/12),length=Math.max(4,Math.round(source.length/ratio)),resampled=new Float32Array(length),radius=16,cutoff=Math.min(1,1/ratio)*.94;
 for(let frame=0;frame<length;frame++){
  const position=frame*ratio,center=Math.floor(position);let sum=0,weights=0;
  for(let offset=-radius+1;offset<=radius;offset++){
   const index=center+offset,distance=position-index;if(index<0||index>=source.length||Math.abs(distance)>=radius)continue;
   const phase=Math.PI*distance,weight=(Math.abs(distance)<1e-9?cutoff:Math.sin(phase*cutoff)/phase)*(.5+.5*Math.cos(Math.PI*distance/radius));sum+=source[index]*weight;weights+=weight;
  }
  resampled[frame]=Math.abs(weights)>1e-9?sum/weights:0;
 }
 let output=resampled;
 if(pitch.mode==='keep'){
  if(typeof MygrainVocalCut==='undefined')importScripts(new URL('vocal-loop-cut.js?v=20261115-d-controls-1',base).href);
  const analysisRate=Math.min(24000,Math.max(800,Math.floor(resampled.length/2)*25));output=new Float32Array(source.length);MygrainVocalCut.stretchChannels([resampled],[output],analysisRate);
 }
 const fade=Math.min(72,Math.floor(output.length/2));let peak=0;
 for(let frame=0;frame<output.length;frame++){output[frame]*=Math.min(1,frame/Math.max(1,fade),(output.length-1-frame)/Math.max(1,fade));peak=Math.max(peak,Math.abs(output[frame]));}
 if(peak>1e-9)for(let frame=0;frame<output.length;frame++)output[frame]*=.9/peak;
 return output;
}
self.onmessage=async({data})=>{const {id,picks,base,preparationVersion}=data;try{const prepared=await Promise.all(picks.map(async pick=>{const response=await fetch(new URL('industry-corpus-v1/'+pick.id+'/'+pick.chunk+'.pcm',base),{credentials:'same-origin',signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Industry sample fetch failed ('+response.status+')');const bytes=await response.arrayBuffer();if(bytes.byteLength!==pick.chunkFrames*2)throw Error('Incomplete industry recording');const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(sha!==pick.sha256)throw Error('Industry recording checksum mismatch');const source=new Int16Array(bytes);if(preparationVersion===2)return trimCut(source,pick);const n=pick.frames,pcm=new Float32Array(n),fade=Math.min(72,Math.floor(n/2));let start=pick.start;
function extract(offset){let mean=0;for(let i=0;i<n;i++)mean+=source[offset+i]/32768/n;let peak=0,energy=0;for(let i=0;i<n;i++){const v=(source[offset+i]/32768-mean)*Math.min(1,i/Math.max(1,fade),(n-1-i)/Math.max(1,fade));pcm[i]=v;peak=Math.max(peak,Math.abs(v));energy+=v*v;}return{peak,rms:Math.sqrt(energy/n)};}
let m=extract(start);if(m.rms<1e-5){let best=0;for(let offset=0;offset<=source.length-n;offset+=Math.max(1,Math.floor(n/2))){const value=extract(offset);if(value.rms>best){best=value.rms;start=offset;}}m=extract(start);}if(m.peak<1e-7)throw Error('Selected industry recording has no usable audio');const gain=.9/m.peak;for(let i=0;i<n;i++)pcm[i]*=gain;return{pcm,pick:{...pick,start,normaliseGain:gain,normalisedPeak:.9,normalisedRms:m.rms*gain}};}));const sourceFrames=prepared.map(item=>item.pcm.length);if(data.pitch?.semitones)for(const item of prepared){item.pcm=pitchCut(item.pcm,data.pitch,base);item.pick={...item.pick,playbackFrames:item.pcm.length,pitchSemitones:data.pitch.semitones,pitchMode:data.pitch.mode};}const bank={pcms:prepared.map(x=>x.pcm),picks:prepared.map(x=>x.pick),sampleRate:24000,...(data.pitch?.semitones?{sourceFrames}: {})};self.postMessage({id,bank},bank.pcms.map(x=>x.buffer));}catch(e){self.postMessage({id,error:e.message||String(e)});}};

// Preparation v2: trim only the selected cut's leading/trailing silence. Preserve
// requested width in the recipe; report the actual retained PCM bounds separately.
function trimCut(source,pick){
 const n=pick.frames;let start=pick.start;
 function inspect(at){let mean=0;for(let i=0;i<n;i++)mean+=source[at+i]/32768/n;let peak=0,energy=0;for(let i=0;i<n;i++){const x=source[at+i]/32768-mean;peak=Math.max(peak,Math.abs(x));energy+=x*x;}return{mean,peak,rms:Math.sqrt(energy/n)};}
 let m=inspect(start);if(m.rms<1e-5){let best=0;for(let at=0;at<=source.length-n;at+=Math.max(1,Math.floor(n/2))){const next=inspect(at);if(next.rms>best){best=next.rms;start=at;}}m=inspect(start);}
 if(m.peak<1e-7)throw Error('Selected industry recording has no usable audio');
 // -48 dBFS or 2% of the cut peak (-34 dB relative), whichever is higher.
 // Quiet but usable recordings cap that floor at 25% of their own peak.
 const threshold=Math.min(m.peak*.25,Math.max(10**(-48/20),m.peak*.02));
 let first=0,last=n-1;while(first<last&&Math.abs(source[start+first]/32768)<threshold)first++;while(last>first&&Math.abs(source[start+last]/32768)<threshold)last--;
 // Keep at least 16 frames for the sample-clock's shortest playable cut.
 if(last-first+1<16){const missing=16-(last-first+1);first=Math.max(0,first-Math.ceil(missing/2));last=Math.min(n-1,first+15);first=Math.max(0,last-15);}
 const frames=last-first+1,pcm=new Float32Array(frames),fade=Math.min(72,Math.floor(frames/2));let mean=0;for(let i=0;i<frames;i++)mean+=source[start+first+i]/32768/frames;
 let peak=0,energy=0;for(let i=0;i<frames;i++){const x=(source[start+first+i]/32768-mean)*Math.min(1,i/Math.max(1,fade),(frames-1-i)/Math.max(1,fade));pcm[i]=x;peak=Math.max(peak,Math.abs(x));energy+=x*x;}
 if(peak<1e-7)throw Error('Selected industry cut has no usable audio after silence trim');const gain=.9/peak;for(let i=0;i<frames;i++)pcm[i]*=gain;
 return{pcm,pick:{...pick,start:start+first,frames,requestedFrames:pick.frames,trimStart:first,trimEnd:n-1-last,trimThreshold:threshold,normaliseGain:gain,normalisedPeak:.9,normalisedRms:Math.sqrt(energy/frames)*gain}};
}
