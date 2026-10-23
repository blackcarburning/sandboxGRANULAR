(function (root) {
    'use strict';
    // Silent clock only: the real mix stays connected to its original destination.
    // Worklet messages wake audio schedulers without relying on background UI timers.
    const clockSource = `class MygrainBackgroundClock extends AudioWorkletProcessor {
        constructor() { super(); this.frames = 0; this.enabled = false;
            this.port.onmessage = e => { this.enabled = e.data === true; }; }
        process() {
            if (this.enabled) {
                this.frames += 128;
                if (this.frames >= sampleRate * .02) { this.frames = 0; this.port.postMessage('tick'); }
            }
            return true;
        }
    }
    registerProcessor('mygrain-background-clock-v1', MygrainBackgroundClock);`;

    function create(host, adapter) {
        const doc = host.document;
        let context = null, node = null, generation = 0, lastSync = -Infinity;
        let disposed = false, timer = null, clockError = null;
        const listen = (target, type, handler) => {
            target?.addEventListener?.(type, handler);
            return () => target?.removeEventListener?.(type, handler);
        };
        function configure() {
            const type = adapter.microphoneActive?.() ? 'play-and-record' : 'playback';
            try { if (host.navigator?.audioSession && host.navigator.audioSession.type !== type) host.navigator.audioSession.type = type; }
            catch (error) { /* Feature detection must not prevent normal audio startup. */ }
        }
        function sync() {
            if (disposed) return;
            configure();
            try {
                const session = host.navigator?.mediaSession;
                if (session) session.playbackState = context?.state === 'running' && adapter.playing() ? 'playing' : 'none';
            } catch (error) {}
        }
        function pulse() {
            if (disposed || context?.state !== 'running') return;
            if (doc.hidden) adapter.tick();
            const now = host.performance.now();
            if (now - lastSync >= 500) { lastSync = now; sync(); }
        }
        function visibility() {
            node?.port.postMessage(Boolean(doc.hidden));
            // Deliberately do not resume an interrupted AudioContext here: calls,
            // explicit Stop, and OS audio focus must not trigger an autoplay loop.
            sync();
        }
        function detach() {
            generation++;
            if (node) { node.port.onmessage = null; node.port.close(); node.disconnect(); node = null; }
            context = null;
        }
        async function attach(nextContext) {
            if (disposed || nextContext === context) return;
            detach(); context = nextContext; clockError = null;
            const token = generation;
            configure();
            if (!nextContext?.audioWorklet || !host.AudioWorkletNode || !host.Blob || !host.URL?.createObjectURL) { sync(); return; }
            let url;
            try {
                url = host.URL.createObjectURL(new host.Blob([clockSource], { type: 'text/javascript' }));
                await nextContext.audioWorklet.addModule(url);
                if (disposed || token !== generation || nextContext.state === 'closed') return;
                node = new host.AudioWorkletNode(nextContext, 'mygrain-background-clock-v1', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
                node.port.onmessage = pulse;
                node.onprocessorerror = () => { clockError = 'Audio clock unavailable'; };
                node.connect(nextContext.destination);
                visibility();
            } catch (error) { if (token === generation && !disposed) clockError = String(error?.message || error); }
            finally { if (url) host.URL.revokeObjectURL(url); }
            sync();
        }
        const unlisten = [listen(doc, 'visibilitychange', visibility), listen(host, 'mygrain-account-lock', dispose)];
        // Foreground bookkeeping only. Hidden scheduling is driven by the worklet.
        timer = host.setInterval(sync, 500);
        function dispose() {
            if (disposed) return;
            disposed = true; detach(); host.clearInterval(timer);
            unlisten.forEach(remove => remove());
            try { if (host.navigator?.mediaSession) host.navigator.mediaSession.playbackState = 'none'; } catch (error) {}
        }
        return Object.freeze({ attach, configure, sync, dispose, get diagnostics() { return { clockReady: Boolean(node), clockError, hidden: Boolean(doc.hidden), contextState: context?.state || null }; } });
    }
    const exports = { create, clockSource };
    if (typeof module !== 'undefined' && module.exports) module.exports = exports;
    else root.MygrainBackgroundAudio = Object.freeze(exports);
})(typeof window !== 'undefined' ? window : globalThis);
