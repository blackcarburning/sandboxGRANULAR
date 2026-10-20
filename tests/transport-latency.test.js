const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const baselinePath = path.join(__dirname, '../backups/transport-sync-20261018T145844Z/before/index.html');
const sourcePath = process.env.MYGRAIN_LATENCY_SOURCE || path.join(__dirname, '../index.html');

function extractFunction(html, name) {
    const header = new RegExp(`^        (?:async )?function ${name}\\(`, 'm');
    const match = header.exec(html);
    if (!match) throw new Error(`Missing application function: ${name}`);
    const closing = html.indexOf('\n        }', match.index);
    if (closing < 0) throw new Error(`Unclosed application function: ${name}`);
    return html.slice(match.index, closing + '\n        }'.length);
}

function collectSources(html, options = {}) {
    const names = [
        'setupEffects', 'makeDistortionCurve', 'makeFinalDistortionCurve', ...(html.includes('function makeFinalShimmerCurve(') ? ['makeFinalShimmerCurve'] : []),
        ...(html.includes('function configureDistortionStages(') ? ['configureDistortionStages', 'configureLegacyDistortion', 'configureFinalEffectInputs'] : []),
        'getActiveFilterStages', 'safeDisconnectNode', 'getFinalFxFilterSource', 'rebuildFilterChain',
        'configureLPFSlope', 'configureHPFSlope', 'rebuildFinalFxRouting',
        'shouldRouteDrumMachineDirectToOutput', 'getDrumMachineBusDestination', 'ensureDrumMachineBus',
        'ensureDrumMachineKickBypassBus', 'ensureDrumMachineDirectFxSends', 'getBastardLoopXPlaybackDestination',
        'updateDrumMachineMix', ...(html.includes('function getFinalReverbDrumSendAmount(') ? ['getFinalReverbDrumSendAmount'] : []), 'normalizeFinalCompressorSidechainSource',
        'getFinalCompressorReleaseSeconds', 'pruneFinalSidechainKickEvents', 'registerFinalSidechainKickTrigger',
        'getFinalKickSidechainDetector', 'getFinalCompressorSidechainDetector', 'shouldRouteKickAroundFinalCompressor',
        'scheduleDrumMachineRepeats'
    ];
    for (const match of html.matchAll(/^        (?:async )?function (\w+)\(/gm)) {
        if (/latency|compensation/i.test(match[1]) && !names.includes(match[1])) names.push(match[1]);
    }
    for (const name of ['resetTransportSynchronization', 'getTransportTimingDebug', 'flushTransportBypassDelay']) {
        if (html.includes(`function ${name}(`)) names.push(name);
    }
    const declarations = html.includes('function configureDistortionStages(') ? ['distortionRoutingStates = new WeakMap();', 'legacyDistortionBypassGain = null;', 'finalEffectInputState = null;'] : [];
    for (const match of html.matchAll(/^        (?:let|const|var) (\w*(?:latency|compensation)\w*|transportSync|finalKickBypassDelay)\s*=[\s\S]*?;(?=\n)/gim)) {
        declarations.push(match[0].trim().replace(/^(?:let|const|var) /, ''));
    }
    if (!options.raw && html.includes('function captureDrumSendFxState(')) {
        return require('./drum-parallel-fx-fixture.js').collectSources(html);
    }
    return { names, functions: names.map(name => extractFunction(html, name)), declarations };
}

function createFakeContext(sampleRate = 48000) {
    const nodes = [];
    function parameter(value = 0) {
        return {
            value,
            setValueAtTime(next) { this.value = next; },
            setTargetAtTime(next) { this.value = next; },
            linearRampToValueAtTime(next) { this.value = next; },
            exponentialRampToValueAtTime(next) { this.value = next; },
            cancelScheduledValues() {}, cancelAndHoldAtTime() {}
        };
    }
    function node(kind) {
        const created = {
            kind, connections: [], context: null,
            gain: parameter(1), frequency: parameter(440), Q: parameter(1), pan: parameter(),
            offset: parameter(1), delayTime: parameter(), threshold: parameter(-24), knee: parameter(30),
            ratio: parameter(12), attack: parameter(.003), release: parameter(.25),
            fftSize: 2048, frequencyBinCount: 1024,
            connect(destination, output = 0, input = 0) {
                if (!destination) throw new Error(`Missing destination for ${kind}`);
                this.connections.push({ destination, output, input });
                return destination;
            },
            disconnect(destination) {
                this.connections = destination ? this.connections.filter(edge => edge.destination !== destination) : [];
            },
            start() {}, stop() {}, setPeriodicWave() {}
        };
        nodes.push(created);
        return created;
    }
    const context = {
        sampleRate, currentTime: 0, state: 'running', nodes,
        createBuffer(channels, length, rate) {
            const data = Array.from({ length: channels }, () => new Float32Array(length));
            return { sampleRate: rate, length, numberOfChannels: channels, duration: length / rate,
                getChannelData: channel => data[channel] };
        }
    };
    for (const kind of ['Gain', 'StereoPanner', 'Analyser', 'ConstantSource', 'Oscillator',
        'DynamicsCompressor', 'WaveShaper', 'Convolver', 'BiquadFilter', 'Delay',
        'ChannelSplitter', 'ChannelMerger', 'BufferSource']) {
        context[`create${kind}`] = () => {
            const created = node(kind);
            created.context = context;
            return created;
        };
    }
    context.destination = node('Destination');
    return context;
}

function createFixture(sources, context, options = {}) {
    const controls = new Map();
    const messages = [];
    const defaults = { lfo3Waveform: 'sine', lfo3Rate: '30', lfo3Depth: '0', phaserRate: '30', tremoloRate: '120',
        finalReverbDrumSend: '100', finalCompressorRelease: '100' };
    const noop = () => {};
    const state = {
        audioContext: context, window: globalThis,
        console: { log: noop, warn: (...args) => messages.push({ kind: 'warning', args }), error: noop },
        setAudioStatus: (...args) => messages.push({ kind: 'audioStatus', args }),
        setTimeout: globalThis.setTimeout.bind(globalThis), clearTimeout: globalThis.clearTimeout.bind(globalThis),
        document: {
            querySelectorAll: () => [],
            getElementById(id) {
                if (!controls.has(id)) controls.set(id, { value: defaults[id] ?? '0', checked: false,
                    classList: { toggle: noop }, setAttribute: noop });
                return controls.get(id);
            }
        },
        lpfEnabled: false, hpfEnabled: false, lpfSlope: 12, hpfSlope: 12,
        finalFxPlacement: options.placement || 'post', drumMachineDirectOutput: options.direct !== false,
        drumMachineBusGainNode: null, drumMachineKickBypassGainNode: null,
        drumMachineDirectDelaySendGainNode: null, drumMachineDirectReverbSendGainNode: null,
        drumMachineDirectDelaySendEnabled: false, drumMachineDirectReverbSendEnabled: false,
        finalCompressorSidechainSource: 'off', finalSidechainKickEvents: [],
        FINAL_COMPRESSOR_SIDECHAIN_OPTIONS: ['off', 'lfo1', 'kick'].map(value => ({ value })),
        drumMachineExtraTracks: {}, drumMachineKickPattern: [true], drumMachineKickRatchetPattern: [1],
        getDrumMachineKickPlaybackLevel: () => .8, getDrumMachineKickPitchRatio: () => 1,
        getDrumMachineKickDecayValue: () => 1, getDrumMachineKickLengthValue: () => 1,
        playDrumMachineHit: noop,
        oscillatorsEnabled: false, granularLayersEnabled: false, MIX_HEADROOM: 1,
        getNativeOscillatorWaveform: () => 'sine', dbToLinear: value => Math.pow(10, value / 20),
        getMasterTrimDb: () => 0, getGranularTrimDb: () => 0, getOscModuleVolumeValue: () => 1,
        getDrumMachineOutputGain: () => 1, clampInternalLfoBpmValue: value => Number(value),
        drumMachineEnabled: true, drumMachineReverbTailUntil: 0,
        getModulatedValue: name => name === 'volume' ? 100 : Number(controls.get(name)?.value || 0),
        getSliderPercent: name => Number(controls.get(name)?.value || 0) / 100,
        getLoopLayerSoloGain: () => 1, getFinalFxPlacementSwitchDuck: () => 1,
        setStatus: noop, saveState: noop,
        getSharedBpmClockValue: () => 120,
        getSharedLoopTransportOriginTime: () => null,
        TRANSPORT_START_BUFFER_SECONDS: .18, SCHEDULE_AHEAD_TIME: .12,
        createFinalReverbImpulseForContext: target => target.createBuffer(2, 128, target.sampleRate),
        configureFinalReverbShimmerRouting: noop, syncOscSynthFilterControls: noop,
        createNoiseBuffers: noop, updateEffects: noop, syncFinalPanControlDisplays: noop,
        updateFinalOutputPanning: noop, syncFinalFxPlacementButton: noop, stopRetiredTransportVoices: noop,
        ...options.globals
    };
    const scope = new Proxy(state, {
        has: (target, name) => name !== Symbol.unscopables,
        get: (target, name) => name === Symbol.unscopables ? undefined : name in target ? target[name] : globalThis[name],
        set(target, name, value) { target[name] = value; return true; }
    });
    const code = `${sources.declarations.join('\n')}\n${sources.functions.join('\n')}\nreturn { ${sources.names.join(', ')} };`;
    const compile = options.compile || (body => new Function('scope', body));
    const functions = compile(`with (scope) { ${code} }`)(scope);
    return { state, functions, controls, context, messages };
}

function graphPaths(source, destination, visited = new Set()) {
    if (source === destination) return [[source]];
    if (!source || visited.has(source)) return [];
    const nextVisited = new Set(visited).add(source);
    return (source.connections || []).flatMap(edge => graphPaths(edge.destination, destination, nextVisited)
        .map(chain => [source, ...chain]));
}

async function setupFixture(html, sampleRate = 48000, options = {}) {
    const fixture = createFixture(collectSources(html), createFakeContext(sampleRate), {
        ...options, compile: body => vm.runInNewContext(`(function(scope) { ${body} })`)
    });
    await fixture.functions.setupEffects();
    fixture.functions.rebuildFinalFxRouting();
    return fixture;
}

module.exports = { baselinePath, sourcePath, extractFunction, collectSources, createFakeContext,
    createFixture, graphPaths, setupFixture };

if (require.main === module) {
    const html = fs.readFileSync(sourcePath, 'utf8');
    const before = fs.readFileSync(baselinePath, 'utf8');

    test('baseline fixture reproduces the actual five-shaper/compressor X path and undelayed drum bypass', async testContext => {
        testContext.diagnostic(JSON.stringify({ sourcePath,
            sourceSha256: crypto.createHash('sha256').update(html).digest('hex'),
            baselineSha256: crypto.createHash('sha256').update(before).digest('hex') }));
        const { state, functions } = await setupFixture(before);
        const processed = graphPaths(functions.getBastardLoopXPlaybackDestination(), state.finalAmplifierNode);
        assert.ok(processed.some(chain => chain.filter(node => node.kind === 'WaveShaper').length === 5));
        assert.ok(processed.some(chain => chain.includes(state.finalCompressorNode)));
        assert.equal(state.finalCompressorNode.ratio.value, 1);
        const bypass = graphPaths(functions.getDrumMachineBusDestination(), state.finalAmplifierNode);
        assert.ok(bypass.length > 0);
        assert.ok(bypass.every(chain => chain.every(node => !['Delay', 'WaveShaper', 'DynamicsCompressor'].includes(node.kind))));
    });

    for (const sampleRate of [44100, 48000]) {
        for (const placement of ['pre', 'post']) {
            test(`entire clean drum and kick bypass paths contain one configured delay at ${sampleRate}Hz, FX ${placement}`, async () => {
                const { state, functions } = await setupFixture(html, sampleRate, { placement });
                const drum = functions.ensureDrumMachineBus();
                const kick = functions.ensureDrumMachineKickBypassBus();
                for (const [label, source] of [['drums', drum], ['kick', kick]]) {
                    const chains = graphPaths(source, state.finalAmplifierNode);
                    assert.ok(chains.length > 0, `${label}: connected to final amplifier`);
                    const cleanChains = chains.filter(chain => !chain.includes(state.finalFxOutput)
                        && !chain.some(node => state.drumSendFxGraph?.nodes.includes(node)));
                    assert.ok(cleanChains.length > 0, `${label}: the clean path exists independently of wet sends`);
                    for (const chain of cleanChains) {
                        const delays = chain.filter(node => node.kind === 'Delay');
                        assert.equal(delays.length, 1, `${label}: exactly one compensation delay on clean output`);
                        assert.ok(delays[0].delayTime.value >= 0, `${label}: valid actual delay configuration`);
                        assert.ok(delays[0].delayTime.value < .1, `${label}: bounded compensation, not musical delay`);
                        assert.equal(state.transportSync.latency.status, 'unavailable', 'VM explicitly exercises unsupported offline calibration');
                        assert.equal(delays[0].delayTime.value, state.transportSync.latency.seconds,
                            `${label}: actual delay matches reported fallback rather than a hardcoded estimate`);
                        assert.equal(chain.some(node => ['WaveShaper', 'BiquadFilter', 'DynamicsCompressor'].includes(node.kind)), false,
                            `${label}: no processing added to clean drums`);
                    }
                }
                const directOff = functions.getBastardLoopXPlaybackDestination();
                state.drumMachineDirectOutput = false;
                functions.ensureDrumMachineBus();
                assert.equal(functions.getDrumMachineBusDestination(), directOff);
                assert.equal(drum.connectedTo, directOff, 'Direct Out off shares the processed X input');
                state.drumMachineDirectOutput = true;
                functions.ensureDrumMachineBus();
                assert.equal(drum.connectedTo, state.finalKickBypassMasterGain);
                const processed = graphPaths(directOff, state.finalAmplifierNode);
                assert.ok(processed.some(chain => chain.filter(node => node.kind === 'WaveShaper').length === 0));
                assert.equal(state.finalCompressorNode.ratio.value, 1);
                state.drumMachineDirectDelaySendEnabled = true;
                state.drumMachineDirectReverbSendEnabled = true;
                if (state.drumSendFxState) {
                    state.drumSendFxState.delay.enabled = true;
                    state.drumSendFxState.reverb.enabled = true;
                    state.drumSendFxState.delay.send = 100;
                    state.drumSendFxState.reverb.send = 100;
                }
                state.finalCompressorSidechainSource = 'kick';
                functions.updateDrumMachineMix();
                assert.equal(state.drumMachineDirectDelaySendGainNode.gain.value, 1, 'Direct Out on enables its explicit delay send');
                assert.equal(state.drumMachineDirectReverbSendGainNode.gain.value, 1, 'Direct Out on enables its explicit reverb send');
                state.drumMachineDirectOutput = false;
                functions.updateDrumMachineMix();
                assert.equal(drum.connectedTo, state.preFilterGainNode, 'ordinary drums use the processed path with Direct Out off');
                assert.equal(kick.connectedTo, state.finalKickBypassMasterGain, 'SC-kick bypass remains on the clean compensated path');
                assert.equal(state.drumMachineDirectDelaySendGainNode.gain.value, state.drumSendFxState ? 1 : 0,
                    'dedicated delay remains independent of Direct Out; legacy extra shared delay is disabled');
                assert.equal(state.drumMachineDirectReverbSendGainNode.gain.value, 1, 'explicit reverb send remains available with Direct Out off');
                assert.equal(graphPaths(kick, state.finalDelayNode).length, 0, 'SC-kick bypass has no unintended direct-delay injection');
                if (state.drumSendFxGraph) {
                    assert.equal(graphPaths(kick, state.finalReverbPreDelay).length, 0, 'dedicated reverb never injects into the main shared room');
                    assert.ok(graphPaths(kick, state.drumSendFxGraph.predelay).length > 0, 'SC-kick reaches its independent room');
                    assert.ok(graphPaths(kick, state.drumSendFxGraph.delay).length > 0, 'SC-kick reaches its independent delay');
                } else {
                    assert.ok(graphPaths(kick, state.finalReverbPreDelay).length > 0, 'SC-kick bypass retains its explicit reverb send');
                }
            });
        }
    }

    test('unavailable calibration stays explicit, uncached, and retryable without guessing a component delay', async () => {
        let constructions = 0;
        class UnavailableOfflineContext {
            constructor() {
                constructions += 1;
                throw new Error('offline rendering intentionally unavailable');
            }
        }
        const { state, functions, context, messages } = await setupFixture(html, 44100, {
            globals: { window: { OfflineAudioContext: UnavailableOfflineContext } }
        });
        const firstAttempt = constructions;
        assert.ok(firstAttempt > 0);
        assert.equal(state.transportLatencyCache.size, 0, 'failed probes do not poison the successful-calibration cache');
        assert.equal(state.transportSync.latency.status, 'unavailable');
        assert.match(state.transportSync.latency.reason, /intentionally unavailable/);
        assert.equal(await functions.ensureTransportLatencyReady(context), false);
        assert.ok(constructions > firstAttempt, 'next attempt really retries the offline renderer');
        assert.equal(state.finalKickBypassDelay.delayTime.value, state.transportSync.latency.seconds);
        assert.equal(functions.getTransportTimingDebug().latency.status, 'unavailable');
        assert.equal(functions.getTransportOutputLatencySeconds(), 0, 'capture getter must not claim a measured latency on failed calibration');
        assert.ok(messages.some(message => message.kind === 'audioStatus' && message.args[1] === 'error' &&
            /unavailable|not aligned/i.test(message.args[0])), 'a failed zero-delay fallback is visibly reported, not ignored');
        assert.ok(messages.some(message => message.kind === 'warning'), 'calibration failure is also diagnosable in the console');
    });

    test('rebuilt contexts replace and disconnect their compensation node; stale probes cannot update the new graph', async () => {
        const { state, functions, context } = await setupFixture(html);
        const oldDelay = state.finalKickBypassDelay;
        const replacement = createFakeContext(44100);
        state.audioContext = replacement;
        await functions.setupEffects();
        assert.notEqual(state.finalKickBypassDelay, oldDelay);
        assert.equal(oldDelay.connections.length, 0, 'the old context compensation node is disconnected');
        assert.equal(state.finalKickBypassDelay.context, replacement);
        const newDelay = state.finalKickBypassDelay;
        const currentTiming = state.transportSync.latency;
        context.state = 'closed';
        assert.equal(await functions.ensureTransportLatencyReady(context), false);
        assert.equal(state.finalKickBypassDelay, newDelay);
        assert.equal(state.transportSync.latency, currentTiming, 'stale completion cannot overwrite replacement-context metadata');
        functions.flushTransportBypassDelay();
        assert.equal(newDelay.connections.length, 0, 'stop/reset flushing discards the previous delay tail');
        assert.notEqual(state.finalKickBypassDelay, newDelay);
        const flushedDelay = state.finalKickBypassDelay;
        assert.equal(flushedDelay.delayTime.value, functions.getTransportOutputLatencySeconds());
        assert.equal(state.finalKickBypassMasterGain.connections.filter(edge => edge.destination.kind === 'Delay').length, 1,
            'flushing cannot leave a parallel stale-delay output connected');
        functions.resetTransportSynchronization();
        assert.equal(flushedDelay.connections.length, 0);
        assert.equal(state.finalKickBypassDelay, null);
        assert.equal(state.transportSync.latency.status, 'pending');
    });

    test('an in-flight old-context renderer failure cannot alter the new graph or poison a same-rate retry', async () => {
        const rejectRenders = [];
        class PendingOfflineContext {
            constructor(channels, frameCount, sampleRate) {
                const offline = createFakeContext(sampleRate);
                offline.startRendering = () => new Promise((resolve, reject) => rejectRenders.push(reject));
                return offline;
            }
        }
        const original = createFakeContext(48000);
        const fixture = createFixture(collectSources(html), original, {
            compile: body => vm.runInNewContext(`(function(scope) { ${body} })`),
            globals: { window: { OfflineAudioContext: PendingOfflineContext } }
        });
        const pending = fixture.functions.ensureTransportLatencyReady(original);
        assert.equal(rejectRenders.length, 4, 'the real calibration helper started independent output/2x-stage impulse and silence probes');
        original.state = 'closed';
        const replacement = createFakeContext(44100);
        fixture.state.audioContext = replacement;
        const replacementDelay = replacement.createDelay(.25);
        fixture.state.finalKickBypassDelay = replacementDelay;
        const replacementTiming = { status: 'pending', sampleRate: 44100, seconds: 0, frames: 0 };
        fixture.state.transportSync.latency = replacementTiming;
        rejectRenders.forEach(reject => reject(new Error('old offline context was discarded')));
        assert.equal(await pending, false);
        assert.equal(fixture.state.transportSync.latency, replacementTiming);
        assert.equal(fixture.state.finalKickBypassDelay, replacementDelay);
        assert.equal(replacementDelay.delayTime.value, 0);
        assert.equal(fixture.messages.length, 0, 'an obsolete calibration does not report a failure against the replacement engine');
        const sameRateReplacement = createFakeContext(48000);
        fixture.state.audioContext = sameRateReplacement;
        const retry = fixture.functions.ensureTransportLatencyReady(sameRateReplacement);
        const retryProbeCount = rejectRenders.length - 4;
        rejectRenders.slice(4).forEach(reject => reject(new Error('replacement probe failure')));
        assert.equal(await retry, false);
        assert.equal(retryProbeCount, 4,
            'a discarded failed calibration must start four fresh probes for the next same-rate context');
        assert.equal(fixture.state.transportLatencyCache.has(48000), false,
            'a failed replacement calibration must remain uncached and retryable');
    });
}
