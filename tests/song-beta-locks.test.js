const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const { EditingLease, deviceIdentity } = require('../song-beta-locks.js');
require('../song-beta-storage.js');
const { Controller } = require('../song-beta.js');

function storage() {
    const data = new Map();
    return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}

function fixture(overrides = {}) {
    let now = 1000000;
    const requests = [];
    const local = overrides.storage || storage();
    const lease = new EditingLease({ storage: local, crypto: webcrypto, agent: 'iPhone', now: () => now,
        request: async (path, options) => {
            requests.push({ path, options });
            if (overrides.request) return overrides.request(path, options);
            return { ok: true, token: 'a'.repeat(64), serverTime: 1000,
                lock: path.endsWith('/release') ? null : { label: 'Phone', expiresAt: 1600 }, song: { id: 'song-1234abcd', revision: 1, parts: [] } };
        }, onChange: overrides.onChange });
    return { lease, local, requests, setNow: value => { now = value; }, dispose: () => { clearTimeout(lease.timer); lease.songId = null; } };
}

function controllerFixture(fetch) {
    const elements = new Map();
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { value: '', addEventListener() {}, classList: { toggle() {} } });
        return elements.get(id);
    } };
    const controller = new Controller({}, { document, storage: storage(), crypto: webcrypto, fetch, api: 'https://example.test/mygrain/api/songs' });
    controller.render = () => {};
    controller.song = { id: 'song-1234abcd', revision: 8, parts: [] };
    controller.lease.songId = controller.song.id;
    return controller;
}

test('browser installation ID survives reloads but each tab gets a fresh editing session', () => {
    const local = storage();
    const first = fixture({ storage: local });
    const second = fixture({ storage: local });
    assert.equal(first.lease.device.id, second.lease.device.id);
    assert.notEqual(first.lease.session, second.lease.session);
    assert.match(first.lease.device.label, /^iPhone [a-f0-9]{4}$/);
    assert.notEqual(first.lease.device.id, fixture().lease.device.id);
});

test('invalid installation IDs are replaced and private labels are kept locally', () => {
    const local = storage();
    local.setItem('mygrain-song-device-v1', '../bad');
    local.setItem('mygrain-song-device-label-v1', 'Mark’s laptop');
    const identity = deviceIdentity(local, webcrypto, 'Windows');
    assert.match(identity.id, /^[a-f0-9]{32}$/);
    assert.equal(identity.label, 'Mark’s laptop');
});

test('selected songs start read-only; acquisition supplies identity and revision', async () => {
    const state = fixture();
    await state.lease.watch('song-1234abcd');
    assert.equal(state.lease.canWrite, false);
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    assert.equal(state.lease.canWrite, true);
    const acquired = state.requests.find(entry => entry.path.endsWith('/acquire'));
    assert.equal(acquired.options.headers['If-Match'], '"1"');
    assert.deepEqual(JSON.parse(acquired.options.body), { deviceId: state.lease.device.id, sessionId: state.lease.session, label: 'Phone' });
    state.dispose();
});

test('server-relative expiry tolerates a device clock years out of sync', async () => {
    const state = fixture();
    state.setNow(900000000000);
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    assert.equal(state.lease.deadline, 900000600000);
    state.setNow(900000599999);
    assert.equal(state.lease.canWrite, true);
    state.setNow(900000600000);
    assert.equal(state.lease.canWrite, false);
    state.dispose();
});

test('heartbeat includes secret session credentials but never the library key in its body', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    await state.lease.check();
    const renewal = state.requests.find(entry => entry.path.endsWith('/renew'));
    assert.equal(renewal.options.headers['X-Mygrain-Song-Lock'], 'a'.repeat(64));
    assert.equal(renewal.options.headers['X-Mygrain-Song-Session'], state.lease.session);
    assert.equal(renewal.options.body, undefined);
    state.dispose();
});

test('network failures pause editing and successful renewal resumes before expiry', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    const request = state.lease.request;
    state.lease.request = async () => { throw new Error('Offline'); };
    await state.lease.check();
    assert.equal(state.lease.canWrite, false);
    assert.ok(state.lease.token);
    assert.match(state.lease.message, /Connection lost/);
    state.lease.request = request;
    await state.lease.check();
    assert.equal(state.lease.canWrite, true);
    assert.equal(state.lease.message, '');
    state.dispose();
});

