(function (root) {
    'use strict';
    // Reuse Loop L's Hall texture, never its whole master/room routing. Buffer-only
    // sharing keeps every track's convolver private and bounds idle cache storage.
    const rooms = new WeakMap();
    const MAX_ROOM_BYTES = 8 * 1024 * 1024;
    function roomImpulse(context, seconds, impulseFor) {
        let cache = rooms.get(context);
        if (!cache) { cache = new Map(); rooms.set(context, cache); }
        const key = Math.round(Math.max(.2, Math.min(4, Number(seconds) || 1.2)) * 100) / 100;
        if (cache.has(key)) { const buffer = cache.get(key); cache.delete(key); cache.set(key, buffer); return buffer; }
        if (typeof impulseFor !== 'function') throw new Error('K Hall reverb is not ready. Reload MYGRAIN.');
        const buffer = impulseFor(context, .45, (key - .2) / 3.8, 'hall', key);
        cache.set(key, buffer);
        let bytes = [...cache.values()].reduce((sum, item) => sum + item.length * item.numberOfChannels * 4, 0);
        // Keep enough for five distinct maximum tails even at high sample rates.
        const budget = Math.max(MAX_ROOM_BYTES, (context.sampleRate || 48000) * 20 * 2 * 4);
        while (cache.size > 8 || bytes > budget) {
            const oldest = cache.keys().next().value, item = cache.get(oldest);
            bytes -= item.length * item.numberOfChannels * 4; cache.delete(oldest);
        }
        return buffer;
    }
    function prepare(context, settings, impulseFor = root.createFinalReverbImpulseForContext) {
        if (root.mygrainLoopFx) return null;
        return settings.reverbMix > 0 ? roomImpulse(context, settings.reverbDecay, impulseFor) : null;
    }
    // Each graph belongs to one audible K voice. No global FX bus or UI timers.
    function create(context, input, output, settings, bpm, destination, impulseFor = root.createFinalReverbImpulseForContext, preparedRoom = null, eqKey = null) {
        const nodes = [], filters = [], oscillators = [];
        const own = node => (nodes.push(node), node);
        const gain = value => { const node = own(context.createGain()); node.gain.value = value; return node; };
        // Own a preflighted room immediately, including failures before its branch.
        if (preparedRoom) own(preparedRoom);
        let tail = input, disposed = false, lfo = null, delay = null, delayCapacity = 0;
        const append = node => { tail.connect(node); tail = node; return node; };
        try {
            const common = root.mygrainLoopFx && eqKey;
            if (common && settings.envelope > 0) {
                const config=root.mygrainLoopFx.channel(eqKey);
                const filter=append(own(context.createBiquadFilter()));
                filter.type=config.filterType;filter.frequency.value=config.cutoff;filter.Q.value=.707;filters.push(filter);
                settings={...settings,cutoff:config.cutoff};
            }
            if (!common && settings.filterMode !== 'bypass') {
                const [type, slope] = settings.filterMode.split('-');
                for (let stage = 0; stage < Math.max(1, Number(slope) / 12); stage++) {
                    const filter = append(own(context.createBiquadFilter()));
                    filter.type = type; filter.frequency.value = settings.cutoff;
                    // A steep cascade must not multiply high-Q boosts into clipping.
                    filter.Q.value = stage === 0 ? settings.resonance : .707;
                    filters.push(filter);
                }
            }
            if (settings.drive > 0) {
                const shaper = own(context.createWaveShaper()), curve = new Float32Array(257);
                const amount = 10 ** (settings.drive / 20);
                for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 128 - 1) * amount) / Math.sqrt(amount);
                shaper.curve = curve; shaper.oversample = 'none'; append(shaper);
            }
            // Dry signal remains unity at zero mixes; all wet feeds are local and bounded.
            const mix = gain(1); tail.connect(mix);
            if (!common && settings.delayMix > 0) {
                delayCapacity = Math.min(12, Math.max(.1, 60 / bpm * Number(settings.delayDivision)) + .05);
                delay = own(context.createDelay(delayCapacity));
                delay.delayTime.value = Math.min(11.9, 60 / bpm * Number(settings.delayDivision));
                const lowpass = own(context.createBiquadFilter()); lowpass.type = 'lowpass'; lowpass.frequency.value = settings.delayCutoff; lowpass.Q.value = .707;
                const feedback = gain(settings.delayFeedback), wet = gain(settings.delayMix);
                tail.connect(delay); delay.connect(lowpass); lowpass.connect(feedback); feedback.connect(delay);
                lowpass.connect(wet); wet.connect(mix);
            }
            if (!common && settings.reverbMix > 0) {
                // Same feed-forward room branch as Loop L: no reverb feedback loop.
                const predelay = own(context.createDelay(.05)); predelay.delayTime.value = .018;
                const room = preparedRoom || own(context.createConvolver());
                if (!preparedRoom) room.buffer = prepare(context, settings, impulseFor);
                const tone = own(context.createBiquadFilter()); tone.type = 'lowpass'; tone.frequency.value = 6400; tone.Q.value = .707;
                const wet = gain(settings.reverbMix * (.68 + .45 * .18));
                tail.connect(predelay); predelay.connect(room); room.connect(tone); tone.connect(wet); wet.connect(mix);
            }
            mix.connect(output);
            const eqRoute = eqKey && root.mygrainChannelEq ? root.mygrainChannelEq.connect(eqKey, output, destination) : null;
            if (eqRoute) nodes.push(eqRoute); else output.connect(destination);
            if (!common && filters.length && settings.lfoAmount > 0) {
                lfo = own(context.createOscillator()); oscillators.push(lfo);
                lfo.type = settings.lfoWave === 'ramp' ? 'sawtooth' : settings.lfoWave;
                lfo.frequency.value = bpm / 60 / Number(settings.lfoDivision);
                const polarity = (settings.lfoInvert ? -1 : 1) * (settings.lfoWave === 'ramp' ? -1 : 1);
                const depth = gain((settings.cutoff - 50) * settings.lfoAmount * .5 * polarity);
                lfo.connect(depth); for (const filter of filters) depth.connect(filter.frequency);
            }
            return { filters, output, nodes,
                start(time, cycle) {
                    if (lfo) lfo.start(time);
                    if (filters.length && settings.envelope > 0) {
                        const peak = Math.max(300, Math.min(18000, Math.round(Math.max(300, settings.cutoff) * 2 ** (settings.envelope * 4))));
                        const decay = settings.envelopeDecay === null ? Math.max(.06, Math.min(Math.max(.2, cycle * .18), 1.4)) : settings.envelopeDecay;
                        for (const filter of filters) {
                            filter.frequency.setValueAtTime(peak, time);
                            filter.frequency.linearRampToValueAtTime(settings.cutoff, time + decay);
                        }
                    }
                },
                tempo(value) {
                    if (disposed) return;
                    if (lfo) lfo.frequency.setTargetAtTime(value / 60 / Number(settings.lfoDivision), context.currentTime, .015);
                    if (delay && Math.min(11.9, 60 / value * Number(settings.delayDivision)) > delayCapacity) return false;
                    if (delay) delay.delayTime.setTargetAtTime(Math.min(11.9, 60 / value * Number(settings.delayDivision)), context.currentTime, .03);
                },
                dispose() {
                    if (disposed) return; disposed = true;
                    for (const oscillator of oscillators) try { oscillator.stop(); } catch {}
                    for (const node of nodes) { try { node.disconnect(); } catch {} if (node.curve) node.curve = null; if ('buffer' in node) node.buffer = null; }
                }
            };
        } catch (error) {
            for (const oscillator of oscillators) try { oscillator.stop(); } catch {}
            for (const node of nodes) { try { node.disconnect(); } catch {} if (node.curve) node.curve = null; if ('buffer' in node) node.buffer = null; }
            throw error;
        }
    }
    if (typeof module === 'object' && module.exports) module.exports = { create, prepare };
    else root.MygrainKTrackDsp = Object.freeze({ create, prepare });
})(typeof window === 'undefined' ? globalThis : window);
