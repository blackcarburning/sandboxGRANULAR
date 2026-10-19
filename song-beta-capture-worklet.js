class MygrainSongCapture extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.startFrame = options.processorOptions.startFrame;
        this.frames = options.processorOptions.frames;
        this.channels = [new Float32Array(this.frames), new Float32Array(this.frames)];
        this.finished = false;
    }

    process(inputs, outputs) {
        if (this.finished) return false;
        const blockLength = outputs[0][0].length;
        const first = Math.max(currentFrame, this.startFrame);
        const last = Math.min(currentFrame + blockLength, this.startFrame + this.frames);
        for (let channel = 0; channel < 2; channel += 1) {
            const input = inputs[0][channel] || inputs[0][0];
            if (input && last > first) this.channels[channel].set(input.subarray(first - currentFrame, last - currentFrame), first - this.startFrame);
        }
        if (currentFrame + blockLength >= this.startFrame + this.frames) {
            this.finished = true;
            const channels = this.channels.map(channel => channel.buffer);
            this.port.postMessage({ channels }, channels);
        }
        return !this.finished;
    }
}

registerProcessor('mygrain-song-capture-v1', MygrainSongCapture);
