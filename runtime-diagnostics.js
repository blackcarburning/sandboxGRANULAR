(function (root) {
    'use strict';

    const prefix = 'mygrain-runtime-debug-v1:';
    const tabKey = 'mygrain-runtime-tab-v1';
    const limits = { sessions: 4, events: 60, history: 12, bytes: 32768, heartbeatMs: 5000, retryMs: 60000 };

    function createRecorder(options = {}) {
        const host = options.host || root;
        const now = options.now || Date.now;
        const safely = (callback, fallback = null) => { try { return callback(); } catch { return fallback; } };
        const storage = safely(() => host.localStorage);
        const tab = safely(() => host.sessionStorage);
        const id = options.id || `run-${safely(() => host.crypto.randomUUID(), `${now()}-${Math.random().toString(36).slice(2)}`)}`;
        let provider = () => ({});
        let timer = null;
        let pending = null;
        let stopped = false;
        let lastWrite = -Infinity;
        let retryAt = 0;
        let persistenceError = '';
        let savedAt = null;
        let lastUrgent = -Infinity;
        let repeatedFailure = null;
        const listeners = [];
        const previousId = safely(() => tab.getItem(tabKey));
        const instant = () => new Date(now()).toISOString();

        function route(value) {
            return safely(() => {
                const parsed = new URL(value, host.location.href);
                if (parsed.origin !== host.location.origin) return '[cross-origin]';
                return parsed.pathname.split('/').map(segment => {
                    if (!segment) return '';
                    return /^(mygrain|api|songs|parts|lock|acquire|renew|release|render|audio|snapshot|revisions|debug-logs|login|logout|auth|session|homepage|index\.html)$/.test(segment) || /^[a-z][a-z0-9-]*\.(js|css)$/.test(segment)
                        ? segment : ':resource';
                }).join('/');
            }, '[unavailable]');
        }

        function text(value, maximum = 800) {
            return String(value || '').replace(/https?:\/\/[^\s)"'<>]+/g, value => {
                const position = value.match(/:\d+:\d+$/)?.[0] || '';
                return position ? `${route(value.slice(0, -position.length))}${position}` : route(value);
            })
                .replace(/\b(?:password|token|secret|authorization|cookie|bearer|key)\b["']?\s*[:= ]\s*[^\s,;}]+/gi, '[redacted]')
                .replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]').slice(0, maximum);
        }

        function clean(value, depth = 0) {
            if (depth > 5) return '[bounded]';
            if (value === null || typeof value === 'boolean') return value;
            if (typeof value === 'number') return Number.isFinite(value) ? value : null;
            if (typeof value === 'string') return text(value);
            if (Array.isArray(value)) return value.slice(-20).map(entry => clean(entry, depth + 1));
            if (!value || typeof value !== 'object') return null;
            return Object.fromEntries(Object.entries(value).slice(0, 40)
                .filter(([key]) => !/token|password|secret|cookie|authorization|credential|libraryKey|deviceId/i.test(key))
                .map(([key, entry]) => [key, clean(entry, depth + 1)]));
        }

        function readRuns() {
            return safely(() => {
                const entries = [];
                for (let index = 0; index < storage.length; index += 1) {
                    const key = storage.key(index);
                    if (!key?.startsWith(prefix)) continue;
                    const encoded = storage.getItem(key);
                    if (!encoded || encoded.length > limits.bytes) continue;
                    const value = safely(() => JSON.parse(encoded));
                    if (value?.schemaVersion === 1 && typeof value.sessionId === 'string' && typeof value.updatedAt === 'string' && Array.isArray(value.events)) entries.push(value);
                }
                return entries.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
            }, []);
        }

        const previous = readRuns().filter(entry => entry.sessionId !== id).slice(0, limits.sessions - 1);
        const navigation = safely(() => host.performance.getEntriesByType('navigation')[0]);
        const record = { schemaVersion: 1, sessionId: id, build: options.build || 'unknown', startedAt: instant(), updatedAt: instant(),
            boot: { navigationType: navigation?.type || 'unavailable', redirectCount: navigation?.redirectCount ?? null,
                responseStatus: navigation?.responseStatus ?? null, path: route(host.location?.href),
                wasDiscarded: typeof host.document?.wasDiscarded === 'boolean' ? host.document.wasDiscarded : null,
                previousSessionId: previousId, previousSessionFound: previous.some(entry => entry.sessionId === previousId),
                standalone: safely(() => host.matchMedia('(display-mode: standalone)').matches, false) || Boolean(host.navigator?.standalone) },
            state: {}, events: [], breadcrumbs: [], history: [] };
        safely(() => tab.setItem(tabKey, id));

        function sample() {
            const memory = host.performance?.memory;
            record.state = { visibility: host.document?.visibilityState || 'unavailable', online: host.navigator?.onLine ?? null,
                passwordFormPresent: safely(() => Boolean(host.document.querySelector('input[type="password"]'))),
                jsHeapUsedBytes: memory?.usedJSHeapSize ?? null, ...clean(safely(provider, { unavailable: true })) };
            record.updatedAt = instant();
            if (record.state.build) record.build = record.state.build;
        }

        function persist() {
            if (stopped || now() < retryAt) return;
            if (pending !== null) { host.clearTimeout(pending); pending = null; }
            sample();
            try {
                if (!storage) throw new Error('Unavailable');
                let encoded = JSON.stringify(record);
                while (new Blob([encoded]).size > limits.bytes && record.breadcrumbs.length) { record.breadcrumbs.shift(); encoded = JSON.stringify(record); }
                while (new Blob([encoded]).size > limits.bytes && record.events.length) {
                    record.events.shift();
                    encoded = JSON.stringify(record);
                }
                if (new Blob([encoded]).size > limits.bytes) throw new Error('Oversize');
                storage.setItem(prefix + id, encoded);
                savedAt = record.updatedAt;
                lastWrite = now();
                persistenceError = '';
                const runs = readRuns().filter(entry => entry.sessionId !== id);
                const matching = runs.find(entry => entry.sessionId === previousId);
                const audioRuns = runs.filter(entry => entry.state?.audioStarted);
                const failures = runs.filter(entry => entry.events.some(event => /javascript-error|rejection|fetch-failed/.test(event.type)));
                const keep = new Set([id, matching?.sessionId, ...audioRuns.map(entry => entry.sessionId), ...failures.map(entry => entry.sessionId), ...runs.map(entry => entry.sessionId)]
                    .filter(Boolean).slice(0, limits.sessions));
                for (const entry of runs) if (!keep.has(entry.sessionId)) storage.removeItem(prefix + entry.sessionId);
            } catch (error) {
                persistenceError = `Runtime breadcrumb storage unavailable (${text(error.name || 'Error', 60)}). Earlier saved audio checkpoints are separate.`;
                retryAt = now() + limits.retryMs;
            }
        }

        function event(type, details = {}, immediate = false) {
            if (stopped) return;
            safely(() => {
                if (type === 'javascript-error' || type === 'unhandled-rejection') {
                    const signature = JSON.stringify([type, details.name, details.message, details.source, details.line, details.column, details.stack]);
                    if (repeatedFailure?.signature === signature && now() - repeatedFailure.started < 1000) {
                        repeatedFailure.entry.count = (repeatedFailure.entry.count || 1) + 1;
                        repeatedFailure.entry.lastTimestamp = instant();
                        return;
                    }
                    repeatedFailure = { signature, started: now(), entry: null };
                }
                if (type === 'ui-breadcrumb' || type === 'power-mode') {
                    record.breadcrumbs.push({ timestamp: instant(), type, ...clean(details) });
                    if (record.breadcrumbs.length > 120) record.breadcrumbs.shift();
                    return; // Reuse the existing five-second persistence heartbeat.
                }
                record.events.push({ timestamp: instant(), type, ...clean(details) });
                if (repeatedFailure && (type === 'javascript-error' || type === 'unhandled-rejection')) repeatedFailure.entry = record.events.at(-1);
                if (record.events.length > limits.events) record.events.shift();
                const lifecycle = ['pagehide', 'visibilitychange', 'freeze', 'build-redirect'].includes(type);
                if ((immediate && (lifecycle || now() - lastUrgent >= 250)) || now() - lastWrite >= 1000) {
                    if (immediate) lastUrgent = now();
                    persist();
                }
                else if (pending === null) pending = host.setTimeout(() => { pending = null; persist(); }, 1000);
            });
        }

        function listen(target, name, callback, capture = false) {
            if (!target?.addEventListener) return;
            target.addEventListener(name, callback, capture);
            listeners.push(() => target.removeEventListener(name, callback, capture));
        }

        function failure(reason) {
            return { name: text(safely(() => reason.name), 80), message: text(safely(() => reason.message || String(reason))),
                stack: text(safely(() => reason.stack), 2400) };
        }

        listen(host, 'error', entry => {
            const target = entry.target;
            event(entry.message ? 'javascript-error' : 'resource-error', entry.message
                ? { ...failure(entry.error || entry.message), message: text(entry.message), source: route(entry.filename), line: entry.lineno, column: entry.colno }
                : { element: target?.tagName || 'unknown', source: route(target?.src || target?.href) }, true);
        }, true);
        listen(host, 'unhandledrejection', entry => event('unhandled-rejection', failure(entry.reason), true));
        listen(host, 'pageshow', entry => event('pageshow', { persisted: Boolean(entry.persisted) }, true));
        listen(host, 'pagehide', entry => event('pagehide', { persisted: Boolean(entry.persisted) }, true));
        listen(host, 'online', () => event('online', {}, true));
        listen(host, 'offline', () => event('offline', {}, true));
        listen(host.document, 'visibilitychange', () => event('visibilitychange', { visibility: host.document.visibilityState }, true));
        listen(host.document, 'freeze', () => event('freeze', {}, true));
        listen(host.document, 'resume', () => event('resume', {}, true));
        listen(host.document, 'DOMContentLoaded', () => event('dom-ready', {}, true));
        listen(host.document, 'pointerdown', entry => {
            const control = entry.target?.closest?.('button, select');
            if (!control) return;
            const classes = [...(control.classList || [])].filter(value => /^song-beta-(copy|paste|amend|load|remove|recall)$/.test(value));
            if (!/^(songBeta|performance|bastardLoop.*Cut|sectionJump(?:Undo|Redo)Btn|start-btn|submit.*Debug|.*DebugLog)/.test(control.id || '') && !classes.length) return;
            event('control', { control: text(control.id || classes[0], 100), disabled: Boolean(control.disabled) }, true);
        }, true);

        listen(host.document, 'change', entry => {
            const control = entry.target;
            if (!/^bastardLoop.*Cut/.test(control?.id || '')) return;
            event('loop-cut-control', { control: text(control.id, 100),
                value: control.type === 'checkbox' ? Boolean(control.checked) : text(control.value, 40) });
        }, true);

        // Scalar breadcrumbs only: no pointer-move stream, text entry, layout reads or new timer.
        let activeCard = null;
        const sliders = new WeakSet();
        const describe = target => {
            const card = target?.closest?.('[role="dialog"],dialog,[id$="Overlay"],[id$="Card"],.performance-feature-card,.performance-sound-card,.performance-bpm-card');
            return { card: text(card?.id || card?.getAttribute?.('data-instrument') || (card?.tagName==='DIALOG'?'dialog':'page'), 80),
                control: text(target?.id || target?.getAttribute?.('data-control') || target?.getAttribute?.('aria-label') || target?.tagName || 'unknown', 100) };
        };
        const crumb = (action, detail = {}) => event('ui-breadcrumb', { action, ...detail,
            audioTime: safely(() => host.mygrainClockContextTime?.()), lowPower: Boolean(host.mygrainPower?.active) });
        const identify = target => { const detail=describe(target); if(detail.card!==activeCard){activeCard=detail.card;crumb('card-enter', {card:activeCard});} return detail; };
        listen(host.document, 'pointerdown', entry => {
            const target=entry.target?.closest?.('input[type="range"],button,select,[role="slider"]');
            const detail=identify(entry.target); if(!target)return;
            if(target.type==='range'){sliders.add(target);crumb('slider-start',{...describe(target),value:Number(target.value)});}
        }, true);
        listen(host.document, 'input', entry => {
            const target=entry.target;if(target?.type!=='range'||sliders.has(target))return;
            sliders.add(target);crumb('slider-start',{...identify(target),value:Number(target.value)});
        }, true);
        for (const name of ['pointerup','pointercancel']) listen(host.document,name,entry=>{
            const target=entry.target;if(target?.type!=='range'||!sliders.has(target))return;
            sliders.delete(target);crumb('slider-end',{...describe(target),value:Number(target.value),cancelled:name==='pointercancel'});
        },true);
        listen(host.document, 'change', entry => {
            const target=entry.target;if(!['range','checkbox','radio'].includes(target?.type)&&target?.tagName!=='SELECT')return;
            const detail=identify(target); if(target.type==='range')sliders.delete(target);
            // Select values can contain private filenames: retain selected index, never text.
            crumb(target.type==='range'?'slider-end':'control-change',{...detail,value:target.tagName==='SELECT'?target.selectedIndex:target.type==='range'?Number(target.value):Boolean(target.checked)});
        }, true);
        listen(host.document, 'click', entry => {
            const target=entry.target?.closest?.('button');if(!target)return;
            crumb('button',{...identify(target),pressed:target.getAttribute?.('aria-pressed')});
            if(target.hasAttribute?.('aria-pressed')) Promise.resolve().then(()=>crumb('toggle-applied',{...describe(target),pressed:target.getAttribute('aria-pressed')}));
        }, true);
        listen(host.document, 'focusin', entry => identify(entry.target), true);
        for(const [name,action] of [['mygrain-ui-busy','scroll-start'],['mygrain-ui-settled','scroll-end']])
            listen(host,name,()=>{const state=safely(()=>host.mygrainUiActivity.snapshot(),{});crumb(action,{card:activeCard,target:text(state.scrollTarget,80),reason:text(state.reason,30)});});

        const originalFetch = host.fetch;
        let observedFetch = null;
        if (typeof originalFetch === 'function') {
            observedFetch = function (...args) {
                const input = args[0];
                const url = typeof input === 'string' || input instanceof URL ? String(input) : input?.url;
                const path = route(url);
                if (!path.startsWith('/mygrain/api/')) return originalFetch.apply(this, args);
                const started = now();
                const method = text(args[1]?.method || input?.method || 'GET', 16);
                return originalFetch.apply(this, args).then(response => {
                    safely(() => event('api-response', { path, method, status: response.status, ok: response.ok,
                        redirected: response.redirected, destination: route(response.url || url),
                        contentType: response.headers?.get('content-type')?.split(';')[0] || null,
                        durationMs: now() - started }, response.status === 401 || response.status === 403 || response.status === 423 || response.redirected));
                    return response;
                }, error => { safely(() => event('fetch-failed', { path, method, durationMs: now() - started, ...failure(error) }, true)); throw error; });
            };
            safely(() => { host.fetch = observedFetch; });
        }

        function snapshot() {
            sample();
            return JSON.parse(JSON.stringify({ ...record, persistence: { available: Boolean(savedAt), savedAt, error: persistenceError },
                retention: limits, limitation: 'A missing pagehide is not proof of a crash. Browser/OS termination reasons and native memory are unavailable unless explicitly reported.' }));
        }

        event('boot', {}, true);
        timer = host.setInterval?.(() => {
            if (host.document?.visibilityState !== 'hidden') {
                sample();
                record.history.push({ timestamp: record.updatedAt, audioState: record.state.audioState ?? null,
                    audioTime: record.state.audioTime ?? null, jsHeapUsedBytes: record.state.jsHeapUsedBytes,
                    songCache: record.state.song?.cache ?? null, songBusy: record.state.song?.busy ?? null,
                    songPlaying: record.state.song?.playing ?? null, amending: record.state.song?.amending ?? null });
                if (record.history.length > limits.history) record.history.shift();
                persist();
            }
        }, limits.heartbeatMs);
        return { id, event, snapshot, persist,
            setStateProvider(callback) { provider = callback; event('app-ready'); persist(); },
            recovery(sessionId) {
                const retained = readRuns();
                const saved = [...retained, ...previous].find(entry => entry.sessionId === sessionId);
                return { schemaVersion: 1, exportedAt: instant(), sourceSessionId: sessionId || null,
                    sourceRuntime: saved || null, currentRuntime: snapshot(),
                    previousSameTab: [...retained, ...previous].find(entry => entry.sessionId === previousId) || null,
                    recentPriorRuns: retained.filter(entry => entry.sessionId !== id).slice(0, limits.sessions - 1),
                    note: 'Recovery/export context is separate from the original audio capture. Missing source diagnostics were not recorded by earlier builds.' };
            },
            clear(sessionId = id) {
                safely(() => storage.removeItem(prefix + sessionId));
                for (let index = previous.length - 1; index >= 0; index -= 1) if (previous[index].sessionId === sessionId) previous.splice(index, 1);
                if (sessionId === id) { record.events.length = 0; record.breadcrumbs.length = 0; record.history.length = 0; repeatedFailure = null; savedAt = null; }
            },
            stop() {
                stopped = true;
                host.clearInterval?.(timer);
                host.clearTimeout?.(pending);
                for (const remove of listeners) remove();
                if (host.fetch === observedFetch) host.fetch = originalFetch;
            } };
    }

    const api = { createRecorder, limits, prefix, tabKey };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else {
        root.MygrainRuntimeDiagnostics = api;
        try { root.mygrainRuntimeDiagnostics = createRecorder(); } catch {}
    }
})(typeof window !== 'undefined' ? window : globalThis);
