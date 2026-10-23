(function (root) {
    'use strict';

    class MemoryBudget {
        constructor(limitBytes = 192 * 1024 * 1024, strict = false) {
            this.limitBytes = limitBytes;
            this.strict = strict;
            this.bytes = 0;
            this.waiting = [];
        }

        acquire(bytes, signal) {
            if (!Number.isFinite(bytes) || bytes < 0) return Promise.reject(new Error('Invalid song preparation memory estimate.'));
            if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
            if (this.strict && bytes > this.limitBytes) return Promise.reject(new Error(`This part needs about ${Math.ceil(bytes / 1048576)} MB of preparation memory, above this device's ${Math.floor(this.limitBytes / 1048576)} MB safety budget. Use shorter source samples or prepare it on a higher-memory desktop. Saved parts are unchanged.`));
            const weight = Math.min(this.limitBytes, Math.max(1, bytes));
            return new Promise((resolve, reject) => {
                const entry = { weight, signal, resolve, reject };
                entry.abort = () => {
                    this.waiting = this.waiting.filter(candidate => candidate !== entry);
                    signal.removeEventListener('abort', entry.abort);
                    reject(new DOMException('Cancelled', 'AbortError'));
                    this.drain();
                };
                signal?.addEventListener('abort', entry.abort, { once: true });
                this.waiting.push(entry);
                this.drain();
            });
        }

        drain() {
            while (this.waiting.length && this.bytes + this.waiting[0].weight <= this.limitBytes) {
                const entry = this.waiting.shift();
                entry.signal?.removeEventListener('abort', entry.abort);
                this.bytes += entry.weight;
                let released = false;
                entry.resolve(() => {
                    if (released) return;
                    released = true;
                    this.bytes -= entry.weight;
                    this.drain();
                });
            }
        }
    }

    class RenderStore {
        constructor(indexedDB) {
            if (indexedDB === undefined) {
                try { indexedDB = root.indexedDB; } catch { indexedDB = null; }
            }
            this.indexedDB = indexedDB;
            this.database = null;
            this.warning = '';
        }

        async open() {
            if (!this.database) {
                this.database = new Promise((resolve, reject) => {
                    if (!this.indexedDB) return reject(new Error('Browser storage is unavailable.'));
                    const request = this.indexedDB.open('mygrain-song-renders-v1', 1);
                    request.onupgradeneeded = () => request.result.createObjectStore('renders');
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('Close other MYGRAIN tabs to open browser song storage.'));
                    request.onsuccess = () => {
                        const database = request.result;
                        database.onversionchange = () => { database.close(); this.database = null; };
                        resolve(database);
                    };
                }).catch(error => { this.database = null; throw error; });
            }
            return this.database;
        }

        async transaction(mode, action) {
            const database = await this.open();
            return new Promise((resolve, reject) => {
                const transaction = database.transaction('renders', mode);
                let result;
                const request = action(transaction.objectStore('renders'));
                request.onsuccess = () => { result = request.result; };
                transaction.oncomplete = () => resolve(result);
                transaction.onabort = () => reject(transaction.error || request.error || new Error('Song storage transaction was cancelled.'));
                transaction.onerror = () => {};
            });
        }

        async get(key) {
            try { return await this.transaction('readonly', store => store.get(key)); }
            catch (error) { this.warning = 'Browser render storage unavailable; saved server renders will be loaded when needed.'; return null; }
        }

        async put(key, bytes) {
            try {
                await this.transaction('readwrite', store => store.put(bytes, key));
                return true;
            } catch (error) {
                this.warning = 'Browser render storage is full or unavailable; saved server renders will be loaded when needed.';
                return false;
            }
        }

        async delete(key) {
            try { await this.transaction('readwrite', store => store.delete(key)); } catch (error) {}
        }
    }

    // Optional encoded originals, not decoded audio or playback renders. Keep a
    // bounded disk cache so switching editable parts need not download them again.
    class SourceStore extends RenderStore {
        constructor(indexedDB, limitBytes = 64 * 1024 * 1024) {
            super(indexedDB);
            this.limitBytes = limitBytes;
        }

        async open() {
            if (!this.database) {
                this.database = new Promise((resolve, reject) => {
                    if (!this.indexedDB) return reject(new Error('Browser storage is unavailable.'));
                    const request = this.indexedDB.open('mygrain-song-sources-v1', 1);
                    request.onupgradeneeded = () => {
                        request.result.createObjectStore('sources');
                        request.result.createObjectStore('sizes');
                    };
                    request.onerror = () => reject(request.error);
                    request.onblocked = () => reject(new Error('Source cache is unavailable.'));
                    request.onsuccess = () => {
                        const database = request.result;
                        database.onversionchange = () => { database.close(); this.database = null; };
                        resolve(database);
                    };
                }).catch(error => { this.database = null; throw error; });
            }
            return this.database;
        }

        async get(key) {
            try {
                const database = await this.open();
                return await new Promise((resolve, reject) => {
                    const tx = database.transaction('sources', 'readonly');
                    const request = tx.objectStore('sources').get(key);
                    tx.oncomplete = () => resolve(request.result || null);
                    tx.onabort = () => reject(tx.error || new Error('Source cache read failed.'));
                    tx.onerror = () => {};
                });
            } catch { return null; }
        }

        async put(key, bytes) {
            if (!bytes?.byteLength || bytes.byteLength > this.limitBytes) return false;
            try {
                const database = await this.open();
                await new Promise((resolve, reject) => {
                    const tx = database.transaction(['sources', 'sizes'], 'readwrite');
                    const sources = tx.objectStore('sources'), sizes = tx.objectStore('sizes');
                    const request = sizes.getAll();
                    request.onsuccess = () => {
                        const entries = request.result.filter(entry => entry.key !== key).sort((a, b) => a.time - b.time);
                        let total = entries.reduce((sum, entry) => sum + entry.bytes, bytes.byteLength);
                        for (const entry of entries) {
                            if (total <= this.limitBytes) break;
                            sources.delete(entry.key); sizes.delete(entry.key); total -= entry.bytes;
                        }
                        sources.put(bytes, key);
                        sizes.put({ key, bytes: bytes.byteLength, time: Date.now() }, key);
                    };
                    tx.oncomplete = () => resolve();
                    tx.onabort = () => reject(tx.error || new Error('Source cache write failed.'));
                    tx.onerror = () => {};
                });
                return true;
            } catch { return false; }
        }

        async delete(key) {
            try {
                const database = await this.open();
                await new Promise((resolve, reject) => {
                    const tx = database.transaction(['sources', 'sizes'], 'readwrite');
                    tx.objectStore('sources').delete(key); tx.objectStore('sizes').delete(key);
                    tx.oncomplete = resolve;
                    tx.onabort = () => reject(tx.error);
                    tx.onerror = () => {};
                });
            } catch {}
        }
    }

    // Separate from Song render caches: durable local history belongs to a stable
    // account/device, never to the short-lived Song reservation token.
    class HistoryStore {
        constructor(owner, device) {
            this.owner = owner;
            this.device = device;
            this.revision = 0;
            this.references = new Set();
            this.ids = new WeakMap();
            this.decoded = new Map();
            this.database = null;
            this.closed = false;
            this.readOnly = false;
        }

        conflict() { return new Error('Undo/Redo history is active or changed in another tab on this device. Close that tab and reload MYGRAIN.'); }

        async open() {
            if (root.navigator?.locks?.request) {
                await new Promise((resolve, reject) => {
                    root.navigator.locks.request(`mygrain-history:${this.owner}`, { ifAvailable: true }, lock => {
                        this.readOnly = !lock;
                        resolve();
                        return lock ? new Promise(release => { this.release = release; if (this.closed) release(); }) : undefined;
                    }).catch(reject);
                });
            }
            if (this.closed) throw new Error('History storage closed.');
            this.database = await new Promise((resolve, reject) => {
                const request = root.indexedDB.open('mygrain-card-history-v1', 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore('journals');
                    request.result.createObjectStore('audio');
                };
                request.onerror = () => reject(request.error);
                request.onblocked = () => reject(new Error('Close other MYGRAIN tabs to open history storage.'));
                request.onsuccess = () => resolve(request.result);
            });
            if (this.closed) { this.database.close(); throw new Error('History storage closed.'); }
            this.database.onversionchange = () => this.close();
            const journal = await this.read('journals', this.device);
            if (!journal) return { undo: [], redo: [] };
            if (journal.version !== 1 || journal.owner !== this.owner || !Array.isArray(journal.undo) || !Array.isArray(journal.redo) || journal.undo.length + journal.redo.length > 10) throw new Error('Saved history is incompatible; current-session Undo/Redo remains available.');
            const validPath = change => Array.isArray(change.path) && change.path.length > 0 && change.path.every(key => typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key));
            if (!Number.isInteger(journal.revision) || journal.revision < 1 || !Array.isArray(journal.references)
                || journal.references.some(id => typeof id !== 'string' || !id.startsWith(`${this.device}:`))
                || [...journal.undo, ...journal.redo].some(entry => entry.owner !== this.owner || typeof entry.label !== 'string' || !Array.isArray(entry.json) || !entry.json.every(validPath) || !Array.isArray(entry.buffers) || entry.buffers.some(change => !Number.isInteger(change.index) || change.index < 0 || change.index > 100))) throw new Error('Saved history is damaged; current-session Undo/Redo remains available.');
            this.revision = journal.revision;
            this.references = new Set(journal.references);
            return { undo: journal.undo, redo: journal.redo };
        }

        read(store, key) {
            return new Promise((resolve, reject) => {
                if (this.closed) return reject(new Error('History storage closed.'));
                const tx = this.database.transaction(store, 'readonly'), request = tx.objectStore(store).get(key);
                let result;
                request.onsuccess = () => { result = request.result; };
                tx.oncomplete = () => resolve(result);
                tx.onabort = () => reject(tx.error || request.error || new Error('History read cancelled.'));
                tx.onerror = () => {};
            });
        }

        async check() {
            if (this.readOnly) throw this.conflict();
            const journal = await this.read('journals', this.device);
            if ((journal?.revision || 0) !== this.revision) { this.readOnly = true; throw this.conflict(); }
        }

        async save(undo, redo) {
            if (this.closed) throw new Error('History storage closed.');
            if (this.readOnly) throw this.conflict();
            const references = new Set(), additions = new Map();
            const audio = buffer => {
                if (!buffer) return null;
                let id = typeof buffer === 'string' ? buffer : this.ids.get(buffer);
                if (!id) { id = `${this.device}:${root.crypto.randomUUID()}`; this.ids.set(buffer, id); }
                references.add(id);
                if (typeof buffer !== 'string' && !this.references.has(id)) additions.set(id, {
                    sampleRate: buffer.sampleRate, length: buffer.length, channels: buffer.numberOfChannels,
                    // IndexedDB clones these arrays once; do not re-encode unchanged sounds.
                    data: Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
                });
                return id;
            };
            const piano = value => value && ({ ...value, atlas: audio(value.atlas), cache: [...value.cache].map(([key, buffer]) => [key, audio(buffer)]) });
            const entry = value => ({ ...value, buffers: value.buffers.map(change => ({ ...change, before: audio(change.before), after: audio(change.after) })), piano: value.piano && { before: piano(value.piano.before), after: piano(value.piano.after) } });
            const journal = { version: 1, owner: this.owner, revision: this.revision + 1, undo: undo.map(entry), redo: redo.map(entry), references: [...references] };
            await new Promise((resolve, reject) => {
                const tx = this.database.transaction(['journals', 'audio'], 'readwrite');
                const journals = tx.objectStore('journals'), sounds = tx.objectStore('audio');
                const request = journals.get(this.device);
                let conflict;
                request.onsuccess = () => {
                    try {
                    if ((request.result?.revision || 0) !== this.revision) { this.readOnly = true; conflict = this.conflict(); tx.abort(); return; }
                    for (const [key, value] of additions) sounds.put(value, key);
                    for (const key of this.references) if (!references.has(key)) sounds.delete(key);
                    journals.put(journal, this.device);
                    } catch (error) { conflict = error; tx.abort(); }
                };
                tx.oncomplete = resolve;
                tx.onabort = () => reject(conflict || tx.error || new Error('History save cancelled.'));
                tx.onerror = () => {};
            });
            this.revision = journal.revision;
            this.references = references;
            for (const key of this.decoded.keys()) if (!references.has(key)) this.decoded.delete(key);
        }

        async hydrate(entry, context) {
            const audio = async value => {
                if (!value || typeof value !== 'string') return value;
                if (!value.startsWith(`${this.device}:`)) throw new Error('Saved history belongs to another device.');
                if (!this.decoded.has(value)) {
                    const data = await this.read('audio', value);
                    if (!data || !Number.isInteger(data.channels) || data.channels < 1 || data.channels > 32 || !Number.isInteger(data.length) || data.length < 1 || !Array.isArray(data.data) || data.data.length !== data.channels || data.data.some(channel => !(channel instanceof Float32Array) || channel.length !== data.length)) throw new Error('Saved history audio is incomplete. Undo/Redo stopped without changing the patch.');
                    const buffer = context.createBuffer(data.channels, data.length, data.sampleRate);
                    data.data.forEach((channel, index) => buffer.getChannelData(index).set(channel));
                    this.ids.set(buffer, value); this.decoded.set(value, buffer);
                }
                return this.decoded.get(value);
            };
            const piano = async value => {
                if (!value) return value;
                const cache = new Map();
                for (const [key, buffer] of value.cache) cache.set(key, await audio(buffer));
                return { ...value, atlas: await audio(value.atlas), cache };
            };
            const buffers = [];
            for (const change of entry.buffers) buffers.push({ ...change, before: await audio(change.before), after: await audio(change.after) });
            return { ...entry, buffers, piano: entry.piano && { before: await piano(entry.piano.before), after: await piano(entry.piano.after) } };
        }

        close() {
            this.closed = true;
            this.database?.close();
            this.release?.();
            this.decoded.clear();
        }
    }

    root.MygrainSongStorage = { MemoryBudget, RenderStore, SourceStore, HistoryStore };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.MygrainSongStorage;
})(typeof window !== 'undefined' ? window : globalThis);
