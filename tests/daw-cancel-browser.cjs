'use strict';
const assert=require('node:assert/strict'),{request}=require('playwright-core');
const base='http://127.0.0.1:18933/mygrain/';
(async()=>{const api=await request.newContext({baseURL:base,extraHTTPHeaders:{'X-Mygrain-User':'admin'}});try{
 assert.equal((await api.post('api/auth/login',{data:{username:'admin',password:'isolated-daw-fixture'}})).status(),200);
 const songs=(await(await api.get('api/songs')).json()).songs;assert.ok(songs?.length);const song=songs.at(-1);
 const before=(await(await api.get('api/ftp/list?path=')).json()).entries.map(x=>x.name).sort();
 const created=await api.post('api/ftp/daw-start?'+new URLSearchParams({scope:'song',name:'Cancel-test',songId:song.id,revision:String(song.revision),reference:'0'}),{data:''});assert.equal(created.status(),202,await created.text());const job=(await created.json()).job;
 const stop=await api.post('api/ftp/daw-cancel?id='+job.id,{data:''});assert.equal(stop.status(),200);assert.equal((await stop.json()).job.state,'cancelled');
 const unknown=await api.get('api/ftp/daw-status?id='+job.id.replace(/^./,job.id[0]==='0'?'1':'0'));assert.equal(unknown.status(),404);
 const after=(await(await api.get('api/ftp/list?path=')).json()).entries.map(x=>x.name).sort();assert.deepEqual(after,before);console.log('PASS queued/running server job cancellation, unknown capability and no new FTP file');
}finally{await api.dispose();}})().catch(e=>{console.error(e);process.exitCode=1});
