(function (root) {
    'use strict';

    function randomId(crypto) {
        return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('');
    }

    function deviceIdentity(storage, crypto, agent = '') {
        let id = storage.getItem('mygrain-song-device-v1');
        if (!/^[a-f0-9]{32}$/.test(id || '')) {
            id = randomId(crypto);
            storage.setItem('mygrain-song-device-v1', id);
        }
        const platform = /iPhone/i.test(agent) ? 'iPhone' : /iPad/i.test(agent) ? 'iPad' : /Android/i.test(agent) ? 'Android' : /Windows/i.test(agent) ? 'Windows PC' : /Macintosh/i.test(agent) ? 'Mac' : /Linux/i.test(agent) ? 'Linux PC' : 'Browser';
        return { id, label: storage.getItem('mygrain-song-device-label-v1') || `${platform} ${id.slice(0, 4)}` };
    }

    class EditingLease {
        constructor(options) {
            this.request = options.request;
            this.onChange = options.onChange || (() => {});
            this.now = options.now || Date.now;
            this.device = deviceIdentity(options.storage, options.crypto, options.agent);
            this.session = randomId(options.crypto);
            this.songId = null;
            this.token = null;
            this.deadline = 0;
            this.lock = null;
            this.message = '';
            this.verified = false;
            this.timer = null;
            this.generation = 0;
        }

        get canWrite() {
            return Boolean(this.token && this.verified && this.now() < this.deadline);
        }

        credentials() {
            return { 'X-Mygrain-Song-Device': this.device.id, 'X-Mygrain-Song-Session': this.session, 'X-Mygrain-Song-Lock': this.token || '' };
        }

        async network(path, options = {}) {
            const abort = new AbortController();
            const timer = root.setTimeout(() => abort.abort(), 15000);
            try { return await this.request(path, { ...options, signal: abort.signal }); }
            finally { root.clearTimeout(timer); }
        }

        schedule() {
            root.clearTimeout(this.timer);
            this.timer = this.songId ? root.setTimeout(() => this.check(), 30000) : null;
            this.timer?.unref?.();
        }

        update(payload) {
            this.lock = payload.lock;
            if (this.token && payload.lock) this.deadline = this.now() + Math.max(0, payload.lock.expiresAt - payload.serverTime) * 1000;
        }

        async watch(songId) {
            if (songId === this.songId) return;
            await this.release();
            this.songId = songId || null;
            this.lock = null;
            this.message = '';
            this.onChange();
            this.schedule();
            if (this.songId) await this.check();
        }

        async check() {
            const generation = this.generation;
            const songId = this.songId;
            if (!songId) return;
            if (this.token && this.now() >= this.deadline) this.lost({ lock: null }, 'Editing lock expired. Refresh Songs and use Edit Song again. Your live pattern is still available.');
            const token = this.token;
            try {
                const payload = await this.network(`/${encodeURIComponent(songId)}/lock${token ? '/renew' : ''}`, token ? { method: 'POST', headers: this.credentials() } : {});
                if (generation !== this.generation || songId !== this.songId) return;
                this.update(payload);
                this.verified = Boolean(this.token);
                this.message = '';
            } catch (error) {
                if (generation !== this.generation || songId !== this.songId) return;
                if (error.code === 'SONG_LOCK_LOST' || error.code === 'SONG_LOCK_REQUIRED') {
                    this.lost(error, error.message);
                } else {
                    this.verified = false;
                    this.message = this.token ? 'Connection lost: song editing is paused. Reconnecting before the 10-minute expiry will resume it.' : 'Cannot check editing availability. Playback is still available; reconnect before editing.';
                }
            } finally {
                if (generation === this.generation && songId === this.songId) {
                    this.onChange();
                    this.schedule();
                }
            }
        }

        async acquire(songId, revision, label) {
            if (this.songId !== songId) await this.watch(songId);
            this.generation += 1;
            const generation = this.generation;
            root.clearTimeout(this.timer);
            try {
                const payload = await this.network(`/${encodeURIComponent(songId)}/lock/acquire`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'If-Match': `"${revision}"` },
                    body: JSON.stringify({ deviceId: this.device.id, sessionId: this.session, label })
                });
                if (generation !== this.generation || songId !== this.songId) throw new Error('Song selection changed; the editing lock will expire automatically.');
                this.token = payload.token;
                this.update(payload);
                this.verified = true;
                this.message = '';
                return payload.song;
            } catch (error) {
                if (generation === this.generation) {
                    if ('lock' in error) this.lock = error.lock;
                    this.message = error.message;
                }
                throw error;
            } finally {
                if (generation === this.generation) { this.onChange(); this.schedule(); }
            }
        }

        lost(payload, message = 'Your editing lock is no longer valid. Refresh Songs and use Edit Song again. Your live pattern is still available.') {
            this.token = null;
            this.deadline = 0;
            this.verified = false;
            this.lock = payload.lock || null;
            this.message = message;
            this.onChange();
        }

        async release(options = {}) {
            const songId = this.songId;
            const token = this.token;
            const headers = this.credentials();
            this.generation += 1;
            const generation = this.generation;
            root.clearTimeout(this.timer);
            this.token = null;
            this.deadline = 0;
            this.verified = false;
            this.lock = null;
            this.message = '';
            if (token && songId) {
                try { await this.network(`/${encodeURIComponent(songId)}/lock/release`, { method: 'POST', headers, ...options }); }
                catch { if (generation === this.generation) this.message = 'Release could not be confirmed. The server lock expires 10 minutes after its last renewal.'; }
            }
            if (generation === this.generation) { this.onChange(); this.schedule(); }
        }
    }

    root.MygrainSongLocks = { EditingLease, deviceIdentity };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.MygrainSongLocks;
})(globalThis);
