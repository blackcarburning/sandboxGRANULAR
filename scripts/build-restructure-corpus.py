#!/usr/bin/env python3
"""Build immutable public-only PCM corpus. Never overwrite a published v1 corpus.

All source paths resolve beneath samples_public; 24 kHz mono matches Ember.
Four bounded ffmpeg workers, one decoder thread each. Intermediate PCM stays
in each worker; published chunks and catalogue retain hashes for saved recall.
"""
from pathlib import Path
import concurrent.futures,hashlib,json,subprocess
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT.parent/'samples_public'
TARGET=ROOT/'restructure-corpus-v1'
CATALOG=ROOT/'restructure-catalog.json'

def build(path):
    path=path.resolve();path.relative_to(SOURCE.resolve())
    original=hashlib.sha256(path.read_bytes()).hexdigest();uid=original[:20]
    pcm=subprocess.run(['ffmpeg','-v','error','-threads','1','-i',str(path),'-ac','1','-ar','24000','-f','s16le','-'],capture_output=True,check=True).stdout
    recording=np.frombuffer(pcm,dtype='<i2')
    if len(recording)<16:return None
    chunks=[];dest=TARGET/uid;dest.mkdir(parents=True,exist_ok=True)
    for offset in range(0,len(recording),384000):
        part=recording[offset:offset+384000]
        if len(part)<16:continue
        active=[i//12000 for i in range(0,len(part),12000) if np.max(np.abs(part[i:i+12000].astype(np.int32)))>32]
        body=part.tobytes();chunk=dest/(str(len(chunks))+'.pcm')
        if chunk.exists():assert chunk.read_bytes()==body, 'Immutable corpus collision'
        else:chunk.write_bytes(body)
        chunks.append({'frames':len(part),'sha256':hashlib.sha256(body).hexdigest(),'active':active})
    if not any(c['active'] for c in chunks):return None
    return {'id':uid,'file':str(path.relative_to(SOURCE.resolve())),'title':path.stem,'originalSha256':original,'chunks':chunks}

if __name__=='__main__':
    if CATALOG.exists():raise SystemExit('Published corpus already exists; use a new version')
    files=sorted(SOURCE.rglob('*.wav'));records=[];seen=set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i,record in enumerate(pool.map(build,files)):
            if record and record['id'] not in seen:seen.add(record['id']);records.append(record)
            if (i+1)%200==0:print(f'Prepared {i+1}/{len(files)} public recordings',flush=True)
    assert len(records)>=8
    CATALOG.write_text(json.dumps({'version':1,'source':'samples_public','sampleRate':24000,'chunkFrames':384000,'records':records},separators=(',',':')))
    print(f'Published {len(records)} unique public recordings',flush=True)
