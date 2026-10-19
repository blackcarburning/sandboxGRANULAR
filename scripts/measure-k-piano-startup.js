const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const options = Object.fromEntries(process.argv.slice(2).map(argument => argument.replace(/^--/, '').split('=')));
const source = path.resolve(options.source || path.join(root, 'q-card.js'));
const runs = Number(options.runs || 3);
const kbps = Number(options.kbps || 0);

async function main() {
    const server = http.createServer((request, response) => {
        if (!['GET', 'HEAD'].includes(request.method)) return response.writeHead(405).end();
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        if (pathname === '/measure.html') {
            response.setHeader('Content-Type', 'text/html');
            return response.end('<script src="q-theory.js"></script><script src="q-card.js"></script>');
        }
        const filename = pathname === '/q-card.js' ? source : path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (filename !== source && !filename.startsWith(root + path.sep)) return response.writeHead(403).end();
        fs.readFile(filename, (error, bytes) => {
            if (error) return response.writeHead(404).end();
            response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.html') ? 'text/html' : filename.endsWith('.css') ? 'text/css' : 'application/octet-stream');
            response.setHeader('Cache-Control', 'no-store');
            response.end(bytes);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let browser;
    try {
        browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/snap/bin/chromium', headless: true,
            args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
        const results = [];
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            const layout = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
            const layoutPage = await layout.newPage();
            await layoutPage.route('**/*', route => route.request().url().startsWith(origin) && ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
            await layoutPage.goto(origin, { waitUntil: 'load' });
            const pitches = await layoutPage.evaluate(() => getKeyboardSamplePitches());
            await layout.close();
            for (let run = 0; run < runs; run += 1) {
                const context = await browser.newContext();
                const page = await context.newPage();
                const network = await context.newCDPSession(page);
                await network.send('Network.enable');
                await network.send('Network.setCacheDisabled', { cacheDisabled: true });
                await page.goto(`${origin}/measure.html`, { waitUntil: 'load' });
                if (kbps) await network.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: kbps * 1000 / 8, uploadThroughput: kbps * 1000 / 8 });
                const measurement = await page.evaluate(async notes => {
                    const audio = new AudioContext({ sampleRate: 48000 });
                    await audio.resume();
                    const player = MygrainQ.createKeyboardPlayer({ context: () => audio, output: () => audio.destination });
                    const sampler = player.samplers.get('piano').piano;
                    const load = sampler.load.bind(sampler);
                    const loads = new Map();
                    sampler.load = async sample => {
                        const began = performance.now();
                        const buffer = await load(sample);
                        loads.set(sample.id, { id: sample.id, readyMs: performance.now() - began, seconds: buffer.duration });
                        return buffer;
                    };
                    const began = performance.now();
                    let next = 0;
                    await Promise.all(Array.from({ length: 3 }, async () => {
                        while (next < notes.length) await player.prepare('piano', notes[next++], 127);
                    }));
                    const readyMs = performance.now() - began;
                    const resources = performance.getEntriesByType('resource').filter(resource => /SAMPLES_Q.*\.(wav|mp3)/.test(resource.name));
                    const result = { readyMs, cachedBytes: player.metrics.cachedBytes,
                        sampleBytes: resources.reduce((total, resource) => total + resource.encodedBodySize, 0),
                        samples: resources.map(resource => ({ file: new URL(resource.name).pathname, bytes: resource.encodedBodySize, networkMs: resource.duration,
                            ...loads.get(new URL(resource.name).pathname.split('/').pop().replace(/\.(wav|mp3)$/, '')) })) };
                    player.stop();
                    await audio.close();
                    return result;
                }, pitches);
                results.push({ viewport, pitches, run: run + 1, ...measurement });
                await context.close();
            }
        }
        process.stdout.write(`${JSON.stringify({ source, kbps, runs, results }, null, 2)}\n`);
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
