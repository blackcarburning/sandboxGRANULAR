const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const original = JSON.parse(fs.readFileSync(path.join(root, 'SAMPLES_Q/manifest.json')));
const compact = JSON.parse(fs.readFileSync(path.join(root, 'SAMPLES_Q_KEYBOARD/catalog.json')));
const comparisonIds = new Set(['A0v16', 'C1v4', 'C4v16', 'Ds6v8', 'C8v4', 'C8v16']);

async function main() {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await browser.newPage();
        await page.evaluate(() => { window.audioContexts = [44100, 48000].map(sampleRate => new AudioContext({ sampleRate })); });
        let maximumFrameError = 0;
        const comparisons = [];
        for (const sample of compact.samples) {
            const bytes = fs.readFileSync(path.join(root, 'SAMPLES_Q_KEYBOARD', sample.file));
            assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), sample.sha256);
            const source = original.samples.find(candidate => candidate.id === sample.id);
            const reference = comparisonIds.has(sample.id) ? fs.readFileSync(path.join(root, 'SAMPLES_Q', source.file)).toString('base64') : null;
            const results = await page.evaluate(async ({ encoded, reference, source }) => {
                const decodeBytes = content => Uint8Array.from(atob(content), character => character.charCodeAt(0)).buffer;
                const results = [];
                for (const context of audioContexts) {
                    const buffer = await context.decodeAudioData(decodeBytes(encoded));
                    const frameDelta = buffer.length - Math.round(source.frames * context.sampleRate / source.sampleRate);
                    const result = { sampleRate: context.sampleRate, channels: buffer.numberOfChannels, frameDelta, frameError: Math.abs(frameDelta) };
                    if (reference) {
                        const original = await context.decodeAudioData(decodeBytes(reference));
                        let cross = 0;
                        let sourceEnergy = 0;
                        let compactEnergy = 0;
                        let tailSourceEnergy = 0;
                        let tailCompactEnergy = 0;
                        for (let channel = 0; channel < 2; channel += 1) {
                            const expected = original.getChannelData(channel);
                            const actual = buffer.getChannelData(channel);
                            for (let frame = 0; frame < Math.min(context.sampleRate, expected.length, actual.length); frame += 1) {
                                cross += expected[frame] * actual[frame];
                                sourceEnergy += expected[frame] ** 2;
                                compactEnergy += actual[frame] ** 2;
                            }
                            for (let frame = Math.max(0, Math.min(expected.length, actual.length) - context.sampleRate); frame < Math.min(expected.length, actual.length); frame += 1) {
                                tailSourceEnergy += expected[frame] ** 2;
                                tailCompactEnergy += actual[frame] ** 2;
                            }
                        }
                        result.onsetCorrelation = cross / Math.sqrt(sourceEnergy * compactEnergy);
                        result.tailEnergyRatio = tailCompactEnergy / tailSourceEnergy;
                    }
                    results.push(result);
                }
                return results;
            }, { encoded: bytes.toString('base64'), reference, source });
            for (const result of results) {
                assert.equal(result.channels, 2, `${sample.id}: stereo`);
                assert.ok(result.frameDelta >= -1 && result.frameError < result.sampleRate / 1000, `${sample.id}: full source duration at ${result.sampleRate} Hz`);
                maximumFrameError = Math.max(maximumFrameError, result.frameError);
                if (reference) {
                    assert.ok(result.onsetCorrelation > .98, `${sample.id}: original onset alignment/timbre`);
                    comparisons.push({ id: sample.id, ...result });
                }
            }
        }
        await page.evaluate(async () => { await Promise.all(audioContexts.map(context => context.close())); });
        process.stdout.write(`${JSON.stringify({ samples: compact.samples.length, decodes: compact.samples.length * 2, maximumFrameError, comparisons }, null, 2)}\n`);
    } finally { await browser.close(); }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
