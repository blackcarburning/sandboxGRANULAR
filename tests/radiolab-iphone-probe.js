// Reproduce the actual iPhone HTTP handshake independently of Linux's media
// stack: retain a bytes=0-1 probe, then let the browser GET the same tune URL.
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');

async function installIphoneProbe(context, origin, results) {
    const seen = new Set();
    const requests = new Set();
    results.iphoneProbes = [];
    await context.route('**/radiolab/stream/**', async route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, origin);
        if (route.request().method() !== 'GET' || !url.pathname.startsWith('/mygrain/radiolab/stream/')) return route.continue();
        if (seen.has(url.href)) return route.continue();
        seen.add(url.href);
        const cookies = await context.cookies(url.href);
        const probe = { station: url.pathname.split('/').at(-1), range: 'bytes=0-1', status: null, bytes: 0 };
        results.iphoneProbes.push(probe);
        try {
            await new Promise((resolve, reject) => {
                const request = (url.protocol === 'https:' ? https : http).get(url, {
                    headers: { Cookie: cookies.map(item => `${item.name}=${item.value}`).join('; '),
                        Range: probe.range, 'Accept-Encoding': 'identity' }
                }, response => {
                    probe.status = response.statusCode;
                    probe.acceptRanges = response.headers['accept-ranges'];
                    if (probe.status !== 200) {
                        response.resume();
                        return reject(new Error(`iPhone probe returned ${probe.status}`));
                    }
                    response.on('error', () => {}); // replacement intentionally closes this stream
                    response.once('data', chunk => {
                        probe.bytes = chunk.length;
                        response.pause(); // keep its slot open until the playback GET replaces it
                        resolve();
                    });
                });
                requests.add(request);
                const deadline = setTimeout(() => request.destroy(new Error('probe deadline')), 15000);
                request.on('error', reject);
                request.on('close', () => { clearTimeout(deadline); requests.delete(request); });
            });
            const headers = { ...route.request().headers() };
            delete headers.range;
            await route.continue({ headers });
        } catch (error) {
            probe.error = error.message;
            await route.abort().catch(() => {});
        }
    });
    return () => { for (const request of requests) request.destroy(); };
}

module.exports = { installIphoneProbe };