test('expired sessions never silently renew or acquire a new editing lock', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    const previous = state.requests.length;
    state.setNow(1600000);
    await state.lease.check();
    assert.equal(state.lease.canWrite, false);
    assert.equal(state.lease.token, null);
    assert.equal(state.requests.length, previous + 1);
    assert.equal(state.requests.at(-1).path, '/song-1234abcd/lock');
    state.dispose();
});

test('rejected renewal drops the old token and exposes the replacement owner', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    state.lease.request = async () => { throw Object.assign(new Error('Expired'), { code: 'SONG_LOCK_LOST', lock: { label: 'Laptop', expiresAt: 2000 } }); };
    await state.lease.check();
    assert.equal(state.lease.canWrite, false);
    assert.equal(state.lease.token, null);
    assert.equal(state.lease.lock.label, 'Laptop');
    state.dispose();
});

test('finish editing releases immediately and selection changes do not leak ownership', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    await state.lease.watch('other-5678abcd');
    const release = state.requests.find(entry => entry.path.endsWith('/release'));
    assert.equal(release.path, '/song-1234abcd/lock/release');
    assert.equal(release.options.headers['X-Mygrain-Song-Lock'], 'a'.repeat(64));
    assert.equal(state.lease.songId, 'other-5678abcd');
    assert.equal(state.lease.canWrite, false);
    state.dispose();
});

test('pagehide release uses keepalive and does not persist the secret token', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    await state.lease.release({ keepalive: true });
    assert.equal(state.requests.at(-1).options.keepalive, true);
    assert.equal(state.lease.token, null);
    assert.equal(state.local.getItem('mygrain-song-token'), null);
    state.dispose();
});

test('an old renewal response cannot restore ownership after release', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 1, 'Phone');
    const request = state.lease.request;
    let finish;
    state.lease.request = (path, options) => path.endsWith('/renew') ? new Promise(resolve => { finish = resolve; }) : request(path, options);
    const checking = state.lease.check();
    await state.lease.release();
    finish({ lock: { label: 'Phone', expiresAt: 2000 }, serverTime: 1000 });
    await checking;
    assert.equal(state.lease.canWrite, false);
    assert.equal(state.lease.lock, null);
    state.dispose();
});

test('failed availability check recovers cleanly after reconnecting', async () => {
    const state = fixture();
    const request = state.lease.request;
    state.lease.request = async () => { throw new Error('Offline'); };
    await state.lease.watch('song-1234abcd');
    assert.match(state.lease.message, /Cannot check/);
    state.lease.request = request;
    await state.lease.check();
    assert.equal(state.lease.message, '');
    state.dispose();
});

test('controller blocks read-only song changes before any network request', async () => {
    let requests = 0;
    const controller = controllerFixture(async () => { requests += 1; });
    await assert.rejects(controller.request('/song-1234abcd/rename', { method: 'POST' }), /read-only/);
    assert.equal(requests, 0);
});

test('controller attaches the exact revision and secret only to song mutations', async () => {
    const requests = [];
    const controller = controllerFixture(async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ ok: true }) }; });
    controller.lease.token = 'a'.repeat(64);
    controller.lease.deadline = Date.now() + 600000;
    controller.lease.verified = true;
    await controller.request('/song-1234abcd/rename', { method: 'POST' });
    await controller.request('/song-1234abcd');
    assert.equal(requests[0].options.headers['If-Match'], '"8"');
    assert.equal(requests[0].options.headers['X-Mygrain-Song-Lock'], 'a'.repeat(64));
    assert.equal(requests[1].options.headers['X-Mygrain-Song-Lock'], undefined);
});

