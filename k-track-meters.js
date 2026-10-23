(function (root) {
    'use strict';
    // Display-only taps. Never insert a meter into, or disconnect, the audible route.
    function create(host) {
        const win = host.window || root, doc = win.document;
        if (win.__mygrainSongRenderDeck || !win.IntersectionObserver) return null;
        const entries = [...doc.querySelectorAll('[data-k-track-meter]')].map(element => ({
            element, index: Number(element.dataset.kTrackMeter), visible: false, tap: null,
            fill: element.querySelector('[data-k-vu-fill]'), peak: element.querySelector('[data-k-vu-peak]'),
            value: element.querySelector('[data-k-vu-value]'), db: -60, held: -60, holdUntil: 0,
            clipUntil: 0, lastLabel: '', lastText: -Infinity, lastDraw: ''
        }));
        let voices = new Map(), context = null, timer = null, destroyed = false, pageHidden = false;
        const toDb = value => Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(1e-6, value))));
        function disconnect(entry) {
            const tap = entry.tap; if (!tap) return;
            try { tap.source.disconnect(tap.splitter); } catch {}
            try { tap.splitter.disconnect(); } catch {}
            for (const analyser of tap.analysers) try { analyser.disconnect(); } catch {}
            entry.tap = null;
        }
        function draw(entry, db, peak, clipped, now) {
            // Quantise the display to avoid rewriting unchanged/silent DOM on every sample.
            db = Math.round(db * 2) / 2; peak = Math.round(peak * 2) / 2;
            const key = `${db}/${peak}/${clipped}`;
            if (key !== entry.lastDraw) {
                // Reveal a fixed colour scale using a right-anchored dark mask.
                entry.fill.style.transform = `scaleX(${1 - (db + 60) / 60})`;
                entry.peak.style.left = `${(peak + 60) / 60 * 100}%`;
                entry.element.classList.toggle('k-vu-clipped', clipped);
                entry.lastDraw = key;
            }
            if (now - entry.lastText >= 250) {
                const label = db <= -60 ? '−∞' : `${Math.round(db)} dB`;
                if (label !== entry.lastLabel) {
                    entry.value.textContent = label;
                    entry.element.setAttribute('aria-valuenow', String(db));
                    entry.element.setAttribute('aria-valuetext', db <= -60 ? 'Silent' : `${Math.round(db)} dBFS`);
                    entry.lastLabel = label;
                }
                entry.lastText = now;
            }
        }
        function idle(entry) {
            entry.db = entry.held = -60; entry.holdUntil = entry.clipUntil = 0;
            // Offscreen/hidden meters receive no drawing, including reset writes.
            if (entry.visible && !doc.hidden && !pageHidden && !destroyed) draw(entry, -60, -60, false, win.performance.now());
        }
        function sync(nextVoices = voices) {
            if (destroyed) return;
            voices = nextVoices;
            const nextContext = host.context();
            if (nextContext !== context) {
                context?.removeEventListener('statechange', syncState);
                for (const entry of entries) disconnect(entry);
                context = nextContext;
                context?.addEventListener('statechange', syncState);
            }
            const enabled = !doc.hidden && !pageHidden && context?.state === 'running';
            for (const entry of entries) {
                const voice = enabled && entry.visible && voices.get(entry.index);
                const source = voice && (voice.output || voice.filters?.at(-1) || voice.pan || voice.gain);
                if (entry.tap && entry.tap.source !== source) disconnect(entry);
                if (source && !entry.tap) {
                    // Separate channels avoid stereo cancellation and preserve constant-power pan readings.
                    let tap;
                    try {
                        tap = { source, splitter: context.createChannelSplitter(2), analysers: [], data: [] };
                        entry.tap = tap;
                        for (let channel = 0; channel < 2; channel++) {
                            const analyser = context.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0;
                            tap.analysers.push(analyser); tap.data.push(new Float32Array(512));
                            tap.splitter.connect(analyser, channel);
                        }
                        source.connect(tap.splitter);
                        entry.db = entry.held = -60; entry.holdUntil = entry.clipUntil = 0;
                    } catch { disconnect(entry); }
                }
                if (!entry.tap) idle(entry);
            }
            if (entries.some(entry => entry.tap)) {
                if (timer === null) timer = win.setTimeout(tick, 50);
            } else if (timer !== null) { win.clearTimeout(timer); timer = null; }
        }
        function tick() {
            timer = null;
            // Visibility/context events normally handle this; check again before every audio read.
            if (doc.hidden || pageHidden || context?.state !== 'running' || host.context() !== context) { sync(); return; }
            const now = win.performance.now();
            for (const entry of entries) {
                if (!entry.visible || !entry.tap) continue;
                let sum = 0, peak = 0;
                for (let channel = 0; channel < 2; channel++) {
                    const data = entry.tap.data[channel];
                    entry.tap.analysers[channel].getFloatTimeDomainData(data);
                    for (let frame = 0; frame < data.length; frame++) { const value = data[frame]; sum += value * value; peak = Math.max(peak, Math.abs(value)); }
                }
                const db = toDb(Math.sqrt(sum / 1024)), peakDb = toDb(peak);
                entry.db = Math.max(db, entry.db - 2.5);
                if (peakDb >= entry.held) { entry.held = peakDb; entry.holdUntil = now + 600; }
                else if (now > entry.holdUntil) entry.held = Math.max(peakDb, entry.held - 2.5);
                if (peak >= 1) entry.clipUntil = now + 600;
                draw(entry, entry.db, entry.held, now < entry.clipUntil, now);
            }
            if (entries.some(entry => entry.tap)) timer = win.setTimeout(tick, 50);
        }
        function syncState() { sync(); }
        function hidePage() { pageHidden = true; sync(); }
        function showPage() { pageHidden = false; sync(); }
        const observer = new win.IntersectionObserver(changes => {
            for (const change of changes) {
                const entry = entries.find(entry => entry.element === change.target);
                if (entry) entry.visible = change.isIntersecting && change.intersectionRatio > 0;
            }
            sync();
        }, { threshold: [0, 0.01] });
        for (const entry of entries) observer.observe(entry.element);
        doc.addEventListener('visibilitychange', syncState);
        win.addEventListener('pagehide', hidePage); win.addEventListener('pageshow', showPage);
        function destroy() {
            destroyed = true; observer.disconnect();
            if (timer !== null) win.clearTimeout(timer); timer = null;
            for (const entry of entries) disconnect(entry);
            voices = new Map(); context?.removeEventListener('statechange', syncState); context = null;
            doc.removeEventListener('visibilitychange', syncState);
            win.removeEventListener('pagehide', hidePage); win.removeEventListener('pageshow', showPage);
        }
        return { sync, destroy, get activeCount() { return entries.filter(entry => entry.tap).length; }, get running() { return timer !== null; } };
    }
    if (typeof module === 'object' && module.exports) module.exports = { create };
    else root.MygrainKTrackMeters = Object.freeze({ create });
})(typeof window === 'undefined' ? globalThis : window);
