const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const crypto = require('node:crypto');
const utils = require('../mygrain-utils.js');

const html = fs.readFileSync(process.env.RANDOMISE_VARIATION_SOURCE || path.join(__dirname, '../index.html'), 'utf8');
const evidence = process.env.RANDOMISE_VARIATION_EVIDENCE;
const measurements = {};

function functionSource(name, asynchronous = false) {
    const start = html.indexOf(`        ${asynchronous ? 'async ' : ''}function ${name}(`);
    assert.notEqual(start, -1, name);
    return html.slice(start, html.indexOf('\n        }', start) + '\n        }'.length);
}

function fixture(seed = 'variation', length = 16) {
    const math = Object.create(Math);
    math.random = utils.createSeededRandom(seed);
    const context = vm.createContext({
        Math: math, Date: { now: () => 123456789 }, console,
        mygrainUtils: utils,
        getPatternLengthSteps: () => length,
        getDrumMachinePatternLength: () => length,
        PATTERN_STEPS_PER_BAR: 16,
        drumMachineExtraTracks: {},
        drumMachineKickBuffer: {}, drumMachineSnareBuffer: {},
        generatedSourceLowNoiseMode: false, tonalDrumsEnabled: false,
        sourceMutationSerial: 0,
        lastSourceWriteAt: 0, lastGeneratedSourceWriteAt: 0,
        sequencerBPM: 120,
        clampBpmValue: value => Number(value),
        document: { getElementById: () => ({ value: 120 }) },
        setStatus() {},
        audioContext: {
            sampleRate: 8000,
            createBuffer(channels, frames, sampleRate) {
                const data = Array.from({ length: channels }, () => new Float32Array(frames));
                return { numberOfChannels: channels, length: frames, sampleRate, duration: frames / sampleRate,
                    getChannelData: channel => data[channel] };
            }
        },
        async applyLoadedAudioBuffer(buffer) { context.rendered = buffer; }
    });
    for (const name of ['quantizePitchOffsetToScale', 'buildLoopBlueprint', 'buildGeneratedSourceDrumBlueprint', 'isTonalDrumRecipe', 'buildRandomDrumMachinePattern']) {
        vm.runInContext(functionSource(name), context);
    }
    vm.runInContext(functionSource('generateRandomSourceSample', true).replace('            let peak = 0;', '            globalThis.renderEvents = events;\n            let peak = 0;'), context);
    return context;
}

function profile(seed, id = 'straight') {
    return { id, label: id, generationSeed: seed, root: 'C2', densityBias: .55, energy: .7,
        scale: { name: 'minor-grid', intervals: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 22] } };
}

test('seeded musical phrases vary their contour rather than retaining the same rising riff', () => {
    const context = fixture();
    const oldContour = [0, 2, 3, 5, 7, 8, 10, 0];
    let matches = 0;
    let active = 0;
    const contours = new Set();
    for (let index = 0; index < 128; index += 1) {
        const chosen = profile(`phrase-${index}`);
        const blueprint = context.buildLoopBlueprint(chosen);
        assert.deepEqual(blueprint, context.buildLoopBlueprint(chosen));
        const rhythm = utils.generateRhythmicStepBlueprint({ seed: chosen.generationSeed, archetype: chosen.id, stepCount: 16 });
        assert.deepEqual(Array.from(blueprint.pattern.enabled), rhythm.enabled);
        assert.deepEqual(Array.from(blueprint.pattern.velocities), rhythm.velocities);
        const contour = [];
        blueprint.pattern.pitchOffsets.forEach((offset, step) => {
            if (!blueprint.pattern.enabled[step]) return;
            const audibleOffset = context.quantizePitchOffsetToScale(offset, chosen.scale.intervals);
            const pitchClass = ((audibleOffset % 12) + 12) % 12;
            assert.ok(chosen.scale.intervals.some(interval => interval % 12 === pitchClass));
            assert.ok(audibleOffset >= -12 && audibleOffset <= 24);
            active += 1;
            if (pitchClass === oldContour[step % 8]) matches += 1;
            contour.push(pitchClass);
        });
        contours.add(contour.join(','));
    }
    measurements.phrases = { takes: 128, oldRiffAgreement: matches / active, uniqueAudibleContours: contours.size };
    assert.ok(matches / active < .35, JSON.stringify(measurements.phrases));
    assert.ok(contours.size >= 80, JSON.stringify(measurements.phrases));
});

