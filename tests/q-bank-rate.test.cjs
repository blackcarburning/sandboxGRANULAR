'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.env.MYGRAIN_Q_TEST_ROOT||path.resolve(__dirname,'..');
const T=require(path.join(root,'q-theory.js')),{Controller}=require(path.join(root,'q-card.js'));
function fixture(instrument='piano'){
 const state=T.defaults();state.instrument=instrument;state.sequence[0]=T.normalizeStep({notes:[48],velocity:95});
 state.bank={version:1,instrument:T.instruments[instrument].id,sampleRate:44100,samples:[48,51].map((midi,i)=>({
  id:instrument==='piano'?(i?'Ds3v12':'C3v12'):(i?'viola50v96':'viola48v96'),midi:instrument==='piano'?midi:(i?50:48),velocity:instrument==='piano'?95:96,
  offset:i*5292,frames:4410,...(instrument==='strings'?{loopStart:441,loopEnd:3969}:{})}))};
 return{state,asset:{channels:2,frames:10584,sampleRate:44100}};
}
test('portable Q atlas frame maps follow actual PCM rate, with unchanged canonical banks',()=>{
 for(const instrument of ['piano','strings'])for(const rate of [22050,44100,48000,96000]){
  const {state,asset}=fixture(instrument),before=JSON.stringify(state),next={...asset,sampleRate:rate,frames:Math.round(asset.frames*rate/asset.sampleRate)};
  const bank=T.bankForAsset(state,next);T.validateBank({...state,bank},next);assert.equal(JSON.stringify(state),before);
  if(rate===44100)assert.equal(bank,state.bank);
  for(let i=0;i<bank.samples.length;i++){
   const a=state.bank.samples[i],b=bank.samples[i];assert(Math.abs(b.offset/rate-a.offset/44100)<=.5/rate+1e-12);
   if(instrument==='strings')assert(Math.abs(b.loopStart/rate-a.loopStart/44100)<=.5/rate+1e-12);
  }
 }
});
test('mismatched, malformed, overlapping and truncated Q atlases remain rejected',()=>{
 for(const mutate of [x=>x.asset.frames+=100,x=>x.asset.channels=1,x=>x.state.bank.samples[1].offset--,x=>x.state.bank.samples[0].id='not-a-sample']){
  const x=fixture();x.asset={...x.asset,sampleRate:48000,frames:11520};mutate(x);assert.throws(()=>T.bankForAsset(x.state,x.asset));
 }
});
test('Q state capture fixes metadata without reading, allocating or replacing the atlas PCM',()=>{
 const {state}=fixture(),c=new Controller({length:()=>16,bpm:()=>120,save(){},context:()=>({currentTime:0})});
 c.state=state;const pcm={sampleRate:48000,length:11520,numberOfChannels:2,getChannelData(){throw Error('PCM must stay untouched')}};
 c.piano.restored(pcm,state.bank);const before=JSON.stringify(state),saved=c.getState();
 assert.equal(saved.bank.sampleRate,48000);T.validateBank(saved,{sampleRate:48000,frames:11520,channels:2});
 assert.equal(c.piano.atlas,pcm);assert.equal(JSON.stringify(state),before);assert.equal(c.piano.bank.sampleRate,44100);
 assert.deepEqual(c.getState(),saved);
});
