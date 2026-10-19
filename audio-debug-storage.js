(function (root) {
    'use strict';

    const limits = { sessions: 3, bytes: 2 * 1024 * 1024, checkpointMs: 5000, urgentMs: 1000, retryMs: 60000, timeoutMs: 5000 };
    const databaseName = 'mygrain-audio-debug-v1';

    function packReport(report) {
        if (report?.schemaVersion !== 1 || report.application !== 'MYGRAIN' || report.phoneDiagnostics?.schemaVersion !== 1) {
            throw new Error('The diagnostic capture is not ready to save. Earlier checkpoints remain available.');
        }
        const compact = { ...report, recentLogs: (report.recentLogs || []).map(({ phoneDiagnostics, ...entry }) => entry) };
        if (report.currentState) {
            const { phoneDiagnostics, ...audioState } = report.currentState;
            compact.currentState = audioState;
        }
        let encoded = JSON.stringify(compact);
        if (new Blob([encoded]).size > limits.bytes) {
            compact.debugConsoleText = `[Local checkpoint shortened to fit storage; structured phone data follows.]\n${String(report.debugConsoleText).slice(-65536)}`;
            compact.recentLogs = compact.recentLogs.slice(-5);
            compact.debugConsoleEvents = (report.debugConsoleEvents || []).slice(-40);
            compact.phoneDiagnostics = { ...report.phoneDiagnostics,
                history: (report.phoneDiagnostics?.history || []).slice(-60),
                events: (report.phoneDiagnostics?.events || []).slice(-40),
                incidents: (report.phoneDiagnostics?.incidents || []).slice(-3), localCheckpointShortened: true };
            encoded = JSON.stringify(compact);
        }
        if (new Blob([encoded]).size > limits.bytes) throw new Error('The latest diagnostic capture is too large to save locally. Earlier checkpoints remain available.');
        return encoded;
    }

    function createIndexedDBStorage(host = root) {
        let database = null;
        let opening = null;

        function open() {
            if (database) return Promise.resolve(database);
            if (opening) return opening;
            opening = new Promise((resolve, reject) => {
                if (!host.indexedDB) { reject(new Error('IndexedDB is unavailable in this browser.')); return; }
                let finished = false;
                const timeout = host.setTimeout(() => {
                    finished = true;
                    reject(new Error('Local diagnostic storage did not open. It may be blocked by the browser.'));
                }, limits.timeoutMs);
                let request;
                try { request = host.indexedDB.open(databaseName, 1); } catch (error) {
                    host.clearTimeout(timeout);
                    reject(error);
                    return;
                }
                request.onupgradeneeded = () => {
                    if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'id' });
                };
                request.onerror = () => {
                    host.clearTimeout(timeout);
                    if (!finished) { finished = true; reject(request.error || new Error('Cannot open local diagnostic storage.')); }
                };
                request.onsuccess = () => {
                    host.clearTimeout(timeout);
                    if (finished) { request.result.close(); return; }
                    finished = true;
                    database = request.result;
                    database.onversionchange = () => { database.close(); database = null; opening = null; };
                    resolve(database);
                };
            }).catch(error => { opening = null; throw error; });
            return opening;
        }

        async function transaction(mode, action) {
            const connection = await open();
            return new Promise((resolve, reject) => {
                let operation;
                try { operation = connection.transaction('sessions', mode, { durability: 'strict' }); }
                catch (error) { operation = connection.transaction('sessions', mode); }
                let result;
                const timeout = host.setTimeout(() => {
                    try { operation.abort(); } catch (error) {}
                    reject(new Error('Local diagnostic write timed out. Earlier checkpoints remain available.'));
                }, limits.timeoutMs);
                operation.oncomplete = () => { host.clearTimeout(timeout); resolve(result); };
                operation.onabort = operation.onerror = () => {
                    host.clearTimeout(timeout);
                    reject(operation.error || new Error('Local diagnostic storage failed. It may be full or unavailable.'));
                };
                try { action(operation.objectStore('sessions'), value => { result = value; }); }
                catch (error) {
                    host.clearTimeout(timeout);
                    try { operation.abort(); } catch (abortError) {}
                    reject(error);
                }
            });
        }

        return {
            list: () => transaction('readonly', (store, result) => {
                const request = store.getAll();
                request.onsuccess = () => result(request.result);
            }),
            save: record => transaction('readwrite', (store, result) => {
                const request = store.getAll();
                request.onsuccess = () => {
                    const records = [record, ...request.result.filter(entry => entry.id !== record.id)
                        .sort((first, second) => String(second.savedAt || '').localeCompare(String(first.savedAt || '')))];
                    const retained = records.slice(0, limits.sessions);
                    store.put(record);
                    for (const expired of records.slice(limits.sessions)) store.delete(expired.id);
                    result(retained);
                };
            }),
            remove: id => transaction('readwrite', store => { store.delete(id); }),
            markSubmitted: (id, receipt, captureTime) => transaction('readwrite', (store, result) => {
                const request = store.get(id);
                request.onsuccess = () => {
                    if (!request.result || request.result.captureTime !== captureTime) return;
                    const updated = { ...request.result, receipt };
                    store.put(updated);
                    result(updated);
                };
            }),
            close() { database?.close(); database = null; opening = null; }
        };
    }

    function createJournal(options = {}) {
        const host = options.host || root;
        const storage = options.storage || createIndexedDBStorage(host);
        const now = options.now || (() => Date.now());
        const id = options.id || `diag-${host.crypto?.randomUUID?.() || `${now()}-${Math.random().toString(36).slice(2)}`}`;
        const startedAt = options.startedAt || new Date(now()).toISOString();
        let records = [];
        let available = false;
        let loaded = false;
        let error = '';
        let warning = '';
        let lastAttempt = -Infinity;
        let lastSavedAt = null;
        let pendingReason = '';
        let writing = null;
        let forced = null;
        let clearing = false;
        let stopped = false;
        let epoch = 0;
        let cached = null;

        function state() {
            return { id, available, loaded, error, warning, writing: writing !== null, lastSavedAt,
                records: records.map(({ data, ...metadata }) => ({ ...metadata, current: metadata.id === id })) };
        }

        function notify() {
            try { options.onChange?.(state()); } catch (callbackError) {}
        }

        function fail(failure) {
            error = failure.message || 'Local diagnostic storage is unavailable.';
            notify();
            return false;
        }

        function validRecord(record) {
            if (!record || typeof record.id !== 'string' || typeof record.savedAt !== 'string' ||
                typeof record.data !== 'string' || record.data.length > limits.bytes) return false;
            try {
                const report = JSON.parse(record.data);
                return report?.schemaVersion === 1 && report.application === 'MYGRAIN' && typeof report.debugConsoleText === 'string' && report.phoneDiagnostics?.schemaVersion === 1;
            } catch (parseError) { return false; }
        }

        const ready = storage.list().then(saved => {
            loaded = true;
            records = saved.filter(validRecord).sort((first, second) => second.savedAt.localeCompare(first.savedAt)).slice(0, limits.sessions);
            if (records.length !== saved.length) warning = 'Some local diagnostic records are unreadable or outside the retention limit.';
            available = true;
            notify();
            return true;
        }).catch(failure => { loaded = true; return fail(failure); });

        function read(idToRead) {
            const record = records.find(entry => entry.id === idToRead);
            if (!record) return null;
            if (cached?.id !== idToRead || cached.data !== record.data) cached = { id: idToRead, data: record.data, report: JSON.parse(record.data) };
            return cached.report;
        }

        async function checkpoint(reason = 'periodic', settings = {}) {
            await ready;
            if (!available || stopped || clearing || (!settings.force && (error || options.shouldCapture?.() === false))) return false;
            if (writing) {
                if (!settings.force) { if (reason !== 'periodic') pendingReason = reason; return writing; }
                if (!forced) {
                    const queued = { reason, settings, generation: epoch };
                    queued.promise = writing.then(() => {
                        forced = null;
                        return queued.generation === epoch ? checkpoint(queued.reason, queued.settings) : false;
                    });
                    forced = queued;
                } else { forced.reason = reason; forced.settings = settings; }
                return forced.promise;
            }
            const generation = epoch;
            lastAttempt = now();
            writing = Promise.resolve().then(async () => {
                const report = settings.report || options.getReport();
                const record = { id, startedAt,
                    savedAt: new Date(now()).toISOString(), captureTime: report.captureTime, build: report.build, reason,
                    data: packReport(report), receipt: null };
                if (generation !== epoch || stopped) return false;
                records = (await storage.save(record)).filter(validRecord);
                lastSavedAt = record.savedAt;
                error = '';
                return record;
            }).catch(fail).finally(() => {
                writing = null;
                notify();
            });
            return writing;
        }

        function request(reason) { pendingReason = reason; }

        function sample() {
            if (stopped || clearing || !available || options.shouldCapture?.() === false) return;
            if (error) {
                if (now() - lastAttempt < limits.retryMs) return;
                return checkpoint('storage-retry', { force: true }).catch(fail);
            }
            const urgent = Boolean(pendingReason);
            if (now() - lastAttempt < (urgent ? limits.urgentMs : limits.checkpointMs)) return;
            const reason = pendingReason || 'periodic';
            pendingReason = '';
            return checkpoint(reason).catch(fail);
        }

        async function remove(idToRemove = id) {
            await ready;
            if (!available) return false;
            if (idToRemove === id) { clearing = true; epoch += 1; pendingReason = ''; }
            try {
                if (writing) await writing;
                await storage.remove(idToRemove);
                records = records.filter(record => record.id !== idToRemove);
                if (cached?.id === idToRemove) cached = null;
                if (idToRemove === id) lastSavedAt = null;
                error = '';
                return true;
            } catch (failure) { return fail(failure); }
            finally { clearing = false; notify(); }
        }

        async function markSubmitted(idToMark, receipt, captureTime) {
            await ready;
            if (!available) return false;
            try {
                if (writing) await writing;
                const existing = records.find(record => record.id === idToMark);
                if (!existing || existing.captureTime !== captureTime) return false;
                const updated = await storage.markSubmitted(idToMark, receipt, captureTime);
                if (updated) records = records.map(record => record.id === idToMark ? updated : record);
                notify();
                return Boolean(updated);
            } catch (failure) { return fail(failure); }
        }

        return { id, ready, state, read, checkpoint, request, sample, remove, markSubmitted,
            stop() { stopped = true; epoch += 1; pendingReason = ''; storage.close?.(); } };
    }

    const api = { createJournal, createIndexedDBStorage, packReport, databaseName, limits };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.MygrainDebugStorage = api;
})(typeof window !== 'undefined' ? window : globalThis);
