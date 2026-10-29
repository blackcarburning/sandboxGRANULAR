import './noise-card-dsp.js?v=20261025-n-threshold-1';

// Input audio is detection-only. The only output is cents of filter modulation;
// it is connected exclusively to N's filter AudioParams, never to an audio bus.
class NoiseEnvelopeProcessor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [{ name: 'gate', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' }];
    }
    constructor(options) {
        super();
        this.env = new MygrainNoise.Envelope(sampleRate, options.processorOptions.settings);
        this.lfos = options.processorOptions.lfos;
        this.live = true;
        this.port.onmessage = ({ data }) => {
            if (data.dispose) { this.live = false; this.port.postMessage({ disposed: true }); return; }
            if (data.settings) this.env.configure(data.settings);
            if (data.lfos) this.lfos = data.lfos;
            if (data.trigger) this.pendingTrigger = data.strength || 1;
        };
    }
    process(inputs, outputs, parameters) {
        const out = outputs[0][0], input = inputs[0], settings = this.env.s;
        const index = settings.source === 'L1' ? 0 : settings.source === 'L2' ? 1 : settings.source === 'L3' ? 2 : -1;
        for (let i = 0; i < out.length; i++) {
            const time = (currentFrame + i) / sampleRate;
            const gate = parameters.gate.length === 1 ? parameters.gate[0] : parameters.gate[i];
            if (gate < .5) { this.wasActive = false; out[i] = 0; continue; }
            if (!this.wasActive) {
                this.env.value = 0; this.env.stage = 'idle'; this.env.detector = 0; this.env.armed = true; this.env.followOpen = false; this.env.until = 0;
                this.wasActive = true;
            }
            if (this.pendingTrigger) { this.env.trigger(time, this.pendingTrigger); this.pendingTrigger = 0; }
            // Detect L/R separately so anti-phase stereo does not disappear.
            let amplitude = 0;
            for (const channel of input) amplitude = Math.max(amplitude, Math.abs(channel[i] || 0));
            if (index >= 0) amplitude = Math.max(0, MygrainNoise.lfoValue(this.lfos, index, time));
            out[i] = this.env.sample(amplitude, time) * settings.amount * 1200;
        }
        return this.live;
    }
}
registerProcessor('mygrain-noise-envelope-v1', NoiseEnvelopeProcessor);
