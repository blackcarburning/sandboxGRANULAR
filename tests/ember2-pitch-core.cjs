const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),task=process.env.TASK,helper={};
new Function('globalThis',fs.readFileSync(root+'/vocal-loop-cut.js','utf8'))(helper);
const context=new Function('self','URL','MygrainVocalCut',fs.readFileSync(root+'/ember2-sample-worker.js','utf8')+';return {pitchCut};')({},URL,helper.MygrainVocalCut);
const original=Float32Array.from({length:24000},(_,frame)=>.5*Math.sin(2*Math.PI*440*frame/24000)),snapshot=original.slice(),rows=[];
function frequency(samples){const first=Math.round(samples.length*.2),last=Math.round(samples.length*.8),crossings=[];for(let frame=first+1;frame<last;frame++)if(samples[frame-1]<=0&&samples[frame]>0)crossings.push(frame-1-samples[frame-1]/(samples[frame]-samples[frame-1]));return(crossings.length-1)*24000/(crossings.at(-1)-crossings[0]);}
assert.equal(context.pitchCut(original,{semitones:0,mode:'keep'},''),original);
for(const mode of ['keep','speed'])for(let semitones=-24;semitones<=24;semitones++){
 if(!semitones)continue;
 const output=context.pitchCut(original,{semitones,mode},''),ratio=2**(semitones/12),actual=frequency(output),expected=440*ratio,error=Math.abs(actual/expected-1);
 assert.equal(output.length,mode==='keep'?original.length:Math.round(original.length/ratio));assert(error<.015,JSON.stringify({mode,semitones,actual,expected,error}));assert(output.every(value=>Number.isFinite(value)&&Math.abs(value)<=.900001));rows.push({mode,semitones,frames:output.length,actual,expected,error});
}
assert.deepEqual(original,snapshot);
const shortRows=[];
for(const frames of [2000,8192])for(let semitones=-24;semitones<=24;semitones++){
 if(!semitones)continue;
 const source=Float32Array.from({length:frames},(_,frame)=>.5*Math.sin(2*Math.PI*440*frame/24000)),output=context.pitchCut(source,{semitones,mode:'keep'},''),actual=frequency(output),expected=440*2**(semitones/12),error=Math.abs(actual/expected-1);assert(error<.02,JSON.stringify({frames,semitones,actual,expected,error}));shortRows.push({frames,semitones,actual,expected,error});
}
for(const frames of [16,31,32,257,2000,384000])for(const semitones of [-24,24])for(const mode of ['keep','speed']){const source=Float32Array.from({length:frames},(_,frame)=>Math.sin(frame*.2)*.4),output=context.pitchCut(source,{semitones,mode},'');assert.equal(output.length,mode==='keep'?frames:Math.max(4,Math.round(frames/2**(semitones/12))));assert(output.every(value=>Number.isFinite(value)&&Math.abs(value)<=.900001));}
const modelContext=vm.createContext({});for(const file of ['ember-dsp.js','ember2-dsp.js'])vm.runInContext(fs.readFileSync(root+'/'+file,'utf8'),modelContext);const model=modelContext.MygrainEmber,base={...model.defaults(),enabled:true};
for(const mode of ['keep','speed']){assert.equal(model.renderVersion({...base,pitch:{semitones:0,mode}}),26);for(const semitones of [-24,-1,1,24])assert.equal(model.renderVersion({...base,pitch:{semitones,mode}}),30);assert.equal(model.renderVersion({...base,enabled:false,pitch:{semitones:12,mode}}),0);}
fs.writeFileSync(task+'/evidence/pitch-core.json',JSON.stringify({rows,shortRows,sourceImmutable:true,extremeWidths:true},null,2));console.log('PASS 96 pitch/duration cases, 96 short-cut frequency checks, immutable source, extreme cut widths and selective capability');
