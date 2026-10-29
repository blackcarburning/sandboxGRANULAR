const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),Eq=require('../channel-eq.js');
function processor(){let C;const sandbox={AudioWorkletProcessor:class{constructor(){this.port={}}},sampleRate:48000,registerProcessor:(name,c)=>C=c};vm.runInNewContext(fs.readFileSync(require.resolve('../eq-automation-worklet.js'),'utf8'),sandbox);return new C()}
function coeffs(v){return v.bands.flatMap(b=>{const sections=Eq.sections(b,48000);return Array.from({length:8},(_,i)=>sections[i]?[...sections[i].b,sections[i].a[1],sections[i].a[2]]:[1,0,0,0,0]).flat()})}
test('automation worklet matches native RBJ bell/shelf/cut response and keeps stereo phase',()=>{for(const type of Eq.TYPES){const p=processor(),v=Eq.defaults();v.enabled=true;v.bands.forEach(b=>b.enabled=false);Object.assign(v.bands[1],{enabled:true,type,frequency:1500,gain:12,q:.9,slope:96});p.port.onmessage({data:{initial:true,coefficients:coeffs(v)}});const data=[];for(let k=0;k<100;k++){const input=new Float32Array(128),right=new Float32Array(128);for(let i=0;i<128;i++){input[i]=.01*Math.sin((k*128+i)*2*Math.PI*1000/48000);right[i]=-input[i]}const out=[new Float32Array(128),new Float32Array(128)];p.process([[input,right]],[out]);for(let i=0;i<128;i++){assert(Number.isFinite(out[0][i]));assert(Math.abs(out[0][i]+out[1][i])<1e-8);data.push(out[0][i])}}const tail=data.slice(-4800),power=tail.reduce((s,x)=>s+x*x,0)/tail.length,db=10*Math.log10(power/(.01*.01/2));assert(Math.abs(db-Eq.response(v,[1000])[0])<.02,type+' '+db)}});
test('per-sample coefficient glides keep rapid sweeps continuous without restarting states',()=>{const p=processor(),v=Eq.defaults();v.bands.forEach(b=>b.enabled=false);Object.assign(v.bands[1],{enabled:true,gain:12});let previous=0,jump=0,peak=0;for(let k=0;k<240;k++){if(k%4===0){v.bands[1].frequency=200*20**(k/240);p.port.onmessage({data:{initial:k===0,coefficients:coeffs(v)}})}const input=new Float32Array(128);for(let i=0;i<128;i++)input[i]=.05*Math.sin((k*128+i)*2*Math.PI*440/48000);const out=[new Float32Array(128),new Float32Array(128)];p.process([[input]],[out]);for(const x of out[0]){jump=Math.max(jump,Math.abs(x-previous));peak=Math.max(peak,Math.abs(x));previous=x;assert(Number.isFinite(x))}}assert(peak>.05&&peak<.3);assert(jump<.015,'max adjacent-sample jump '+jump)});

// A bell has unity DC gain regardless of boost/cut. Modulating it must not
// synthesize a signal from constant input (the old transposed form did).
test('rapid low-frequency boost/cut cannot turn DC into modulation transients',()=>{
 const p=processor(),v=Eq.defaults();v.enabled=true;v.bands.forEach(b=>b.enabled=false);
 Object.assign(v.bands[1],{enabled:true,type:'bell',frequency:30,gain:0,q:1});
 let error=0;
 for(let k=0;k<600;k++){
  if(k%20===0){v.bands[1].gain=k<80?0:(k%40===0?24:-24);p.port.onmessage({data:{initial:k===0,coefficients:coeffs(v)}})}
  const out=[new Float32Array(128),new Float32Array(128)];p.process([[new Float32Array(128).fill(.1)]],[out]);
  if(k>80)for(const x of out[0])error=Math.max(error,Math.abs(x-.1));
 }
 assert(error<1e-6,'spurious modulation amplitude '+error);
});
