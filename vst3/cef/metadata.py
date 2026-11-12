#!/usr/bin/env python3
import json,pathlib,re,subprocess,sys
tool,bundle=map(pathlib.Path,sys.argv[1:]);dest=bundle/'Contents/Resources/moduleinfo.json';dest.parent.mkdir(parents=True,exist_ok=True)
subprocess.run([str(tool),'-create','-version','0.1.1','-path',str(bundle),'-output',str(dest)],check=True)
value=json.loads(re.sub(r',\s*([}\]])',r'\1',dest.read_text()));assert value['Classes'][0]['CID']=='A44B25E13DE64853A16CC63921C9D4B2';assert value['Version']=='0.1.1';dest.write_text(json.dumps(value,indent=2)+'\n')
