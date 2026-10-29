/* One-pass X/L EQ automation. Position is sequence phase, never wall-clock time. */
(function(root) {
    'use strict';
    const sound = value => ({ enabled: value.enabled, bands: value.bands.map(b => ({ ...b })) });
    function interpolate(points, phase) {
        if (!points.length) return null;
        phase = Math.max(0, Math.min(1, phase));
        let lo = 0, hi = points.length - 1;
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (points[mid].phase <= phase) lo = mid; else hi = mid; }
        const a = points[lo], b = points[hi], t = Math.max(0, Math.min(1, (phase - a.phase) / (b.phase - a.phase || 1)));
        return { enabled: t >= 1 ? b.enabled : a.enabled, bands: a.bands.map((band, i) => ({ ...(t >= 1 ? b.bands[i] : band),
            frequency: band.frequency * (b.bands[i].frequency / band.frequency) ** t,
            q: band.q * (b.bands[i].q / band.q) ** t,
            gain: band.gain + (b.bands[i].gain - band.gain) * t })) };
    }
    // Error-bounded curve reduction keeps long exported patches small without
    // quantising time. Preserve every discrete shape/on/slope transition.
    function simplify(points) {
        if (points.length < 3) return points;
        const keep = new Set([0, points.length - 1]);
        const categorical = p => JSON.stringify([p.enabled, ...p.bands.map(b => [b.enabled, b.type, b.slope])]);
        for (let i = 1; i < points.length; i++) if (categorical(points[i]) !== categorical(points[i - 1])) { keep.add(i - 1); keep.add(i); }
        const anchors = [...keep].sort((a,b) => a-b), stack = [];
        for (let i = 1; i < anchors.length; i++) stack.push([anchors[i-1], anchors[i]]);
        while (stack.length) {
            const [lo, hi] = stack.pop(); let worst = 1, at = -1;
            for (let i = lo + 1; i < hi; i++) {
                const predicted = interpolate([points[lo], points[hi]], points[i].phase);
                let error = 0;
                for (let b = 0; b < 4; b++) {
                    const actual = points[i].bands[b], estimate = predicted.bands[b];
                    error = Math.max(error, Math.abs(Math.log(actual.frequency / estimate.frequency)) / .001,
                        Math.abs(Math.log(actual.q / estimate.q)) / .001, Math.abs(actual.gain - estimate.gain) / .01);
                }
                if (error > worst) { worst = error; at = i; }
            }
            if (at >= 0) { keep.add(at); stack.push([lo, at], [at, hi]); }
        }
        return [...keep].sort((a,b) => a-b).map(i => points[i]);
    }
    function create(runtime, clock, persist, options = {}) {
        const writes = new Map(), messages = new Map(), listeners = new Set(), touches = new Set();
        let timer = null, disposed = false;
        const notify = () => { for (const fn of listeners) fn(); };
        const save = () => { persist(); notify(); };
        function info(key) {
            const a = runtime.get(key).automation, w = writes.get(key);
            return { read: a?.read === true, write: !!w, recording: w?.recording === true,
                points: a?.points.length || 0, progress: w?.progress || 0,
                message: messages.get(key) || (a?.points.length ? 'Automation ready' : 'No automation') };
        }
        function schedule() {
            if (disposed || options.manual || timer !== null) return;
            if (!writes.size && !['X','L'].some(k => { const a = runtime.get(k).automation; return a?.read && a.points.length; })) return;
            timer = setTimeout(() => { timer = null; tick(); schedule(); }, ['X','L'].some(k => clock(k).running) ? 10 : 60);
        }
        function cancel(key, message) {
            writes.delete(key); messages.set(key, message); notify();
        }
        function tick() {
            if (disposed) return;
            for (const key of ['X','L']) {
                const c = clock(key), w = writes.get(key);
                if (w) {
                    if (!c.running) {
                        if (w.recording) cancel(key, 'Recording stopped early — previous automation kept');
                        else { w.last = null; messages.set(key, 'W armed · start the sequence'); }
                        continue;
                    }
                    if (w.recording && c.steps !== w.steps) { cancel(key, 'Sequence length changed — take cancelled'); continue; }
                    if (!w.recording) {
                        const crossed = w.last !== null && c.phase < w.last;
                        if (!(crossed || (w.last === null && c.phase < .025))) { w.last = c.phase; continue; }
                        w.recording = true; w.steps = c.steps; w.points = [{ phase: 0, ...sound(runtime.get(key)) }];
                        w.progress = c.phase; w.last = c.phase;
                        messages.set(key, 'W recording · one sequence'); notify();
                    } else {
                        const delta = c.phase - w.last;
                        w.progress += delta < -.5 ? delta + 1 : Math.max(0, delta);
                        w.last = c.phase;
                    }
                    if (w.progress >= 1) {
                        w.points.push({ phase: 1, ...sound(runtime.get(key)) });
                        const value = runtime.get(key);
                        value.automation = { version: 1, read: true, steps: w.steps, points: simplify(w.points) };
                        writes.delete(key); runtime.set(key, value); messages.set(key, 'Recorded · R enabled'); save();
                    } else if (w.progress > w.points.at(-1).phase && w.points.length < 32767) {
                        w.points.push({ phase: w.progress, ...sound(runtime.get(key)) });
                    }
                } else if (!touches.has(key)) {
                    const a = runtime.get(key).automation;
                    if (a?.read && a.points.length && c.running) runtime.automate(key, interpolate(a.points, c.phase));
                    else runtime.clearAutomationOverride(key);
                }
            }
        }
        const api = {
            info, tick,
            touch(key, active) {
                if (!['X','L'].includes(key)) return;
                if (active) { touches.add(key); runtime.set(key, runtime.get(key)); }
                else touches.delete(key);
            },
            read(key) {
                if (writes.has(key)) cancel(key, 'Write cancelled');
                const value = runtime.get(key), a = value.automation;
                if (!a?.points.length) return;
                value.automation = { ...a, read: !a.read }; runtime.set(key, value);
                messages.set(key, value.automation.read ? 'R enabled' : 'R off · manual EQ'); save(); schedule();
            },
            write(key) {
                if (writes.has(key)) { cancel(key, 'Write cancelled · previous automation kept'); schedule(); return; }
                runtime.clearAutomationOverride(key);
                runtime.prepareAutomation?.(key);
                const c = clock(key);
                writes.set(key, { recording: false, last: c.running ? c.phase : null, progress: 0 });
                messages.set(key, c.running ? 'W armed · waiting for sequence start' : 'W armed · start the sequence'); notify(); schedule();
            },
            remove(key) {
                writes.delete(key); const value = runtime.get(key); delete value.automation;
                runtime.clearAutomationOverride(key); runtime.set(key, value);
                messages.set(key, 'Automation deleted · EQ settings kept'); save();
            },
            subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
            dispose() { disposed = true; clearTimeout(timer); unsubscribe(); writes.clear(); for (const k of ['X','L']) runtime.clearAutomationOverride(k); }
        };
        const unsubscribe = runtime.subscribe(reason => {
            if (reason === 'restore') { writes.clear(); touches.clear(); messages.clear(); for (const k of ['X','L']) runtime.clearAutomationOverride(k); }
            schedule(); notify();
        });
        schedule(); return api;
    }
    if (typeof module === 'object' && module.exports) module.exports = { interpolate, simplify, create };
    else {
        root.MygrainEqAutomation = { interpolate, simplify, create };
        root.mygrainEqAutomation = create(root.mygrainChannelEq, key => root.mygrainEqAutomationClock(key), () => saveState());
        root.addEventListener('mygrain-account-lock', () => root.mygrainEqAutomation.dispose());
    }
})(typeof window === 'undefined' ? globalThis : window);
