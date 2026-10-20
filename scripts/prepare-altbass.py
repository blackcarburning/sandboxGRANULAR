#!/usr/bin/env python3
"""Fetch only the Juno-6 bass regions via HTTP ranges, preserving SFZ start/end.
No whole-archive download; requires requests, numpy and scipy (Python 3.12).
"""
import hashlib, io, json, pathlib, re, zipfile
import requests
import wave, aifc, math
import numpy as np
from scipy.signal import resample_poly, correlate
from fractions import Fraction
ROOT = pathlib.Path(__file__).resolve().parents[1] / 'SAMPLES_ALTBASS'
REPO = 'https://github.com/publicsamples/Roland-Juno-6'
ARCHIVE = REPO + '/releases/download/1.0/Audio.zip'
REVISION = 'e407c041a66312bf4140966fd69b49ce2be105b8'
class RemoteZip(io.RawIOBase):
    def __init__(self):
        r = requests.get(ARCHIVE, stream=True, timeout=60); r.raise_for_status()
        self.url, self.length, self.pos = r.url, int(r.headers['Content-Length']), 0; r.close()
    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.length + offset
        return self.pos
    def tell(self): return self.pos
    def read(self, count=-1):
        count = min(count if count >= 0 else self.length, self.length - self.pos)
        if count <= 0: return b''
        r = requests.get(self.url, headers={'Range': f'bytes={self.pos}-{self.pos+count-1}'}, timeout=60); r.raise_for_status()
        if r.status_code != 206 or len(r.content) != count: raise IOError('Archive HTTP range unavailable')
        self.pos += count
        return r.content

def main():
    ROOT.mkdir(exist_ok=True)
    tree = requests.get('https://api.github.com/repos/publicsamples/Roland-Juno-6/git/trees/' + REVISION, timeout=60); tree.raise_for_status()
    commit = tree.json()['sha']
    base = 'https://raw.githubusercontent.com/publicsamples/Roland-Juno-6/' + commit + '/'
    license_response = requests.get(base+'LICENSE', timeout=60); license_response.raise_for_status()
    (ROOT/'LICENSE.txt').write_text(license_response.text.rstrip()+'\n')
    entries=[]
    with zipfile.ZipFile(RemoteZip()) as archive:
        for patch in ['Pulse Bass', 'Saw Bass split']:
            response=requests.get(base+'SFZ/'+requests.utils.quote(patch)+'.sfz',timeout=60);response.raise_for_status()
            for line in response.text.splitlines():
                match=re.search(r'sample=../Audio/(.+)-(\d+)-(\d+)\.aif',line)
                if not match: continue
                midi, velocity=int(match[2]),int(match[3])
                if not 36 <= midi <= (48 if patch == 'Saw Bass split' else 60): continue
                member='juno6/Audio/'+match[0].split('../Audio/')[1]
                data=archive.read(member)
                start=int(re.search(r'offset=(\d+)',line)[1]) if 'offset=' in line else 0
                end=re.search(r' end=(\d+)',line)
                source_midi=midi
                midi-=12  # These two patches sound one octave below their SFZ keyboard key.
                note=['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'][midi%12]+str(midi//12-1)
                # Explicit sharp spelling understood by the existing sampler root parser.
                note=note.replace('Cs','C#').replace('Ds','D#').replace('Fs','F#').replace('Gs','G#').replace('As','A#')
                name=f'Juno6 {patch} v{velocity} {note}.wav'
                with aifc.open(io.BytesIO(data), 'rb') as aiff:
                    rate,channels,width=aiff.getframerate(),aiff.getnchannels(),aiff.getsampwidth()
                    aiff.setpos(start);raw=aiff.readframes(min(aiff.getnframes()-start,int(end[1])+1-start) if end else aiff.getnframes()-start)
                octets=np.frombuffer(raw,dtype=np.uint8).reshape(-1,width).astype(np.int64)
                signed=sum(octets[:,i] << (8*(width-1-i)) for i in range(width))
                signed=np.where(signed >= 1 << (width*8-1),signed-(1 << (width*8)),signed)
                audio=(signed.astype(np.float64)/(1 << (width*8-1))).reshape(-1,channels)
                if rate != 44100:
                    divisor=math.gcd(rate,44100);audio=resample_poly(audio,44100//divisor,rate//divisor,axis=0)
                # Centre raw analogue tuning on the true sounding note, not the
                # upstream keyboard key. Preserve slow oscillator movement.
                mono=audio.mean(axis=1);segment=mono[round(.12*44100):min(len(mono),round(.85*44100))]
                segment=segment-segment.mean();corr=correlate(segment,segment,method='fft')[len(segment)-1:]
                corr=corr/np.arange(len(segment),0,-1)
                expected=440*2**((midi-69)/12);lo=round(44100/(expected*1.06));hi=round(44100/(expected*.94))
                lag=lo+int(np.argmax(corr[lo:hi+1]))
                if lag in (lo,hi) or corr[lag]/corr[0]<.5:raise ValueError('Ambiguous bass pitch: '+name)
                delta=.5*(corr[lag-1]-corr[lag+1])/(corr[lag-1]-2*corr[lag]+corr[lag+1])
                measured=44100/(lag+delta);ratio=Fraction(measured/expected).limit_denominator(10000)
                audio=resample_poly(audio,ratio.numerator,ratio.denominator,axis=0)
                frames=len(audio);peak=float(np.max(np.abs(audio)))
                if not frames or not np.isfinite(audio).all() or peak<.001:raise ValueError('Empty/invalid bass: '+name)
                pcm=np.clip(np.rint(audio*32768),-32768,32767).astype('<i2')
                with wave.open(str(ROOT/name),'wb') as wav:
                    wav.setnchannels(channels);wav.setsampwidth(2);wav.setframerate(44100);wav.writeframes(pcm.tobytes())
                rate=44100
                entries.append({'name':name,'rootNote':note,'midi':midi,'sourceMidi':source_midi,'measuredSourceHz':measured,'tuningCorrectionCents':1200*math.log2(expected/measured),'patch':patch,'velocity':velocity,'archiveMember':member,'sourceSha256':hashlib.sha256(data).hexdigest(),'sfzStartFrame':start,'sfzEndFrame':int(end[1]) if end else None,'sha256':hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),'durationS':frames/rate,'channels':channels,'sampleRate':rate,'peak':peak})
            print(patch,len(entries),'prepared',flush=True)
    (ROOT/'manifest.json').write_text(json.dumps({'repository':REPO,'revision':commit,'archive':ARCHIVE,'license':'Public domain; upstream LICENSE.txt','processing':'Original SFZ region boundaries, true sounding roots (SFZ key minus one octave), modest centre tuning correction, 44.1kHz PCM16; no EQ, effects, saturation or normalisation. Source keyboard notes C2-C4; sounding roots C1-C3.','samples':entries},indent=2)+'\n')
    print(len(entries),'WAVs',sum((ROOT/e['name']).stat().st_size for e in entries),'bytes',flush=True)
if __name__=='__main__':main()
