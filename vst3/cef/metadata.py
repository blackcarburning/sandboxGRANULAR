#!/usr/bin/env python3
import json,pathlib,re,subprocess,sys
fx='--fx' in sys.argv
version='0.1.0' if fx else '0.1.4'
cid='2642D59B6C824E319ADE03F7B8562C10' if fx else 'A44B25E13DE64853A16CC63921C9D4B2'
tool,bundle=map(pathlib.Path,[v for v in sys.argv[1:] if v!='--fx']);dest=bundle/'Contents/Resources/moduleinfo.json';dest.parent.mkdir(parents=True,exist_ok=True)
subprocess.run([str(tool),'-create','-version',version,'-path',str(bundle),'-output',str(dest)],check=True)
value=json.loads(re.sub(r',\s*([}\]])',r'\1',dest.read_text()));assert value['Classes'][0]['CID']==cid;assert value['Version']==version;dest.write_text(json.dumps(value,indent=2)+'\n')
