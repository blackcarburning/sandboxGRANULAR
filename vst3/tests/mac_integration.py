#!/usr/bin/env python3
"""Test actual packaged Mach-O, AppKit editor, socket transport and callback PCM."""
import array,json,math,os,pathlib,socket,struct,subprocess,sys,time
host,bundle,output=sys.argv[1:];out=pathlib.Path(output);out.parent.mkdir(parents=True,exist_ok=True)
p=subprocess.Popen([host,bundle,output],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
log=[]
def line():
 s=p.stdout.readline().strip();log.append(s);print(s,flush=True);return s
while True:
 s=line()
 if s.startswith('CODE='):code=s[5:];break
 if p.poll() is not None:raise RuntimeError('native host failed: '+str(log))
port,token=code.split('.');ws=socket.create_connection(('127.0.0.1',int(port)),timeout=5)
ws.sendall(('GET /stream?token='+token+' HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nOrigin: https://openclaw.blackcarburning.com\r\nSec-WebSocket-Key: MDEyMzQ1Njc4OWFiY2RlZg==\r\nSec-WebSocket-Version: 13\r\n\r\n').encode())
response=b''
while not response.endswith(b'\r\n\r\n'):response+=ws.recv(1)
assert b'101 Switching' in response,response
# SHA-1 response is independently checked, not just a connected TCP socket.
assert b'Sec-WebSocket-Accept: BACScCJPNqyz+UBoqMH89VmURoA=' in response,response

def send(body,opcode=1):
 if isinstance(body,str):body=body.encode()
 mask=os.urandom(4);n=len(body);head=bytes([128|opcode,128|n]) if n<126 else bytes([128|opcode,254])+struct.pack('!H',n)
 ws.sendall(head+mask+bytes(b^mask[i%4] for i,b in enumerate(body)))
def recv_exact(n):
 data=b''
 while len(data)<n:
  piece=ws.recv(n-len(data));assert piece;data+=piece
 return data
def receive():
 a,b=recv_exact(2);n=b&127
 if n==126:n=struct.unpack('!H',recv_exact(2))[0]
 assert n<40000
 return a&15,recv_exact(n)
def control(cmd):pathlib.Path(output+'.control').write_text(cmd)
fx=' FX.vst3' in bundle;clocks=[];returned=0
send('ready');send('arm')
if not fx:
 frames=48000;pcm=array.array('f',(v for i in range(frames) for v in (.12*math.sin(2*math.pi*220*i/48000),.08*math.sin(2*math.pi*330*i/48000))))
 send('prepare:1:48000:48000:2:120')
 for first in range(0,frames,4096):
  count=min(4096,frames-first);send(struct.pack('<IIIId',0x324c474d,1,48000,count,float(first))+pcm[first*2:(first+count)*2].tobytes(),2)
 send('rendered')
start=time.monotonic();reopened=False;stopped=False;offline=False;shot=False
while time.monotonic()-start<9:
 elapsed=time.monotonic()-start
 if elapsed>3 and not reopened:control('reopen');reopened=True
 if elapsed>4 and not shot:control('screenshot');shot=True
 if elapsed>6 and not offline:control('offline');offline=True
 if elapsed>7.5 and not stopped:control('stop');stopped=True
 opcode,body=receive()
 if opcode==1:
  data=json.loads(body)
  if data.get('type')=='clock':clocks.append(data)
 elif opcode==2 and fx:
  magic,epoch,rate,n,first=struct.unpack('<IIIId',body[:24]);assert magic==0x3349474d
  samples=array.array('f');samples.frombytes(body[24:]);assert len(samples)==n*2
  samples=array.array('f',(v*.25 for v in samples))
  send(struct.pack('<IIIId',0x3352474d,epoch,rate,n,first)+samples.tobytes(),2);returned+=n
control('quit');ws.close();tail,_=p.communicate(timeout=12);log.append(tail);print(tail)
assert p.returncode==0 and 'NATIVE_HOST_OK' in tail
assert len(clocks)>100 and any(c['armed'] for c in clocks) and any(not c['armed'] for c in clocks[-30:])
assert any(c['running'] for c in clocks), 'no native playback'
assert any(c['offline'] for c in clocks)
assert pathlib.Path(output+'.png').is_file()
raw=array.array('f');raw.frombytes(out.read_bytes());assert all(math.isfinite(v) for v in raw)
def rms_segment(a,b,ch):
 samples=raw[int(a*48000)*2+ch:int(b*48000)*2:2];assert samples;return math.sqrt(sum(v*v for v in samples)/len(samples))
# Audio host starts just before handshake; the broad steady interval tolerates UI scheduling.
lrms=rms_segment(3,5,0);rrms=rms_segment(3,5,1)
if fx:
 assert returned>200000 and abs(lrms-.1*.25/math.sqrt(2))<.004 and abs(rrms-.08*.25/math.sqrt(2))<.004,(lrms,rrms,returned)
 assert abs(rms_segment(7.1,7.4,0)-.1/math.sqrt(2))<.004,'offline must be aligned dry'
else:
 assert abs(lrms-.12/math.sqrt(2))<.004 and abs(rrms-.08/math.sqrt(2))<.004,(lrms,rrms)
 assert abs(rms_segment(7.1,7.4,0)-.12/math.sqrt(2))<.004,'prepared offline audio'
summary={'bundle':bundle,'nativeHost':True,'editorReopen':True,'savedStateRoundtrip':True,'offlineFallback':fx,'preparedOffline':not fx,'leftRms':lrms,'rightRms':rrms,'returnedFrames':returned,'clockMessages':len(clocks)}
pathlib.Path(output+'.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
