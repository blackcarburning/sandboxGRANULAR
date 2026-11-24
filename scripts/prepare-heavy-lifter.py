#!/usr/bin/env python3
"""Immutable 24 kHz mono analysis corpus. Originals are never modified.
Anti-aliased polyphase conversion; bounded 16 s fetch chunks, PCM16 LE.
All six effects derive from these same identified recordings and saved cuts.
"""
import argparse, hashlib, json, math
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

def main():
 p=argparse.ArgumentParser();p.add_argument("source",type=Path);p.add_argument("output",type=Path);a=p.parse_args()
 records=json.loads((a.source/"CATALOGUE.json").read_text());a.output.mkdir(parents=True,exist_ok=True);rows=[]
 for i,r in enumerate(records):
  identity=r["ready_sha256"][:20];folder=a.output/identity;folder.mkdir(exist_ok=True)
  x,sr=sf.read(a.source/r["ready_file"],dtype="float32",always_2d=True);x=x.mean(axis=1)
  # Avoid cancellation in unusual antiphase stereo; retain one real channel.
  if np.max(np.abs(x))<1e-7:
   x,_=sf.read(a.source/r["ready_file"],dtype="float32",always_2d=True);x=x[:,0]
  g=math.gcd(sr,24000);x=resample_poly(x,24000//g,sr//g).astype(np.float32)
  x=np.nan_to_num(x);x=np.clip(x,-1,1);chunks=[]
  for j,start in enumerate(range(0,len(x),384000)):
   b=(x[start:start+384000]*32767).round().astype("<i2").tobytes();(folder/f"{j}.pcm").write_bytes(b)
   derived=np.frombuffer(b,dtype="<i2").astype(float)/32768
   threshold=max(1e-5,float(np.sqrt(np.mean(derived*derived)))*.025)
   active=[k//12000 for k in range(0,len(derived),12000) if np.sqrt(np.mean(derived[k:k+12000]**2))>=threshold]
   chunks.append({"frames":len(b)//2,"sha256":hashlib.sha256(b).hexdigest(),"active":active})
  rows.append({"id":identity,"title":r["title"],"category":r["category"],"file":Path(r["ready_file"]).name,"seconds":r["duration_seconds"],"originalSha256":r["ready_sha256"],"sourceUrl":r["source_url"],"creator":r["creator"],"licence":r["licence"],"chunks":chunks})
  if i%50==0:print(f"Prepared {i+1}/{len(records)}",flush=True)
 catalog={"version":1,"sampleRate":24000,"chunkFrames":384000,"records":rows}
 encoded=json.dumps(catalog,separators=(",",":"),ensure_ascii=False)
 (a.output/"catalog.json").write_text(encoded)
 # No PCM or mutable account material is included in this public metadata module.
 (a.output.parent/"heavy-lifter-catalog.js").write_text("(function(r){const c="+encoded+";if(typeof module==='object'&&module.exports)module.exports=c;else r.MygrainIndustryCatalog=c;})(globalThis);\n")
 print(f"Prepared {len(rows)} unique recordings / {sum(len(r['chunks']) for r in rows)} chunks",flush=True)
if __name__=="__main__":main()
