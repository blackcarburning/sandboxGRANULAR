/* L's private effects lane. Mirror the master controls, but never its room send.
 * The shared pan/compressor/recording bus remains downstream of both lanes. */
(() => {
    'use strict';
    class LReverbLane {
        constructor(context, output, targetFor, impulseFor, curveVersionFor) {
            this.context = context;
            this.output = output;
            this.targetFor = targetFor;
            this.impulseFor = impulseFor;
            this.curveVersionFor = curveVersionFor;
            this.mirrors = new Map();
            this.edges = [];
            this.modulationEdges = [];
            this.tailUntil = 0;
            this.auditionUntil = 0;
            this.lastNoteEnd = 0;
            this.tailSeconds = 0;
            this.input = context.createGain();
            this.roomOutput = context.createGain();
            this.roomSend = context.createGain();
            this.roomSend.gain.value = 0;
            this.roomPredelay = context.createDelay(.2);
            this.roomPredelay.delayTime.value = .018;
            this.roomTone = context.createBiquadFilter();
            this.roomTone.type = 'lowpass';
            this.roomWet = context.createGain();
            this.roomWet.gain.value = 0;
            this.gate = context.createGain();
            this.input.connect(this.roomOutput);
            this.input.connect(this.roomSend);
            this.roomSend.connect(this.roomPredelay);
            this.roomTone.connect(this.roomWet);
            this.roomWet.connect(this.roomOutput);
            this.gate.connect(output);
            this.owned = [this.input, this.roomOutput, this.roomSend, this.roomPredelay, this.roomTone, this.roomWet, this.gate];
        }

        mirror(source) {
            if (!source) throw new Error('L effects lane: missing master node');
            if (this.mirrors.has(source)) return this.mirrors.get(source).node;
            const ctx = this.context;
            let node;
            if ('frequency' in source && 'Q' in source) node = ctx.createBiquadFilter();
            else if ('delayTime' in source) node = ctx.createDelay(3.2);
            else if ('curve' in source) node = ctx.createWaveShaper();
            else if ('pan' in source) node = ctx.createStereoPanner();
            else if ('gain' in source) node = ctx.createGain();
            else throw new Error('L effects lane: unsupported master node');
            const binding = { node, params: new Map() };
            this.mirrors.set(source, binding);
            this.copy(source, binding, true);
            return node;
        }

        setParam(param, value, immediate = false) {
            const now = this.context.currentTime;
            param.cancelScheduledValues(now);
            if (immediate) param.setValueAtTime(value, now);
            else { param.setValueAtTime(param.value, now); param.linearRampToValueAtTime(value, now + .025); }
        }

        copy(source, binding, immediate = false) {
            const { node, params } = binding;
            if ('Q' in source && node.type !== source.type) node.type = source.type;
            if ('curve' in source) {
                // Web Audio returns a fresh array on every curve read. Track the
                // source's revision, not array identity, to avoid rebuilding DSP
                // and allocating large copies at every modulation tick.
                const revision = this.curveVersionFor(source);
                if (!binding.hasCurve || binding.curveRevision !== revision) {
                    node.curve = source.curve;
                    binding.curveRevision = revision;
                    binding.hasCurve = true;
                }
                if (node.oversample !== source.oversample) node.oversample = source.oversample;
            }
            for (const key of ['gain', 'frequency', 'Q', 'detune', 'delayTime', 'pan']) {
                if (!source[key]) continue;
                const value = this.targetFor(source[key]);
                if (params.get(key) === value) continue;
                params.set(key, value);
                this.setParam(node[key], value, immediate);
            }
        }

        // Only change owned edges; never disconnect a master node or a shared LFO.
        topology(key, build) {
            if (this.topologyKey === key) return;
            const edges = [];
            const edge = (from, to) => edges.push([from, to]);
            const chain = nodes => nodes.slice(1).forEach((node, i) => edge(nodes[i], node));
            build(edge, chain, source => this.mirror(source));
            const contains = (list, from, to) => list.some(pair => pair[0] === from && pair[1] === to);
            for (const [from, to] of this.edges) if (!contains(edges, from, to)) { try { from.disconnect(to); } catch (_) {} }
            for (const [from, to] of edges) if (!contains(this.edges, from, to)) from.connect(to);
            this.edges = edges;
            this.topologyKey = key;
        }

        modulate(source, destination) {
            if (this.modulationEdges.some(pair => pair[0] === source && pair[1] === destination)) return;
            source.connect(destination);
            this.modulationEdges.push([source, destination]);
        }

        setRoom(settings) {
            this.settings = settings;
            if (settings.mix > 0) {
                if (!this.room) {
                    this.room = this.context.createConvolver();
                    this.roomPredelay.connect(this.room);
                    this.room.connect(this.roomTone);
                    this.owned.push(this.room);
                }
                const key = `${settings.size}:${settings.decay}`;
                if (this.impulseKey !== key) {
                    // Slider drags are coalesced, not rebuilt by the modulation tick.
                    this.pendingImpulse = { key, size: settings.size, decay: settings.decay };
                    if (!this.room.buffer) this.flushImpulse();
                    else {
                        clearTimeout(this.impulseTimer);
                        this.impulseTimer = setTimeout(() => this.flushImpulse(), 100);
                    }
                }
            }
            this.setParam(this.roomSend.gain, settings.mix > 0 ? 1 : 0);
            this.setParam(this.roomWet.gain, settings.mix * (.68 + settings.size * .18));
            this.setParam(this.roomTone.frequency, settings.tone);
        }

        flushImpulse() {
            clearTimeout(this.impulseTimer);
            if (!this.pendingImpulse || !this.room) return;
            const { key, size, decay } = this.pendingImpulse;
            this.room.buffer = this.impulseFor(this.context, size, decay);
            this.impulseKey = key;
            this.pendingImpulse = null;
        }

        touch(end, audition = false) {
            this.lastNoteEnd = Math.max(this.lastNoteEnd, end);
            this.tailUntil = Math.max(this.tailUntil, end + this.tailSeconds);
            if (audition) this.auditionUntil = Math.max(this.auditionUntil, end + this.tailSeconds);
        }

        sync(enabled, soloGain, tailSeconds) {
            for (const [source, binding] of this.mirrors) this.copy(source, binding);
            this.tailSeconds = tailSeconds;
            if (this.lastNoteEnd > 0) this.tailUntil = Math.max(this.tailUntil, this.lastNoteEnd + tailSeconds);
            const level = (enabled || this.context.currentTime < this.auditionUntil) ? soloGain : 0;
            if (this.gateTarget !== level) { this.setParam(this.gate.gain, level); this.gateTarget = level; }
        }

        destroy() {
            clearTimeout(this.impulseTimer);
            for (const [source, param] of this.modulationEdges) { try { source.disconnect(param); } catch (_) {} }
            for (const { node } of this.mirrors.values()) node.disconnect();
            for (const node of this.owned) node.disconnect();
            this.mirrors.clear();
            this.edges = this.modulationEdges = [];
            this.tailUntil = this.auditionUntil = 0;
        }
    }
    window.MygrainLReverbLane = LReverbLane;
})();
