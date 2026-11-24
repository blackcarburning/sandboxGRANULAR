import './glasshaus-dsp.js?v=20261123-glasshaus-slide-gain-1';
const G = globalThis.MygrainGlassHaus, TAU = 2 * Math.PI;
class GlassHausProcessor extends AudioWorkletProcessor {
 constructor(options) {
  super(); const p = options.processorOptions;
  this.s = G.normalize(p.state); this.bpm = p.bpm; this.time = p.time; this.origin = p.origin;
  this.anchor = this.origin; this.beat = 0; this.last = -1; this.voices = []; this.dead = false;
  this.end = Number.isFinite(p.end) ? p.end : Infinity; this.dc = [0, 0]; this.prev = [0, 0]; this.level = this.s.level*(this.s.mode==='rub'?(this.s.slideGain??1):1); this.turn = ((currentTime - this.origin) * this.s.speed * TAU % TAU + TAU) % TAU;
  this.left = new Float64Array(128); this.right = new Float64Array(128); this.pitch = new Float64Array(128); this.sum = new Float64Array(128); this.envelopes = new Float64Array(128); this.fades = new Float64Array(128);
  // Prepared once off the audio thread; SIMD lanes are the existing split-mode pair.
  this.kernel = p.kernel ? new WebAssembly.Instance(p.kernel).exports : null;
  if (this.kernel) {
   const mem = this.kernel.memory.buffer;
   this.envelopes = new Float64Array(mem, 0, 128); this.pitch = new Float64Array(mem, 1024, 128); this.sum = new Float64Array(mem, 2048, 128); this.params = new Float64Array(mem, 3072, 28);
  }
  this.curves = [new Float64Array(128),new Float64Array(128),new Float64Array(128)];
  this.laneVoices = [null,null,null]; this.lanePrevious = [0,0,0]; this.laneCell = -1; this.hitCell = -1;
  this.peaks = this.s.lanes?.map(G.lanePeaks);
  this.port.onmessage = e => {
   const v = e.data;
   if (v.dispose) { this.dead = true; this.voices.length = 0; }
   if (v.bpm && v.bpm !== this.bpm) { this.beat += (currentTime - this.anchor) * this.bpm / 60; this.anchor = currentTime; this.bpm = v.bpm; }
   if (v.state) { const previous=this.s;this.s = G.normalize(v.state);this.peaks=this.s.lanes?.map(G.lanePeaks);
    for(let i=0;i<3;i++) {
     const voice=this.laneVoices[i];if(!voice)continue;
     if(!this.s.lanes||!this.s.objects[i].enabled||JSON.stringify(previous.objects[i])!==JSON.stringify(this.s.objects[i])||previous.root!==this.s.root||previous.tuning!==this.s.tuning||previous.contact!==this.s.contact) {
      voice.curveActive=false;voice.gate=voice.age;this.laneVoices[i]=null;
     }else {voice.pressure=this.s.pressure;voice.rub=this.s.mode!=='strike';}
    }
 for (const voice of this.voices) if (!this.s.objects[voice.slot].enabled && !voice.retiring) voice.retiring = 1; }
  };
 }
 trigger(step, time, slot = null, drawn = false, impulse = false) {
  const s = this.s, enabled = s.objects.map((o, i) => ({o, i})).filter(x => x.o.enabled && x.o.level > 0), notes = drawn ? [s.root] : G.notes(s, step); let chosen = null; const strikeMode = drawn ? impulse : s.mode !== 'rub';
  // Rim contact uses musical beats, not a tiny impulse-length gate. Ringing survives release.
  const rub = s.mode !== 'strike', gate = step.gate * 60 / this.bpm * s.bars / (rub ? 1 : 4);
  for (let oi = 0; oi < enabled.length; oi++) {
   const {o, i} = enabled[oi]; if(slot!==null&&slot!==i)continue; const tool = s.contact === 'auto' ? (o.type === 'wineglass' ? 'finger' : 'mallet') : s.contact, objectKey = JSON.stringify(o);
   for (let j = 0; j < notes.length; j++) {
    if (!drawn && s.assignment === 'split' && enabled.length > 1 && j % enabled.length !== oi) continue;
    const n = notes[j], key = i + ':' + n + ':' + objectKey + ':' + tool, old = this.voices.find(v => v.key === key && !v.retiring);
    const model = old ? old.m : G.modes(s, o, n, sampleRate);
    if (old) {
     // A renewed rub must not reset contact phase, envelope or modal displacement.
     for (let z = 0; z < model.length; z++) if (strikeMode) {
      const mode = old.m[z], limit = Math.sqrt(Math.max(0, 4 - mode.x * mode.x));
      mode.y = Math.max(-limit, Math.min(limit, mode.y + Math.exp(-model[z].hz / (700 + s.hardness * 15000)) * model[z].a * step.velocity));
     }
     if(drawn&&!impulse&&s.pressure>0&&old.m.every(m=>m.x*m.x+m.y*m.y<1e-16))old.m.forEach(m=>m.y+=.008*m.a);
     old.drawn=drawn;old.curveActive=drawn;chosen=old;
     old.age = 0; old.gate = gate; old.life = gate + o.decay * 1.5 + 1; old.rub = rub; old.pressure = s.pressure; old.velocity = step.velocity;
     continue;
    }
    const m = model.map(a => {
     const w = TAU * a.hz / sampleRate, angle = a.order * (o.position * TAU + this.turn) + a.pair * Math.PI / 2;
     const staticAngle = a.order * o.position * TAU + a.pair * Math.PI / 2;
     const coupling = a.order === 2 ? .8 + .2 * Math.abs(Math.cos(staticAngle)) : .25 + .75 * Math.abs(Math.cos(staticAngle));
     const shape = a.a / coupling, strike = strikeMode ? Math.exp(-a.hz / (700 + s.hardness * 15000)) : 0;
     const turn = TAU * s.speed * a.order / sampleRate;
     return {...a, x:0, y:(strike + (s.mode === 'strike' || s.pressure > 0 ? .008 : 0)) * a.a * step.velocity,
      c:Math.cos(w), sn:Math.sin(w), r:Math.exp(-Math.log(1000) / (a.decay * sampleRate)), base:w,
      cx:Math.cos(angle), cy:Math.sin(angle), tc:Math.cos(turn), ts:Math.sin(turn), speed:s.speed,
      target:shape * (tool === 'finger' ? .24 * Math.exp(-(a.order - 2) * 1.5) : .32 * Math.exp(-(a.order - 2) * .65)),
      gain:tool === 'finger' ? 180 : 140};
    });
    const voice={key, slot:i, m, drawn, curveActive:drawn, age:0, gate, life:gate + o.decay * 1.5 + 1,
     level:o.level / Math.sqrt(Math.max(1, notes.length * enabled.length)), left:Math.cos((o.pan + 1) * Math.PI / 4), right:Math.sin((o.pan + 1) * Math.PI / 4),
     rub, pressure:s.pressure, velocity:step.velocity, env:0, retiring:0};this.voices.push(voice);chosen=voice;
   }
  }
  while (this.voices.filter(v => !v.retiring).length > 48) {
   let weakest = null, energy = Infinity;
   for (const v of this.voices) { if (v.retiring) continue; let e = 0; for (const m of v.m) e += m.x * m.x + m.y * m.y; if (e < energy) {energy = e; weakest = v;} }
   weakest.retiring = 1;
  }
  return chosen;
 }
 renderChunk(first, end, attack, release, frictionSpeed) {
  const s = this.s, dt = 1 / sampleRate, pitch = this.pitch, sum = this.sum, envs = this.envelopes, fades = this.fades;
  for (let vi = this.voices.length - 1; vi >= 0; vi--) {
   const v = this.voices[vi]; let age = v.age, env = v.env, retiring = v.retiring, count = end, mixEnd = end, dead = false;
   sum.fill(0, first, end);
   for (let k = first; k < end; k++) {
    age += dt;
    if (age > v.life) {count = mixEnd = k; dead = true; break;}
    const drawing=v.drawn&&v.curveActive&&s.enabled&&currentTime+k*dt>=this.time&&currentTime+k*dt<this.end;
    const strength=drawing?this.curves[v.slot][k]:0;
    if(drawing&&strength>1e-5)v.life=age+s.objects[v.slot].decay*1.5+1;
    const targetEnv = v.rub && (v.drawn?drawing:age<v.gate) ? v.pressure*(v.drawn?strength:1) : 0;
    env += (targetEnv - env) * (targetEnv > env ? attack : release); envs[k] = env;
    if (retiring) {retiring -= dt / .015; if (retiring <= 0) {count = k + 1; mixEnd = k; dead = true; break;}}
    fades[k] = retiring || 1;
   }
   v.age = age; v.env = env; v.retiring = retiring;
   for (let mi = 0; mi < v.m.length; mi++) {
    const m = v.m[mi], velocity = v.drawn&&v.curveActive ? Math.max(1e-4,this.curves[v.slot][first]) : v.velocity;
    // Keep the original scalar arithmetic/order, with two independent Float64 lanes.
    if (this.kernel) {
     const p = this.params, next = v.m[mi+1];
     for(let lane=0;lane<2;lane++) {
      const q=lane?next:m;
      p[lane]=q?.x||0; p[2+lane]=q?.y||0; p[4+lane]=q?.cx||0; p[6+lane]=q?.cy||0;
      p[8+lane]=q?.c??1; p[10+lane]=q?.sn||0; p[12+lane]=q?.r??1; p[14+lane]=q?.base||0;
      p[16+lane]=q?.tc??1; p[18+lane]=q?.ts||0; p[20+lane]=q?q.target*(.25+.75*v.pressure)*velocity:1;
      p[22+lane]=q?.gain||0; p[24+lane]=frictionSpeed; p[26+lane]=dt;
     }
     this.kernel.run(first,count,s.vibrato.depth>0?1:0);
     m.x=p[0]; m.y=p[2]; m.cx=p[4]; m.cy=p[6];
     if(next){next.x=p[1];next.y=p[3];next.cx=p[5];next.cy=p[7];mi++;} continue;
    }
    // Mode-major chunks keep oscillator state in local numbers rather than repeatedly traversing objects per sample.
    let x = m.x, y = m.y, cx = m.cx, cy = m.cy;
    const baseC = m.c, baseS = m.sn, radius = m.r, base = m.base, tc = m.tc, ts = m.ts;
    const targetBase = m.target * (.25 + .75 * v.pressure) * velocity, driveBase = m.gain;
    for (let k = first; k < count; k++) {
     let c = baseC, sn = baseS;
     if (s.vibrato.depth > 0) {const delta = base * (pitch[k] - 1); c = baseC - baseS * delta; sn = baseS + baseC * delta; const inv = 1 / Math.sqrt(c*c + sn*sn); c *= inv; sn *= inv;}
     let xx = (c*x - sn*y)*radius, yy = (sn*x + c*y)*radius;
     const contact = envs[k];
     if (contact > 1e-7) {
      const energy = xx*xx + yy*yy, target = targetBase * (.25 + .75*cx*cx);
      const drive = driveBase * contact * frictionSpeed * (.15 + .85*cx*cx);
      const gain = 1 + Math.max(-120, drive * (1 - energy/(target*target + 1e-9))) * dt;
      xx *= gain; yy *= gain;
     }
     const nextCx = cx*tc - cy*ts; cy = cy*tc + cx*ts; cx = nextCx;
     const energy = xx*xx + yy*yy; if (energy > 4) {const scale = 2/Math.sqrt(energy); xx *= scale; yy *= scale;}
     x = xx; y = yy; sum[k] += x;
    }
    m.x = x; m.y = y; m.cx = cx; m.cy = cy;
   }
   for (let k = first; k < mixEnd; k++) {const a = sum[k]*v.level*.32*fades[k]; this.left[k] += a*v.left; this.right[k] += a*v.right;}
   if (dead) {this.voices.splice(vi, 1);if(this.laneVoices[v.slot]===v)this.laneVoices[v.slot]=null;}
  }
 }
 process(inputs, outputs) {
  if (this.dead) return false;
  const out = outputs[0], s = this.s, dt = 1/sampleRate, attack = 1-Math.exp(-dt/.035), release = 1-Math.exp(-dt/.06), frictionSpeed = Math.sqrt(s.speed/(.25+s.speed)), slew = 1-Math.exp(-dt/.008);
  const targetLevel=s.level*(s.mode==='rub'?(s.slideGain??1):1);
  const length = out[0].length; this.left.fill(0); this.right.fill(0);
  for (const v of this.voices) for (const m of v.m) if (m.speed !== s.speed) {const turn = TAU*s.speed*m.order*dt; m.tc = Math.cos(turn); m.ts = Math.sin(turn); m.speed = s.speed;}
  let first = 0;
  for (let k = 0; k < length; k++) {
   const t = currentTime+k*dt, beats = this.beat+(t-this.anchor)*this.bpm/60, sub = Math.floor(beats*4/s.bars*12+1e-7);
   const vib = s.vibrato;
   this.pitch[k] = vib.depth > 0 ? 2**(Math.sin((vib.sync ? beats*vib.ratio : (t-this.origin)*vib.rate)*TAU)*vib.depth/1200) : 1;
   if(s.lanes) {
    const position=beats*32/s.bars, cell=Math.floor(position+1e-7), index=((cell%128)+128)%128, changed=cell!==this.laneCell;
    const hitCell=Math.floor(beats*4+1e-7),hitIndex=((hitCell%(s.bars*16))+(s.bars*16))%(s.bars*16),hitChanged=hitCell!==this.hitCell;
    for(let i=0;i<3;i++) {
     const value=G.laneValue(s.lanes[i],position);this.curves[i][k]=value;
     const live=t>=this.time&&t<this.end&&s.enabled&&s.objects[i].enabled&&s.objects[i].level>0;
     const impulse=live&&s.mode!=='rub'&&(s.hits?hitChanged&&s.hits[i][hitIndex]&&G.laneValue(s.lanes[i],hitIndex*8/s.bars)>1e-5:changed&&this.peaks[i][index]);
     const contact=live&&s.mode!=='strike'&&value>1e-5&&(!this.laneVoices[i]||this.lanePrevious[i]<=1e-5);
     if(impulse||contact) {
      if(k>first)this.renderChunk(first,k,attack,release,frictionSpeed);
      this.laneVoices[i]=this.trigger({velocity:impulse?(s.hits?G.laneValue(s.lanes[i],hitIndex*8/s.bars):s.lanes[i][index]):1,gate:2},t,i,true,impulse);first=k;
     }
     this.lanePrevious[i]=value;
    }
    this.laneCell=cell;this.hitCell=hitCell;
   } else if (t >= this.time && t < this.end && sub !== this.last) {
    this.last = sub; const index = ((Math.floor(sub/12)%16)+16)%16, step = s.steps[index], part = ((sub%12)+12)%12;
    if (step.on && s.enabled && part%(12/step.ratchet) === 0) {
     if (k > first) this.renderChunk(first, k, attack, release, frictionSpeed);
     this.trigger(step, t); first = k;
    }
   }
   this.turn += TAU*s.speed*dt; if (this.turn >= TAU) this.turn -= TAU;
  }
  if (first < length) this.renderChunk(first, length, attack, release, frictionSpeed);
  for (let k = 0; k < length; k++) {
   this.level += (targetLevel-this.level)*slew;
   let dc = this.left[k]-this.prev[0]+.997*this.dc[0]; this.prev[0] = this.left[k]; this.dc[0] = dc; out[0][k] = Math.tanh(dc*this.level)*.92;
   dc = this.right[k]-this.prev[1]+.997*this.dc[1]; this.prev[1] = this.right[k]; this.dc[1] = dc; out[1][k] = Math.tanh(dc*this.level)*.92;
  }
  return true;
 }
}
registerProcessor('mygrain-glasshaus-v1', GlassHausProcessor);
