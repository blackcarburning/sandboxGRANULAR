const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sources, eligibleFile, chooseSample } = require('../random-performance-samples.js');
const catalogUrl = 'https://example.test/mygrain-bastardloops/api/source-files';
const response = (sourceKey, files, status = 200) => ({ ok: status === 200, status, json: async () => ({ ok: status === 200, sourceKey, files }) });
for (const key of sources) test(`random picker reaches ${key} without consulting forbidden roots`, async () => {
 const queried = [];
 const selected = await chooseSample({ catalogUrl, random: () => .99999, fetch: async url => {
  const source = new URL(url).searchParams.get('source'); queried.push(source);
  return response(source, source === key ? [{ name: 'tone.wav', relativePath: 'Tonal/tone.wav', sourceKey: key, previewUrl: 'https://bad.test/samples_bass.wav' }] : []);
 }});
 assert.equal(selected.sourceKey, key); assert.equal(selected.relativePath, 'Tonal/tone.wav');
 assert.ok(queried.every(value => sources.includes(value)));
 assert.deepEqual(sources, ['samples_vocal','samples_piano','samples_orch','sampledrop','sampledrop2','splice_claw']);
});
test('forbidden subfolders, foreign roots and unsafe paths never become candidates', () => {
 for (const folder of ['Drums','Bass','samples_bass','Drum Kits','Kicks','Snare','Hi-Hats','Percussion','Cymbals','Drum-and-Bass']) {
  assert.equal(eligibleFile({ relativePath: `Pack/${folder}/sound.wav` }, 'sampledrop'), false, folder);
 }
 for (const relativePath of ['../piano.wav','/piano.wav','Pack/../piano.wav','Pack\\bass.wav','https://evil.test/a.wav','Pack//a.wav','preset.json']) {
  assert.equal(eligibleFile({ relativePath }, 'samples_piano'), false, relativePath);
 }
 assert.equal(eligibleFile({relativePath:'a.wav',sourceKey:'samples_bass'}, 'sampledrop'), false);
 assert.equal(eligibleFile({relativePath:'a.wav'}, 'samples_bass'), false);
 assert.equal(eligibleFile({relativePath:'Woodwind/Bassoon/a.wav'}, 'samples_orch'), true, 'Do not mistake bassoon for a bass folder');
});
test('exhausted libraries fail closed after exactly the allowed roots', async () => {
 const queried=[];
 await assert.rejects(chooseSample({catalogUrl,fetch:async url=>{
  const key=new URL(url).searchParams.get('source');queried.push(key);
  return response(key,[{relativePath:'Bass/no.wav'},{relativePath:'Drums/no.wav'}]);
 }}), /No new eligible samples/);
 assert.deepEqual([...queried].sort(), [...sources].sort());
});
test('a failed folder tries another allowed library and avoids the current sample', async () => {
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
 await assert.rejects(chooseSample({catalogUrl,fetch:async()=>response('samples_bass',[{relativePath:'a.wav'}])}), /identity did not match/);
});
