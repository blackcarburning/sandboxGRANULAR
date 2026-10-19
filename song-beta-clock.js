(function (root) {
    'use strict';
    const bridges = root.__mygrainSongRenderBridges = new Map();
    const modules = new WeakMap();
    let renderHtml;

    function waitWithAbort(promise, signal) {
        return new Promise((resolve, reject) => {
            const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
            const finish = (error, value) => {
                signal?.removeEventListener('abort', abort);
                if (error) reject(error); else resolve(value);
            };
            signal?.addEventListener('abort', abort, { once: true });
            promise.then(value => finish(null, value), error => finish(error));
            if (signal?.aborted) abort();
        });
    }

    function schedule(context, parts, renders, onEnded = () => {}, destination = context.destination) {
        const sources = [];
        const entries = [];
        const startTime = Math.ceil((context.currentTime + .25) * context.sampleRate) / context.sampleRate;
        let duration = 0;
        let stopped = false;
        const interrupted = () => {
            if (!stopped && context.state !== 'running') { stop(); onEnded('interrupted'); }
        };
        const stop = () => {
            if (stopped) return;
            stopped = true;
            context.removeEventListener?.('statechange', interrupted);
            for (const source of sources) {
                source.onended = null;
                try { source.stop(); } catch (error) {}
                source.disconnect();
            }
        };
        try {
            for (const part of parts) {
                const buffer = renders.get(part.sourcePartId || part.id);
                const baseDuration = 60 / part.bpm * part.patternSteps / 4;
                if (!buffer || !Number.isFinite(baseDuration) || baseDuration <= 0) throw new Error(`Arm Cache again: ${part.name} has no prepared song audio.`);
                const start = startTime + Math.round(duration * context.sampleRate) / context.sampleRate;
                duration += root.MygrainSongBeta.partDurationSeconds(part);
                const end = startTime + Math.round(duration * context.sampleRate) / context.sampleRate;
                const source = context.createBufferSource();
                sources.push(source);
                source.buffer = buffer;
                source.loop = true;
                source.playbackRate.value = buffer.duration / baseDuration;
                source.connect(destination);
                source.start(start);
                source.stop(end);
                entries.push({ id: part.id, start, end });
            }
            sources.at(-1).onended = () => { if (!stopped) { stop(); onEnded('finished'); } };
            context.addEventListener?.('statechange', interrupted);
        } catch (error) {
            stop();
            throw error;
        }
        return { stop, entries, startTime, endTime: entries.at(-1).end, context };
    }

    async function scheduleStored(context, parts, load, onEnded = () => {}, signal, destination = context.destination, options = {}) {
        if (!parts.length) throw new Error('Save at least one part first.');
        const looping = options.loop === true;
        const offset = looping ? options.startIndex || 0 : 0;
        if (!Number.isInteger(offset) || offset < 0 || offset >= parts.length) throw new Error('Invalid song start part.');
        const partAt = index => parts[(index + offset) % parts.length];
        const initialCount = looping ? 2 : Math.min(2, parts.length);
        const initial = [];
        for (let index = 0; index < initialCount; index += 1) {
            initial.push(looping && parts.length === 1 && index > 0 ? initial[0] : await load(partAt(index)));
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        }
        const singleBuffer = looping && parts.length === 1 ? initial[0] : null;
        const startTime = Math.ceil((context.currentTime + .25) * context.sampleRate) / context.sampleRate;
        let duration = 0;
        const createEntry = (part, index) => {
            const start = startTime + Math.round(duration * context.sampleRate) / context.sampleRate;
            duration += root.MygrainSongBeta.partDurationSeconds(part);
            return { id: part.id, start, end: startTime + Math.round(duration * context.sampleRate) / context.sampleRate, ...(looping ? { sequence: index } : {}) };
        };
        const entries = looping ? [] : parts.map(createEntry);
        const sources = new Set();
        let stopped = false;
        let completed = -1;
        let wake;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            signal?.removeEventListener('abort', stop);
            context.removeEventListener?.('statechange', interrupted);
            wake?.();
            for (const source of sources) {
                source.onended = null;
                try { source.stop(); } catch (error) {}
                source.disconnect();
                source.buffer = null;
            }
            sources.clear();
        };
        const interrupted = () => {
            if (!stopped && context.state !== 'running') { stop(); onEnded('interrupted'); }
        };
        const queue = (index, buffer) => {
            if (stopped || signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            const part = partAt(index);
            const entry = looping ? createEntry(part, index) : entries[index];
            if (context.currentTime >= entry.start) throw new Error(`Storage could not prepare ${part.name} before its beat boundary. Try arming again or use a lower preparation count.`);
            const baseDuration = root.MygrainSongBeta.partDurationSeconds({ ...part, repeats: 1 });
            if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) throw new Error(`Missing song audio for ${part.name}. Arm Cache again.`);
            if (looping) entries.push(entry);
            const source = context.createBufferSource();
            sources.add(source);
            source.buffer = buffer;
            source.loop = true;
            source.playbackRate.value = buffer.duration / baseDuration;
            source.connect(destination);
            source.onended = () => {
                if (stopped) return;
                source.onended = null;
                source.disconnect();
                source.buffer = null;
                sources.delete(source);
                completed = index;
                if (looping) {
                    while (entries[0]?.sequence <= index) entries.shift();
                }
                wake?.();
                if (!looping && index === parts.length - 1) { stop(); onEnded('finished'); }
            };
            source.start(entry.start);
            source.stop(entry.end);
        };
        try {
            signal?.addEventListener('abort', stop, { once: true });
            context.addEventListener?.('statechange', interrupted);
            initial.forEach((buffer, index) => queue(index, buffer));
            initial.length = 0;
            const prepare = async () => {
                for (let index = initialCount; (looping || index < parts.length) && !stopped; index += 1) {
                    const buffer = singleBuffer || await load(partAt(index));
                    if (stopped) return;
                    if (completed < index - 2) await new Promise(resolve => { wake = resolve; });
                    wake = null;
                    if (stopped) return;
                    queue(index, buffer);
                }
            };
            prepare().catch(error => {
                if (stopped) return;
                stop();
                if (error.name !== 'AbortError') onEnded(error.message);
            });
        } catch (error) { stop(); throw error; }
        return { stop, entries, startTime, endTime: looping ? Infinity : entries.at(-1).end, context };
    }

    function renderCaptureTiming(context, deck) {
        const sampleRate = Number(context.sampleRate);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('Song capture requires a valid sample rate.');
        const requestedStart = typeof deck.getBufferedTransportStartTime === 'function'
            ? deck.getBufferedTransportStartTime()
            : context.currentTime + .3;
        const outputLatency = typeof deck.getTransportOutputLatencySeconds === 'function'
            ? deck.getTransportOutputLatencySeconds()
            : 0;
        if (!Number.isFinite(requestedStart) || requestedStart <= context.currentTime) throw new Error('Song preparation missed its buffered start. Arm Cache again.');
        if (!Number.isFinite(outputLatency) || outputLatency < 0 || outputLatency > .25) throw new Error('Song capture output latency is unavailable. Arm Cache again.');
        const sourceFrame = Math.ceil(requestedStart * sampleRate);
        const latencyFrames = Math.round(outputLatency * sampleRate);
        return { sourceTime: sourceFrame / sampleRate, startFrame: sourceFrame + latencyFrames, latencyFrames };
    }

    async function render(context, part, timing, signal) {
        if (root.document.hidden) throw new Error('Keep MYGRAIN in the foreground while preparing song audio.');
        if (!context.audioWorklet || !root.AudioWorkletNode) throw new Error('Exact song rendering requires AudioWorklet support. Use an up-to-date browser over HTTPS.');
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const base = new URL('.', root.document.baseURI);
        if (!modules.has(context)) modules.set(context, context.audioWorklet.addModule(new URL('song-beta-capture-worklet.js?v=20261013-clock-2', base).href).catch(error => { modules.delete(context); throw error; }));
        await modules.get(context);
        if (!renderHtml) {
            renderHtml = fetch(base, { cache: 'no-store', signal }).then(response => {
                if (!response.ok) throw new Error('Could not load the isolated song renderer.');
                return response.text();
            }).catch(error => { renderHtml = null; throw error; });
        }
        const html = await waitWithAbort(renderHtml, signal);
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        const name = `song-${root.crypto.randomUUID()}`;
        const destination = context.createGain();
        destination.gain.value = 0;
        destination.connect(context.destination);
        const bridge = { context, destination, nodes: new Set(), databases: new Set(), connections: new Set(), state: part.snapshot.state };
        bridge.databaseFactory = root.mygrainAccounts?.createRenderDatabaseFactory(bridge);
        bridges.set(name, bridge);
        const frame = root.document.createElement('iframe');
        frame.name = name;
        frame.title = 'Isolated song audio renderer';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.cssText = 'position:fixed;width:1200px;height:900px;opacity:0;pointer-events:none;z-index:-1;top:0;left:0;border:0';
        frame.srcdoc = html.replace(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^>]*>[\s\S]*?<\/script>/gi, '').replace('<head>', `<head><base href="${base.href}"><script src="song-beta-render-deck.js?v=20261019-render-memory-1"><\/script>`);
        root.document.body.append(frame);
        let capture;
        try {
            const deadline = Date.now() + 30000;
            while (!frame.contentWindow?.mygrainSongBetaAdapter) {
                if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
                if (Date.now() > deadline) throw new Error('Isolated song renderer did not start.');
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            const deck = frame.contentWindow;
            // Render decks inherit the authenticated account but omit its UI
            // toolbar, which normally enables this initially disabled button.
            const startButton = deck.document.getElementById('start-btn');
            startButton.disabled = false;
            startButton.click();
            await waitWithAbort(deck.mygrainSongBetaAdapter.ready(), signal);
            if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
            if (root.document.hidden) throw new Error('Keep MYGRAIN in the foreground while preparing song audio.');
            deck.saveAudioBufferToDB = async () => {};
            deck.clearAudioBufferFromDB = async () => {};
            deck.mygrainSongBetaAdapter.recall(part, { start: false });
            const frames = Math.round(60 / timing.bpm * timing.patternSteps / 4 * context.sampleRate);
            const captureTiming = renderCaptureTiming(context, deck);
            const startFrame = captureTiming.startFrame;
            capture = new root.AudioWorkletNode(context, 'mygrain-song-capture-v1', {
                numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
                processorOptions: { startFrame, frames }
            });
            deck.mygrainSongBetaAdapter.output().connect(capture);
            capture.connect(context.destination);
            const recorded = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => finish(new Error('Song rendering timed out. Keep the page open and audio running.')), frames / context.sampleRate * 1000 + 30000);
                const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
                const interrupted = () => { if (context.state !== 'running') finish(new Error('Audio stopped during rendering. Resume MYGRAIN and arm again.')); };
                const hidden = () => { if (root.document.hidden) finish(new Error('Song preparation stopped when the page was hidden. Keep MYGRAIN foregrounded and arm again.')); };
                const finish = (error, channels) => {
                    clearTimeout(timeout);
                    signal?.removeEventListener('abort', abort);
                    context.removeEventListener('statechange', interrupted);
                    root.document.removeEventListener('visibilitychange', hidden);
                    capture.port.onmessage = null;
                    capture.onprocessorerror = null;
                    if (error) reject(error); else resolve(channels);
                };
                capture.port.onmessage = event => finish(null, event.data.channels);
                capture.onprocessorerror = () => finish(new Error('Exact song audio capture failed.'));
                signal?.addEventListener('abort', abort, { once: true });
                context.addEventListener('statechange', interrupted);
                root.document.addEventListener('visibilitychange', hidden);
                if (signal?.aborted) abort();
            });
            deck.mygrainSongBetaAdapter.startAt(captureTiming.sourceTime);
            const channels = await recorded;
            const buffer = context.createBuffer(2, frames, context.sampleRate);
            channels.forEach((channel, index) => buffer.copyToChannel(new Float32Array(channel), index));
            return buffer;
        } finally {
            bridge.disposed = true;
            if (capture) { capture.port.onmessage = null; capture.port.close(); capture.disconnect(); }
            try { frame.contentWindow?.mygrainSongBetaAdapter?.stop({ hardCut: true }); } catch (error) {}
            try { bridge.disposeContext?.(); } catch (error) {}
            bridge.disposeContext = null;
            for (const node of bridge.nodes) {
                try { node.onended = null; } catch (error) {}
                try { node.stop?.(); } catch (error) {}
                try { node.disconnect(); } catch (error) {}
                try { if ('buffer' in node) node.buffer = null; } catch (error) {}
            }
            bridge.nodes.clear();
            bridge.state = null;
            destination.disconnect();
            for (const connection of bridge.connections) connection.close();
            bridge.connections.clear();
            for (const database of bridge.databases) {
                try { bridge.databaseFactory?.deleteDatabase(database); } catch {}
            }
            frame.remove();
            bridges.delete(name);
        }
    }

    root.MygrainSongClock = { schedule, scheduleStored, render, renderCaptureTiming };
    if (typeof module !== 'undefined' && module.exports) module.exports = { schedule, scheduleStored, renderCaptureTiming };
})(globalThis);
