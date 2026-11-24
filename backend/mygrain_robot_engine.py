"""Offline-only Robot synthesis child. Models are installed by the operator.

One engine per process; stdin/stdout bounded JSON IPC, no user-content cache.
The parent owns admission, 300s deadline, 45s idle reaper and engine switching.
"""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import re
import select
import subprocess
import sys
import tempfile
import time
import wave

ROOT = Path('/opt/openclaw-robot')
ENGINE = sys.argv[1]
MODEL = None
PROCESSOR = None
DEVICE = 'cpu'
GPU = None
RATE = 24000
JOBS = 0


def wav_read(path):
    import numpy as np
    import soundfile as sf
    x, sr = sf.read(path, dtype='float32', always_2d=True)
    return x.mean(axis=1), sr


def speech(word, voice, speed):
    global MODEL, PROCESSOR, DEVICE, GPU
    import numpy as np
    if ENGINE in ('festival', 'flite', 'sam'):
        with tempfile.TemporaryDirectory(prefix='robot-voice-') as folder:
            out = Path(folder) / 'word.wav'
            if ENGINE == 'festival':
                # Text is a JSON/Scheme string, never interpolated as Scheme code.
                text = json.dumps(word, ensure_ascii=True)
                scheme = f'(voice_{"rab" if voice.endswith("rab") else "kal"}_diphone)\n(Parameter.set \'Duration_Stretch {170/speed})\n(set! utt (Utterance Text {text}))\n(utt.synth utt)\n(utt.save.wave utt "{out}" \'riff)\n'
                subprocess.run(['/usr/bin/festival', '--pipe'], input=scheme.encode(), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=12)
            elif ENGINE == 'flite':
                subprocess.run(['/usr/bin/flite', '-voice', voice[6:], '-setf', f'duration_stretch={170/speed}', '-t', word, '-o', str(out)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=12)
            else:
                subprocess.run([str(ROOT/'sam/sam'), '-speed', str(max(25, min(180, round(72*170/speed)))), '-wav', str(out), word], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, check=True, timeout=8)
            return wav_read(out)
    if ENGINE == 'piper':
        from piper import PiperVoice, SynthesisConfig
        from piper.config import PiperConfig
        import onnxruntime as rt
        name = 'en_GB-cori-medium' if voice == 'piper_cori' else 'en_US-ljspeech-high'
        if not isinstance(MODEL, tuple) or MODEL[0] != name:
            path = next((ROOT/'piper/models'/name).glob('en/*/*/*/*.onnx'))
            options=rt.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
            MODEL = (name, PiperVoice(session=rt.InferenceSession(str(path),sess_options=options,providers=['CPUExecutionProvider']),config=PiperConfig.from_dict(json.loads(Path(str(path)+'.json').read_text()))))
        chunks = list(MODEL[1].synthesize(word, SynthesisConfig(length_scale=170/speed)))
        return np.concatenate([c.audio_float_array for c in chunks]), chunks[0].sample_rate
    if ENGINE == 'qwen':
        import torch
        from qwen_tts import Qwen3TTSModel
        torch.set_num_threads(2)
        if MODEL is None:
            if not torch.cuda.is_available():
                raise ValueError('Qwen needs the server GPU; please use Piper or Kokoro while it is unavailable.')
            MODEL = Qwen3TTSModel.from_pretrained(str(ROOT/'qwen/model'), device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='eager')
        DEVICE = str(next(MODEL.model.parameters()).device).split(':')[0]
        GPU = torch.cuda.get_device_name(0) if DEVICE == 'cuda' else None
        speaker = {'qwen_ryan':'Ryan', 'qwen_aiden':'Aiden', 'qwen_vivian':'Vivian'}[voice]
        with torch.inference_mode():
            audio, sr = MODEL.generate_custom_voice(text=word, language='English', speaker=speaker, non_streaming_mode=True, max_new_tokens=120)
        x = np.asarray(audio[0], np.float32)
        if speed != 170:
            # SoX WSOLA tempo preserves natural pitch, unlike changing sample rate.
            result = subprocess.run(['/usr/bin/sox','-t','f32','-r',str(sr),'-c','1','-','-t','f32','-','tempo',str(speed/170)], input=x.astype('<f4').tobytes(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=12)
            x = np.frombuffer(result.stdout, dtype='<f4').copy()
        return x, sr
    raise ValueError('Unknown speech engine.')


def bark(words, voice):
    global MODEL, PROCESSOR, DEVICE, GPU
    import torch
    import numpy as np
    from transformers import BarkModel, AutoProcessor
    torch.set_num_threads(2)
    if MODEL is None:
        if not torch.cuda.is_available():
            raise ValueError('Bark needs the server GPU; please use a smaller voice while it is unavailable.')
        PROCESSOR = AutoProcessor.from_pretrained(str(ROOT/'bark/model'), local_files_only=True)
        MODEL = BarkModel.from_pretrained(str(ROOT/'bark/model'), local_files_only=True, torch_dtype=torch.float16, attn_implementation='eager').to('cuda')
    DEVICE = str(next(MODEL.parameters()).device).split(':')[0]
    GPU = torch.cuda.get_device_name(0)
    text = ' '.join(words)
    if voice == 'bark_sing':
        text = '♪ ' + text + ' ♪'
    # Pass local arrays directly: no runtime speaker download or fallback.
    speaker = 'en_speaker_1' if voice == 'bark_1' else 'en_speaker_0'
    preset = {key:np.load(ROOT/'bark/model/speaker_embeddings'/f'{speaker}_{key}.npy',allow_pickle=False) for key in ('semantic_prompt','coarse_prompt','fine_prompt')}
    inputs = PROCESSOR(text, voice_preset=preset, return_tensors='pt').to(DEVICE)
    with torch.inference_mode():
        audio = MODEL.generate(**inputs, do_sample=True, semantic_max_new_tokens=350, fine_batch_size=1)
    return audio.detach().float().cpu().numpy().reshape(-1), MODEL.generation_config.sample_rate


def singing(words, score):
    """Unmodified Qixuan ONNX acoustic/vocoder, explicit F0 and lyric timing.

    CMU English lexicon -> bank's ARPAbet inventory. Sustain vowels; consonants
    retain time, rather than stretching a spoken recording into a singing voice.
    """
    global MODEL
    import cmudict
    import numpy as np
    import onnxruntime as rt
    if MODEL is None:
        bank = next((ROOT/'diffsinger/bank').iterdir())
        op = rt.SessionOptions(); op.intra_op_num_threads=2; op.inter_op_num_threads=1
        MODEL = (rt.InferenceSession(str(next(bank.glob('*.onnx'))), sess_options=op, providers=['CPUExecutionProvider']),
                 rt.InferenceSession(str(next((ROOT/'diffsinger/vocoder').glob('*.onnx'))), sess_options=op, providers=['CPUExecutionProvider']),
                 json.loads(next(bank.glob('*.phonemes.json')).read_text()), cmudict.dict(),
                 rt.InferenceSession(str(next((bank/'dsvariance').glob('*.linguistic.onnx'))), sess_options=op, providers=['CPUExecutionProvider']),
                 rt.InferenceSession(str(next((bank/'dsvariance').glob('*.variance.onnx'))), sess_options=op, providers=['CPUExecutionProvider']),
                 json.loads(next((bank/'dsvariance').glob('*.phonemes.json')).read_text()))
    acoustic,vocoder,inventory,dictionary,linguistic,variance,variance_inventory = MODEL
    sr,hop=44100,512
    tokens=['SP']; durations=[10]; lanes=[]; pitches=[0.] * 10
    vowels=set('aa ae ah ao aw ax ay eh er ey ih iy ow oy uh uw'.split())
    for i,(word,note) in enumerate(zip(words, score['notes'])):
        key=re.sub(r"[^a-z']",'',word.lower())
        pronunciation=dictionary.get(key)
        if not pronunciation:
            raise ValueError('Qixuan English dictionary does not know word '+str(i+1)+'. Try another spelling or lyric.')
        phones=[re.sub(r'\d','',p).lower() for p in pronunciation[0]]
        phones=['en/'+p for p in phones]
        if any(p not in inventory for p in phones):
            raise ValueError('Unsupported singing pronunciation at word '+str(i+1)+'.')
        frames=round(note['beats']*60/score['bpm']*sr/hop)
        if frames<len(phones)*2:
            raise ValueError('Note too short for lyric word '+str(i+1)+'. Increase its beats or lower melody BPM.')
        consonant=min(6, max(2, frames//max(2,len(phones)*3)))
        d=[consonant if p[3:] not in vowels else 0 for p in phones]
        vi=[j for j,p in enumerate(phones) if p[3:] in vowels] or [len(phones)-1]
        sustain=max(1,(frames-sum(d))//len(vi))
        for j in vi:d[j]=sustain
        d[vi[-1]]+=frames-sum(d)
        start=sum(durations); tokens.extend(phones);durations.extend(d)
        hz=440*2**((note['note']-69)/12)
        f=np.full(frames,hz,np.float32)
        # Gentle late vibrato, continuous F0; user notes still define the pitch.
        t=np.arange(frames)*hop/sr;f*=2**((np.sin(t*2*np.pi*5.2)*.12*np.minimum(1,t/.2))/12)
        pitches.extend(f.tolist())
        lanes.append({'word':word,'offset':start*hop/sr,'duration':frames*hop/sr})
    tokens+=['SP'];durations+=[18];pitches += [0.]*18
    f0=np.array([pitches],np.float32)
    values={'tokens':np.array([[inventory[p] for p in tokens]],np.int64),'languages':np.array([[0 if p=='SP' else 1 for p in tokens]],np.int64),'durations':np.array([durations],np.int64),'f0':f0,'breathiness':np.zeros_like(f0),'voicing':np.ones_like(f0),'gender':np.zeros_like(f0),'velocity':np.ones_like(f0),'depth':np.array(.6,np.float32),'steps':np.array(16,np.int64)}
    # These acoustic controls are harmonic/aperiodic RMS in dB, not 0–1
    # amounts. Predict them with the bank's own variance model; zero dB
    # constants grossly overdrive the vocoder and obscure the consonants.
    encoded=linguistic.run(None,{'tokens':np.array([[variance_inventory[p] for p in tokens]],np.int64),'languages':values['languages'],'ph_dur':values['durations']})[0]
    pitch=(69+12*np.log2(np.maximum(f0,1)/440)).astype(np.float32)
    predicted=variance.run(None,{'encoder_out':encoded,'ph_dur':values['durations'],'pitch':pitch,'breathiness':np.zeros_like(f0),'voicing':np.zeros_like(f0),'retake':np.ones((*f0.shape,2),bool),'steps':np.array(12,np.int64)})
    values['breathiness'],values['voicing']=predicted
    mel=acoustic.run(None,values)[0]
    x=vocoder.run(None,{'mel':mel,'f0':f0})[0].reshape(-1)
    # Keep complete, continuous sung phrase as one trigger, not sixteen attacks.
    return x, sr, [{'word':'Sung phrase','offset':0.,'duration':len(x)/sr}]


def finalize(x, sr, trim=True):
    import numpy as np
    from scipy.signal import resample_poly
    from math import gcd
    x=np.asarray(x,np.float32).reshape(-1)
    if not len(x) or not np.isfinite(x).all() or len(x)>sr*26:
        raise ValueError('Voice returned invalid or overlong audio. Try fewer words.')
    if trim:
        active=np.flatnonzero(abs(x)>max(.001, float(abs(x).max())*.006))
        if not len(active):raise ValueError('Voice returned silence. Try another phrase.')
        pad=round(sr*.015);x=x[max(0,int(active[0])-pad):int(active[-1])+pad+1]
    if sr != RATE:
        g=gcd(int(sr),RATE);x=resample_poly(x,RATE//g,int(sr)//g).astype(np.float32)
    peak=float(abs(x).max());rms=float(np.sqrt(np.mean(x*x)))
    if peak<.0001:raise ValueError('Voice returned silence.')
    x*=min(4.,.88/peak,.13/max(.0001,rms))
    fade=min(round(RATE*.003),len(x)//2);ramp=np.linspace(0,1,fade,dtype=np.float32)
    x[:fade]*=ramp;x[-fade:]*=ramp[::-1]
    return x


def render(payload):
    global JOBS
    import numpy as np
    started=time.monotonic();words=payload['words'];voice=payload['voice'];speed=payload['speed']
    if ENGINE in ('bark','diffsinger'):
        if ENGINE=='bark':x,sr=bark(words,voice)
        else:x,sr,_=singing(words,payload['melody'])
        x=finalize(x,sr,trim=ENGINE!='diffsinger');pieces=[x]
        lanes=[{'word':'Sung phrase' if ENGINE=='diffsinger' or voice=='bark_sing' else 'Vocal phrase','offset':0.,'duration':len(x)/RATE}]
    else:
        pieces=[];lanes=[];offset=0.
        for word in words:
            x,sr=speech(word,voice,speed);x=finalize(x,sr)
            if len(x)>RATE*8:raise ValueError('A word exceeded eight seconds. Try a shorter phrase.')
            lanes.append({'word':word,'offset':offset,'duration':len(x)/RATE});pieces.append(x);offset+=len(x)/RATE
    pcm=np.concatenate(pieces)
    out=io.BytesIO()
    with wave.open(out,'wb') as w:w.setparams((1,2,RATE,0,'NONE',''));w.writeframes((np.clip(pcm,-1,1)*32767).astype('<i2').tobytes())
    JOBS+=1
    return {'audioBase64':base64.b64encode(out.getvalue()).decode(),'lanes':lanes,'device':DEVICE,'gpu':GPU,'workerReused':JOBS>1,'inferenceSeconds':round(time.monotonic()-started,3),'retire':JOBS>=32}


def main():
    for _ in range(32):
        if not select.select([sys.stdin],[],[],75)[0]:break
        line=sys.stdin.buffer.readline(65537)
        if not line or len(line)>65536:break
        try:
            # Libraries must never put progress/model warnings on the IPC stream.
            with contextlib.redirect_stdout(sys.stderr):result=render(json.loads(line))
        except Exception as error:
            result={'error':str(error)[:600]}
        sys.stdout.write(json.dumps(result)+'\n');sys.stdout.flush()
        if result.get('retire'):break

if __name__=='__main__':main()
