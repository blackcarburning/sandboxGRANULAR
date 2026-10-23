const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit } = require('playwright-core');
const { sources, fixture } = require('./grain-sustain-fixture.cjs');
const production = sources(), baseline = process.env.MYGRAIN_GRAIN_BASELINE ? sources(process.env.MYGRAIN_GRAIN_BASELINE) : null;
const evidence = process.env.MYGRAIN_GRAIN_EVIDENCE || '/tmp/mygrain-grain-sustain';
fs.mkdirSync(evidence, { recursive: true });
(async () => {
    const results = [];
    for (const [engine, kind] of Object.entries({ chromium, webkit })) {
        const browser = await kind.launch(engine === 'chromium' ? { executablePath: '/snap/bin/chromium', args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {});
        try {
            const page = await browser.newPage();
            for (const sampleRate of [44100, 48000]) {
                const cases = [
                    ...(baseline ? [{ label: 'previous-six-source-engine', ...baseline, notes: 1, broken: true }] : []),
                    ...[1, 4, 6].map(notes => ({ label: `default-${notes}-notes`, ...production, notes })),
                    { label: 'maximum-smoothing-chord', ...production, notes: 4, layers: ['A', 'B'].map(key => ({ key, sizeSeconds: .15, blend: 1, smoothing: 1, attackSeconds: .02, decaySeconds: .03, releaseSeconds: .2, volume: .4 })) },
                    { label: 'short-A-long-B-chord', ...production, notes: 4, layers: [{ key: 'A', sizeSeconds: .02 }, { key: 'B', sizeSeconds: .5 }].map(layer => ({ ...layer, blend: .5, smoothing: .5, attackSeconds: .005, decaySeconds: .01, releaseSeconds: .02, volume: .5 })) }
                ];
                for (const config of cases) {
                    const result = await page.evaluate(async ({ config, sampleRate, fixtureSource }) => {
                        const offline = new OfflineAudioContext(2, sampleRate * 4, sampleRate);
                        const make = (0, eval)('(' + fixtureSource + ')');
                        const f = make(config, offline);
                        const schedule = f.run((code, state) => Object.assign(state,
                            Function(...Object.keys(state), code + '\nreturn { getConcurrentGrainSourceCount, getGranularLayerIntervalSeconds, scheduleActiveGrains };')(...Object.values(state))));
                        const audio = await offline.startRendering(), samples = audio.getChannelData(0);
                        let silence = 0, run = 0, longest = 0, sum = 0, peak = 0;
                        for (let i = Math.round(sampleRate * .5); i < sampleRate * 2.8; i++) {
                            const value = Math.abs(samples[i]); sum += value * value; peak = Math.max(peak, value);
                            if (value < .00001) { silence++; run++; longest = Math.max(longest, run); } else run = 0;
                        }
                        return { ...schedule, silentPercent: silence / (sampleRate * 2.3) * 100, longestSilenceMs: longest / sampleRate * 1000, rms: Math.sqrt(sum / (sampleRate * 2.3)), peak };
                    }, { config, sampleRate, fixtureSource: fixture.toString() });
                    console.log(JSON.stringify({ engine, sampleRate, label: config.label, ...result }));
                    if (config.broken) assert.ok(result.longestSilenceMs > 100, 'Previous deployed engine must reproduce the audible dropout');
                    else {
                        assert.ok(result.rms > .01 && result.peak < 1, 'Real non-silent unclipped PCM');
                        assert.ok(result.longestSilenceMs < 2 && result.silentPercent < .1, 'Held grain output must not contain silent holes');
                        assert.ok(result.maxPool <= production.cap);
                    }
                    results.push({ engine, sampleRate, label: config.label, ...result });
                }
            }
            await page.close();
        } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(evidence, 'pcm-results.json'), JSON.stringify(results, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
