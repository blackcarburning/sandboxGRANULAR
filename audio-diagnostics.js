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
            audioClockStallSamples: 0, consecutiveClockStalls: 0, longestClockStallSamples: 0, maximumClockLagMs: 0 };
        const longTasks = { available: false, count: 0, totalMs: 0, maximumMs: 0 };
        let timer = null;
        let observer = null;
        let currentContext = null;
        let contextListener = null;
        let contextCount = 0;
        let contextCreatedAt = null;
        let previous = null;
        let lastHistoryAt = -Infinity;
        let sequence = 0;
        let contextTransitions = 0;

        function record(type, details = {}) {
            const entry = { sequence: ++sequence, timestamp: new Date(wallNow()).toISOString(),
                uptimeSeconds: Math.round((now() - startedAt) / 100) / 10, type, ...details };
            boundedPush(events, entry, limits.events);
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
                    note: 'Foreground 1 Hz main-thread lateness/clock probe; not a hardware underrun detector.' },
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
                    if (audioElapsedMs <= 1 && elapsed >= limits.sampleMs * .5) {
                        timing.audioClockStallSamples += 1;
                        timing.consecutiveClockStalls += 1;
                        timing.longestClockStallSamples = Math.max(timing.longestClockStallSamples, timing.consecutiveClockStalls);
                        if (timing.consecutiveClockStalls === 3) record('audio-clock-not-advancing', { state, contextTime: audioTime });
                    } else timing.consecutiveClockStalls = 0;
                }
            } else timing.consecutiveClockStalls = 0;
            previous = { instant, audioTime, visible, state };
            if (instant - lastHistoryAt >= limits.historyMs) {
                lastHistoryAt = instant;
                const application = read(() => getState(true), {});
                boundedPush(history, { uptimeSeconds: Math.round((instant - startedAt) / 1000), visibility: host.document?.visibilityState || 'unavailable',
                    contextState: state, contextTime: audioTime, sampleRate: finite(currentContext?.sampleRate), heapUsedBytes: describeHeap(host).usedBytes ?? null,
                    maximumDelayMs: timing.maximumDelayMs, delayedOver120ms: timing.delayedOver120ms,
                    clockStalls: timing.audioClockStallSamples, counts: application.counts, caches: application.caches,
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
            const incident = { timestamp: new Date(wallNow()).toISOString(), capture };
            boundedPush(incidents, incident, limits.incidents);
            return incident;
        }

        function clearHistory() {
            history.length = 0;
            events.length = 0;
            incidents.length = 0;
            delays.length = 0;
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
            `Resources: ${JSON.stringify({ counts: application.counts, caches: application.caches, buffers: application.buffers })}`,
            `Playback / FX: ${JSON.stringify({ playback: application.playback, synth: application.synth, effects: application.effects })}`,
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
