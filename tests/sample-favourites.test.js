const test = require('node:test');
const assert = require('node:assert/strict');
const { Library, itemKey } = require('../sample-favourites.js');

const library = (revision = 0) => ({ ok: true, revision, groups: [{ id: 'default', name: 'Favourites', items: {} }] });
const response = body => ({ ok: true, json: async () => body });

test('favourite identities separate repositories, sources and complete relative paths', () => {
    assert.notEqual(itemKey('sample:hats', 'folder/one.wav'), itemKey('sample:crash', 'folder/one.wav'));
    assert.notEqual(itemKey('sample:hats', 'folder/one.wav'), itemKey('sample:hats', 'other/one.wav'));
    assert.notEqual(itemKey('repository:wav', 'one.wav'), itemKey('repository:midi', 'one.wav'));
    assert.deepEqual(JSON.parse(itemKey('sample:"a', 'b:c.wav')), ['sample:"a', 'b:c.wav']);
});

test('named favourite filters and all-favourites filters work independently per browser', () => {
    const favourites = new Library({ fetch: async () => response(library()) });
    const key = itemKey('sample:hats', 'closed.wav');
    favourites.groups = [{ id: 'default', name: 'Favourites', items: {} }, { id: 'rides', name: 'Rides', items: { [key]: { name: 'Smooth hat' } } }];
    assert.equal(favourites.matches('samples', key), true);
    favourites.state('samples').filter = 'default';
    assert.equal(favourites.matches('samples', key), false);
    favourites.state('samples').filter = 'rides';
    assert.equal(favourites.matches('samples', key), true);
    favourites.state('samples').filter = '*';
    assert.equal(favourites.matches('samples', key), true);
    assert.equal(favourites.matches('samples', itemKey('sample:crash', 'closed.wav')), false);
    assert.equal(favourites.state('wav').filter, '');
    assert.match(favourites.searchText(key), /Smooth hat/);
});

test('a stale GET cannot overwrite a newer confirmed change', async () => {
    const queue = [library(5), library(3)];
    const favourites = new Library({ fetch: async () => response(queue.shift()) });
    await favourites.refresh();
    favourites.groups[0].items.keep = { name: 'Keep' };
    await favourites.refresh();
    assert.equal(favourites.revision, 5);
    assert.equal(favourites.groups[0].items.keep.name, 'Keep');
});

test('request failures retain the last good favourite data', async () => {
    let calls = 0;
    const favourites = new Library({ fetch: async () => { if (calls++ === 0) return response(library(1)); throw new Error('Offline'); } });
    await favourites.refresh();
    favourites.groups[0].items.keep = { name: 'Keep' };
    assert.equal(await favourites.change('samples', { operation: 'set' }), false);
    assert.equal(favourites.groups[0].items.keep.name, 'Keep');
});

test('view preferences are stored independently of patch and song state', () => {
    const values = new Map();
    const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
    const favourites = new Library({ storage });
    favourites.state('wav').filter = '*';
    favourites.remember();
    const restored = new Library({ storage });
    assert.equal(restored.state('wav').filter, '*');
    assert.deepEqual([...values.keys()], ['mygrain-favourite-views-v1']);
    assert.equal(restored.groups.length, 0);
});

test('creating a collection selects its server-issued stable ID', async () => {
    const result = { ...library(1), selectedGroupId: 'new' };
    result.groups.push({ id: 'new', name: 'New', items: {} });
    const favourites = new Library({ fetch: async () => response(result) });
    assert.equal(await favourites.change('samples', { operation: 'create', name: 'New' }), true);
    assert.equal(favourites.group('samples').id, 'new');
});

test('concurrent refresh calls share one request', async () => {
    let calls = 0;
    let resolve;
    const pending = new Promise(complete => { resolve = complete; });
    const favourites = new Library({ fetch: async () => { calls += 1; await pending; return response(library(1)); } });
    const requests = [favourites.refresh(), favourites.refresh()];
    resolve();
    await Promise.all(requests);
    assert.equal(calls, 1);
});

test('renaming a source sends stable-reference migration, not a source-file request', async () => {
    const writes = [];
    const favourites = new Library({ fetch: async (url, options) => { writes.push({ url, body: JSON.parse(options.body) }); return response(library(1)); } });
    await favourites.renamed('repository:wav', 'old.wav', 'new.wav');
    assert.deepEqual(writes, [{ url: '/mygrain/api/favourites', body: { operation: 'rekey', oldKey: itemKey('repository:wav', 'old.wav'), newKey: itemKey('repository:wav', 'new.wav') } }]);
});
