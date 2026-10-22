const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryBudget, RenderStore } = require('../song-beta-storage.js');

test('memory admission throttles heavy workers and releases each reservation only once', async () => {
    const budget = new MemoryBudget(100);
    const first = await budget.acquire(60);
    let admitted = false;
    const pending = budget.acquire(60).then(release => { admitted = true; return release; });
    await Promise.resolve();
    assert.equal(admitted, false);
    assert.equal(budget.bytes, 60);
    first();
    first();
    const second = await pending;
    assert.equal(budget.bytes, 60);
    second();
    assert.equal(budget.bytes, 0);
});

test('a large individual snapshot runs exclusively rather than failing a song-size limit', async () => {
    const budget = new MemoryBudget(100);
    const large = await budget.acquire(1000);
    let admitted = false;
    const pending = budget.acquire(1).then(release => { admitted = true; return release; });
    await Promise.resolve();
    assert.equal(admitted, false);
    large();
    const next = await pending;
    next();
    assert.equal(budget.bytes, 0);
});

test('cancelled waiting workers release their queue entry without stranding later work', async () => {
    const budget = new MemoryBudget(100);
    const release = await budget.acquire(90);
    const abort = new AbortController();
    const cancelled = budget.acquire(90, abort.signal);
    const rejected = assert.rejects(cancelled, { name: 'AbortError' });
    const next = budget.acquire(10);
    abort.abort();
    await rejected;
    const finish = await next;
    assert.equal(budget.bytes, 100);
    finish();
    release();
    assert.equal(budget.bytes, 0);
    assert.equal(budget.waiting.length, 0);
    await assert.rejects(budget.acquire(NaN), /Invalid/);
    await assert.rejects(budget.acquire(1, abort.signal), { name: 'AbortError' });
});

test('unavailable or full browser storage falls back to server renders without retaining encoded audio in RAM', async () => {
    const unavailable = new RenderStore(null);
    assert.equal(await unavailable.get('key'), null);
    assert.equal(await unavailable.put('key', new ArrayBuffer(8)), false);
    assert.match(unavailable.warning, /server renders/);
    const full = new RenderStore(null);
    full.open = async () => ({ transaction() { throw new DOMException('Full', 'QuotaExceededError'); } });
    assert.equal(await full.put('key', new ArrayBuffer(8)), false);
    assert.match(full.warning, /full or unavailable/);
});

test('a denied IndexedDB property still permits server-backed song playback', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    try {
        Object.defineProperty(globalThis, 'indexedDB', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
        const store = new RenderStore();
        assert.equal(await store.get('saved-server-render'), null);
        assert.match(store.warning, /server renders/);
    } finally {
        if (original) Object.defineProperty(globalThis, 'indexedDB', original);
        else delete globalThis.indexedDB;
    }
});

test('render writes await transaction commit rather than treating request success as durable storage', async () => {
    const store = new RenderStore(null);
    const request = {};
    const transaction = { objectStore: () => ({ put: () => request }) };
    store.open = async () => ({ transaction: () => transaction });
    let committed = false;
    const pending = store.put('key', new ArrayBuffer(8)).then(result => { committed = result; return result; });
    await Promise.resolve();
    request.onsuccess();
    await Promise.resolve();
    assert.equal(committed, false);
    transaction.oncomplete();
    assert.equal(await pending, true);
});

test('original source caching is optional and oversized archives do not open storage', async () => {
    const {SourceStore} = require('../song-beta-storage.js');
    const store = new SourceStore(null, 8);
    assert.equal(await store.get('source'), null);
    assert.equal(await store.put('source', new ArrayBuffer(4)), false);
    await store.delete('source');
    store.open = () => assert.fail('Oversized sources must not use browser storage');
    assert.equal(await store.put('source', new ArrayBuffer(9)), false);
});
