(function (root) {
    'use strict';

    const MAX_BYTES = 64 * 1024 * 1024;

    function filename(name, parts) {
        const uniqueTempos = [...new Set(parts.map(part => String(Number(part.bpm))))];
        const tempoList = uniqueTempos.join('-');
        const tempos = tempoList.length > 100 ? `${uniqueTempos[0]}-mixed` : tempoList;
        if (!tempos || parts.some(part => !Number.isFinite(Number(part.bpm)) || Number(part.bpm) <= 0)) throw new Error('The song has an invalid tempo.');
        const base = String(name || '').replace(/\\/g, '/').split('/').pop()
            .replace(/\.wav$/i, '').replace(/\.song\.[\d.-]+(?:mixed)?$/i, '')
            .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '').slice(0, 100);
        return `${base || 'mygrain'}.song.${tempos}.wav`;
    }

    function layout(parts, renders, sampleRate) {
        if (!parts.length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Song export requires parts and a valid sample rate.');
        let duration = 0;
        const entries = parts.map(part => {
            const start = Math.round(duration * sampleRate);
            const baseDuration = root.MygrainSongBeta.partDurationSeconds({ ...part, repeats: 1 });
            duration += root.MygrainSongBeta.partDurationSeconds(part);
            const end = Math.round(duration * sampleRate);
            const buffer = renders?.get(part.sourcePartId || part.id);
            if (renders && (!buffer || !Number.isInteger(buffer.length) || buffer.length < 1 || !buffer.numberOfChannels || typeof buffer.getChannelData !== 'function')) throw new Error(`Arm Cache again: ${part.name} has no prepared song audio.`);
            return { start, end, buffer, baseDuration, part };
        });
        const frames = Math.round(duration * sampleRate);
        if (44 + frames * 6 > MAX_BYTES) throw new Error('This song exceeds the WAV folder’s 64 MB upload limit. Reduce repeats or export a shorter arrangement.');
        return { entries, frames };
    }

    function pickupSeconds(part) {
        const pre=part.render?.robotPreRollFrames!=null?part.render.robotPreRollFrames/part.render.sampleRate:(part.robotPreRollSeconds||0);
        return Number.isFinite(pre)&&pre>0&&pre<=.2001?pre:0;
    }

    // Only aligned Songs use this path. Mix a bounded output chunk at a time,
    // retaining just the source buffers whose body/pickup intersects that chunk.
    async function wavAligned(parts,renders,sampleRate,signal) {
        const provider=typeof renders==='function'?renders:part=>renders.get(part.sourcePartId||part.id);
        const baseLayout=layout(parts,null,sampleRate),pickupFrames=Math.round(pickupSeconds(parts[0])*sampleRate),frames=baseLayout.frames+pickupFrames;
        if(44+frames*6>MAX_BYTES)throw Error('This song exceeds the WAV folder’s 64 MB upload limit.');
        const header = new ArrayBuffer(44);
        const view = new DataView(header);
        const writeText = (offset, text) => Array.from(text).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
        writeText(0, 'RIFF');
        view.setUint32(4, 36 + frames * 6, true);
        writeText(8, 'WAVE');
        writeText(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 6, true);
        view.setUint16(32, 6, true);
        view.setUint16(34, 24, true);
        writeText(36, 'data');
        view.setUint32(40, frames * 6, true);
        const chunks=[header],cache=new Map();let peak=0;
        for(let chunkStart=0;chunkStart<frames;chunkStart+=32768){
            if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
            const chunkEnd=Math.min(frames,chunkStart+32768),mix=[new Float32Array(chunkEnd-chunkStart),new Float32Array(chunkEnd-chunkStart)];
            for(const entry of baseLayout.entries){
                const {part,baseDuration}=entry,start=entry.start+pickupFrames,end=entry.end+pickupFrames,pre=pickupSeconds(part);
                if(end<=chunkStart||start-pre*sampleRate>chunkEnd)continue;
                const key=part.sourcePartId||part.id;let buffer=cache.get(key);
                if(!buffer){buffer=await provider(part);if(!buffer||!buffer.length||!buffer.numberOfChannels)throw Error('Arm Cache again: missing song audio.');cache.set(key,buffer);}
                const channels=[buffer.getChannelData(0),buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1))],preSamples=pre*buffer.sampleRate,full=root.MygrainSongBeta.sourcePartDurationSeconds(part),step=(buffer.length-preSamples)/(full*sampleRate),cycle=baseDuration*sampleRate,loopSamples=(buffer.length-preSamples)*baseDuration/full;
                if(!(step>0))throw Error('Invalid song pickup. Arm Cache again.');
                const add=(from,to,position,nextIndex)=>{for(let frame=Math.max(chunkStart,Math.ceil(from));frame<Math.min(chunkEnd,to);frame++){const pos=position(frame),index=Math.floor(pos),fraction=pos-index;for(let ch=0;ch<2;ch++){const pcm=channels[ch],next=nextIndex(index),value=(pcm[index]??0)*(1-fraction)+(pcm[next]??0)*fraction;if(!Number.isFinite(value))throw Error('A song render contains invalid audio.');mix[ch][frame-chunkStart]+=value;}}};
                add(start,end,frame=>preSamples+((frame-start)%cycle)*step,index=>index+1>=preSamples+loopSamples?Math.floor(preSamples):index+1);
                if(preSamples>0)for(let n=0;n<part.repeats;n++){const boundary=start+n*cycle,from=boundary-preSamples/step;if(boundary>chunkStart&&from<chunkEnd)add(from,boundary,frame=>(frame-from)*step,index=>Math.min(Math.ceil(preSamples)-1,index+1));}
            }
            const bytes=new Uint8Array((chunkEnd-chunkStart)*6);let offset=0;
            for(let i=0;i<mix[0].length;i++)for(let ch=0;ch<2;ch++){const value=mix[ch][i];peak=Math.max(peak,Math.abs(value));const sample=Math.max(-1,Math.min(1,value)),integer=Math.round(sample*(sample<0?0x800000:0x7fffff));bytes[offset++]=integer&255;bytes[offset++]=(integer>>8)&255;bytes[offset++]=(integer>>16)&255;}
            chunks.push(bytes);
            for(const key of cache.keys())if(!baseLayout.entries.some(e=>(e.part.sourcePartId||e.part.id)===key&&e.end+pickupFrames>chunkEnd&&e.start+pickupFrames-pickupSeconds(e.part)*sampleRate<=chunkEnd))cache.delete(key);
            await new Promise(resolve=>root.setTimeout(resolve,0));
        }
        if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
        return{blob:new Blob(chunks,{type:'audio/wav'}),frames,sampleRate,peak,robotPreRollFrames:pickupFrames};
    }

    async function wav(parts, renders, sampleRate, signal) {
        if(parts.some(part=>pickupSeconds(part)>0))return wavAligned(parts,renders,sampleRate,signal);
        const provider = typeof renders === 'function' ? renders : null;
        const { entries, frames } = layout(parts, provider ? null : renders, sampleRate);
        const header = new ArrayBuffer(44);
        const view = new DataView(header);
        const writeText = (offset, text) => Array.from(text).forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
        writeText(0, 'RIFF');
        view.setUint32(4, 36 + frames * 6, true);
        writeText(8, 'WAVE');
        writeText(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 2, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 6, true);
        view.setUint16(32, 6, true);
        view.setUint16(34, 24, true);
        writeText(36, 'data');
        view.setUint32(40, frames * 6, true);
        const chunks = [header];
        let peak = 0;
        for (const entry of entries) {
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const { start, end, baseDuration } = entry;
            const buffer = provider ? await provider(entry.part) : entry.buffer;
            if (!buffer || !Number.isInteger(buffer.length) || buffer.length < 1 || !buffer.numberOfChannels || typeof buffer.getChannelData !== 'function') throw new Error(`Arm Cache again: ${entry.part.name} has no prepared song audio.`);
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const channels = [buffer.getChannelData(0), buffer.getChannelData(Math.min(1, buffer.numberOfChannels - 1))];
            const fullDuration = root.MygrainSongBeta.sourcePartDurationSeconds(entry.part);
            const step = buffer.length / (fullDuration * sampleRate);
            const cycleFrames = baseDuration * sampleRate;
            const loopSamples = buffer.length * baseDuration / fullDuration;
            for (let chunkStart = start; chunkStart < end; chunkStart += 32768) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                const chunkEnd = Math.min(end, chunkStart + 32768);
                const chunk = new Uint8Array((chunkEnd - chunkStart) * 6);
                let offset = 0;
                for (let frame = chunkStart; frame < chunkEnd; frame += 1) {
                    const position = (((frame - start) % cycleFrames) * step) % buffer.length;
                    const index = Math.floor(position);
                    const fraction = position - index;
                    for (const channel of channels) {
                        const next = index + 1 >= loopSamples ? 0 : index + 1;
                        const value = channel[index] * (1 - fraction) + channel[next] * fraction;
                        if (!Number.isFinite(value)) throw new Error('A song render contains invalid audio. Arm Cache again.');
                        peak = Math.max(peak, Math.abs(value));
                        const sample = Math.max(-1, Math.min(1, value));
                        const integer = Math.round(sample * (sample < 0 ? 0x800000 : 0x7fffff));
                        chunk[offset++] = integer & 0xff;
                        chunk[offset++] = (integer >> 8) & 0xff;
                        chunk[offset++] = (integer >> 16) & 0xff;
                    }
                }
                chunks.push(chunk);
                await new Promise(resolve => root.setTimeout(resolve, 0));
            }
        }
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        return { blob: new Blob(chunks, { type: 'audio/wav' }), frames, sampleRate, peak };
    }

    root.MygrainSongExport = { filename, layout, wav, MAX_BYTES };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.MygrainSongExport;
})(typeof window !== 'undefined' ? window : globalThis);
