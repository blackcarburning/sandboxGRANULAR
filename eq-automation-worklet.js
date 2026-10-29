/* Persistent direct-form I RBJ EQ: coefficient glides preserve signal history. */
class MygrainEqAutomationProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.current = new Float64Array(32 * 5); this.target = new Float64Array(32 * 5);
        for (let i = 0; i < 32; i++) this.current[i * 5] = this.target[i * 5] = 1;
        this.states = [new Float64Array(128), new Float64Array(128)];
        this.remaining = 0; this.active = [0, 8, 16, 24];
        this.port.onmessage = ({ data }) => {
            if (!Array.isArray(data.coefficients) || data.coefficients.length !== 160 || !data.coefficients.every(Number.isFinite)) return;
            this.target.set(data.coefficients);
            if (data.initial) this.current.set(this.target);
            this.remaining = data.initial ? 0 : Math.max(1, Math.round(sampleRate * .02));
            const previousActive = this.active;
            this.active = [];
            for (let s = 0; s < 32; s++) {
                const j = s * 5;
                if (s % 8 === 0 || this.current[j] !== 1 || this.target[j] !== 1 || [1,2,3,4].some(k => this.current[j+k] !== 0 || this.target[j+k] !== 0)) {
                    // A newly introduced cut section inherits the upstream signal
                    // history, rather than starting a cold filter in a live signal.
                    if (!previousActive.includes(s) && s > 0) for (const state of this.states) {
                        const upstream = this.active.at(-1) * 4, z = s * 4;
                        state[z] = state[z+2] = state[upstream+2];
                        state[z+1] = state[z+3] = state[upstream+3];
                    }
                    this.active.push(s);
                }
            }
        };
    }
    process(inputs, outputs) {
        const input = inputs[0], output = outputs[0];
        for (let i = 0; i < output[0].length; i++) {
            if (this.remaining > 0) {
                for (const s of this.active) for (let k = s * 5; k < s * 5 + 5; k++) this.current[k] += (this.target[k] - this.current[k]) / this.remaining;
                this.remaining--;
            }
            for (let ch = 0; ch < output.length; ch++) {
                let value = (input[ch] || input[0])?.[i] || 0;
                const state = this.states[Math.min(ch, 1)], c = this.current;
                for (const s of this.active) {
                    const j = s * 5, z = s * 4;
                    const next = c[j] * value + c[j+1] * state[z] + c[j+2] * state[z+1]
                        - c[j+3] * state[z+2] - c[j+4] * state[z+3];
                    state[z+1] = state[z]; state[z] = value;
                    state[z+3] = state[z+2]; state[z+2] = next;
                    value = next;
                }
                output[ch][i] = Number.isFinite(value) ? value : 0;
            }
        }
        return true;
    }
}
registerProcessor('mygrain-eq-automation-v1', MygrainEqAutomationProcessor);
