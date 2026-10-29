(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MygrainDrumTone = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function cutoffHz(percent, maximum = 20000) {
        const value = Math.max(0, Math.min(100, Number(percent) || 0));
        return 20 * Math.pow(maximum / 20, value / 100);
    }

    function connect(context, input, destination, options = {}) {
        const finish = source => typeof options.connectOutput === 'function' ? options.connectOutput(source, destination) : source.connect(destination);
        const cutoff = Math.max(0, Math.min(100, Number(options.cutoff ?? 100)));
        const envelope = options.accent ? Math.max(0, Math.min(1, Number(options.envAmount) || 0)) : 0;
        if (cutoff >= 100 && envelope === 0) {
            finish(input);
            return [];
        }
        const maximum = Math.min(20000, context.sampleRate * .45);
        const base = cutoffHz(cutoff, maximum);
        const peak = base * Math.pow(maximum / base, envelope);
        const start = Math.max(0, Number(options.start) || 0);
        const attack = Math.min(.003, Math.max(.001, (options.duration || .1) * .05));
        const end = start + Math.max(attack + .006, Number(options.duration) || .1);
        const filters = [];
        let previous = input;
        const stages = globalThis.mygrainPower?.isLive(context) ? 1 : 4;
        for (let stage = 0; stage < stages; stage += 1) {
            const filter = context.createBiquadFilter();
            filter.type = 'lowpass';
            filter.Q.value = 20 * Math.log10(1 / (2 * Math.cos((2 * stage + 1) * Math.PI / (4 * stages))));
            filter.frequency.setValueAtTime(base, start);
            if (peak > base) {
                filter.frequency.exponentialRampToValueAtTime(peak, start + attack);
                filter.frequency.exponentialRampToValueAtTime(base, end);
            }
            previous.connect(filter);
            previous = filter;
            filters.push(filter);
        }
        finish(previous);
        return filters;
    }

    return { cutoffHz, connect };
});
