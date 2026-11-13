const assert=require('node:assert/strict');
function buffer(ch,n,rate){const a=Array.from({length:ch},()=>new Float32Array(n));return {numberOfChannels:ch,length:n,sampleRate:rate,getChannelData:c=>a[c]};}
const audioContext={createBuffer:buffer};
const src=require('node:fs').readFileSync(require('node:path').join(__dirname,'../loop-d.js'),'utf8');const maximise=new Function('audioContext',src.slice(src.indexOf('function maximise('),src.indexOf('function setMaximiser'))+';return maximise;')(audioContext);

const b=buffer(2,48000,48000);for(let i=0;i<b.length;i++){b.getChannelData(0)[i]=.01*Math.sin(i*.08);b.getChannelData(1)[i]=b.getChannelData(0)[i]*.5;}const orig=b.getChannelData(0).slice();assert.equal(maximise(b,0),b);const a=maximise(b,100);let sum=0;for(let i=0;i<a.length;i++){sum+=a.getChannelData(0)[i]**2;assert.equal(a.getChannelData(1)[i],a.getChannelData(0)[i]*.5);}assert(Math.sqrt(sum/a.length)>.1);assert.deepEqual(b.getChannelData(0),orig);
for(const rate of [22050,44100,48000]){const b=buffer(2,rate,rate);for(let c=0;c<2;c++)for(let i=0;i<b.length;i++)b.getChannelData(c)[i]=i%127===0?2:.01*Math.sin(i*.2);const a=maximise(b,100);for(let c=0;c<2;c++)for(const x of a.getChannelData(c)){assert(Number.isFinite(x));assert(Math.abs(x)<=Math.pow(10,-1/20)+1e-6);}}
const silence=buffer(1,1,44100);assert.equal(maximise(silence,100),silence);console.log('PASS bypass exact, quiet gain, stereo link, untouched original, finite bounded transients at 3 rates, silence');
