const test=require('node:test'),assert=require('node:assert/strict'),{Controller}=require('../song-beta');
function fixture(reply){
 const part={id:'a'.repeat(32),sha256:'b'.repeat(64),name:'Large K part'},song={id:'fixture-12345678',revision:4,parts:[part,{...part,id:'c'.repeat(32),sourcePartId:part.id}]};
 const c={song,songs:[song],generation:3,abort:new AbortController(),calls:[],armStage(){},status(){},hasSavedRender:p=>p.render?.sourceSha256===part.sha256,async request(path,options){this.calls.push({path,options});return typeof reply==='function'?reply(this.calls.length,song,part):reply}};
 return{c,part,song,done:()=>({ok:true,job:{state:'done'},song:{...song,parts:song.parts.map(p=>({...p,render:{version:1,sourceSha256:p.sha256}}))}})};
}
test('server preparation changes only shared render metadata and works without Song editing credentials',async()=>{
 const f=fixture();f.c.request=async(path,options)=>{assert.equal(options.method,'POST');return f.done()};
 const before=JSON.stringify(f.song);const result=await Controller.prototype.prepareOnServer.call(f.c,f.part,3);assert.equal(result.render.sourceSha256,f.part.sha256);assert(f.c.song.parts.every(p=>p.render));assert.equal(f.c.song.revision,4);assert.equal(JSON.stringify(f.song),before);
});
test('changed source or Song revision is rejected without replacing client Song state',async()=>{
 for(const changed of ['source','revision']){const f=fixture();f.c.request=async()=>{let d=f.done();if(changed==='source')d.song.parts[0].sha256='d'.repeat(64);else d.song.revision++;return d};await assert.rejects(Controller.prototype.prepareOnServer.call(f.c,f.part,3),/Song changed/);assert.equal(f.c.song,f.song)}
});
test('server failure and missing job preserve their useful retry messages',async()=>{
 for(const state of ['failed','missing']){const f=fixture({job:{state,message:'Specific server failure'}});await assert.rejects(Controller.prototype.prepareOnServer.call(f.c,f.part,3),/Specific server failure/);assert.equal(f.c.song,f.song)}
});
test('cancelling a queued server wait promptly releases the client wait without accepting a later render',async()=>{
 const f=fixture({job:{state:'queued'}});const promise=Controller.prototype.prepareOnServer.call(f.c,f.part,3);setTimeout(()=>f.c.abort.abort(),10);await assert.rejects(promise,e=>e.name==='AbortError');assert.equal(f.c.song,f.song);assert.equal(f.c.calls.length,1);
});
test('a stale generation rejects even a completed server job',async()=>{
 const f=fixture();f.c.request=async()=>{f.c.generation++;return f.done()};await assert.rejects(Controller.prototype.prepareOnServer.call(f.c,f.part,3),e=>e.name==='AbortError');
});
test('server-render requests are cache operations, never editorial writes requiring a lease',async()=>{
 const f=fixture(),headers=[];Object.assign(f.c,{api:'/mygrain/api/songs',key:'e'.repeat(64),requireEditing(){throw Error('Unexpected editorial write')},fetch:async(url,options)=>{headers.push(options.headers);return{ok:true,json:async()=>({ok:true,job:{state:'queued'}})}}});await Controller.prototype.request.call(f.c,`/${f.song.id}/parts/${f.part.id}/server-arm?sha256=${f.part.sha256}`,{method:'POST'});assert.equal(headers[0]['If-Match'],undefined);
});
