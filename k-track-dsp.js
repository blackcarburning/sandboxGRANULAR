(function (root) {
    'use strict';
    // Each graph belongs to one audible K voice. No global FX bus or UI timers.
    function create(context, input, output, settings, bpm, destination) {
        const nodes = [], filters = [], oscillators = [];
        const own = node => (nodes.push(node), node);
        const gain = value => { const node = own(context.createGain()); node.gain.value = value; return node; };
        let tail = input, disposed = false, lfo = null, delay = null, delayCapacity = 0;
        const append = node => { tail.connect(node); tail = node; return node; };
        try {
            if (settings.filterMode !== 'bypass') {
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
            if (settings.delayMix > 0) {
                delayCapacity = Math.min(12, Math.max(.1, 60 / bpm * Number(settings.delayDivision)) + .05);
                delay = own(context.createDelay(delayCapacity));
                delay.delayTime.value = Math.min(11.9, 60 / bpm * Number(settings.delayDivision));
                const lowpass = own(context.createBiquadFilter()); lowpass.type = 'lowpass'; lowpass.frequency.value = settings.delayCutoff; lowpass.Q.value = .707;
                const feedback = gain(settings.delayFeedback), wet = gain(settings.delayMix);
                tail.connect(delay); delay.connect(lowpass); lowpass.connect(feedback); feedback.connect(delay);
                lowpass.connect(wet); wet.connect(mix);
            }
            if (settings.reverbMix > 0) {
                // Short bounded combs avoid five large IR buffers/convolution engines.
                for (const seconds of [.067, .079, .101, .127]) {
                    const comb = own(context.createDelay(.15)); comb.delayTime.value = seconds;
                    const lowpass = own(context.createBiquadFilter()); lowpass.type = 'lowpass'; lowpass.frequency.value = 6500; lowpass.Q.value = .707;
                    const feedback = gain(Math.min(.94, .001 ** (seconds / settings.reverbDecay))), wet = gain(settings.reverbMix / 4);
                    tail.connect(comb); comb.connect(lowpass); lowpass.connect(feedback); feedback.connect(comb);
                    lowpass.connect(wet); wet.connect(mix);
                }
            }
            mix.connect(output); output.connect(destination);
            if (filters.length && settings.lfoAmount > 0) {
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
                    for (const node of nodes) { try { node.disconnect(); } catch {} if (node.curve) node.curve = null; }
                }
            };
        } catch (error) {
            for (const oscillator of oscillators) try { oscillator.stop(); } catch {}
            for (const node of nodes) try { node.disconnect(); } catch {}
            throw error;
        }
    }
    if (typeof module === 'object' && module.exports) module.exports = { create };
    else root.MygrainKTrackDsp = Object.freeze({ create });
})(typeof window === 'undefined' ? globalThis : window);
