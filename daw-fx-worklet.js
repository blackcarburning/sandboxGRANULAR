/* Per-context source-frame mapping: input precedes return through a second,
   silent dependency. Transport delay stays fixed even while clocks drift. */
const fxMappings=new Map(),FX_SIZE=1<<18;
class MygrainFxInput extends AudioWorkletProcessor {
    constructor(options){
        super();this.id=options.processorOptions.id;
        this.mapping={frame:-1,epoch:0,rate:48000,positions:new Float64Array(128),history:new Float64Array(16384)};fxMappings.set(this.id,this.mapping);
        this.left=new Float32Array(FX_SIZE);this.right=new Float32Array(FX_SIZE);this.reset();
        this.port.onmessage=({data})=>{
            if(data.type==='dispose'){this.reset();fxMappings.delete(this.id);this.dead=true;return;}
            if(data.type==='reset'){this.reset();return;}
            if(data.type!=='input'||!(data.buffer instanceof ArrayBuffer))return;
            const b=data.buffer,h=new DataView(b);if(b.byteLength<24||h.getUint32(0,true)!==0x3349474d)return;
            const epoch=h.getUint32(4,true),rate=h.getUint32(8,true),n=h.getUint32(12,true),first=h.getFloat64(16,true);
            if(!epoch||rate<8000||rate>192000||!n||n>1024||b.byteLength!==24+n*8||!Number.isSafeInteger(first)||first<0)return;
            if(epoch!==this.mapping.epoch||rate!==this.mapping.rate||first!==this.expected||this.w-this.r+n>=FX_SIZE){this.reset();this.mapping.epoch=epoch;this.mapping.rate=rate;this.base=first;}
            const samples=new Float32Array(b,24);for(let i=0;i<n;i++){this.left[this.w&(FX_SIZE-1)]=Number.isFinite(samples[i*2])?samples[i*2]:0;this.right[this.w&(FX_SIZE-1)]=Number.isFinite(samples[i*2+1])?samples[i*2+1]:0;this.w++;}
            this.expected=first+n;this.port.postMessage({type:'accepted'});
        };
    }
    reset(){this.r=0;this.w=0;this.base=0;this.expected=-1;this.fraction=0;this.started=false;this.smooth=.12;this.mapping.frame=-1;this.mapping.epoch=0;this.mapping.history.fill(-1);}
    process(inputs,outputs){
        const out=outputs[0],n=out[0].length,m=this.mapping;m.frame=currentFrame;m.positions.fill(-1);for(let i=0;i<n;i++)m.history[(currentFrame+i)&16383]=-1;
        if(this.dead)return false;
        if(!this.started){if(this.w-this.r<m.rate*.12)return true;this.started=true;this.smooth=(this.w-this.r)/m.rate;}
        const fill=(this.w-this.r)/m.rate;this.smooth+=(fill-this.smooth)*.002;
        const step=m.rate/sampleRate*(1+Math.max(-.005,Math.min(.005,(this.smooth-.12)*.02)));
        for(let i=0;i<n;i++){
            if(this.w-this.r<Math.ceil(step)+2){this.started=false;break;}
            const a=this.r&(FX_SIZE-1),b=(this.r+1)&(FX_SIZE-1),f=this.fraction;
            out[0][i]=this.left[a]+(this.left[b]-this.left[a])*f;out[1][i]=this.right[a]+(this.right[b]-this.right[a])*f;
            m.positions[i]=this.base+this.r+f;m.history[(currentFrame+i)&16383]=m.positions[i];
            this.fraction+=step;const used=Math.floor(this.fraction);this.fraction-=used;this.r+=used;
        }
        return true;
    }
}
class MygrainFxReturn extends AudioWorkletProcessor {
    constructor(options){
        super();this.id=options.processorOptions.id;this.pool=Array.from({length:8},()=>new ArrayBuffer(24+1024*8));this.buffer=null;this.used=0;this.epoch=0;this.previous=-1;this.delayFrames=options.processorOptions.delayFrames||0;this.lastSentEnd=0;
        this.port.onmessage=({data})=>{if(data.type==='recycle')this.pool.push(data.buffer);if(data.type==='dispose'){this.dead=true;this.previous=-1;}if(data.type==='reset'){this.previous=-1;this.used=0;this.epoch=0;}if(data.type==='latency'){this.delayFrames=Math.max(0,Math.min(8192,Number(data.frames)||0));this.previous=-1;this.used=0;}};
    }
    push(index,l,r,m){
        if(index<this.lastSentEnd)return;
        if(!this.buffer){this.buffer=this.pool.pop();if(!this.buffer){this.port.postMessage({type:'overflow'});this.dead=true;return;}this.samples=new Float32Array(this.buffer,24);}
        if(this.used&&index!==this.first+this.used)this.used=0;
        if(!this.used)this.first=index;
        this.samples[this.used*2]=Number.isFinite(l)?l:0;this.samples[this.used*2+1]=Number.isFinite(r)?r:0;this.used++;
        if(this.used===1024){const h=new DataView(this.buffer);h.setUint32(0,0x3352474d,true);h.setUint32(4,m.epoch,true);h.setUint32(8,m.rate,true);h.setUint32(12,1024,true);h.setFloat64(16,this.first,true);const buffer=this.buffer;this.lastSentEnd=this.first+1024;this.buffer=null;this.used=0;this.port.postMessage({type:'return',buffer},[buffer]);}
    }
    process(inputs,outputs){
        if(this.dead)return false;
        const m=fxMappings.get(this.id),input=inputs[0],n=outputs[0][0].length;
        if(!m||m.frame!==currentFrame){this.previous=-1;return true;}
        if(this.epoch!==m.epoch){this.epoch=m.epoch;this.previous=-1;this.used=0;this.lastSentEnd=0;}
        for(let i=0;i<n;i++){
            const t=currentFrame+i-this.delayFrames,a=Math.floor(t),f=t-a,p0=m.history[a&16383],p1=m.history[(a+1)&16383];
            const x=p0<0||(f>1e-9&&p1<0)?-1:p0+(p1-p0)*f,l=input?.[0]?.[i]||0,r=input?.[1]?.[i]??l;
            if(x<0){this.previous=-1;this.used=0;continue;}
            if(this.previous<0||x<=this.previous||x-this.previous>32){this.previous=x;this.previousL=l;this.previousR=r;this.next=Math.ceil(x);continue;}
            while(this.next<=x){const f=(this.next-this.previous)/(x-this.previous);this.push(this.next++,this.previousL+(l-this.previousL)*f,this.previousR+(r-this.previousR)*f,m);}
            this.previous=x;this.previousL=l;this.previousR=r;
        }
        return true;
    }
}
registerProcessor('mygrain-fx-input-v1',MygrainFxInput);
registerProcessor('mygrain-fx-return-v1',MygrainFxReturn);
