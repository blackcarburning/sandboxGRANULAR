(function (root) {
    'use strict';
    const KEYS = Object.freeze(['A', 'B', 'C', 'V', 'W', 'P', 'O', 'L', 'X', 'Q', 'M', 'M+', 'generated', 'sample',
        'K1', 'K2', 'K3', 'K4', 'K5', 'drumKick', 'drumSnare', 'drumHat', 'drumPerc', 'drumClap', 'drumCymbals', 'drumEtc', 'drumRoll']);
    const TYPES = Object.freeze(['bell', 'lowshelf', 'highshelf', 'highpass', 'lowpass']);
    const SLOPES = Object.freeze([12, 24, 36, 48, 72, 96]);
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const number = (n, fallback, lo, hi) => n !== null && n !== '' && Number.isFinite(Number(n)) ? clamp(Number(n), lo, hi) : fallback;
    function defaults() {
        return { enabled: false, bands: [80, 400, 2500, 10000].map((frequency, index) => ({
            enabled: true, type: index === 0 ? 'lowshelf' : index === 3 ? 'highshelf' : 'bell', frequency, gain: 0, q: Math.SQRT1_2, slope: 12 })) };
    }
    function automation(value) {
        if (value == null) return null;
        if (value.version !== 1 || !Array.isArray(value.points) || value.points.length > 32768) throw new Error('Invalid EQ automation.');
        let previous = -1;
        const points = value.points.map(point => {
            if (!point || !Number.isFinite(point.phase) || point.phase < 0 || point.phase > 1 || point.phase <= previous) throw new Error('Invalid EQ automation position.');
            previous = point.phase;
            return { phase: point.phase, ...channel({ enabled: point.enabled, bands: point.bands }) };
        });
        if (points.length && (points.length < 2 || points[0].phase !== 0 || points.at(-1).phase !== 1)) throw new Error('Incomplete EQ automation.');
        return { version: 1, read: value.read === true, steps: number(value.steps, 16, 1, 64), points };
    }
    function channel(value) {
        if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('Invalid channel EQ settings.');
        if (value?.bands != null && (!Array.isArray(value.bands) || value.bands.length !== 4)) throw new Error('Channel EQ requires four bands.');
        const fallback = defaults();
        return { ...(value?.automation != null ? { automation: automation(value.automation) } : {}), enabled: value?.enabled === true, bands: fallback.bands.map((base, index) => {
            const band = value?.bands?.[index];
            if (band != null && (typeof band !== 'object' || Array.isArray(band))) throw new Error('Invalid EQ band.');
            return { enabled: band?.enabled !== false, type: TYPES.includes(band?.type) ? band.type : base.type,
                frequency: number(band?.frequency, base.frequency, 20, 20000), gain: number(band?.gain, 0, -24, 24),
                q: number(band?.q, base.q, .1, 18), slope: SLOPES.includes(band?.slope) ? band.slope : 12 };
        }) };
    }
    function normalize(value) {
        if (value != null && (value.version !== 1 || !value.channels || typeof value.channels !== 'object' || Array.isArray(value.channels))) throw new Error('Unsupported channel EQ version. Reload MYGRAIN.');
        return { version: 1, channels: Object.fromEntries(KEYS.map(key => [key, channel(value?.channels?.[key])])) };
    }
    // Robert Bristow-Johnson biquads. Shelves use alpha=sin(w)/(2Q), so Q
    // really changes their transition/resonance (native Web Audio shelf Q does not).
    function coefficients(type, frequency, gain, q, sampleRate) {
        const w = 2 * Math.PI * clamp(frequency, 5, sampleRate * .49) / sampleRate;
        const c = Math.cos(w), s = Math.sin(w), alpha = s / (2 * q), A = 10 ** (gain / 40), beta = 2 * Math.sqrt(A) * alpha;
        let b, a;
        if (type === 'bell') { b = [1 + alpha * A, -2 * c, 1 - alpha * A]; a = [1 + alpha / A, -2 * c, 1 - alpha / A]; }
        else if (type === 'lowshelf') {
            b = [A * ((A + 1) - (A - 1) * c + beta), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - beta)];
            a = [(A + 1) + (A - 1) * c + beta, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - beta];
        } else if (type === 'highshelf') {
            b = [A * ((A + 1) + (A - 1) * c + beta), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - beta)];
            a = [(A + 1) - (A - 1) * c + beta, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - beta];
        } else {
            b = type === 'highpass' ? [(1 + c) / 2, -(1 + c), (1 + c) / 2] : [(1 - c) / 2, 1 - c, (1 - c) / 2];
            a = [1 + alpha, -2 * c, 1 - alpha];
        }
        const scale = a[0]; return { b: b.map(n => n / scale), a: a.map(n => n / scale) };
    }
    function sections(band, sampleRate) {
        if (!band.enabled) return [];
        if (!['highpass', 'lowpass'].includes(band.type)) return Math.abs(band.gain) < 1e-8 ? [] : [coefficients(band.type, band.frequency, band.gain, band.q, sampleRate)];
        const count = band.slope / 12, order = count * 2;
        return Array.from({ length: count }, (_, index) => {
            const butterworth = 1 / (2 * Math.cos(Math.PI * (2 * index + 1) / (2 * order)));
            // Q=.707 is an exact Butterworth cutoff even for 96 dB/oct.
            return coefficients(band.type, band.frequency, 0, clamp(butterworth * (index === 0 ? band.q / Math.SQRT1_2 : 1), .05, 50), sampleRate);
        });
    }
    function response(value, frequencies, sampleRate = 48000, bypass = true) {
        const state = channel(value), filters = state.bands.flatMap(b => sections(b, sampleRate));
        return Array.from(frequencies, f => {
            if (bypass && !state.enabled) return 0;
            const w = 2 * Math.PI * Math.min(f, sampleRate * .4999) / sampleRate;
            const c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
            let db = 0;
            for (const { b, a } of filters) {
                const power = v => (v[0] + v[1] * c1 + v[2] * c2) ** 2 + (v[1] * s1 + v[2] * s2) ** 2;
                db += 10 * Math.log10(Math.max(1e-30, power(b)) / Math.max(1e-30, power(a)));
            }
            return db;
        });
    }
    function convertSnapshot(original) {
        const normalized = normalize(original.state?.modes?.channelEq);
        if (JSON.stringify(original.state?.modes?.channelEq) === JSON.stringify(normalized)) return { snapshot: original, changed: false };
        const snapshot = JSON.parse(JSON.stringify(original));
        snapshot.state.modes.channelEq = normalized;
        return { snapshot, changed: true };
    }
    function create() {
        let state = normalize(), watched = null;
        const overrides = new Map(), worklets = new WeakMap(), readyContexts = new WeakSet();
        const effective = key => overrides.get(key) || state.channels[key];
        const groups = new Set(), listeners = new Set();
        const emit = reason => { for (const fn of listeners) fn(reason); };
        const disconnect = (source, target) => { try { target ? source.disconnect(target) : source.disconnect(); } catch {} };
        function disposeWire(wire) {
            if (!wire) return;
            wire.processor?.port.close();
            for (const node of wire.nodes) disconnect(node);
        }
        function unmeter(group) {
            if (!group.analyser) return;
            disconnect(group.meterOutput, group.meterSplit); disconnect(group.meterSplit);
            for (const analyser of group.analysers) disconnect(analyser);
            group.analyser = group.analysers = group.meterSplit = group.meterOutput = group.spectrum = group.meterData = null;
        }
        function meter(group) {
            const want = watched === group.key && effective(group.key).enabled && group.wire && group.context.state === 'running';
            if (!want || group.meterOutput !== group.wire?.output) unmeter(group);
            if (!want || group.analyser) return;
            // Analyse L/R separately: a mono analyser would falsely hide
            // anti-phase stereo. Display the louder channel at each frequency.
            group.meterSplit = group.context.createChannelSplitter(2);
            group.analysers = [0, 1].map(index => {
                const analyser = group.context.createAnalyser(); analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = .75; analyser.minDecibels = -100; analyser.maxDecibels = 0;
                group.meterSplit.connect(analyser, index); return analyser;
            });
            group.analyser = group.analysers[0];
            group.spectrum = new Float32Array(group.analyser.frequencyBinCount);
            group.meterData = group.analysers.map(() => new Float32Array(group.spectrum.length));
            group.meterOutput = group.wire.output; group.meterOutput.connect(group.meterSplit);
        }
        function automationCoefficients(key, rate) {
            const value = effective(key), out = [];
            for (const band of value.bands) {
                const filters = value.enabled ? sections(band, rate) : [];
                for (let i = 0; i < 8; i++) {
                    const section = filters[i];
                    out.push(...(section ? [...section.b, section.a[1], section.a[2]] : [1, 0, 0, 0, 0]));
                }
            }
            return out;
        }
        function sendAutomation(group, initial = false) {
            group.wire?.processor?.port.postMessage({ initial, coefficients: automationCoefficients(group.key, group.context.sampleRate) });
        }
        async function loadProcessor(ctx) {
            if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false;
            if (!worklets.has(ctx)) worklets.set(ctx, ctx.audioWorklet.addModule(new URL('eq-automation-worklet.js?v=20261027-eq-crackle-2', document.baseURI).href));
            await worklets.get(ctx);
            readyContexts.add(ctx);
            return true;
        }
        async function prepareAutomation(key, context = null) {
            // Server/isolated renderers prewarm before any sources are scheduled.
            if (context) await loadProcessor(context);
            const selected = [...groups].filter(g => g.key === key && (!context || g.context === context));
            for (const group of selected) {
                const ctx = group.context;
                if (group.dynamicReady || !ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') continue;
                try {
                    if (!await loadProcessor(ctx)) continue;
                    if (!groups.has(group) || group.dynamicReady || ctx.state === 'closed') continue;
                    group.dynamicReady = true; update(group, false, true);
                } catch (error) { group.automationError = String(error.message || error); }
            }
        }
        function wireFor(group, enabled) {
            const ctx = group.context, input = ctx.createGain(), output = ctx.createGain(), nodes = [input, output];
            let tail = input;
            let processor = null;
            if (enabled && group.dynamicReady) {
                processor = new AudioWorkletNode(ctx, 'mygrain-eq-automation-v1', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
                processor.port.postMessage({ initial: true, coefficients: automationCoefficients(group.key, ctx.sampleRate) });
                nodes.push(processor); tail.connect(processor); tail = processor;
            } else if (enabled) for (const band of effective(group.key).bands) for (const { b, a } of sections(band, ctx.sampleRate)) {
                const filter = ctx.createIIRFilter(b, a); nodes.push(filter); tail.connect(filter); tail = filter;
            }
            tail.connect(output); output.connect(group.destination);
            return { input, output, nodes, enabled, processor };
        }
        function clearRetired(group) {
            for (const item of group.retired) {
                clearTimeout(item.timer);
                for (const source of item.sources) disconnect(source, item.wire.input);
                disposeWire(item.wire);
            }
            group.retired.clear();
        }
        function update(group, initial = false, automated = false) {
            const fade = automated ? .03 : .012;
            const enabled = effective(group.key).enabled, old = group.wire;
            if (old?.processor) { sendAutomation(group); meter(group); return; }
            if (!enabled && !old) { meter(group); return; }
            const offline = typeof group.context.startRendering === 'function', crossfade = !initial && !offline && group.context.state === 'running';
            const next = enabled || crossfade ? wireFor(group, enabled) : null;
            const now = group.context.currentTime, sources = [...group.links].map(link => link.source);
            if (next) next.output.gain.value = crossfade ? 0 : 1;
            group.wire = next;
            for (const source of sources) {
                if (!old) disconnect(source, group.destination);
                source.connect(next ? next.input : group.destination);
                if (old && !crossfade) disconnect(source, old.input);
            }
            if (crossfade) {
                // Initial dry routing has no nodes. Only this transition needs
                // a temporary dry branch; settled bypass returns to a direct edge.
                if (!old) {
                    const dry = wireFor(group, false);
                    for (const source of sources) source.connect(dry.input);
                    group.retired.add({ wire: dry, sources, timer: null });
                } else group.retired.add({ wire: old, sources, timer: null });
                next.output.gain.setValueAtTime(0, now); next.output.gain.linearRampToValueAtTime(1, now + fade);
                for (const item of group.retired) if (item.timer === null) {
                    const gain = item.wire.output.gain, held = gain.value;
                    // Capture/hold BEFORE cancelling: cancelling a partially
                    // completed fade first can reset its value and click.
                    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
                    else { gain.cancelScheduledValues(now); gain.setValueAtTime(held, now); }
                    item.wire.output.gain.linearRampToValueAtTime(0, now + fade);
                    item.timer = setTimeout(() => {
                        for (const source of item.sources) disconnect(source, item.wire.input);
                        disposeWire(item.wire); group.retired.delete(item);
                    }, fade * 1000 + 12);
                }
                if (!enabled) {
                    const timer = setTimeout(() => {
                        group.timers.delete(timer);
                        if (group.wire !== next) return;
                        for (const link of group.links) { link.source.connect(group.destination); disconnect(link.source, next.input); }
                        group.wire = null; unmeter(group); disposeWire(next);
                    }, fade * 1000 + 14);
                    group.timers.add(timer);
                }
            } else disposeWire(old);
            meter(group);
        }
        function releaseGroup(group) {
            for (const timer of group.timers) clearTimeout(timer);
            group.timers.clear(); clearRetired(group); unmeter(group); disposeWire(group.wire); group.wire = null; groups.delete(group);
        }
        const api = {
            settings: () => normalize(state), get: key => ({ ...channel({ ...effective(key), automation: null }), ...(state.channels[key].automation ? { automation: state.channels[key].automation } : {}) }),
            prepareAutomation,
            automate(key, value) {
                if (!['X', 'L'].includes(key)) return;
                const next = channel(value), previous = effective(key);
                overrides.set(key, next);
                prepareAutomation(key);
                if (JSON.stringify(next) !== JSON.stringify(previous)) for (const group of groups) if (group.key === key) update(group, false, true);
            },
            clearAutomationOverride(key) {
                if (!overrides.delete(key)) return;
                for (const group of groups) if (group.key === key) update(group);
                emit();
            },
            set(key, value) {
                if (!KEYS.includes(key)) throw new Error('Unknown EQ channel.');
                const next = channel(value);
                if (JSON.stringify(next) === JSON.stringify(state.channels[key])) return;
                overrides.delete(key);
                state.channels[key] = next;
                if (next.enabled) prepareAutomation(key);
                for (const group of groups) if (group.key === key) update(group);
                emit();
            },
            restore(value) {
                const next = normalize(value), changed = KEYS.filter(key => overrides.has(key) || JSON.stringify(next.channels[key]) !== JSON.stringify(state.channels[key]));
                overrides.clear();
                state = next;
                for (const key of changed) if (next.channels[key].enabled) prepareAutomation(key);
                for (const group of groups) if (changed.includes(group.key)) update(group);
                emit('restore');
            },
            connect(key, source, destination, owner = null) {
                if (!KEYS.includes(key)) throw new Error('Unknown EQ channel.');
                const context = source.context;
                let group = [...groups].find(g => g.key === key && g.context === context && g.destination === destination);
                if (!group) { group = { key, context, destination, dynamicReady: readyContexts.has(context), links: new Set(), wire: null, retired: new Set(), timers: new Set() }; groups.add(group); if (effective(key).enabled) update(group, true); }
                const link = { source, disposed: false }; group.links.add(link);
                source.connect(group.wire ? group.wire.input : destination); meter(group);
                if (effective(key).enabled || (['X','L'].includes(key) && root.mygrainEqAutomation?.info(key).write)) prepareAutomation(key, context);
                const route = { disconnect() {
                    if (link.disposed) return; link.disposed = true;
                    owner?.removeEventListener?.('ended', route.disconnect);
                    disconnect(source, group.wire ? group.wire.input : destination);
                    for (const item of group.retired) disconnect(source, item.wire.input);
                    group.links.delete(link);
                    if (!group.links.size) releaseGroup(group);
                } };
                owner?.addEventListener?.('ended', route.disconnect, { once: true });
                return route;
            },
            watch(key) { watched = key; for (const group of groups) meter(group); },
            spectra(key) {
                const out = [];
                for (const group of groups) if (group.key === key) { meter(group); if (group.analyser) { group.analysers.forEach((analyser, index) => analyser.getFloatFrequencyData(group.meterData[index])); for (let i = 0; i < group.spectrum.length; i++) group.spectrum[i] = Math.max(group.meterData[0][i], group.meterData[1][i]); out.push({ values: group.spectrum, sampleRate: group.context.sampleRate }); } }
                return out;
            },
            subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
            releaseContext(context) {
                for (const group of [...groups]) if (!context || group.context === context) {
                    for (const link of group.links) { disconnect(link.source, group.wire ? group.wire.input : group.destination); link.disposed = true; }
                    group.links.clear(); releaseGroup(group);
                }
            },
            diagnostics() { return { automated: [...groups].filter(g => g.wire?.processor).length, automationErrors: [...groups].filter(g => g.automationError).map(g => g.automationError), groups: groups.size, routes: [...groups].reduce((n, g) => n + g.links.size, 0), filters: [...groups].reduce((n, g) => n + (g.wire?.nodes.length || 2) - 2, 0), analysers: [...groups].reduce((n, g) => n + (g.analysers?.length || 0), 0), transitions: [...groups].reduce((n, g) => n + g.retired.size + g.timers.size, 0), watched,
                channels: Object.fromEntries(KEYS.map(key => [key, { routes: [...groups].filter(g => g.key === key).reduce((n, g) => n + g.links.size, 0), filters: [...groups].filter(g => g.key === key).reduce((n, g) => n + (g.wire?.nodes.length || 2) - 2, 0) }])) }; }
        };
        return api;
    }
    const exported = Object.freeze({ KEYS, TYPES, SLOPES, defaults, channel, automation, normalize, coefficients, sections, response, convertSnapshot, create });
    if (typeof module === 'object' && module.exports) module.exports = exported;
    else { root.MygrainChannelEq = exported; root.mygrainChannelEq = create(); }
})(typeof window === 'undefined' ? globalThis : window);
