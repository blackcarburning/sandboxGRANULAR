from pathlib import Path
import ast,random,json,hashlib,requests,base64,io,os
from urllib.parse import urlsplit
from scipy.io import wavfile
import numpy as np
root=Path(os.environ.get('MYGRAIN_TEST_OUTPUT','/tmp/mygrain-source-grid-results'));root.mkdir(parents=True,exist_ok=True)
workspace=Path(os.environ.get('MYGRAIN_TEST_WORKSPACE',Path(__file__).resolve().parents[2]))
s=(workspace/'fs7300-documenter/server.py').read_text();tree=ast.parse(s)
names={'clamp_bastardloop_pattern_steps','normalize_bastardloop_divisions','normalize_random_cut_divisions','build_bastardloop_schedule'}
ns={}
for node in tree.body:
 if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and (t.id.startswith('MYGRAIN_BASTARDLOOP_') and any(x in t.id for x in ['PATTERN','DIVISION'])) for t in node.targets):
  exec(compile(ast.Module(body=[node],type_ignores=[]),'constants','exec'),ns)
for node in tree.body:
 if isinstance(node,ast.FunctionDef) and node.name in names:exec(compile(ast.Module(body=[node],type_ignores=[]),'functions','exec'),ns)
for steps in [8,16,24,32,64,128]:
 for value in ['4','2','1','1/2','1/4','1/8','1/16','1/32','uncut']:
  for manual in [False,True]:
   rows=ns['build_bastardloop_schedule'](random.Random(42),[value],steps,manual_cuts=manual)
   assert sum(row['slots'] for row in rows)==ns['clamp_bastardloop_pattern_steps'](steps)*2,(steps,value,manual,rows)
   if not manual:assert all(row['label'] in ['2','1'] for row in rows)
   elif value=='uncut':assert rows==[{'label':'uncut','slots':ns['clamp_bastardloop_pattern_steps'](steps)*2,'uncut':True}]
   elif ns['MYGRAIN_BASTARDLOOP_DIVISION_SLOT_MAP'][value]<=ns['clamp_bastardloop_pattern_steps'](steps)*2:assert all(row['label']==value for row in rows),(value,rows)
print('PASS 108 manual/ordinary schedule combinations')
# Exercise the actual staged endpoint, not just the pure scheduler.
client=requests.Session();base=os.environ.get('MYGRAIN_TEST_URL','http://127.0.0.1:19016/mygrain/')
assert urlsplit(base).hostname=='127.0.0.1'
r=client.post(base+'api/auth/login',json={'username':'admin','password':'isolated-vst3-test'});r.raise_for_status()
client.headers['X-Mygrain-User']='admin'
api=urlsplit(base)._replace(path='/mygrain-bastardloops/api/bastardloop',query='',fragment='').geturl()
paths=['Nested/Tone_000_C4.wav','Nested/Tone_001_C4.wav']
fixture=Path(os.environ.get('MYGRAIN_TEST_ROOT','/tmp/mygrain-source-grids-store'))/'admin/source_mirrors/SAMPLEDROP'
hashes={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in fixture.rglob('*.wav')}
rows=[]
for manual,value in [(True,'1/32'),(True,'uncut'),(True,'4'),(False,'1/32')]:
 r=client.post(api,json={'source':'sampledrop','sourceFiles':paths,'divisions':[value],'bpm':180,'patternLength':32,'manualCuts':manual,'responseFormat':'audio','seed':'selected-grid-test'},timeout=45)
 assert r.status_code==201,(r.status_code,r.text[:500])
 header=r.headers['X-Mygrain-Bastardloop-Meta'];meta=json.loads(base64.urlsafe_b64decode(header+'='*(-len(header)%4)))
 rate,pcm=wavfile.read(io.BytesIO(r.content));assert rate==44100 and np.max(np.abs(pcm.astype('int32')))>100
 assert set(meta['samplePaths'])<=set(paths)
 rows.append({'manual':manual,'division':value,'frames':len(pcm),'rate':rate,'summary':meta['summary'],'used':len(meta['samplePaths'])})
assert hashes=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in fixture.rglob('*.wav')}
(root/'backend-results.json').write_text(json.dumps(rows,indent=2));print('PASS actual WAV endpoint, fine/Uncut/coarse operations, chosen sources only, source bytes unchanged')
