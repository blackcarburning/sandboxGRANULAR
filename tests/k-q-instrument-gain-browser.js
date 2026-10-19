const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const base = process.env.MYGRAIN_TEST_URL || 'http://127.0.0.1:18817/mygrain/';
const evidence = process.env.MYGRAIN_GAIN_EVIDENCE || '/tmp/mygrain-k17-gain/current.json';
const baselineSource = process.env.MYGRAIN_GAIN_BASELINE_SOURCE;
const comparison = process.env.MYGRAIN_GAIN_COMPARE;

(async () => {
    const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
    const results = [];
    const errors = [];
    const writes = [];
    try {
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const page = await browser.newPage({ viewport, isMobile: true, hasTouch: true });
            page.setDefaultTimeout(60000);
            page.on('pageerror', error => errors.push(error.message));
            await page.route('**/*', route => {
                const request = route.request();
                if (!['GET', 'HEAD'].includes(request.method())) {
                    writes.push({ method: request.method(), url: request.url() });
                    return route.abort();
                }
                const url = new URL(request.url());
                if (url.origin !== new URL(base).origin || url.pathname.startsWith('/mygrain-bastardloops/')) return route.abort();
                if (baselineSource && url.pathname.endsWith('/q-card.js')) return route.fulfill({ path: baselineSource, contentType: 'application/javascript' });
                return route.continue();
            });
            await page.goto(base, { waitUntil: 'load' });
            await page.locator('#start-btn').tap();
            await page.waitForFunction(() => isAudioGraphReady() && !engineStarting && !stateSaveSuspended);
            const measurements = await page.evaluate(async sampleRate => {
                stateSaveSuspended = true;
                stopAllPerformancePlayback({ silent: true });
                panicAllNotes({ immediate: true, preserveStatus: true });
                const readings = [];
                const baseNotes = [48, 60, 64, 67, 72, 84];
                const measure = buffer => {
                    let peak = 0;
                    let energy = 0;
                    let clipped = 0;
                    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
                        for (const sample of buffer.getChannelData(channel)) {
                            peak = Math.max(peak, Math.abs(sample));
                            energy += sample * sample;
                            if (Math.abs(sample) >= 1) clipped += 1;
                        }
                    }
                    return { peak, rms: Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)), clipped };
                };
                for (const instrument of ['piano', 'strings']) {
                    const densePitches = instrument === 'piano' ? [48, 52, 55, 59, 62, 65, 69] : [36, 43, 48, 52, 55, 62, 66, 72];
                    const notes = [...new Set([...baseNotes, ...densePitches])];
                    for (const path of ['keyboard', 'q']) {
                        const loading = new AudioContext({ sampleRate });
                        await loading.resume();
                        const host = { context: () => loading, output: () => loading.destination,
                            destination: () => loading.destination, bpm: () => 120, soloGain: () => 1 };
                        const loader = path === 'keyboard' ? MygrainQ.createKeyboardPlayer(host) : new MygrainQ.Controller(host);
                        let sampler;
                        if (path === 'keyboard') {
                            await Promise.all(notes.map(midi => loader.prepare(instrument, midi, 127)));
                            await loader.prepare(instrument, 60, 96);
                            sampler = loader.samplers.get(instrument).piano;
                        } else {
                            loader.state.instrument = instrument;
                            loader.piano.select(instrument);
                            await loader.piano.ensure([{ notes, velocity: 127 }, { notes: [60], velocity: 96 }]);
                            sampler = loader.piano;
                        }
                        const decoded = notes.map(midi => ({ midi, ...sampler.source(midi, 127) }));
                        const sourceStats = decoded.map(source => ({ midi: source.midi, ...measure(source.buffer) }));
                        for (const scenario of [
                            { name: 'normal', pitches: [60], velocity: 96, level: .75 },
                            { name: 'full', pitches: [60], velocity: 127, level: 1 },
                            { name: 'half', pitches: [60], velocity: 127, level: .5 },
                            { name: 'muted', pitches: [60], velocity: 127, level: 0 },
                            { name: 'chord', pitches: [60, 64, 67], velocity: 127, level: .75 },
                            { name: 'low', pitches: [48], velocity: 127, level: .75 },
                            { name: 'high', pitches: [72], velocity: 127, level: .75 },
                            { name: 'upper', pitches: [84], velocity: 127, level: .75 },
                            { name: 'saved', pitches: [60], velocity: 127, level: 1 },
                            { name: 'dense', pitches: densePitches, velocity: 127, level: instrument === 'piano' ? .5 : 1,
                                duration: instrument === 'piano' ? .8 : 8 },
                            { name: 'dense-wet', pitches: densePitches, velocity: 127, level: instrument === 'piano' ? .5 : 1,
                                duration: instrument === 'piano' ? .8 : 8, room: 1 }
                        ]) {
                            const duration = scenario.duration ?? 1;
                            const context = new OfflineAudioContext(2, Math.round(sampleRate * (duration + 1.4)), sampleRate);
                            let level = scenario.level;
                            const renderHost = { context: () => context, output: () => context.destination,
                                destination: () => context.destination, volume: () => level,
                                bpm: () => 120, soloGain: () => 1 };
                            const player = path === 'keyboard' ? MygrainQ.createKeyboardPlayer(renderHost) : new MygrainQ.Controller(renderHost);
                            const target = path === 'keyboard' ? player.samplers.get(instrument).piano : player.piano;
                            target.select(instrument);
                            if (scenario.name === 'saved') {
                                const selected = sampler.source(60, 127);
                                target.restored(selected.buffer, { instrument: MygrainQTheory.instruments[instrument].id,
                                    sampleRate: selected.buffer.sampleRate,
                                    samples: [{ ...selected.sample, offset: 0, frames: selected.buffer.length,
                                        loopStart: selected.loopStart * selected.buffer.sampleRate,
                                        loopEnd: selected.loopEnd * selected.buffer.sampleRate }] });
                            } else {
                                target.manifest = sampler.manifest;
                                target.cache = new Map(sampler.cache);
                            }
                            if (path === 'q') {
                                Object.assign(player.state, { instrument, enabled: true, level,
                                    room: scenario.room ?? 0, delay: 0, sampleLength: 1, sampleDecay: 1 });
                                const graph = player.ensureGraph();
                                graph.level.gain.cancelScheduledValues(0);
                                graph.level.gain.setValueAtTime(level, 0);
                            }
                            for (const midi of scenario.pitches) {
                                if (path === 'keyboard') player.startVoice({ context, key: `${instrument}-${midi}`, midi,
                                    options: { instrument, velocity: scenario.velocity, startTime: .1, duration } },
                                    target.source(midi, scenario.velocity));
                                else player.voice(midi, scenario.velocity, .1, duration);
                            }
                            const rendered = await context.startRendering();
                            readings.push({ instrument, path, scenario: scenario.name, sampleRate,
                                ...measure(rendered), sourceStats: scenario.name === 'full' ? sourceStats : undefined });
                            level = 0;
                        }
                        await loading.close();
                    }
                }
                return readings;
            }, viewport.width === 390 ? 44100 : 48000);
            results.push(...measurements.map(reading => ({ viewport, ...reading })));
            await page.screenshot({ path: evidence.replace(/\.json$/, `-${viewport.width}.png`) });
            await page.close();
        }
        fs.writeFileSync(evidence, JSON.stringify({ base, baselineSource, results, errors, writes }, null, 2));
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        for (const reading of results) {
            const label = `${reading.sampleRate}/${reading.instrument}/${reading.path}/${reading.scenario}`;
            assert.ok(Number.isFinite(reading.peak) && Number.isFinite(reading.rms), `${label}: finite PCM`);
            assert.equal(reading.clipped, 0, `${label}: tested notes and chords retain full-scale headroom`);
            if (reading.scenario === 'muted') assert.equal(reading.peak, 0, `${label}: exact mute`);
            else assert.ok(reading.rms > .0001, `${label}: audible`);
            const matching = scenario => results.find(other => other.sampleRate === reading.sampleRate &&
                other.instrument === reading.instrument && other.path === reading.path && other.scenario === scenario);
            if (reading.scenario === 'half') assert.ok(Math.abs(reading.rms / matching('full').rms - .5) < .00001, `${label}: linear level`);
            if (reading.scenario === 'saved') assert.ok(Math.abs(reading.rms / matching('full').rms - 1) < .00001, `${label}: saved bank gain parity`);
        }
        if (comparison) {
            const baseline = JSON.parse(fs.readFileSync(comparison, 'utf8'));
            const boosts = [];
            for (const reading of results.filter(reading => reading.scenario !== 'muted')) {
                const previous = baseline.results.find(other => other.sampleRate === reading.sampleRate && other.instrument === reading.instrument &&
                    other.path === reading.path && other.scenario === reading.scenario);
                const boost = reading.rms / previous.rms;
                const expected = reading.instrument === 'piano' ? .6 / .32 : 1.3 / .32;
                assert.ok(Math.abs(boost - expected) < .0001, `${reading.instrument}/${reading.path}: calibrated gain, not double boost (${boost})`);
                boosts.push({ instrument: reading.instrument, path: reading.path, scenario: reading.scenario,
                    sampleRate: reading.sampleRate, boost, db: 20 * Math.log10(boost), peak: reading.peak, clipped: reading.clipped });
            }
            fs.writeFileSync(evidence.replace(/\.json$/, '-comparison.json'), JSON.stringify(boosts, null, 2));
            for (const instrument of ['piano', 'strings']) {
                const matching = boosts.filter(reading => reading.instrument === instrument);
                assert.ok(Math.max(...matching.map(reading => reading.boost)) - Math.min(...matching.map(reading => reading.boost)) < .0001,
                    `${instrument}: keyboard, Q and saved banks share one calibration without double amplification`);
            }
        }
        process.stdout.write(`${JSON.stringify({ evidence, cases: results.length, maxPeak: Math.max(...results.map(reading => reading.peak)), errors, writes })}\n`);
    } finally {
        await browser.close();
    }
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
