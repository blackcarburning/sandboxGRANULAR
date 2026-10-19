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

    async function wav(parts, renders, sampleRate, signal) {
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
            const step = buffer.length / (baseDuration * sampleRate);
            for (let chunkStart = start; chunkStart < end; chunkStart += 32768) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                const chunkEnd = Math.min(end, chunkStart + 32768);
                const chunk = new Uint8Array((chunkEnd - chunkStart) * 6);
                let offset = 0;
                for (let frame = chunkStart; frame < chunkEnd; frame += 1) {
                    const position = ((frame - start) * step) % buffer.length;
                    const index = Math.floor(position);
                    const fraction = position - index;
                    for (const channel of channels) {
                        const value = channel[index] * (1 - fraction) + channel[(index + 1) % buffer.length] * fraction;
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
