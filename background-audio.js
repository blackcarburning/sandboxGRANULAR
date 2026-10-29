(function (root) {
    'use strict';
    // Silent clock only: the real mix stays connected to its original destination.
    // Worklet messages wake audio schedulers without relying on background UI timers.
    const clockSource = `class MygrainBackgroundClock extends AudioWorkletProcessor {
        constructor() { super(); this.frames = 0; this.enabled = false; this.pending = false;
            this.port.onmessage = e => { if (e.data === 'ack') this.pending = false; else { this.enabled = e.data === true; if (!this.enabled) { this.pending = false; this.frames = 0; } } }; }
        process() {
            if (this.enabled) {
                this.frames += 128;
                if (this.frames >= sampleRate * .02 && !this.pending) { this.frames = 0; this.pending = true; this.port.postMessage('tick'); }
            }
            return true;
        }
    }
    registerProcessor('mygrain-background-clock-v1', MygrainBackgroundClock);`;

    function create(host, adapter) {
        const doc = host.document;
        let context = null, node = null, generation = 0, lastSync = -Infinity, lastPulse = -Infinity;
        let disposed = false, timer = null, clockError = null;
        let idleSince = null, idleSuspended = false, suspending = null, waking = null, clockEnabled = null;
        const idleDelayMs = 8000;
        const needed = () => Boolean(adapter.playing() || adapter.microphoneActive?.() || adapter.busy?.());
        function setClock(enabled) {
            enabled = Boolean(enabled && context?.state === 'running');
            if (!node || enabled === clockEnabled) return;
            clockEnabled = enabled; node.port.postMessage(enabled);
        }
        function wake() {
            idleSince = null;
            if (disposed || !context || (!idleSuspended && !suspending)) return Promise.resolve(false);
            if (waking) return waking;
            const current = context, token = generation;
            // Invoke resume in the gesture turn, even if suspend is still pending.
            // Web Audio serializes its control operations in invocation order.
            let resume;
            try { resume = current.resume(); } catch (error) { return Promise.reject(error); }
            waking = Promise.resolve(resume).then(() => {
                if (disposed || token !== generation || current !== context) return false;
                idleSuspended = current.state !== 'running';
                if (!idleSuspended) { adapter.onWake?.(); sync(); }
                return !idleSuspended;
            }).finally(() => { if (current === context) waking = null; });
            return waking;
        }
        function checkIdle() {
            if (!adapter.idleEligible || !context || disposed) return;
            // An explicit Start/recording path can resume the context directly.
            if (idleSuspended && context.state === 'running' && !suspending && !waking) {
                idleSuspended = false; idleSince = null; adapter.onWake?.();
            }
            if (needed() || !adapter.idleEligible()) {
                idleSince = null;
                if (idleSuspended) wake().catch(() => {});
                return;
            }
            if (context.state !== 'running' || suspending || waking) return;
            const now = host.performance.now();
            if (idleSince === null) idleSince = now;
            if (now - idleSince < idleDelayMs) return;
            const current = context, token = generation;
            idleSuspended = true; setClock(false);
            let suspended;
            try { suspended = current.suspend(); }
            catch { idleSuspended = false; return; }
            suspending = Promise.resolve(suspended).then(() => {
                if (token === generation && !disposed && idleSuspended && current.state === 'suspended') adapter.onIdle?.();
            }).catch(() => { if (token === generation) idleSuspended = false; })
              .finally(() => { if (current === context) suspending = null; });
        }
        const listen = (target, type, handler, capture = false) => {
            target?.addEventListener?.(type, handler, capture);
            return () => target?.removeEventListener?.(type, handler, capture);
        };
        function configure() {
            const type = adapter.microphoneActive?.() ? 'play-and-record' : 'playback';
            try { if (host.navigator?.audioSession && host.navigator.audioSession.type !== type) host.navigator.audioSession.type = type; }
            catch (error) { /* Feature detection must not prevent normal audio startup. */ }
        }
        function clockWanted() {
            // Keep a bounded native wake source during the hidden idle grace:
            // iOS may stop UI timers before they can request suspension.
            return (doc.hidden ? adapter.playing() : (adapter.scheduling?.() ?? adapter.playing())) || (doc.hidden && adapter.idleEligible?.() && !idleSuspended && !needed());
        }
        function sync() {
            if (disposed) return;
            configure();
            checkIdle();
            setClock(clockWanted());
            try {
                const session = host.navigator?.mediaSession;
                if (session) session.playbackState = context?.state === 'running' && adapter.playing() ? 'playing' : 'none';
            } catch (error) {}
        }
        function pulse() {
            if (disposed || context?.state !== 'running') return;
            lastPulse = host.performance.now();
            try {
                if (adapter.playing()) adapter.tick();
                if (lastPulse - lastSync >= 500) { lastSync = lastPulse; sync(); }
            } finally { node?.port.postMessage('ack'); }
        }
        function visibility() {
            setClock(clockWanted());
            // Deliberately do not resume an interrupted AudioContext here: calls,
            // explicit Stop, and OS audio focus must not trigger an autoplay loop.
            sync();
        }
        function detach() {
            generation++;
            if (node) { node.port.onmessage = null; node.port.close(); node.disconnect(); node = null; }
            context = null; lastPulse = -Infinity; idleSince = null; idleSuspended = false; suspending = waking = null; clockEnabled = null;
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
        const userWake = () => { wake().catch(() => {}); };
        const unlisten = [listen(doc, 'visibilitychange', visibility), listen(host, 'mygrain-account-lock', dispose),
            listen(doc, 'pointerdown', userWake, true), listen(doc, 'keydown', userWake, true)];
        // Bookkeeping/fallback only. Playing schedulers are driven by native audio pulses.
        timer = host.setInterval(sync, 500);
        function dispose() {
            if (disposed) return;
            disposed = true; detach(); host.clearInterval(timer);
            unlisten.forEach(remove => remove());
            try { if (host.navigator?.mediaSession) host.navigator.mediaSession.playbackState = 'none'; } catch (error) {}
        }
        const driving = () => Boolean(node && clockEnabled && !clockError && context?.state === 'running' && host.performance.now() - lastPulse < 150);
        return Object.freeze({ attach, configure, sync, wake, dispose, get driving() { return driving(); }, get idleSuspended() { return idleSuspended; }, get diagnostics() { return { idleSuspended, idleDelayMs, driving: driving(), playing: Boolean(adapter.playing()), protected: Boolean(adapter.microphoneActive?.() || adapter.busy?.()), idlePending: idleSince !== null && !idleSuspended, clockEnabled: Boolean(clockEnabled), clockReady: Boolean(node), clockError, hidden: Boolean(doc.hidden), contextState: context?.state || null }; } });
    }
    const exports = { create, clockSource };
    if (typeof module !== 'undefined' && module.exports) module.exports = exports;
    else root.MygrainBackgroundAudio = Object.freeze(exports);
})(typeof window !== 'undefined' ? window : globalThis);
