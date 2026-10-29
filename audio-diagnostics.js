(function (root) {
    'use strict';

    const limits = { history: 180, events: 80, incidents: 5, delays: 120, sampleMs: 1000, historyMs: 10000 };

    function read(callback, fallback = null) {
        try { return callback() ?? fallback; } catch (error) { return fallback; }
    }

    function finite(value) {
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
    }

    function boundedPush(entries, entry, maximum) {
        entries.push(entry);
        if (entries.length > maximum) entries.splice(0, entries.length - maximum);
    }

    function describeEnvironment(host) {
        const navigator = host.navigator || {};
        const document = host.document || {};
        const userAgent = navigator.userAgent || 'unavailable';
        const appleMobile = /iPhone|iPad|iPod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const os = userAgent.match(/(?:CPU(?: iPhone)? OS|iPhone OS) ([\d_]+)/);
        const browser = userAgent.match(/(CriOS|FxiOS|EdgiOS|Edg|Chrome|Firefox|Version)\/([\d.]+)/);
        return {
            userAgent, platform: navigator.platform || 'unavailable', appleMobile,
            reportedIOS: os ? os[1].replace(/_/g, '.') : (appleMobile ? 'not reported in user agent' : 'not identified as iOS'),
            reportedBrowserVersion: browser ? `${browser[1]} ${browser[2]}` : 'not reported',
            standalone: navigator.standalone === true || read(() => host.matchMedia('(display-mode: standalone)').matches, false),
            visibility: document.visibilityState || 'unavailable', focused: read(() => document.hasFocus()),
            online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
            hardwareConcurrency: finite(navigator.hardwareConcurrency), deviceMemoryGB: finite(navigator.deviceMemory),
            maxTouchPoints: finite(navigator.maxTouchPoints), devicePixelRatio: finite(host.devicePixelRatio),
            screen: { width: finite(host.screen?.width), height: finite(host.screen?.height),
                orientation: host.screen?.orientation?.type || finite(host.orientation) },
            viewport: { width: finite(host.innerWidth), height: finite(host.innerHeight),
                visualWidth: finite(host.visualViewport?.width), visualHeight: finite(host.visualViewport?.height),
                scale: finite(host.visualViewport?.scale) },
            userActivation: { active: navigator.userActivation?.isActive ?? null, everActive: navigator.userActivation?.hasBeenActive ?? null },
            secureContext: typeof host.isSecureContext === 'boolean' ? host.isSecureContext : null,
            audioSession: { available: Boolean(navigator.audioSession), type: read(() => navigator.audioSession.type),
                state: read(() => navigator.audioSession.state) },
            mediaSessionPlaybackState: read(() => navigator.mediaSession.playbackState),
            connection: { available: Boolean(navigator.connection), effectiveType: read(() => navigator.connection.effectiveType),
                saveData: read(() => navigator.connection.saveData) },
            unavailable: ['Exact iPhone model', 'Device temperature / thermal throttling', 'Total process / native audio RAM',
                'Hardware audio underrun count', 'Speaker / Bluetooth output route unless exposed by the browser']
        };
    }

    function describeHeap(host) {
        const memory = read(() => host.performance.memory);
        if (!memory || finite(memory.usedJSHeapSize) === null) {
            return { available: false, note: 'JS heap API unavailable; decoded PCM estimates are partial, not total device RAM.' };
        }
        return { available: true, usedBytes: finite(memory.usedJSHeapSize), totalBytes: finite(memory.totalJSHeapSize),
            limitBytes: finite(memory.jsHeapSizeLimit), note: 'Browser-reported JS heap only; excludes native audio allocations.' };
    }

    function describeBuffers(entries = []) {
        const seen = new Set();
        const buffers = [];
        for (const [slot, buffer] of entries) {
            if (!buffer || seen.has(buffer)) continue;
            const frames = finite(buffer.length);
            const channels = finite(buffer.numberOfChannels);
            if (frames === null || channels === null) continue;
            seen.add(buffer);
            buffers.push({ slot, frames, channels, sampleRate: finite(buffer.sampleRate), seconds: finite(buffer.duration),
                bytes: frames * channels * 4 });
        }
        return { uniqueBuffers: buffers.length, estimatedPCMBytes: buffers.reduce((sum, buffer) => sum + buffer.bytes, 0),
            largest: buffers.sort((first, second) => second.bytes - first.bytes).slice(0, 8),
            note: 'Known decoded buffers only, deduplicated; excludes hidden caches, graph internals and browser/native overhead.' };
    }

    function describeMicrophones(streams = []) {
        return streams.flatMap(([source, stream]) => read(() => stream.getAudioTracks(), []).map(track => {
            const settings = read(() => track.getSettings(), {});
            return { source, readyState: track.readyState, enabled: track.enabled, muted: track.muted,
                settings: Object.fromEntries(['sampleRate', 'channelCount', 'latency', 'echoCancellation', 'noiseSuppression', 'autoGainControl']
                    .filter(key => settings[key] !== undefined).map(key => [key, settings[key]])) };
        }));
    }

    function createMonitor(options = {}) {
        const host = options.host || root;
        const now = options.now || (() => host.performance.now());
        const wallNow = options.wallNow || (() => Date.now());
        const getContext = options.getContext || (() => null);
        const getState = options.getState || (() => ({}));
        const startedAt = now();
        const history = [];
        const events = [];
        const incidents = [];
        const delays = [];
        const listeners = [];
        const contextIds = new WeakMap();
        const timing = { samples: 0, foregroundSamples: 0, delayedOver120ms: 0, maximumDelayMs: 0,
            audioClockStallSamples: 0, consecutiveClockStalls: 0, longestClockStallSamples: 0, maximumClockLagMs: 0,
            audioClockProgressRatio: null, minimumAudioClockProgressRatio: null,
            audioClockProgressWindowMs: 0, audioClockSlowWindows: 0 };
        const longTasks = { available: false, count: 0, totalMs: 0, maximumMs: 0 };
        let timer = null;
        let observer = null;
        let currentContext = null;
        let contextListener = null;
        let contextCount = 0;
        let contextCreatedAt = null;
        let previous = null;
        let clockWindow = null;
        let clockWasSlow = false;
        let lastHistoryAt = -Infinity;
        let sequence = 0;
        let contextTransitions = 0;
        let repeatedError = null;

        function record(type, details = {}) {
            if (type === 'error' || type === 'warn') {
                if (repeatedError?.type === type && repeatedError.message === details.message && now() - repeatedError.started < 1000) {
                    repeatedError.entry.count = (repeatedError.entry.count || 1) + 1;
                    repeatedError.entry.lastTimestamp = new Date(wallNow()).toISOString();
                    return;
                }
                repeatedError = { type, message: details.message, started: now(), entry: null };
            }
            const entry = { sequence: ++sequence, timestamp: new Date(wallNow()).toISOString(),
                uptimeSeconds: Math.round((now() - startedAt) / 100) / 10, type, ...details };
            boundedPush(events, entry, limits.events);
            if (type === 'error' || type === 'warn') repeatedError.entry = entry;
            read(() => options.onEvent?.(entry));
        }

        function observeContext() {
            const context = read(getContext);
            if (context === currentContext) return;
            if (currentContext && contextListener) read(() => currentContext.removeEventListener('statechange', contextListener));
            currentContext = context;
            previous = null;
            contextCreatedAt = now();
            if (!context) return;
            if (!contextIds.has(context)) contextIds.set(context, ++contextCount);
            record('audio-context-created', { contextId: contextIds.get(context), state: context.state, sampleRate: context.sampleRate });
            contextListener = () => {
                contextTransitions += 1;
                previous = null;
                record('audio-state', { contextId: contextIds.get(context), state: context.state, contextTime: finite(context.currentTime) });
            };
            read(() => context.addEventListener('statechange', contextListener));
        }

        function describeContext() {
            const context = read(getContext);
            if (!context) return { available: false, state: 'not-started' };
            const destination = context.destination;
            const output = read(() => context.getOutputTimestamp());
            const timestampValid = Boolean(output && output.contextTime > 0 && output.performanceTime > 0);
            return { available: true, id: contextIds.get(context) ?? null, contextsObserved: contextCount,
                ageSeconds: contextCreatedAt === null ? null : (now() - contextCreatedAt) / 1000,
                state: context.state, currentTime: finite(context.currentTime), sampleRate: finite(context.sampleRate),
                baseLatencyMs: finite(context.baseLatency) === null ? null : context.baseLatency * 1000,
                outputLatencyMs: finite(context.outputLatency) === null ? null : context.outputLatency * 1000,
                outputTimestamp: { available: typeof context.getOutputTimestamp === 'function', valid: timestampValid,
                    contextTime: finite(output?.contextTime), performanceTime: finite(output?.performanceTime),
                    ageMs: timestampValid ? now() - output.performanceTime : null,
                    renderAheadMs: timestampValid ? (context.currentTime - output.contextTime) * 1000 : null },
                destination: { channels: finite(destination?.channelCount), maxChannels: finite(destination?.maxChannelCount),
                    channelCountMode: destination?.channelCountMode || null, channelInterpretation: destination?.channelInterpretation || null },
                sinkType: read(() => typeof context.sinkId === 'object' ? context.sinkId.type : (context.sinkId === '' ? 'default' : null)),
                stateTransitions: contextTransitions };
        }

        function snapshot(includeHistory = true) {
            const sorted = delays.slice().sort((first, second) => first - second);
            return { schemaVersion: 1, build: options.build || 'unavailable', timestamp: new Date(wallNow()).toISOString(),
                pageUptimeSeconds: now() / 1000, monitorUptimeSeconds: (now() - startedAt) / 1000, monitorRunning: timer !== null,
                environment: describeEnvironment(host), audio: describeContext(), heap: describeHeap(host),
                timing: { ...timing, cadenceMs: limits.sampleMs, recentSamples: sorted.length,
                    recentP95DelayMs: sorted.length ? sorted[Math.floor((sorted.length - 1) * .95)] : null,
                    sinceLastProbeMs: previous ? now() - previous.instant : null,
                    lastProbe: previous ? { performanceTime: previous.instant, contextTime: previous.audioTime,
                        state: previous.state, visible: previous.visible } : null,
                    note: 'Foreground 1 Hz probe; audio/wall clock ratio over at least 5 seconds; not a hardware underrun detector.' },
                longTasks: { ...longTasks }, application: read(() => getState(true), { unavailable: true }),
                history: includeHistory ? history.slice() : [], events: includeHistory ? events.slice() : [],
                incidents: includeHistory ? incidents.slice() : [],
                retention: { cadenceMs: limits.sampleMs, historyEveryMs: limits.historyMs, historyLimit: limits.history,
                    eventLimit: limits.events, incidentLimit: limits.incidents } };
        }

        function sample() {
            observeContext();
            const instant = now();
            const visible = host.document?.visibilityState === 'visible';
            const audioTime = finite(currentContext?.currentTime);
            const state = currentContext?.state || 'not-started';
            timing.samples += 1;
            if (visible && previous?.visible && state === 'running' && previous.state === 'running') {
                const elapsed = instant - previous.instant;
                const delay = Math.max(0, elapsed - limits.sampleMs);
                boundedPush(delays, delay, limits.delays);
                timing.foregroundSamples += 1;
                timing.maximumDelayMs = Math.max(timing.maximumDelayMs, delay);
                if (delay > 120) {
                    timing.delayedOver120ms += 1;
                    record('main-thread-delay', { delayMs: Math.round(delay), contextTime: audioTime });
                }
                if (audioTime !== null && previous.audioTime !== null) {
                    const audioElapsedMs = (audioTime - previous.audioTime) * 1000;
                    timing.maximumClockLagMs = Math.max(timing.maximumClockLagMs, elapsed - audioElapsedMs);
                    // A clock advancing at 70% speed is not frozen. Measure a
                    // bounded foreground window using the existing probe only.
                    if (!clockWindow) clockWindow = previous;
                    const windowMs = instant - clockWindow.instant;
                    if (windowMs >= 5000) {
                        const ratio = Math.max(0, (audioTime - clockWindow.audioTime) * 1000 / windowMs);
                        timing.audioClockProgressRatio = Math.round(ratio * 1000) / 1000;
                        timing.minimumAudioClockProgressRatio = Math.min(timing.minimumAudioClockProgressRatio ?? ratio, ratio);
                        timing.audioClockProgressWindowMs = Math.round(windowMs);
                        const slow = ratio < .9;
                        if (slow) timing.audioClockSlowWindows += 1;
                        if (slow !== clockWasSlow) record(slow ? 'audio-clock-slow' : 'audio-clock-recovered', {
                            progressRatio: timing.audioClockProgressRatio, windowMs: Math.round(windowMs), contextTime: audioTime });
                        clockWasSlow = slow;
                        clockWindow = { instant, audioTime };
                    }
                    if (audioElapsedMs <= 1 && elapsed >= limits.sampleMs * .5) {
                        timing.audioClockStallSamples += 1;
                        timing.consecutiveClockStalls += 1;
                        timing.longestClockStallSamples = Math.max(timing.longestClockStallSamples, timing.consecutiveClockStalls);
                        if (timing.consecutiveClockStalls === 3) record('audio-clock-not-advancing', { state, contextTime: audioTime });
                    } else timing.consecutiveClockStalls = 0;
                }
            } else {
                timing.consecutiveClockStalls = 0;
                clockWindow = null;
                clockWasSlow = false;
                timing.audioClockProgressRatio = null;
                timing.audioClockProgressWindowMs = 0;
            }
            previous = { instant, audioTime, visible, state };
            if (instant - lastHistoryAt >= limits.historyMs) {
                lastHistoryAt = instant;
                const application = read(() => getState(true), {});
                boundedPush(history, { uptimeSeconds: Math.round((instant - startedAt) / 1000), visibility: host.document?.visibilityState || 'unavailable',
                    contextState: state, contextTime: audioTime, sampleRate: finite(currentContext?.sampleRate), heapUsedBytes: describeHeap(host).usedBytes ?? null,
                    maximumDelayMs: timing.maximumDelayMs, delayedOver120ms: timing.delayedOver120ms,
                    clockStalls: timing.audioClockStallSamples, clockProgressRatio: timing.audioClockProgressRatio,
                    clockSlowWindows: timing.audioClockSlowWindows, editor: application.editor, uiActivity: application.uiActivity,
                    counts: application.counts, caches: application.caches,
                    vuMeters: application.vuMeters, undoMemory: application.undoMemory, loopCuts: application.loopCuts,
                    idleAudio: application.idleAudio, processing: application.processing, effects: application.effects, panLab: application.panLab, wasp: application.wasp, visualResources: application.visualResources,
                    scheduling: application.scheduling, playback: application.playback, output: application.output,
                    knownPCMBytes: application.buffers?.estimatedPCMBytes ?? null,
                    knownBuffers: application.buffers?.uniqueBuffers ?? null }, limits.history);
                read(() => options.onHistory?.());
            }
            read(() => options.onSample?.());
        }

        function listen(target, type, callback) {
            if (!target?.addEventListener) return;
            target.addEventListener(type, callback);
            listeners.push([target, type, callback]);
        }

        function start() {
            if (timer !== null) return;
            for (const type of ['visibilitychange', 'freeze', 'resume']) {
                listen(host.document, type, () => { previous = null; record(type, { visibility: host.document.visibilityState }); });
            }
            for (const type of ['focus', 'blur', 'pageshow', 'pagehide', 'online', 'offline']) {
                listen(host, type, event => { previous = null; record(type, { persisted: event.persisted ?? null }); });
            }
            for (const type of ['resize', 'orientationchange']) {
                listen(host, type, () => record(type, { width: finite(host.innerWidth), height: finite(host.innerHeight) }));
            }
            listen(host.navigator?.mediaDevices, 'devicechange', () => record('media-device-change'));
            listen(host.navigator?.audioSession, 'statechange', () => record('audio-session', {
                state: read(() => host.navigator.audioSession.state), sessionType: read(() => host.navigator.audioSession.type) }));
            const supported = read(() => host.PerformanceObserver.supportedEntryTypes, []);
            if (supported.includes('longtask')) {
                observer = read(() => new host.PerformanceObserver(list => {
                    for (const entry of list.getEntries()) {
                        longTasks.count += 1;
                        longTasks.totalMs += entry.duration;
                        longTasks.maximumMs = Math.max(longTasks.maximumMs, entry.duration);
                    }
                }));
                if (observer) longTasks.available = read(() => { observer.observe({ type: 'longtask', buffered: false }); return true; }, false);
            }
            timer = host.setInterval(sample, limits.sampleMs);
            record('monitor-started');
            sample();
        }

        function stop() {
            if (timer !== null) host.clearInterval(timer);
            timer = null;
            for (const [target, type, callback] of listeners.splice(0)) target.removeEventListener(type, callback);
            if (currentContext && contextListener) read(() => currentContext.removeEventListener('statechange', contextListener));
            read(() => observer?.disconnect());
            observer = null;
            currentContext = null;
            previous = null;
        }

        function markProblem() {
            observeContext();
            record('user-marked-crackle');
            const capture = snapshot(false);
            capture.history = history.slice(-12);
            capture.events = events.slice(-20);
            // X keeps its own bounded before/after mark windows in the current
            // application trace. Do not replicate the full ring in every incident.
            if (capture.application?.loopX?.trace) {
                const trace = capture.application.loopX.trace;
                capture.application.loopX.trace = { version: trace.version, enabled: trace.enabled,
                    captured: trace.captured, reference: 'See current application.loopX.trace for X mark windows.' };
            }
            const incident = { timestamp: new Date(wallNow()).toISOString(), capture };
            boundedPush(incidents, incident, limits.incidents);
            return incident;
        }

        function clearHistory() {
            history.length = 0;
            events.length = 0;
            incidents.length = 0;
            delays.length = 0;
            repeatedError = null;
            for (const key of Object.keys(timing)) timing[key] = 0;
            longTasks.count = 0;
            longTasks.totalMs = 0;
            longTasks.maximumMs = 0;
            previous = null;
            lastHistoryAt = -Infinity;
            record('diagnostics-cleared');
        }

        return { start, stop, sample, record, observeContext, snapshot, markProblem, clearHistory };
    }

    function formatText(capture) {
        if (!capture) return 'Phone diagnostics unavailable.';
        const environment = capture.environment;
        const audio = capture.audio;
        const application = capture.application;
        const display = value => value === null || value === undefined ? 'unavailable' : String(value);
        const lines = ['', 'iPhone / Browser Diagnostics', `Build: ${capture.build} | captured ${capture.timestamp} | page uptime ${capture.pageUptimeSeconds.toFixed(1)}s`,
            `Platform: ${environment.platform} | Apple mobile=${environment.appleMobile} | reported iOS=${environment.reportedIOS} | browser=${environment.reportedBrowserVersion}`,
            `User agent: ${environment.userAgent}`,
            `Mode: standalone=${environment.standalone} visibility=${environment.visibility} focused=${display(environment.focused)} online=${display(environment.online)}`,
            `Browser activation: ${JSON.stringify(environment.userActivation)} secureContext=${display(environment.secureContext)} connection=${JSON.stringify(environment.connection)}`,
            `Device hints: cores=${display(environment.hardwareConcurrency)} memoryGB=${display(environment.deviceMemoryGB)} touch=${display(environment.maxTouchPoints)} DPR=${display(environment.devicePixelRatio)}`,
            `Screen/viewport: ${JSON.stringify({ screen: environment.screen, viewport: environment.viewport })}`,
            `Audio session: ${JSON.stringify(environment.audioSession)} | media=${display(environment.mediaSessionPlaybackState)}`,
            `Audio context: ${JSON.stringify(audio)}`,
            `Main thread / clock: ${JSON.stringify(capture.timing)}`,
            `Long tasks: ${JSON.stringify(capture.longTasks)}`,
            `Memory: ${JSON.stringify(capture.heap)}`,
            `Resources: ${JSON.stringify({ counts: application.counts, caches: application.caches,
                    vuMeters: application.vuMeters, undoMemory: application.undoMemory, loopCuts: application.loopCuts,
                    idleAudio: application.idleAudio, processing: application.processing, effects: application.effects, panLab: application.panLab, wasp: application.wasp, visualResources: application.visualResources, buffers: application.buffers })}`,
            `Playback / FX: ${JSON.stringify({ playback: application.playback, synth: application.synth, effects: application.effects })}`,
            `Loop X state / trace: ${JSON.stringify(application.loopX || null)}`,
            `Microphone tracks (no device IDs): ${JSON.stringify(application.microphones || [])}`,
            `Output sample: ${JSON.stringify(application.output)}`,
            `Scheduling counters: ${JSON.stringify(application.scheduling)}`,
            `Unavailable measurements: ${environment.unavailable.join('; ')}`,
            `Retention: ${JSON.stringify(capture.retention)}`, '', 'Recent phone/audio events:'];
        for (const entry of capture.events) lines.push(JSON.stringify(entry));
        lines.push('', '10-second resource timeline:');
        for (const entry of capture.history) lines.push(JSON.stringify(entry));
        lines.push('', 'Marked crackle snapshots:');
        if (!capture.incidents.length) lines.push('(none — press Mark Crackle while the fault is audible, then Copy Debug)');
        for (const incident of capture.incidents) lines.push(JSON.stringify(incident));
        return lines.join('\n');
    }

    const api = { createMonitor, describeEnvironment, describeHeap, describeBuffers, describeMicrophones, formatText, limits };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MygrainAudioDiagnostics = api;
})(typeof window !== 'undefined' ? window : globalThis);

