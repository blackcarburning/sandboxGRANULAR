const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sources, eligibleFile, chooseSample } = require('../random-performance-samples.js');
const catalogUrl = 'https://example.test/mygrain-bastardloops/api/source-files';
const response = (sourceKey, files, status = 200) => ({ ok: status === 200, status, json: async () => ({ ok: status === 200, sourceKey, files }) });
for (const key of sources) test(`random picker reaches ${key} using its complete directory`, async () => {
 const queried = [];
 const selected = await chooseSample({ catalogUrl, random: () => .99999, fetch: async url => {
  const source = new URL(url).searchParams.get('source'); queried.push(source);
  return response(source, source === key ? [{ name: 'tone.wav', relativePath: 'Tonal/tone.wav', sourceKey: key, previewUrl: 'https://bad.test/samples_bass.wav' }] : []);
 }});
 assert.equal(selected.sourceKey, key); assert.equal(selected.relativePath, 'Tonal/tone.wav');
 assert.ok(queried.every(value => sources.includes(value)));
 assert.ok(sources.includes('samples_loops') && sources.includes('samples_perc') && sources.includes('samples_toms'));
});
test('instrument subfolders are included; foreign identities and unsafe paths are rejected', () => {
 for (const folder of ['Drums','Bass','samples_bass','Drum Kits','Kicks','Snare','Hi-Hats','Percussion','Cymbals','Drum-and-Bass']) {
  assert.equal(eligibleFile({ relativePath: `Pack/${folder}/sound.wav` }, 'sampledrop'), true, folder);
 }
 for (const relativePath of ['../piano.wav','/piano.wav','Pack/../piano.wav','Pack\\bass.wav','https://evil.test/a.wav','Pack//a.wav','preset.json']) {
  assert.equal(eligibleFile({ relativePath }, 'samples_piano'), false, relativePath);
 }
 assert.equal(eligibleFile({relativePath:'a.wav',sourceKey:'samples_bass'}, 'sampledrop'), false);
 assert.equal(eligibleFile({relativePath:'a.wav'}, 'samples_bass'), true);
 assert.equal(eligibleFile({relativePath:'Woodwind/Bassoon/a.wav'}, 'samples_orch'), true, 'Do not mistake bassoon for a bass folder');
});
test('exhausted libraries fail closed after exactly the allowed roots', async () => {
 const queried=[];
 await assert.rejects(chooseSample({catalogUrl,fetch:async url=>{
  const key=new URL(url).searchParams.get('source');queried.push(key);
  return response(key,[{relativePath:'preset.json'}]);
 }}), /No new eligible samples/);
 assert.deepEqual([...queried].sort(), [...sources].sort());
});
test('a failed folder tries another allowed library', async () => {
 let calls=0;
 const selected=await chooseSample({catalogUrl,random:()=>.99999,current:{sourceKey:'samples_piano',relativePath:'old.wav'},fetch:async url=>{
  const key=new URL(url).searchParams.get('source');calls++;
  if(key==='samples_vocal')throw new Error('Offline folder');
  return response(key,[{relativePath:'old.wav'},{relativePath:'new.wav'}]);
 }});
 assert.equal(selected.sourceKey,'samples_piano');assert.equal(selected.relativePath,'new.wav');assert.equal(calls,2);
});
test('account/context cancellation rejects a late catalog rather than selecting its sample', async () => {
 let current=true;
 await assert.rejects(chooseSample({catalogUrl,guard:()=>{if(!current)throw Error('Context changed');},fetch:async url=>{
  current=false;return response(new URL(url).searchParams.get('source'),[{relativePath:'a.wav'}]);
 }}),/Context changed/);
});
test('authentication failure does not probe other folders', async () => {
 let calls=0;
 await assert.rejects(chooseSample({catalogUrl,fetch:async()=>{calls++;return response('',[],401);}}), /Sign in/);
 assert.equal(calls,1);
});
test('mismatched catalog identity cannot redirect selection into a forbidden root', async () => {
 await assert.rejects(chooseSample({catalogUrl,fetch:async()=>response('unrelated_root',[{relativePath:'a.wav'}])}), /identity did not match/);
});

test('the last nested file beyond browser-sized pages and newly arriving files are eligible', async () => {
 let generation=0;
 const fetch=async url=>{const u=new URL(url),key=u.searchParams.get('source');assert.equal(u.searchParams.get('refresh'),'1');
 return response(key,key==='samples_vocal'?Array.from({length:2001+generation},(_,i)=>({relativePath:`Deep/Drums/Bass/Percussion/${i}.wav`})):[]);};
 const first=await chooseSample({catalogUrl,fetch,random:()=>.999999});
 assert.equal(first.relativePath,'Deep/Drums/Bass/Percussion/2000.wav');generation++;
 const second=await chooseSample({catalogUrl,fetch,random:()=>.999999});
 assert.equal(second.relativePath,'Deep/Drums/Bass/Percussion/2001.wav');
});

test('a one-sample directory remains a valid pool even when that sample is loaded', async()=>{
 const current={sourceKey:'samples_vocal',relativePath:'Bass/only.wav'};
 const result=await chooseSample({catalogUrl,current,random:()=>.99999,fetch:async url=>{const key=new URL(url).searchParams.get('source');return response(key,key===current.sourceKey?[current]:[]);}});
 assert.equal(result.relativePath,current.relativePath);
});
