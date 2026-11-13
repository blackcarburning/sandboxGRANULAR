/* Acoustic effects: causal dispersive waveguides, passive scattering lattices,
 * and Minnaert-scaled bubble oscillators. No samples, free noise or timers. */
(function(root){
'use strict';
const Inputs=root.MygrainEffectInputs||(typeof module==='object'&&module.exports?require('./effect-inputs.js'):null);
const KEYS=Object.freeze(['wireWorld','sonicCrystal','bubbleChamber']);
const SOURCES=Inputs.SOURCES;
const NAMES=Object.freeze({wireWorld:'WireWorld',sonicCrystal:'Sonic Crystal',bubbleChamber:'Bubble Chamber'});
const DEFAULTS=Object.freeze({
 wireWorld:{dispersion:.72,travel:.38,feedback:.42,damping:.35,direction:'down',width:.75,level:.5},
 sonicCrystal:{tuning:.48,spacing:.35,coupling:.55,disorder:.12,defect:.25,loss:.25,cells:8,reflection:.28,width:.7,level:.7},
 bubbleChamber:{radius:.48,spread:.5,decay:.4,density:.45,motion:.5,mode:'hybrid',population:16,width:.8,level:.65}
});
const num=(v,d,a=0,b=1)=>v!==null&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v))?Math.max(a,Math.min(b,Number(v))):d;
// Version 1 remains a recall-only engine. New chambers start at Mark's reference.
const LIQUID_DEFAULTS=Object.freeze({radius:Math.log(11.74/3)/Math.log(20),spread:.42,decay:Math.sqrt((.039-.018)/3.2),motion:.86,population:8,damping:0,resonance:0,fizz:0,flow:0,width:.62,level:.88});
function normalize(key,value){const v=value&&typeof value==='object'?value:{},liquid=key==='bubbleChamber'&&(value==null||v.version===2),d=liquid?LIQUID_DEFAULTS:DEFAULTS[key];if(!d)throw Error('Unknown acoustic effect');const s={version:liquid?2:1,enabled:v.enabled===true,source:SOURCES.includes(v.source)?v.source:'all'};for(const[k,def]of Object.entries(d)){if(typeof def==='number')s[k]=num(v[k],def,0,k==='cells'?12:k==='population'?24:1);else s[k]=v[k]??def;}if(key==='wireWorld')s.direction=['down','up'].includes(s.direction)?s.direction:d.direction;if(key==='sonicCrystal')s.cells=[4,8,12].includes(s.cells)?s.cells:8;if(key==='bubbleChamber'){s.population=[8,16,24].includes(s.population)?s.population:d.population;if(!liquid)s.mode=['resonate','droplets','hybrid'].includes(s.mode)?s.mode:'hybrid';}return s;}
function normalizeAll(v){return Object.fromEntries(KEYS.map(k=>[k,normalize(k,v?.[k])]));}
const audible=(k,v)=>{const s=normalize(k,v);return s.enabled&&s.level>0;};
const matches=(selected,key)=>selected===key||(selected==='K'&&/^K[1-5]$/.test(key))||(selected==='drums'&&/^drum(Kick|Snare|Hat|Perc|Clap|Cymbals|Etc|Roll)$/.test(key));
const frequency=s=>100*Math.pow(40,s.tuning);
const radius=s=>s.version===2?3*Math.pow(20,s.radius):.6*Math.pow(25,s.radius);
const bubbleDecay=s=>s.version===2?.018+3.2*s.decay*s.decay:.018+1.15*s.decay*s.decay;
function upgradeBubble(value){const s=normalize('bubbleChamber',value);if(s.version===2)return s;return normalize('bubbleChamber',{...s,version:2,radius:Math.log(Math.max(3,radius(s))/3)/Math.log(20),decay:Math.sqrt((bubbleDecay(s)-.018)/3.2),damping:0,resonance:0,fizz:0,flow:0});}
const renderVersion=modes=>KEYS.reduce((version,key)=>{const s=normalize(key,modes?.[key]);return audible(key,s)&&s.source!=='DAW'?Math.max(version,s.version):version;},0);
const clean=v=>Number.isFinite(v)?Math.max(-8,Math.min(8,v)):0;
const tiny=v=>Math.abs(v)<1e-20?0:v;
// Fixed allocations, fractional reads and smooth delay targets: no graph rebuild
// or buffer allocation during a parameter gesture.
class Delay {
 constructor(n){this.data=new Float32Array(n);this.pos=0;this.time=1;this.target=1;}
 set(samples,instant=false){this.target=Math.max(1,Math.min(this.data.length-2,samples));if(instant)this.time=this.target;}
 read(){this.time+=(this.target-this.time)*.0015;let p=this.pos-this.time;if(p<0)p+=this.data.length;const i=p|0,f=p-i;return this.data[i]*(1-f)+this.data[(i+1)%this.data.length]*f;}
 write(v){this.data[this.pos]=tiny(v);if(++this.pos===this.data.length)this.pos=0;}
 clear(){this.data.fill(0);this.pos=0;this.time=this.target;}
}
class Wire {
 constructor(sr,s){this.sr=sr;this.lines=Array.from({length:2},()=>Array.from({length:20},()=>new Delay(Math.ceil(sr*.035)+4)));this.echo=Array.from({length:2},()=>new Delay(Math.ceil(sr*.55)+4));this.low=[0,0];this.a=0;this.set(s,true);}
 set(s,instant=false){this.s=s;this.aTarget=(s.direction==='up'?-1:1)*(.12+.79*s.dispersion);this.gTarget=s.feedback*.86;this.lp=1-Math.exp(-2*Math.PI*(900*Math.pow(14,1-s.damping))/this.sr);const total=.008+s.travel*.22;for(let ch=0;ch<2;ch++){for(let j=0;j<20;j++){const stagger=.65+((j*7)%20)/25;this.lines[ch][j].set(Math.round(this.sr*total/70*stagger*(1+(ch?1:-1)*s.width*.025)),instant);}this.echo[ch].set(this.sr*(.012+total*1.5)*(1+(ch?1:-1)*s.width*.037),instant);}if(instant){this.a=this.aTarget;this.g=this.gTarget;}}
 tick(l,r){this.a+=(this.aTarget-this.a)*.002;this.g+=(this.gTarget-this.g)*.002;let left=0,right=0;for(let ch=0;ch<2;ch++){const e=this.echo[ch].read();this.low[ch]+=this.lp*(e-this.low[ch]);let x=clean((ch?r:l)+this.low[ch]*this.g);for(const line of this.lines[ch]){const delayed=line.read(),y=delayed-this.a*x;line.write(x+this.a*y);x=y;}this.echo[ch].write(x);if(ch)right=x;else left=x;}return this.out(left,right);}
 out(l,r){this.l=l;this.r=r;}
 clear(){for(const bank of this.lines)for(const d of bank)d.clear();for(const d of this.echo)d.clear();this.low.fill(0);}
 dispose(){this.lines=null;this.echo=null;}
}
class Crystal {
 constructor(sr,s){this.sr=sr;this.networks=Array.from({length:2},()=>Array.from({length:12},()=>({f:new Delay(Math.ceil(sr*.006)+4),b:new Delay(Math.ceil(sr*.006)+4),stub:new Delay(Math.ceil(sr*.065)+4),a:0,z:0,c:0})));this.outF=new Float64Array(12);this.outB=new Float64Array(12);this.outS=new Float64Array(12);this.set(s,true);}
 set(s,instant=false){if(this.s&&s.cells!==this.s.cells)this.clear();this.s=s;const f=frequency(s);this.admittance=s.coupling*2.2;this.loss=1-(.002+s.loss*.18);this.boundary=s.reflection*.82;for(let ch=0;ch<2;ch++)for(let j=0;j<12;j++){const cell=this.networks[ch][j],jitter=Math.sin(j*2.3999632297+1.7),detune=1+s.disorder*jitter*.58,defect=j===Math.floor(s.cells/2)?Math.pow(2,-2*s.defect):1,stereo=1+(ch?1:-1)*s.width*.012;const spacing=this.sr*(.00018+s.spacing*.0042)*(1+s.disorder*jitter*.2);cell.f.set(spacing*stereo,instant);cell.b.set(spacing*stereo,instant);cell.stub.set(this.sr/(2*f*detune*defect)*stereo,instant);}}
 tick(l,r){const n=this.s.cells,ad=this.admittance,den=2/(2+ad);let left=0,right=0;for(let ch=0;ch<2;ch++){const bank=this.networks[ch];for(let j=0;j<n;j++){const cell=bank[j];cell.a=cell.f.read();cell.z=cell.b.read();cell.c=cell.stub.read()*this.loss;}for(let j=0;j<n;j++){const fromLeft=j?bank[j-1].a:(ch?r:l)+bank[0].z*.12,fromRight=j===n-1?bank[j].a*this.boundary:bank[j+1].z,side=bank[j].c,pressure=den*(fromLeft+fromRight+ad*side);this.outF[j]=pressure-fromRight;this.outB[j]=pressure-fromLeft;this.outS[j]=pressure-side;}for(let j=0;j<n;j++){bank[j].f.write(this.outF[j]*.999);bank[j].b.write(this.outB[j]*.999);bank[j].stub.write(this.outS[j]);}const out=bank[n-1].a*(1-this.boundary)*1.35;if(ch)right=out;else left=out;}this.l=left;this.r=right;}
 clear(){for(const bank of this.networks)for(const c of bank){c.f.clear();c.b.clear();c.stub.clear();c.a=c.z=c.c=0;}}
 dispose(){this.networks=null;}
}
class Bubbles {
 constructor(sr,s){this.sr=sr;this.voices=Array.from({length:2},()=>Array.from({length:24},()=>({x:0,y:0,age:1e9,c:1,s:0,f:0,amp:1})));this.envelopes=[0,0];this.slow=[0,0];this.phase=[0,0];this.seed=[0x12345678,0x6abc1234];this.index=[0,0];this.count=0;this.set(s,true);}
 rand(ch){let x=this.seed[ch];x^=x<<13;x^=x>>>17;x^=x<<5;this.seed[ch]=x>>>0;return (x>>>0)/4294967296;}
 set(s){if(this.s&&s.population!==this.s.population)this.clear();this.s=s;this.n=s.population;this.pole=Math.exp(-1/(this.sr*(.018+1.15*s.decay*s.decay)));this.injection=1-this.pole;for(let ch=0;ch<2;ch++)for(let j=0;j<24;j++){const v=this.voices[ch][j],spread=((j*0.61803398875)%1)*2-1;v.f=Math.max(65,Math.min(this.sr*.2,3260/(radius(s)*Math.pow(2,spread*s.spread*2))*(1+(ch?1:-1)*s.width*.008)));v.amp=.65+.35*Math.cos(j*1.7);}}
 tick(l,r){const s=this.s,mode=s.mode,resonant=mode==='resonate'?1:mode==='hybrid'?.55:0,droplets=mode!=='resonate',coefFrame=(this.count++&31)===0;let left=0,right=0;for(let ch=0;ch<2;ch++){const input=ch?r:l,abs=Math.abs(input);this.envelopes[ch]+=(abs-this.envelopes[ch])*(abs>this.envelopes[ch]?.08:.0018);this.slow[ch]+=(this.envelopes[ch]-this.slow[ch])*.0003;const onset=Math.max(0,this.envelopes[ch]-this.slow[ch]);let struck=-1;if(droplets&&this.envelopes[ch]>1e-6){this.phase[ch]+=(3+150*s.density*s.density)*Math.min(2,this.envelopes[ch]*8+onset*30)/this.sr;if(this.phase[ch]>=1){this.phase[ch]%=1;struck=Math.min(this.n-1,Math.floor(this.rand(ch)*this.n));const v=this.voices[ch][struck];v.x+=Math.min(.7,this.envelopes[ch]*3+onset*4)*(.55+this.rand(ch)*.45);v.age=0;}}
 let sum=0;for(let j=0;j<this.n;j++){const v=this.voices[ch][j];if(coefFrame||j===struck){const glide=droplets?1-s.motion*.35*Math.exp(-v.age/(this.sr*(.025+.18*s.decay))):1,angle=2*Math.PI*v.f*glide/this.sr;v.c=Math.cos(angle);v.s=Math.sin(angle);}const x=this.pole*(v.c*v.x-v.s*v.y)+input*this.injection*resonant*7,vY=this.pole*(v.s*v.x+v.c*v.y);v.x=tiny(x);v.y=tiny(vY);v.age++;sum+=v.y*v.amp;}sum*=2.2/Math.sqrt(this.n);if(ch)right=sum;else left=sum;}this.l=left;this.r=right;}
 clear(){for(const bank of this.voices)for(const v of bank){v.x=v.y=0;v.age=1e9;}this.envelopes.fill(0);this.slow.fill(0);this.phase.fill(0);this.seed=[0x12345678,0x6abc1234];this.index.fill(0);this.count=0;}
 dispose(){this.voices=null;}
}
// Input-driven pressure resonators: no impulse/droplet injection. Fizz is a
// smoothed multiplicative excitation texture; flow and pitch animate the poles.
// Bounded energy-dependent losses make high pressure thick, never self-running.
class LiquidBubbles {
 constructor(sr,s){this.sr=sr;this.voices=Array.from({length:2},()=>Array.from({length:24},(_,j)=>({x:0,y:0,c:1,s:0,f:0,amp:1,phase:j*2.3999632297,phase2:j*1.71})));this.low=[0,0];this.outLow=[0,0];this.subLow=[0,0];this.env=[0,0];this.texture=[0,0];this.seed=[0x12345678,0x6abc1234];this.count=0;this.controlNames=['motion','damping','resonance','fizz','flow'];this.set(s,true);}
 rand(ch){let x=this.seed[ch];x^=x<<13;x^=x>>>17;x^=x<<5;this.seed[ch]=x>>>0;return(x>>>0)/4294967296*2-1;}
 set(s,instant=false){if(this.s&&s.population!==this.s.population)this.clear();this.s=s;this.n=s.population;this.targets={motion:s.motion,damping:s.damping,resonance:s.resonance,fizz:s.fizz,flow:s.flow};if(instant)this.params={...this.targets};const tau=bubbleDecay(s);this.pole=Math.exp(-1/(this.sr*tau));this.injection=1-this.pole;for(let ch=0;ch<2;ch++)for(let j=0;j<24;j++){const v=this.voices[ch][j],spread=((j*.61803398875)%1)*2-1;v.target=Math.max(38,Math.min(1450,3260/(radius(s)*Math.pow(2,spread*s.spread*2))*(1+(ch?1:-1)*s.width*.008)));if(instant)v.f=v.target;v.amp=.65+.35*Math.cos(j*1.7);}}
 tick(l,r){const frame=(this.count++&31)===0,p=this.params;for(const k of this.controlNames)p[k]+=(this.targets[k]-p[k])*.001;const cutoff=8000*Math.pow(.026,p.damping),lp=1-Math.exp(-2*Math.PI*cutoff/this.sr),sub=1-Math.exp(-2*Math.PI*200/this.sr),tex=1-Math.exp(-2*Math.PI*(70+850*p.fizz)/this.sr);let left=0,right=0;
 for(let ch=0;ch<2;ch++){const input=ch?r:l,amp=Math.abs(input);this.env[ch]+=(amp-this.env[ch])*(amp>this.env[ch]?.035:.0008);this.low[ch]+=lp*(input-this.low[ch]);this.subLow[ch]+=sub*(input-this.subLow[ch]);this.texture[ch]+=tex*(this.rand(ch)-this.texture[ch]);const energy=Math.min(1,this.env[ch]*6),texture=1+p.fizz*(1.5*this.texture[ch]+.35*Math.sin(this.count/this.sr*(29+ch*2))),excite=this.low[ch]*texture,pressure=1+6*p.resonance*p.resonance,pole=Math.exp(Math.log(this.pole)/pressure);let sum=0;
 for(let j=0;j<this.n;j++){const v=this.voices[ch][j];v.f+=(v.target-v.f)*.001;if(frame){v.phase+=(32/this.sr)*2*Math.PI*(.18+p.flow*4.3+j*.027);v.phase2+=(32/this.sr)*2*Math.PI*(1.1+p.fizz*12.3+j*.071);if(v.phase>Math.PI*2)v.phase-=Math.PI*2;if(v.phase2>Math.PI*2)v.phase2-=Math.PI*2;const breath=Math.sin(v.phase),ripple=Math.sin(v.phase2),onset=energy*p.flow*(.025+.06*p.flow),motion=p.motion*(p.flow*.32*breath+p.fizz*.11*ripple-onset),angle=2*Math.PI*Math.max(32,Math.min(1800,v.f*(1+motion)))/this.sr;v.c=Math.cos(angle);v.s=Math.sin(angle);}
 const loss=1/(1+(v.x*v.x+v.y*v.y)*(.00004+.00035*p.resonance)),rotation=pole*loss,x=rotation*(v.c*v.x-v.s*v.y)+excite*this.injection*7*(1+p.resonance*.45),y=rotation*(v.s*v.x+v.c*v.y);v.x=tiny(x);v.y=tiny(y);sum+=v.y*v.amp;}
 sum*=2.2/Math.sqrt(this.n);sum+=this.subLow[ch]*p.flow*(.16+.16*Math.sin(this.count/this.sr*2*Math.PI*(.21+p.flow*.9)));this.outLow[ch]+=lp*(sum-this.outLow[ch]);const out=this.outLow[ch];if(ch)right=out;else left=out;}
 this.l=left;this.r=right;
 }
 clear(){for(const bank of this.voices)for(let j=0;j<bank.length;j++){const v=bank[j];v.x=v.y=0;v.phase=j*2.3999632297;v.phase2=j*1.71;}for(const a of [this.low,this.outLow,this.subLow,this.env,this.texture])a.fill(0);this.seed=[0x12345678,0x6abc1234];this.count=0;}
 dispose(){this.voices=null;}
}
const ENGINES={wireWorld:Wire,sonicCrystal:Crystal,bubbleChamber:Bubbles};
class Engine {
 constructor(key,sr,value){this.key=key;this.sr=sr;this.settings=normalize(key,value);this.body=new (key==='bubbleChamber'&&this.settings.version===2?LiquidBubbles:ENGINES[key])(sr,this.settings);this.level=this.settings.level;this.dc=[0,0];this.last=[0,0];this.dcPole=Math.exp(-2*Math.PI*18/sr);this.disposed=false;}
 update(value){const was=this.settings;this.settings=normalize(this.key,value);if(this.key==='bubbleChamber'&&was.version!==this.settings.version){this.body.dispose();this.body=new (this.settings.version===2?LiquidBubbles:Bubbles)(this.sr,this.settings);this.dc.fill(0);this.last.fill(0);}else this.body.set(this.settings);if(!this.settings.enabled||was.source!==this.settings.source)this.clear();}
 process(inputs,outputs){const out=outputs[0];if(!out)return !this.disposed;for(const ch of out)ch.fill(0);if(this.disposed)return false;if(!audible(this.key,this.settings))return true;const input=inputs[0]||[],left=input[0],right=input[1]||left;for(let i=0;i<out[0].length;i++){this.body.tick(clean(left?.[i]||0),clean(right?.[i]||0));this.level+=(this.settings.level-this.level)*.003;for(let ch=0;ch<out.length;ch++){const raw=ch?this.body.r:this.body.l,y=tiny(raw-this.last[ch]+this.dcPole*this.dc[ch]);this.last[ch]=raw;this.dc[ch]=y;out[ch][i]=clean(y*this.level);}}return true;}
 clear(){this.body.clear();this.dc.fill(0);this.last.fill(0);}
 dispose(){this.disposed=true;this.body.dispose();}
}
function estimatedBytes(values,sr=48000,includeExternal=false){let sum=0;for(const k of KEYS){if(!audible(k,values?.[k])||(!includeExternal&&values[k].source==='DAW'))continue;sum+=k==='wireWorld'?(Math.ceil(sr*.035)+4)*40*4+(Math.ceil(sr*.55)+4)*2*4:k==='sonicCrystal'?24*((Math.ceil(sr*.006)+4)*2+(Math.ceil(sr*.065)+4))*4:32*1024;}return sum;}
const api={KEYS,SOURCES,NAMES,DEFAULTS,LIQUID_DEFAULTS,normalize,normalizeAll,upgradeBubble,renderVersion,bubbleDecay,audible,matches,frequency,radius,estimatedBytes,Engine};if(typeof module==='object'&&module.exports)module.exports=api;else root.MygrainAcousticFx=api;
})(globalThis);