// X-only, opt-in diagnostics. No PCM recording, network requests, persistent
// settings, audio destination connections, or work while disabled.
(function (root) {
    'use strict';
    function createXTrace(host) {
        const bounds = { events: 600, samples: 120, marks: 8, preMark: 48, postMark: 24, sessionMs: 900000,
            history: 900, health: 180, clickTimeline: 128, audioCues: 96 };
        let enabled = false, startedAt = null, timer = null, frame = null, observer = null, mutations = null;
        let activeCalls = [];
        let events = [], samples = [], marks = [], metrics = {}, dropped = 0, sequence = 0, listeners = [];
        let history = [], health = [], clickTimeline = [], audioCues = [], lastHealth = -Infinity;
        const columns = ['second', 'audio', 'notesScheduled', 'voicesEnded', 'cleanups', 'uiSyncs', 'lfoAttaches',
            'lfoEnsures', 'lfoResets', 'delayUpdates', 'sharedSaves', 'sharedUiSyncs', 'sharedModTicks', 'probes',
            'maxTimerDelayMs', 'maxFrameGapMs', 'mutations', 'maxVoiceRecords', 'maxXPeak', 'maxXRms',
            'maxXAdjacentDelta', 'maxCleanupMs', 'slowCalls', 'errors', 'maxProbeCostMs',
            'sharedDebugRefreshes', 'sharedVuRefreshes', 'sharedConsoleRenders'];
        const callColumns = { syncBastardLoopXUi: 5, attachBastardLoopXFilterLfoToVoice: 6,
            ensureBastardLoopXFilterLfoSource: 7, queueBastardLoopXFilterLfoReset: 8,
            destroyBastardLoopXFilterLfoSource: 8, updateBastardLoopXDelayBusSettings: 9,
            'saveState (shared)': 10, 'syncPerformanceControlState (shared)': 11, 'updateAudioModulationTick (shared)': 12,
            'updateDebugPanel (shared)': 25, 'updatePerformanceVuMeter (shared)': 26, 'renderDebugConsole (shared)': 27 };
        let lastTick = 0, lastAudio = 0, lastFrame = 0, frameCount = 0, worstFrame = 0, mutationCount = 0;
        let taps = [], lastScroll = 0, lastInput = new WeakMap(), moves = 0, wheels = 0;
        const now = () => performance.now();
        const safe = (fn, fallback = null) => { try { return fn() ?? fallback; } catch (_) { return fallback; } };
        const round = n => Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
        const stamp = () => ({ ms: round(now()), audio: round(safe(() => host.context().currentTime)), utc: new Date().toISOString() });
        const push = (list, item, max) => { list.push(item); if (list.length > max) { list.shift(); dropped++; } };
        function bucket() {
            const second = Math.floor((now() - startedAt) / 1000);
            if (!history.length || history[history.length - 1][0] !== second) {
                const row = Array(columns.length).fill(0); row[0] = second;
                row[1] = round(safe(() => host.context().currentTime)); push(history, row, bounds.history);
            }
            return history[history.length - 1];
        }
        // Never traverse native nodes, response bodies, buffers, event targets or arbitrary option objects.
        function summarize(value) {
            if (value == null || typeof value === 'boolean') return value;
            if (typeof value === 'number') return round(value);
            if (typeof value === 'string') return value.split('?')[0].slice(-160);
            if (Array.isArray(value)) return { arrayLength: value.length };
            if (typeof value.byteLength === 'number') return { byteLength: value.byteLength, kind: value.constructor?.name };
            if (typeof value.getChannelData === 'function') return { buffer: true, seconds: round(value.duration), sampleRate: value.sampleRate, channels: value.numberOfChannels, frames: value.length };
            if (value instanceof Error || (typeof value.message === 'string' && typeof value.stack === 'string')) return { name: value.name, error: value.message.slice(0, 240), stack: String(value.stack || '').slice(0, 1200) };
            const out = {};
            for (const key of ['note', 'rest', 'accent', 'slide', 'ratchet', 'role', 'fileName', 'sourceKey', 'start', 'end', 'duration', 'key', 'type', 'status', 'ok', 'levelScale', 'stepWindow']) {
                if (['string', 'number', 'boolean'].includes(typeof value[key])) out[key] = summarize(value[key]);
            }
            return out;
        }
        function record(type, detail = {}) {
            if (!enabled) return;
            const entry = { ...stamp(), type, callId: activeCalls[activeCalls.length - 1] || null, detail };
            const row = bucket();
            if (type === 'voice-scheduled') {
                row[2]++;
                for (const [kind, at] of [['note-start', detail.scheduled], ['expected-end', detail.expectedEnd]]) {
                    if (Number.isFinite(at)) push(audioCues, { kind, audio: at, note: detail.note }, bounds.audioCues);
                }
            }
            if (type === 'voice-ended') row[3]++;
            if (type === 'voice-cleanup') { row[4]++; row[21] = Math.max(row[21], detail.handlerMs || 0); }
            if (type === 'error' || type === 'rejection' || type === 'call-error') row[23]++;
            push(events, entry, bounds.events);
            for (const mark of marks) if (entry.ms > mark.ms && entry.ms <= mark.ms + 3000 && mark.after.length < bounds.postMark) mark.after.push(entry);
        }
        function disconnectTaps() {
            for (const tap of taps) { safe(() => tap.node.disconnect(tap.analyser)); safe(() => tap.analyser.disconnect()); }
            taps = [];
        }
        function meter() {
            const nodes = safe(host.nodes, []).filter(entry => entry.node && entry.node.context?.state !== 'closed');
            if (nodes.length !== taps.length || nodes.some((entry, i) => entry.node !== taps[i]?.node || entry.label !== taps[i]?.label)) {
                disconnectTaps();
                for (const entry of nodes) safe(() => {
                    // Overlap quarter-second probes at 44.1/48kHz instead of
                    // examining only 46ms and leaving most of the time unseen.
                    const analyser = entry.node.context.createAnalyser(); analyser.fftSize = 16384;
                    entry.node.connect(analyser); // Measurement leaf only: never connect back to any audible bus.
                    taps.push({ ...entry, analyser, data: new Float32Array(analyser.fftSize) });
                });
                record('meter-routing', { taps: taps.map(t => t.label), audibleReturn: false });
            }
            return taps.map(t => {
                t.analyser.getFloatTimeDomainData(t.data);
                let peak = 0, energy = 0, delta = 0, nonFinite = 0, sum = 0, clipped = 0, deltaFrame = 0;
                for (let i = 0; i < t.data.length; i++) {
                    const n = t.data[i]; if (!Number.isFinite(n)) { nonFinite++; continue; }
                    peak = Math.max(peak, Math.abs(n)); energy += n * n; sum += n;
                    if (Math.abs(n) >= 1) clipped++;
                    if (i && Number.isFinite(t.data[i - 1])) {
                        const jump = Math.abs(n - t.data[i - 1]);
                        if (jump > delta) { delta = jump; deltaFrame = i; }
                    }
                }
                return { tap: t.label, peak: Math.round(peak * 1e7) / 1e7, rms: Math.round(Math.sqrt(energy / t.data.length) * 1e7) / 1e7, maxAdjacentDelta: Math.round(delta * 1e7) / 1e7, nonFinite,
                    mean: Math.round(sum / t.data.length * 1e7) / 1e7, samplesAtOrAboveFullScale: clipped,
                    estimatedMaxDeltaAudio: round(t.node.context.currentTime - (t.data.length - deltaFrame) / t.node.context.sampleRate),
                    windowMs: round(1000 * t.data.length / t.node.context.sampleRate) };
            });
        }
        function tick() {
            if (!enabled) return;
            const t = now(), ctx = safe(host.context), audio = ctx?.currentTime;
            const sample = { ...stamp(), timerDelayMs: round(t - lastTick - 250), audioAdvanceMs: round((audio - lastAudio) * 1000),
                visibility: document.visibilityState, contextState: ctx?.state, frames: frameCount, pointerMoves: moves, wheelEvents: wheels, worstFrameMs: round(worstFrame), mutations: mutationCount,
                transport: safe(host.transport), meters: safe(meter, []) };
            push(samples, sample, bounds.samples);
            const row = bucket(); row[13]++; row[14] = Math.max(row[14], sample.timerDelayMs || 0);
            row[15] = Math.max(row[15], sample.worstFrameMs || 0); row[16] += mutationCount;
            row[17] = Math.max(row[17], sample.transport?.voices || 0);
            for (const meter of sample.meters) {
                row[18] = Math.max(row[18], meter.peak); row[19] = Math.max(row[19], meter.rms);
                row[20] = Math.max(row[20], meter.maxAdjacentDelta);
            }
            if (t - lastHealth >= 5000) {
                push(health, { ...stamp(), state: safe(host.health) }, bounds.health); lastHealth = t;
            }
            row[24] = Math.max(row[24], round(now() - t));
            frameCount = 0; moves = 0; wheels = 0; worstFrame = 0; mutationCount = 0; lastTick = t; lastAudio = audio;
            if (t - startedAt >= bounds.sessionMs) setEnabled(false);
        }
        function frames(t) {
            if (!enabled) return;
            if (lastFrame) worstFrame = Math.max(worstFrame, t - lastFrame);
            lastFrame = t; frameCount++; frame = requestAnimationFrame(frames);
        }
        function listen(target, type, callback, opts = { capture: true, passive: true }) {
            target.addEventListener(type, callback, opts); listeners.push(() => target.removeEventListener(type, callback, opts));
        }
        function setEnabled(value) {
            value = Boolean(value); if (value === enabled) return enabled;
            if (value) {
                events = []; samples = []; marks = []; metrics = {}; activeCalls = []; dropped = 0; sequence = 0;
                history = []; health = []; clickTimeline = []; audioCues = []; lastHealth = -Infinity;
                lastInput = new WeakMap(); lastScroll = 0; startedAt = now(); enabled = true;
                lastTick = startedAt; lastAudio = safe(() => host.context().currentTime); lastFrame = 0;
                frameCount = 0; moves = 0; wheels = 0; worstFrame = 0; mutationCount = 0;
                record('trace-start', { state: safe(host.state), bounds });
                const roots = safe(host.roots, []).filter(Boolean);
                const control = event => {
                    if (host.acceptEvent && !safe(() => host.acceptEvent(event), false)) return;
                    if (event.type === 'pointermove') { moves++; return; }
                    if (event.type === 'wheel') { wheels++; return; }
                    const target = event.target;
                    const identity = target.id || target.dataset?.stepIndex || target.dataset?.note || target.tagName;
                    const detail = { target: String(identity).slice(0, 100), event: event.type, value: summarize(target.value),
                        checked: target.checked, pointer: event.pointerType, key: event.key, trusted: event.isTrusted,
                        scrollTop: round(target.scrollTop), scrollHeight: target.scrollHeight, clientHeight: target.clientHeight };
                    if (event.type === 'scroll') { if (now() - lastScroll < 150) return; lastScroll = now(); }
                    if (event.type === 'input') { const previous = lastInput.get(target) || 0; if (now() - previous < 80) return; lastInput.set(target, now()); }
                    record('gui', detail);
                    if (event.type === 'change') queueMicrotask(() => { if (enabled) record('control-applied', { ...detail, value: summarize(target.value), transport: safe(host.transport) }); });
                };
                for (const el of roots) for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'pointermove', 'wheel', 'touchstart', 'touchend', 'touchcancel', 'click', 'input', 'change', 'keydown', 'scroll']) listen(el, type, control);
                mutations = new MutationObserver(records => { mutationCount += records.filter(r => !host.acceptEvent || safe(() => host.acceptEvent({ target: r.target }), false)).length; });
                for (const el of roots) mutations.observe(el, { childList: true, subtree: true, attributes: true, characterData: true });
                listen(root, 'error', e => record('error', { message: String(e.message).slice(0, 240) }));
                listen(root, 'unhandledrejection', e => record('rejection', { error: summarize(e.reason) }));
                listen(document, 'visibilitychange', () => record('visibility', { state: document.visibilityState }));
                if (root.PerformanceObserver) safe(() => {
                    observer = new PerformanceObserver(list => { for (const e of list.getEntries()) record('long-task', { startMs: round(e.startTime), durationMs: round(e.duration) }); });
                    observer.observe({ type: 'longtask', buffered: false });
                });
                timer = setInterval(tick, 250); frame = requestAnimationFrame(frames);
            } else {
                record('trace-stop'); enabled = false; clearInterval(timer); cancelAnimationFrame(frame);
                timer = null; frame = null; mutations?.disconnect(); observer?.disconnect(); mutations = null; observer = null;
                listeners.forEach(remove => remove()); listeners = []; disconnectTaps();
            }
            safe(() => host.onToggle(enabled)); return enabled;
        }
        function wrap(name, fn, verbose = true) {
            return function (...args) {
                if (!enabled) return fn.apply(this, args);
                const start = now(), id = ++sequence, parentId = activeCalls[activeCalls.length - 1] || null;
                activeCalls.push(id);
                const metric = metrics[name] || (metrics[name] = { calls: 0, totalMs: 0, maxMs: 0, errors: 0, pending: 0,
                    firstStartMs: round(start), lastStartMs: null, minIntervalMs: null, maxIntervalMs: null,
                    caller: String(new Error().stack || '').split('\n').slice(2, 6).join('\n').slice(0, 500) });
                if (metric.lastStartMs !== null) {
                    const gap = round(start - metric.lastStartMs);
                    metric.minIntervalMs = metric.minIntervalMs === null ? gap : Math.min(metric.minIntervalMs, gap);
                    metric.maxIntervalMs = metric.maxIntervalMs === null ? gap : Math.max(metric.maxIntervalMs, gap);
                }
                metric.lastStartMs = round(start);
                const column = callColumns[name]; if (column !== undefined) bucket()[column]++;
                metric.calls++;
                if (verbose) record('call', { id, parentId, name, args: args.slice(0, 5).map(summarize) });
                const finish = (error, result, async = false) => {
                    if (!enabled || metrics[name] !== metric) return;
                    const elapsed = now() - start;
                    if (async) metric.pending--;
                    else { metric.totalMs += elapsed; metric.maxMs = Math.max(metric.maxMs, elapsed); }
                    if (error) metric.errors++;
                    if (!async && elapsed > 8) bucket()[22]++;
                    if (verbose || error || elapsed > 8) record(error ? 'call-error' : async ? 'call-resolved' : 'call-end',
                        { id, parentId, name, args: error ? args.slice(0, 5).map(summarize) : undefined, elapsedMs: round(elapsed), error: error ? summarize(error) : undefined, result: summarize(result), async,
                            sample: async && /Sample/.test(name) ? safe(host.sampleState) : undefined });
                };
                try {
                    const result = fn.apply(this, args); finish(null, result);
                    if (result && typeof result.then === 'function') { metric.pending++; result.then(v => finish(null, v, true), e => finish(e, null, true)); }
                    return result;
                } catch (error) { finish(error); throw error; } finally { activeCalls.pop(); }
            };
        }
        function mark(label = 'audible-click') {
            if (!enabled) return false;
            const time = stamp(), previous = clickTimeline[clickTimeline.length - 1];
            const nearbyAudio = audioCues.map(cue => ({ ...cue, deltaMs: round((time.audio - cue.audio) * 1000) }))
                .filter(cue => Math.abs(cue.deltaMs) <= 3000).sort((a, b) => Math.abs(a.deltaMs) - Math.abs(b.deltaMs)).slice(0, 8);
            const recentCalls = Object.entries(metrics).filter(([name]) => callColumns[name] !== undefined)
                .map(([name, metric]) => ({ name, agoMs: round(time.ms - metric.lastStartMs) }));
            const timeline = { ...time, label, intervalMs: previous ? round(time.ms - previous.ms) : null,
                audioIntervalMs: previous ? round((time.audio - previous.audio) * 1000) : null, nearbyAudio, recentCalls };
            push(clickTimeline, timeline, bounds.clickTimeline);
            const entry = { ...timeline, state: safe(host.state), before: events.slice(-bounds.preMark), after: [] };
            push(marks, entry, bounds.marks); record('user-mark', { label }); return true;
        }
        function snapshot() {
            return { version: 2, enabled, startedAtMs: startedAt, captured: stamp(), bounds, dropped,
                metrics: JSON.parse(JSON.stringify(metrics)), events: events.slice(), samples: samples.slice(),
                history: { cadenceMs: 1000, columns, rows: history.map(row => row.slice()) },
                health: health.slice(), clickTimeline: clickTimeline.slice(),
                marks: marks.map(m => ({ ...m, before: m.before.slice(), after: m.after.slice() })),
                limitations: ['Meters are sampled X-only pre-delay windows, not continuous PCM or proof of an audible click.',
                    'Native hardware underruns and physical speaker output are not available.', 'Observer overhead can affect timing; compare trace on/off.',
                    'Click markers include human reaction time; nearby note/end times show correlation, not causation. History rows aggregate observed seconds; gaps are not interpolated.'] };
        }
        function clear() {
            events = []; samples = []; marks = []; metrics = {}; activeCalls = []; dropped = 0; sequence = 0;
            history = []; health = []; clickTimeline = []; audioCues = []; lastHealth = -Infinity;
            startedAt = enabled ? now() : null; lastTick = now(); lastAudio = safe(() => host.context().currentTime);
            frameCount = 0; worstFrame = 0; mutationCount = 0; moves = 0; wheels = 0;
        }
        return { get enabled() { return enabled; }, setEnabled, wrap, record, mark, snapshot, clear };
    }
    if (typeof module === 'object' && module.exports) module.exports.createXTrace = createXTrace;
    else root.MygrainXTrace = { create: createXTrace };
})(typeof window !== 'undefined' ? window : globalThis);
