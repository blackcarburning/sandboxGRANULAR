/* Bounded, reusable PCM capture. No network, timers or UI on the audio thread. */
class MygrainDawCapture extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.cefPreview=options?.processorOptions?.cefPreview===true;
        this.frames=1024;this.epoch=0;this.startFrame=Infinity;this.cursor=0;this.used=0;this.current=null;
        this.pool=Array.from({length:8},()=>new ArrayBuffer(24+this.frames*8));
        this.port.onmessage=({data})=>{
            if(data.type==='recycle')this.pool.push(data.buffer);
            if(data.type==='stop'){this.epoch=0;this.startFrame=Infinity;this.used=0;if(this.current)this.pool.push(this.current);this.current=null;}
            if(data.type==='start'){
                if(this.current)this.pool.push(this.current);this.current=null;this.used=0;this.cursor=0;
                this.epoch=data.epoch;this.startFrame=data.startFrame;
            }
        };
    }
    process(inputs,outputs) {
        // Keep a silent sink alive; the DAW is the only audible monitor.
        const input=inputs[0],length=outputs[0]?.[0]?.length||128;
        if(!this.epoch){
            // Embedded CEF captures this output into its separate DAW preview
            // bus. Let inline auditions be heard while stopped/disarmed. Normal
            // external Bridge tabs retain their silent sink. During a live
            // capture the original transport PCM path remains the only output.
            if(this.cefPreview)for(let c=0;c<(outputs[0]?.length||0);c++){
                const channel=input?.[c]||input?.[0];if(channel)outputs[0][c].set(channel);
            }
            return true;
        }
        for(let i=0;i<length;i++){
            if(currentFrame+i<this.startFrame)continue;
            if(!this.current){
                this.current=this.pool.pop();
                if(!this.current){this.epoch=0;this.port.postMessage({type:'overflow'});return true;}
                this.samples=new Float32Array(this.current,24);
            }
            this.samples[this.used*2]=input?.[0]?.[i]||0;
            this.samples[this.used*2+1]=input?.[1]?.[i]??input?.[0]?.[i]??0;
            this.used++;
            if(this.used===this.frames){
                const header=new DataView(this.current);header.setUint32(0,0x3141474d,true);header.setUint32(4,this.epoch,true);
                header.setUint32(8,sampleRate,true);header.setUint32(12,this.frames,true);header.setFloat64(16,this.cursor,true);
                const buffer=this.current;this.cursor+=this.frames;this.current=null;this.used=0;
                this.port.postMessage({type:'pcm',buffer},[buffer]);
            }
        }
        return true;
    }
}
registerProcessor('mygrain-daw-capture-v1',MygrainDawCapture);