test('hat randomisation can omit every previously forced even-step position', () => {
    const hitCounts = Array(16).fill(0);
    const masks = new Set();
    for (let index = 0; index < 256; index += 1) {
        const pattern = fixture(`hats-${index}`).buildRandomDrumMachinePattern('hat');
        assert.equal(pattern.length, 16);
        assert.ok(pattern.some(Boolean));
        masks.add(pattern.map(Number).join(''));
        pattern.forEach((hit, step) => { if (hit) hitCounts[step] += 1; });
    }
    measurements.hats = { takes: 256, uniqueMasks: masks.size, stepOccupancy: hitCounts.map(count => count / 256) };
    for (let step = 0; step < 16; step += 2) assert.ok(hitCounts[step] < 240, `step ${step} forced ${hitCounts[step]}/256 times`);
    assert.ok(masks.size > 100, JSON.stringify(measurements.hats));
});

test('source-grid collisions keep one strongest hit per category and beat rather than a piled-up layer', async () => {
    const context = fixture();
    const recipe = { family: 'kickPunch', category: 'kick', level: .8, toneFreq: 55, durationSteps: 4 };
    const sourceBlueprint = { paletteSize: 1, grooveLabel: 'collision fixture', events: [
        { step: 0, velocity: .9, recipe },
        { step: 1, velocity: .2, recipe },
        { step: 2, velocity: .4, recipe },
        { step: 3, velocity: .5, recipe },
        { step: 4, velocity: 1, recipe },
        { step: 4, velocity: .3, recipe: { ...recipe, category: 'snare', family: 'snareDust' } }
    ] };
    await context.generateRandomSourceSample({ profile: profile('collision'), sourceBlueprint });
    const keys = context.renderEvents.map(event => `${event.time}:${event.category}`);
    measurements.collisions = { inputHits: 6, renderedHits: keys.length, duplicateHits: keys.length - new Set(keys).size };
    assert.equal(keys.length, 3);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(context.renderEvents.find(event => event.time === 0 && event.category === 'kick').amp, .8 * .9 * 1.12);
    assert.equal(context.renderEvents.find(event => event.time === .5 && event.category === 'kick').amp, .8 * 1.12);
    assert.equal(context.rendered.duration, 2);
    assert.ok(context.renderEvents.every(event => Number.isInteger(event.time / .5)));
    assert.ok(context.rendered.getChannelData(0).some(value => Math.abs(value) > .05));
});

test('fresh seeded choices render genuinely distinct stereo PCM without stale buffers or timing drift', async () => {
    const hashes = new Set();
    const duplicateCounts = [];
    for (let index = 0; index < 12; index += 1) {
        const context = fixture(`pcm-${index}`);
        const chosen = profile(`pcm-${index}`, ['straight', 'sparse', 'syncopated'][index % 3]);
        await context.generateRandomSourceSample({ profile: chosen });
        const first = context.rendered;
        const hash = crypto.createHash('sha256').update(Buffer.from(first.getChannelData(0).buffer)).digest('hex');
        hashes.add(hash);
        const keys = context.renderEvents.map(event => `${event.time}:${event.category}`);
        duplicateCounts.push(keys.length - new Set(keys).size);
        assert.equal(first.numberOfChannels, 2);
        assert.equal(first.length, 16000);
        assert.ok(first.getChannelData(0).some(value => Math.abs(value) > .05));
        assert.ok(first.getChannelData(1).some(value => Math.abs(value) > .05));
        assert.ok(first.getChannelData(0).every(Number.isFinite));
        assert.ok(context.renderEvents.every(event => Number.isInteger(event.time / .5)));
        await context.generateRandomSourceSample({ profile: chosen });
        assert.notEqual(first, context.rendered);
        assert.deepEqual(first.getChannelData(0), context.rendered.getChannelData(0));
    }
    measurements.pcm = { takes: 12, distinctRenderedBuffers: hashes.size, duplicateCounts };
    assert.equal(hashes.size, 12);
    assert.ok(duplicateCounts.every(count => count === 0));
});

test('Randomize, Mega and Sparse retain the shared generation path and settle barrier', () => {
    assert.match(html, /performanceRandomizeBtn\?\.addEventListener\('click',[\s\S]*?document\.getElementById\('randomizeBtn'\)\?\.click\(\)/);
    assert.match(html, /document\.getElementById\('randomizeBtn'\)\.addEventListener\('click',[\s\S]*?await runPatchRandomization\(\)/);
    const mega = functionSource('runMegaRandomization', true);
    assert.match(mega, /patchResult = await runPatchRandomization\(\)/);
    assert.match(mega, /await waitForMegaRandomLoadsToSettle\(\)/);
    assert.match(html, /await runMegaRandomization\(\{ sparseMode: true \}\)/);
    assert.match(functionSource('runPatchRandomization', true), /blueprint: loopBlueprint,\s*sourceBlueprint/);
});

test.after(() => {
    if (evidence) {
        fs.mkdirSync(evidence, { recursive: true });
        fs.writeFileSync(path.join(evidence, 'variation-metrics.json'), JSON.stringify(measurements, null, 2));
    }
});