test('controller permits hash-checked cache preparation without taking an editing lock', async () => {
    const controller = controllerFixture(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    await controller.request(`/song-1234abcd/parts/${'b'.repeat(32)}/render?sha256=digest`, { method: 'POST' });
    assert.equal(controller.lease.canWrite, false);
});

test('rejected writes retain the live amendment and require explicit recovery', async () => {
    const controller = controllerFixture(async () => ({ ok: false, status: 423, json: async () => ({ ok: false, code: 'SONG_LOCK_REQUIRED', error: 'Lost lock', lock: { label: 'Laptop', expiresAt: 2000 } }) }));
    controller.lease.token = 'a'.repeat(64);
    controller.lease.deadline = Date.now() + 600000;
    controller.lease.verified = true;
    const draft = { id: 'part', songId: controller.song.id };
    controller.editing = draft;
    await assert.rejects(controller.request('/song-1234abcd/arrange', { method: 'POST' }), /Lost lock/);
    assert.equal(controller.editing, draft);
    assert.equal(controller.lease.canWrite, false);
    assert.equal(controller.lease.lock.label, 'Laptop');
});

test('revision conflicts leave the amendment intact and disable further writes', async () => {
    const controller = controllerFixture(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, code: 'SONG_REVISION_CONFLICT', error: 'Refresh Songs' }) }));
    controller.lease.token = 'a'.repeat(64);
    controller.lease.deadline = Date.now() + 600000;
    controller.lease.verified = true;
    controller.editing = { id: 'part' };
    await assert.rejects(controller.request('/song-1234abcd/arrange', { method: 'POST' }), /Refresh Songs/);
    assert.deepEqual(controller.editing, { id: 'part' });
    assert.equal(controller.canEditSong(), false);
    await assert.rejects(controller.request('/song-1234abcd/rename', { method: 'POST' }), /changed on the server/);
});

test('explicit recovery sends the observed lock identity with fresh session identity and exact revision', async () => {
    const state = fixture();
    await state.lease.acquire('song-1234abcd', 8, 'Marks Phone', 'c'.repeat(64));
    const recovered = state.requests.find(entry => entry.path.endsWith('/recover'));
    assert.equal(recovered.options.headers['If-Match'], '"8"');
    assert.deepEqual(JSON.parse(recovered.options.body), {
        deviceId: state.lease.device.id, sessionId: state.lease.session, label: 'Marks Phone', recoveryId: 'c'.repeat(64)
    });
    assert.equal(state.lease.canWrite, true);
    state.dispose();
});

test('recovery option follows the entered name and never grants write access by itself', () => {
    const controller = controllerFixture(async () => {});
    controller.lease.lock = { label: 'Marks Phone', expiresAt: 2000, recoveryId: 'c'.repeat(64) };
    const input = controller.element('songBetaDeviceName');
    input.value = 'Laptop';
    controller.renderLockUi();
    assert.equal(controller.element('songBetaRecoverLock').hidden, true);
    input.value = '  marks phone  ';
    controller.renderLockUi();
    assert.equal(controller.element('songBetaRecoverLock').hidden, false);
    assert.equal(controller.canEditSong(), false);
});

test('cancelled recovery never calls the server or changes the live amendment', async () => {
    const controller = controllerFixture(async () => { throw new Error('Unexpected network request'); });
    controller.element('songBetaDeviceName').value = 'Marks Phone';
    controller.lease.lock = { label: 'Marks Phone', expiresAt: 2000, recoveryId: 'c'.repeat(64) };
    const draft = controller.editing = { id: 'draft' };
    const original = global.confirm;
    try {
        global.confirm = () => false;
        await controller.recoverEditingLock();
        assert.equal(controller.editing, draft);
        assert.equal(controller.lease.token, null);
    } finally { global.confirm = original; }
});

test('accepted recovery preserves draft and obtains server-validated ownership without recalling audio', async () => {
    const requests = [];
    const controller = controllerFixture(async (url, options) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ ok: true, token: 'd'.repeat(64), serverTime: 1000,
            lock: { label: 'Marks Phone', expiresAt: 1600, recoveryId: 'e'.repeat(64) },
            song: { id: 'song-1234abcd', revision: 8, parts: [] } }) };
    });
    controller.element('songBetaDeviceName').value = 'Marks Phone';
    controller.lease.lock = { label: 'Marks Phone', expiresAt: 2000, recoveryId: 'c'.repeat(64) };
    const draft = controller.editing = { id: 'draft' };
    const original = global.confirm;
    try {
        global.confirm = () => true;
        await controller.recoverEditingLock();
        assert.equal(controller.editing, draft);
        assert.equal(controller.canEditSong(), true);
        assert.equal(requests.length, 1);
        assert.match(requests[0].url, /\/lock\/recover$/);
        assert.equal(controller.lease.device.label, 'Marks Phone');
    } finally { global.confirm = original; clearTimeout(controller.lease.timer); }
});
