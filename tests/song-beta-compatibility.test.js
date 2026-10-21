const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../song-beta-adapter.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const bindings = source.slice(source.indexOf('    const audioBindings ='), source.indexOf('    const metadataBindings ='));
const audioKeys = [...bindings.matchAll(/\['([^']+)', \(\) =>/g)].map(match => match[1]).concat('drumClap', 'drumCymbals', 'drumEtc');

function audioBytes() {
    const bytes = Buffer.alloc(44 + 64 * 2);
    bytes.write('RIFF');
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(8000, 24);
    bytes.writeUInt32LE(16000, 28);
    bytes.writeUInt16LE(2, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(128, 40);
    for (let frame = 0; frame < 64; frame += 1) bytes.writeInt16LE(frame * 257 - 8192, 44 + frame * 2);
    return new Uint8Array(bytes);
}

function fixture() {
    const context = {
        Uint8Array, Uint32Array, ArrayBuffer, DataView, Blob, TextEncoder, TextDecoder,
        window: { MygrainQTheory: require('../q-theory.js') },
        audioBindings: audioKeys.map(key => [key]), audioContext: { sampleRate: 48000 }
    };
    vm.createContext(context);
    vm.runInContext(html.slice(html.indexOf('        function getCrc32Table('), html.indexOf('        function getPatchBastardLoopReferences(')), context);
    vm.runInContext(source.slice(source.indexOf('    function cloneJson('), source.indexOf('    function batchSongUiRestore(')), context);
    vm.runInContext(`globalThis.adapter = {${source.slice(source.indexOf('        inspectPart('), source.indexOf('        async decode('))}};`, context);
    const snapshot = {
        format: 'mygrain-song-part', version: 1, createdAt: '2026-10-01T10:00:00Z',
        state: context.prepareSongState({ modes: {}, patternLength: 16, globalBpm: '120' }),
        extra: { freezeStateVersion: 1, audioSlots: Object.fromEntries(audioKeys.map(key => [key, key === 'grainASample'])),
            sequencerSteps: Array.from({ length: 16 }, () => ({ pitch: 'C4', enabled: true })),
            controls: [], metadata: { bastardK: null, bastardMPlus: null } },
        assets: [{ key: 'grainASample', path: 'audio/grainASample.wav', channels: 1, frames: 64, sampleRate: 8000 }]
    };
    snapshot.state.q = context.window.MygrainQTheory.defaults();
    const bytes = audioBytes();
    return { context, snapshot, bytes, adapter: context.adapter,
        async archive(entries = [{ path: 'audio/grainASample.wav', data: bytes }]) {
            return (await context.createStoredZip([{ path: 'song-part.json', data: JSON.stringify(snapshot) }, ...entries])).arrayBuffer();
        } };
}

function removeLane(snapshot, name) {
    const expression = name === 'Q' ? /^q$/ : new RegExp(`bastard(?:Loop)?${name}`, 'i');
    for (const group of ['modes', 'sliders', 'selects']) {
        for (const key of Object.keys(snapshot.state[group])) if (expression.test(key)) delete snapshot.state[group][key];
    }
    if (name === 'Q') delete snapshot.state.q;
    for (const key of Object.keys(snapshot.extra.audioSlots)) if (new RegExp(`^bastard${name}(?:Render)?$`).test(key)) delete snapshot.extra.audioSlots[key];
    delete snapshot.extra.metadata[`bastard${name}`];
}

test('absent K is normalized without mutation, preserving every original audio byte and capture field', async () => {
    const current = fixture();
    removeLane(current.snapshot, 'K');
    const original = JSON.stringify(current.snapshot);
    const info = current.adapter.inspectPart(await current.archive());
    assert.deepEqual([...info.upgrade.lanes], ['K']);
    assert.equal(info.snapshot.state.modes.bastardLoopKEnabled, false);
    assert.equal(info.snapshot.state.modes.bastardLoopKDurationSeconds, 0);
    assert.equal(info.snapshot.extra.audioSlots.bastardK, false);
    assert.equal(info.snapshot.extra.audioSlots.bastardKRender, false);
    assert.equal(info.snapshot.extra.metadata.bastardK, null);
    assert.equal(JSON.stringify(current.snapshot), original);
    const archive = await (await current.adapter.upgradePart(info)).arrayBuffer();
    const entries = current.context.parseStoredZipEntries(archive);
    assert.deepEqual(Buffer.from(entries.get('audio/grainASample.wav')), Buffer.from(current.bytes));
    const upgraded = current.adapter.inspectPart(archive);
    assert.equal(upgraded.upgrade, null);
    assert.equal(upgraded.snapshot.createdAt, current.snapshot.createdAt);
    assert.deepEqual(JSON.parse(JSON.stringify(upgraded.snapshot.assets)), current.snapshot.assets);
    assert.deepEqual(JSON.parse(JSON.stringify(upgraded.snapshot.extra.sequencerSteps)), current.snapshot.extra.sequencerSteps);
    assert.deepEqual(JSON.parse(JSON.stringify(upgraded.snapshot.state.q)), current.snapshot.state.q);
});

test('the registry also fills genuinely absent M+ and Q with silent empty defaults, once', async () => {
    const current = fixture();
    for (const name of ['K', 'MPlus', 'Q']) removeLane(current.snapshot, name);
    const info = current.adapter.inspectPart(await current.archive());
    assert.deepEqual([...info.upgrade.lanes], ['K', 'M+', 'Q']);
    assert.equal(info.snapshot.state.modes.bastardLoopMPlusEnabled, false);
    assert.equal(info.snapshot.extra.audioSlots.bastardMPlus, false);
    assert.equal(info.snapshot.extra.audioSlots.bastardMPlusRender, false);
    assert.equal(info.snapshot.extra.audioSlots.bastardQ, false);
    assert.equal(info.snapshot.state.q.enabled, false);
    assert.equal(info.snapshot.state.q.bank, null);
    assert.ok(info.snapshot.state.q.sequence.every(step => step === null));
    const archive = await (await current.adapter.upgradePart(info)).arrayBuffer();
    assert.equal(current.adapter.inspectPart(archive).upgrade, null);
});

test('partial slots and any saved lane declaration forbid additive migration, including false or null declarations', async () => {
    const mutations = [
        snapshot => { snapshot.extra.audioSlots.bastardKRender = false; },
        snapshot => { snapshot.extra.audioSlots.bastardK = true; },
        snapshot => { snapshot.state.modes.bastardLoopKEnabled = true; },
        snapshot => { snapshot.state.modes.bastardLoopKEnabled = false; },
        snapshot => { snapshot.state.sliders.performanceBastardLoopKLevel = '50'; },
        snapshot => { snapshot.extra.metadata.bastardK = null; },
        snapshot => { snapshot.extra.controls.push({ id: 'performanceBastardLoopKRecordLength', value: '1' }); },
        snapshot => { snapshot.extra.performanceSourceLayerSolo = ['bastardK']; },
        snapshot => { snapshot.state.modes.keyboardSoundSource = 'k'; },
        snapshot => { snapshot.assets.push({ key: 'bastardK', path: 'audio/bastardK.wav', channels: 1, frames: 64, sampleRate: 8000 }); }
    ];
    for (const mutate of mutations) {
        const current = fixture();
        removeLane(current.snapshot, 'K');
        mutate(current.snapshot);
        assert.throws(() => current.context.normalizeSongAudioInventory(current.snapshot), /inventory is incomplete/);
    }
});

test('Q settings without a slot remain a genuine inventory failure rather than being discarded', async () => {
    const current = fixture();
    delete current.snapshot.extra.audioSlots.bastardQ;
    assert.throws(() => current.context.normalizeSongAudioInventory(current.snapshot), /inventory is incomplete/);
});

test('the historic q:null no-settings placeholder can acquire an explicitly empty Q lane', async () => {
    const current = fixture();
    removeLane(current.snapshot, 'Q');
    current.snapshot.state.q = null;
    const info = current.adapter.inspectPart(await current.archive());
    assert.deepEqual([...info.upgrade.lanes], ['Q']);
    assert.equal(info.snapshot.extra.audioSlots.bastardQ, false);
    assert.equal(info.snapshot.state.q.enabled, false);
    assert.equal(info.snapshot.state.q.bank, null);
});

test('unrelated metadata labels and summaries are not treated as lane routing evidence', async () => {
    const current = fixture();
    removeLane(current.snapshot, 'K');
    current.snapshot.extra.metadata.bastardA = { summary: 'K', filename: 'bastardK', source: 'K', tags: ['K', 'Q', 'M+'] };
    current.snapshot.extra.controls.push({ id: 'unrelatedName', type: 'number', value: 'K' });
    const info = current.adapter.inspectPart(await current.archive());
    assert.deepEqual([...info.upgrade.lanes], ['K']);
    assert.deepEqual(JSON.parse(JSON.stringify(info.snapshot.extra.metadata.bastardA)), current.snapshot.extra.metadata.bastardA);
});

test('actual solo routing references still forbid an absent-lane upgrade', () => {
    for (const field of ['keyboardSoundSource', 'performanceSourceLayerSolo', 'performanceSourceLayerSoloSnapshot']) {
        const current = fixture();
        removeLane(current.snapshot, 'K');
        if (field === 'keyboardSoundSource') current.snapshot.state.modes[field] = 'K';
        else current.snapshot.extra[field] = field.endsWith('Snapshot') ? { active: ['K'] } : ['K'];
        assert.throws(() => current.context.normalizeSongAudioInventory(current.snapshot), /inventory is incomplete/);
    }
});

test('loop-layer solo selections reject missing lanes in array and legacy-string form', () => {
    for (const [name, reference] of [['K', 'bastardk'], ['MPlus', 'bastardmplus'], ['Q', 'bastardq']]) {
        for (const selection of [reference, [reference], `bastarda, ${reference}`, ` ${reference} `, [reference.toUpperCase()], [` ${reference.toUpperCase()} `]]) {
            const current = fixture();
            removeLane(current.snapshot, name);
            current.snapshot.state.modes.loopLayerSolo = selection;
            assert.throws(() => current.context.normalizeSongAudioInventory(current.snapshot), /inventory is incomplete/);
        }
    }
});

test('null Q placeholders never hide genuine Q controls or orphaned samples', () => {
    for (const mutate of [
        snapshot => { snapshot.extra.controls.push({ id: 'qEnabled', type: 'checkbox', checked: false }); },
        snapshot => { snapshot.assets.push({ key: 'bastardQ', path: 'audio/bastardQ.wav' }); },
        snapshot => { snapshot.extra.performanceSourceLayerSolo = ['Q']; }
    ]) {
        const current = fixture();
        removeLane(current.snapshot, 'Q');
        current.snapshot.state.q = null;
        mutate(current.snapshot);
        assert.throws(() => current.context.normalizeSongAudioInventory(current.snapshot), /inventory is incomplete/);
    }
});

test('required legacy lanes and declared real audio still fail strictly', async () => {
    for (const mutate of [
        snapshot => { delete snapshot.extra.audioSlots.bastardA; },
        snapshot => { snapshot.extra.audioSlots.bastardK = true; },
        snapshot => { snapshot.extra.audioSlots.grainASample = false; },
        snapshot => { snapshot.assets[0].frames += 1; },
        snapshot => { snapshot.extra.audioSlots.phoneOnly = false; }
    ]) {
        const current = fixture();
        mutate(current.snapshot);
        const archive = await current.archive();
        assert.throws(() => current.adapter.inspectPart(archive), /inventory|manifest|mismatched/);
    }
});

test('missing, unlisted, duplicated, or checksum-corrupt WAV entries never get upgraded', async () => {
    const current = fixture();
    removeLane(current.snapshot, 'K');
    for (const entries of [[], [{ path: 'audio/phoneOnly.wav', data: current.bytes }],
        [{ path: 'audio/grainASample.wav', data: current.bytes }, { path: 'audio/grainASample.wav', data: current.bytes }]]) {
        const archive = await current.archive(entries);
        assert.throws(() => current.adapter.inspectPart(archive), /manifest|duplicate/);
    }
    const archive = await current.archive();
    const corrupted = Buffer.from(archive);
    corrupted[corrupted.indexOf('RIFF') + 44] ^= 1;
    assert.throws(() => current.adapter.inspectPart(archive), /corrupt/);
});

test('inventories are not invented for pre-portable snapshots', async () => {
    const current = fixture();
    delete current.snapshot.extra.freezeStateVersion;
    delete current.snapshot.extra.audioSlots;
    const info = current.adapter.inspectPart(await current.archive());
    assert.equal(info.upgrade, null);
    assert.equal(info.snapshot.extra.audioSlots, undefined);
});

test('old songs without ETC upgrade to an explicitly empty lane without mutating Crash or audio', async () => {
    const current = fixture();
    delete current.snapshot.extra.audioSlots.drumEtc;
    current.snapshot.state.modes.drumMachineExtraTracks = { cymbals: { pattern: [true], metadata: { fileName: 'crash.wav' } } };
    const original = JSON.stringify(current.snapshot);
    const info = current.adapter.inspectPart(await current.archive());
    assert.deepEqual([...info.upgrade.lanes], ['ETC']);
    assert.equal(info.snapshot.extra.audioSlots.drumEtc, false); assert.equal(info.snapshot.extra.metadata.drumEtc, null);
    assert.equal(JSON.stringify(current.snapshot), original);
    assert.deepEqual(JSON.parse(JSON.stringify(info.snapshot.state.modes.drumMachineExtraTracks)), current.snapshot.state.modes.drumMachineExtraTracks);
    const archive = await (await current.adapter.upgradePart(info)).arrayBuffer();
    assert.equal(current.adapter.inspectPart(archive).upgrade, null);
});

test('ETC settings or audio without its declared inventory slot are rejected rather than silently discarded', () => {
    for (const mutate of [
        snapshot => { snapshot.state.modes.drumMachineExtraTracks = { etc: { pattern: [true] } }; },
        snapshot => { snapshot.state.sliders.drumMachineEtcFilterCutoff = '33'; },
        snapshot => { snapshot.extra.metadata.drumEtc = { fileName: 'manual.wav' }; },
        snapshot => { snapshot.assets.push({ key: 'drumEtc', path: 'audio/drumEtc.wav' }); }
    ]) {
        const current = fixture(); delete current.snapshot.extra.audioSlots.drumEtc; mutate(current.snapshot);
        assert.throws(() => current.context.normalizeSongAudioInventory(current.snapshot), /inventory is incomplete for drumEtc/);
    }
});
