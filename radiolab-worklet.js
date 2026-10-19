class RadiolabPCMTap extends AudioWorkletProcessor {
    constructor() {
        super();
        this.active = true;
        this.capturing = false;
        this.pending = 0;
        this.overflow = false;
        this.port.onmessage = event => {
            if (event.data.type === 'dispose') this.active = false;
            if (event.data.type === 'capture') this.capturing = Boolean(event.data.enabled);
            if (event.data.type === 'ack') this.pending = Math.max(0, this.pending - 1);
        };
    }

    process(inputs, outputs) {
        for (const output of outputs) for (const channel of output) channel.fill(0);
        if (!this.active) return false;
        if (!this.capturing) return true;
        const input = inputs[0];
        if (!input?.[0]?.length) return true;
        if (this.pending >= 256) {
            if (!this.overflow) this.port.postMessage({ type: 'overflow' });
            this.overflow = true;
            return true;
        }
        const channels = [new Float32Array(input[0]), new Float32Array(input[1] || input[0])];
        this.pending += 1;
        this.port.postMessage({ type: 'pcm', channels }, channels.map(channel => channel.buffer));
        return true;
    }
}

registerProcessor('mygrain-radiolab-tap', RadiolabPCMTap);
