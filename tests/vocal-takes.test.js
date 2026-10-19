const test = require('node:test');
const assert = require('node:assert/strict');
const { defaultTakeName, Library } = require('../vocal-takes.js');

test('version defaults tag the local date/time and loaded song', () => {
    const date = new Date(2026, 9, 14, 9, 5, 3);
    assert.equal(defaultTakeName('Demo Song', date), '2026-10-14_09-05-03_Demo Song');
    assert.equal(defaultTakeName('', date), '2026-10-14_09-05-03_none');
});

test('default version labels sanitize separators and limit length', () => {
    assert.match(defaultTakeName('Verse/Chorus\\Demo\n'), /Verse_Chorus_Demo_/);
    assert.equal(defaultTakeName('s'.repeat(200)).length, 100);
});

test('save writes raw take and metadata to the global API, not song endpoints', async () => {
    const requests = [];
    const library = Object.create(Library.prototype);
    Object.assign(library, {
        userId: 'user', folderId: 'folder',
        adapter: { canSave: () => true, capture: () => ({ wav: new ArrayBuffer(8), bpm: 105, songName: 'Song' }) },
        selectedUser: () => ({ id: 'user' }), field: () => ({ value: 'Take version' }),
        setStatus: () => {}, refresh: async () => {}, rememberSelection: () => {}, group: () => ({}),
        request: async (...args) => { requests.push(args); }
    });
    await library.save();
    assert.match(requests[0][0], /^\/takes\?/);
    assert.match(requests[0][0], /songName=Song/);
    assert.equal(requests[0][1].headers['Content-Type'], 'audio/wav');
    assert.equal(requests[0][1].body.byteLength, 8);
});

test('saving without a selected user or while recording makes no request', async () => {
    const library = Object.create(Library.prototype);
    library.adapter = { canSave: () => false };
    await assert.rejects(library.save(), /Finish recording/);
    library.adapter.canSave = () => true;
    library.selectedUser = () => null;
    await assert.rejects(library.save(), /Choose a user/);
});

test('workspace selection uses its own storage key, not song state', () => {
    const previous = global.localStorage;
    const entries = new Map();
    global.localStorage = { setItem: (key, value) => entries.set(key, value), getItem: key => entries.get(key) };
    try {
        const library = Object.create(Library.prototype);
        library.userId = 'user'; library.folderId = 'folder';
        library.rememberSelection();
        library.userId = ''; library.folderId = '';
        library.restoreSelection();
        assert.equal(library.userId, 'user');
        assert.equal(library.folderId, 'folder');
        assert.deepEqual([...entries.keys()], ['mygrain-vocal-workspace-selection-v1']);
    } finally { global.localStorage = previous; }
});
