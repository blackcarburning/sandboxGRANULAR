/* Actual codec size boundaries; native wire/DAW are separate test boundaries. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=path.resolve(__dirname,'..'),out=process.env.MYGRAIN_TEST_OUTPUT;assert(out);fs.mkdirSync(out,{recursive:true});
function codec(file){let result;const scope=vm.createContext({TextEncoder,Uint8Array,DataView,ArrayBuffer,Map,Set,Math,postMessage:r=>result=r});vm.runInContext(fs.readFileSync(file,'utf8'),scope);return data=>{result=null;scope.onmessage({data});return result;};}
const now=codec(app+'/daw-project-codec.js'),old=process.env.MYGRAIN_BASELINE_CODEC?codec(process.env.MYGRAIN_BASELINE_CODEC):null;
const metadata={id:'a'.repeat(32),name:'Large immutable part',createdAt:'2026-11-24T11:00:00Z',bpm:120,bars:256};
const make=id=>({type:'pack',id,settings:{kind:'bridge',mode:'live',bars:4},snapshot:{format:'mygrain-song-part',version:1,state:{volume:.8},extra:{},assets:[]},audio:[],slots:[],parts:[],partData:[],delta:false});
const results=[];
const legacy=now(make(1));assert.equal(legacy.type,'prepared');if(old)assert.deepEqual(Buffer.from(legacy.buffer),Buffer.from(old(make(1)).buffer));results.push('legacy byte-exact');
// A valid immutable source and preview from the >96 MiB HTTP fixture.
const bin=fs.readFileSync(path.join(out,'fixtures','100.zip'));
function entries(zip){let at=0;const result=new Map();while(zip.readUInt32LE(at)===0x04034b50){const size=zip.readUInt32LE(at+18),names=zip.readUInt16LE(at+26),extra=zip.readUInt16LE(at+28),name=zip.toString('utf8',at+30,at+30+names),start=at+30+names+extra;result.set(name,zip.subarray(start,start+size));at=start+size;}return result;}
const input=entries(bin),manifest=JSON.parse(input.get('parts-bin.json')),part=manifest.parts[0];
const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),zip=ab(input.get(part.patch)),preview=ab(input.get(part.render));
const large=now({...make(2),parts:[metadata],partData:[{id:metadata.id,zip,preview}]});assert.equal(large.type,'prepared',large.message);assert(large.documentBytes>96*1048576&&large.documentBytes<128*1048576);fs.writeFileSync(path.join(out,'large-native-project.bin'),Buffer.from(large.buffer));results.push('100 MiB native project prepared');
now({type:'commit',id:2,revision:1});
const next=now({...make(3),parts:[metadata],delta:true,revision:1});assert.equal(next.type,'prepared');assert(next.delta);assert(next.buffer.byteLength<3000);const v=new DataView(next.buffer),expanded=new Uint8Array(v.getUint32(8,true));let cursor=0,at=16;for(let i=0;i<v.getUint32(12,true);i++){const kind=v.getUint32(at,true),offset=v.getUint32(at+4,true),length=v.getUint32(at+8,true);at+=12;expanded.set(new Uint8Array(kind?large.buffer:next.buffer,kind?offset:at,length),cursor);if(!kind)at+=length;cursor+=length;}assert.deepEqual(Buffer.from(expanded),Buffer.from(large.buffer));results.push('large immutable parts reused in byte-exact delta');
// >128 MiB combined patch + bin must still fail before native transfer.
const tooLarge=now({...make(4),parts:[metadata,{...metadata,id:'b'.repeat(32)}],partData:[{id:'b'.repeat(32),zip:new ArrayBuffer(30*1048576),preview:new ArrayBuffer(44)}]});assert.equal(tooLarge.type,'error');assert.match(tooLarge.message,/current patch and Parts Bin.*128 MiB.*save the bin universally/);results.push('combined 128 MiB boundary explicitly rejected');
// The failed candidate must not advance the acknowledged baseline.
const retained=now({...make(5),parts:[metadata],delta:true,revision:1});assert.equal(retained.type,'prepared');assert(retained.delta);assert(retained.buffer.byteLength<3000);results.push('failed candidate retains acknowledged delta baseline');
const missing=now({...make(6),parts:[{...metadata,id:'c'.repeat(32)}]});assert.equal(missing.type,'error');results.push('missing part cache rejected');
const count=now({...make(7),parts:Array(33).fill(metadata)});assert.equal(count.type,'error');results.push('32-part count protection retained');
fs.writeFileSync(path.join(out,'codec-results.json'),JSON.stringify({results,snapshotBytes:large.documentBytes,deltaBytes:next.buffer.byteLength},null,2));console.log(JSON.stringify({passed:results.length,results}));
