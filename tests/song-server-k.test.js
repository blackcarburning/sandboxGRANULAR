const test = require('node:test');
const assert = require('node:assert/strict');
const { Controller } = require('../song-beta');

function fixture() {
    const song = { id: 'copied-12345678', revision: 5, parts: [{ id: 'a'.repeat(32), sha256: 'b'.repeat(64) }] };
    const c = { song, key: 'private-library', generation: 3, playing: false, editing: null,
        adapter: { assertNotRecording() {} }, async ensureEditing() {}, status() {}, invalidate() {},
        acceptSong(saved) { this.accepted = saved; this.song = saved; },
        async request(path, options) {
            assert.equal(path, '/copied-12345678/convert-k'); assert.equal(options.method, 'POST');
            assert.equal(options.body, undefined);
            return { ok: true, converted: 1, song: { ...song, revision: 6 } };
        }, readPart() { assert.fail('No original download'); }, upgradeSongParts() { assert.fail('No device conversion'); } };
    return c;
}

test('server K conversion accepts an idempotent zero-change response without a revision bump', async () => {
    const c = fixture(); c.request = async () => ({ ok: true, converted: 0, song: c.song });
    await Controller.prototype.convertKTracks.call(c); assert.equal(c.song.revision, 5);
});

test('late server conversion cannot replace a changed generation, library, Song, revision or source', async () => {
    for (const change of ['generation', 'key', 'song', 'revision', 'source']) {
        const c = fixture(), saved = { ...c.song, revision: 6 };
        c.request = async () => {
            if (change === 'generation') c.generation++;
            if (change === 'key') c.key = 'different-library';
            if (change === 'song') c.song = { ...c.song, id: 'other-12345678' };
            if (change === 'revision') c.song = { ...c.song, revision: 8 };
            if (change === 'source') c.song = { ...c.song, parts: [{ ...c.song.parts[0], sha256: 'f'.repeat(64) }] };
            return { ok: true, converted: 1, song: saved };
        };
        await assert.rejects(Controller.prototype.convertKTracks.call(c), e => e.name === 'AbortError');
        assert.equal(c.accepted, undefined);
        assert.equal(Boolean(c.revisionConflict), !['key', 'song'].includes(change));
    }
});

test('invalid count, Song identity or revision is rejected without accepting a server result', async () => {
    for (const bad of [{ converted: -1 }, { converted: 65 }, { converted: 1.5 }, { song: { id: 'other-12345678', revision: 6 } }, { song: { id: 'copied-12345678', revision: 8 } }]) {
        const c = fixture(); c.request = async () => ({ ok: true, converted: 1, song: { ...c.song, revision: 6 }, ...bad });
        await assert.rejects(Controller.prototype.convertKTracks.call(c), /Unexpected server K/);
        assert.equal(c.accepted, undefined); assert.equal(c.revisionConflict, true);
    }
});

test('legacy helper has no device-side five-track K conversion escape hatch', async () => {
    const c = { generation: 3, editing: null, snapshots: new Map(), uniqueParts: () => [{id:'one'}], armStage() {},
        async readPartMetadata() { return { upgrade: { lanes: ['K five-track recorder'] } }; },
        readPart() { assert.fail('No original download'); }, ensureEditing() { assert.fail('No device conversion'); } };
    await assert.rejects(Controller.prototype.upgradeSongParts.call(c, 3), /Device-side K conversion is disabled/);
});
