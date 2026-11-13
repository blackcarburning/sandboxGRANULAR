/* Dedicated snapshot codec: no audio/socket callbacks run in this worker. */
'use strict';
const encoder=new TextEncoder(),max=128*1048576,assets=new Map(),partCache=new Map();let pending=null,baseline=null;
const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);return c>>>0;});
function crc(bytes){let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function wav(a){const channels=a.channels,frames=channels[0].length,bytes=new Uint8Array(44+frames*channels.length*2),v=new DataView(bytes.buffer);function str(n,t){bytes.set(encoder.encode(t),n);}str(0,'RIFF');v.setUint32(4,bytes.length-8,true);str(8,'WAVEfmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,channels.length,true);v.setUint32(24,a.rate,true);v.setUint32(28,a.rate*channels.length*2,true);v.setUint16(32,channels.length*2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,bytes.length-44,true);let at=44;for(let i=0;i<frames;i++)for(const ch of channels){const n=Math.max(-1,Math.min(1,ch[i]));v.setInt16(at,a.pcm16?Math.max(-32768,Math.min(32767,Math.round(n*32768))):n<0?n*32768:n*32767,true);at+=2;}return {bytes,crc:crc(bytes)};}
function pack(data){
 for(const a of data.audio){assets.set(a.id,wav(a));}
 const used=new Set(data.slots.map(a=>a.id));for(const id of assets.keys())if(!used.has(id))assets.delete(id);
 const snapshot=data.snapshot;snapshot.assets=data.slots.map(a=>({key:a.key,path:'audio/'+a.key+'.wav',channels:a.channels,frames:a.frames,sampleRate:a.rate}));
 const entries=[{path:'song-part.json',bytes:encoder.encode(JSON.stringify(snapshot))},...data.slots.map(a=>({path:'audio/'+a.key+'.wav',...assets.get(a.id),id:a.id}))];
 for(const p of data.partData||[])partCache.set(p.id,{zip:{bytes:new Uint8Array(p.zip),crc:crc(new Uint8Array(p.zip))},preview:{bytes:new Uint8Array(p.preview),crc:crc(new Uint8Array(p.preview))}});
 const binParts=data.parts||[],partIds=new Set(binParts.map(p=>p.id));for(const id of partCache.keys())if(!partIds.has(id))partCache.delete(id);
 if(binParts.length>32||partIds.size!==binParts.length)throw Error('The Parts Bin supports up to 32 unique parts.');
 let binBytes=0;const manifest={format:'mygrain-parts-bin',version:1,parts:binParts.map(p=>{if(!/^[a-f0-9]{32}$/.test(p.id))throw Error('Invalid Parts Bin identity.');const a=partCache.get(p.id);if(!a)throw Error('Parts Bin cache changed; retry Store bin.');binBytes+=a.zip.bytes.length+a.preview.bytes.length;entries.push({path:'parts-bin/'+p.id+'.zip',...a.zip,id:'part:'+p.id+':zip'},{path:'parts-bin/'+p.id+'.wav',...a.preview,id:'part:'+p.id+':preview'});return {...p,patch:'parts-bin/'+p.id+'.zip',render:'parts-bin/'+p.id+'.wav'};})};
 if(binBytes>96*1048576)throw Error('The Parts Bin exceeds its 96 MiB limit. Delete a part and retry.');
 if(binParts.length)entries.push({path:'parts-bin.json',bytes:encoder.encode(JSON.stringify(manifest))});
 if(entries.some(e=>!e.bytes))throw Error('Audio cache changed; retry Store now.');
 let size=22,offset=0;const parts=[],directory=[],spans=new Map();
 for(const e of entries){const name=encoder.encode(e.path),hash=e.crc??crc(e.bytes),h=new Uint8Array(30+name.length),v=new DataView(h.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint32(14,hash,true);v.setUint32(18,e.bytes.length,true);v.setUint32(22,e.bytes.length,true);v.setUint16(26,name.length,true);h.set(name,30);parts.push(h,e.bytes);if(e.id)spans.set(e.id,{offset:offset+h.length,length:e.bytes.length});
 const d=new Uint8Array(46+name.length),dv=new DataView(d.buffer);dv.setUint32(0,0x02014b50,true);dv.setUint16(4,20,true);dv.setUint16(6,20,true);dv.setUint32(16,hash,true);dv.setUint32(20,e.bytes.length,true);dv.setUint32(24,e.bytes.length,true);dv.setUint16(28,name.length,true);dv.setUint32(42,offset,true);d.set(name,46);directory.push(d);offset+=h.length+e.bytes.length;size+=h.length+e.bytes.length+d.length;}
 if(size>max)throw Error('Project snapshot exceeds the 128 MB patch limit.');
 const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,size-offset-22,true);ev.setUint32(16,offset,true);parts.push(...directory,end);
 const settings=encoder.encode(JSON.stringify({format:'mygrain-daw-project',version:1,...data.settings}));if(settings.length>65536)throw Error('Project metadata is too large.');
 const document=new Uint8Array(16+settings.length+size),view=new DataView(document.buffer);[0x3150474d,1,settings.length,size].forEach((n,i)=>view.setUint32(i*4,n,true));document.set(settings,16);let at=16+settings.length;for(const p of parts){document.set(p,at);at+=p.length;}for(const span of spans.values())span.offset+=16+settings.length;
 const hash=crc(document);let wire=document,delta=false;
 if(data.delta&&baseline&&baseline.revision===data.revision){
  const copies=[...spans].filter(([id,n])=>baseline.spans.has(id)&&baseline.spans.get(id).length===n.length).map(([id,n])=>({...n,old:baseline.spans.get(id).offset})).sort((a,b)=>a.offset-b.offset);
  const ops=[];let cursor=0;for(const c of copies){if(c.offset<cursor)continue;if(c.offset>cursor)ops.push({kind:0,offset:cursor,length:c.offset-cursor});ops.push({kind:1,offset:c.old,length:c.length});cursor=c.offset+c.length;}if(cursor<document.length)ops.push({kind:0,offset:cursor,length:document.length-cursor});
  const n=16+ops.length*12+ops.reduce((n,o)=>n+(o.kind?0:o.length),0);
  if(n<document.length){wire=new Uint8Array(n);const w=new DataView(wire.buffer);[0x3150444d,1,document.length,ops.length].forEach((v,i)=>w.setUint32(i*4,v,true));let p=16;for(const o of ops){[o.kind,o.kind?o.offset:0,o.length].forEach((v,i)=>w.setUint32(p+i*4,v,true));p+=12;if(!o.kind){wire.set(document.subarray(o.offset,o.offset+o.length),p);p+=o.length;}}delta=true;}
 }
 pending={id:data.id,spans};postMessage({type:'prepared',id:data.id,buffer:wire.buffer,hash,delta,documentBytes:document.length,assetBytes:data.slots.reduce((n,a)=>n+(assets.get(a.id)?.bytes.length||0),0)},[wire.buffer]);
}
onmessage=({data})=>{try{if(data.type==='pack')pack(data);else if(data.type==='commit'&&pending?.id===data.id){baseline={...pending,revision:data.revision};pending=null;}else if(data.type==='reset'){assets.clear();partCache.clear();baseline=pending=null;}}catch(e){pending=null;postMessage({type:'error',id:data.id,message:e.message});}};
