(function (root) {
    'use strict';

    class MemoryBudget {
        constructor(limitBytes = 192 * 1024 * 1024) {
            this.limitBytes = limitBytes;
            this.bytes = 0;
            this.waiting = [];
        }

        acquire(bytes, signal) {
            if (!Number.isFinite(bytes) || bytes < 0) return Promise.reject(new Error('Invalid song preparation memory estimate.'));
            if (signal?.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
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

    root.MygrainSongStorage = { MemoryBudget, RenderStore };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.MygrainSongStorage;
})(typeof window !== 'undefined' ? window : globalThis);
