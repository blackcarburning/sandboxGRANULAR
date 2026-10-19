const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const scriptTag = html.match(/<script id="mygrain-birthday-script">([\s\S]*?)<\/script>/);
const styleTag = html.match(/<style id="mygrain-birthday-style">([\s\S]*?)<\/style>/);
assert.ok(scriptTag);
assert.ok(styleTag);
const source = scriptTag[1];

function eventTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, callback, options) {
            const entries = listeners.get(type) || [];
            entries.push({ callback, once: Boolean(options && options.once) });
            listeners.set(type, entries);
        },
        removeEventListener(type, callback) {
            listeners.set(type, (listeners.get(type) || []).filter(entry => entry.callback !== callback));
        },
        dispatch(type, details = {}) {
            for (const entry of [...(listeners.get(type) || [])]) {
                if (entry.once) this.removeEventListener(type, entry.callback);
                entry.callback({ type, ...details });
            }
        },
        listenerCount(type) {
            return (listeners.get(type) || []).length;
        },
        activeEvents() {
            return [...listeners].filter(([, entries]) => entries.length).map(([type]) => type).sort();
        }
    };
}

function fixture(options = {}) {
    let clock = 0;
    let nextIdentifier = 1;
    let localParts = options.localParts || [2026, 9, 18];
    const timers = new Map();
    const frames = new Map();
    const created = [];
    const transforms = [];
    let arcs = 0;
    let mediaQueries = 0;
    const context = {
        setTransform(...values) { transforms.push(values); },
        clearRect() {},
        beginPath() {},
        arc() { arcs += 1; },
        fill() {
            if (options.drawThrows) throw new Error('Canvas lost');
        }
    };

    function element(tagName) {
        const node = {
            tagName,
            children: [],
            attributes: {},
            parentNode: null,
            setAttribute(name, value) { this.attributes[name] = value; },
            append(...children) {
                for (const child of children) {
                    child.remove();
                    child.parentNode = this;
                    this.children.push(child);
                }
            },
            insertBefore(child, reference) {
                child.remove();
                child.parentNode = this;
                this.children.splice(this.children.indexOf(reference), 0, child);
            },
            remove() {
                if (this.parentNode) {
                    const siblings = this.parentNode.children;
                    siblings.splice(siblings.indexOf(this), 1);
                    this.parentNode = null;
                }
            },
            replaceChildren(...children) {
                for (const child of [...this.children]) child.remove();
                this.append(...children);
            },
            getContext() {
                if (options.contextThrows) throw new Error('Canvas unavailable');
                return options.nullContext ? null : context;
            }
        };
        created.push(node);
        return node;
    }

    const document = Object.assign(eventTarget(), {
        readyState: options.readyState || 'loading',
        body: options.noBody ? null : element('body'),
        createElement: element
    });
    const window = Object.assign(eventTarget(), {
        __mygrainSongRenderDeck: Boolean(options.renderDeck),
        innerWidth: options.width || 390,
        innerHeight: options.height || 844,
        devicePixelRatio: options.pixelRatio || 3,
        setTimeout(callback, delay) {
            const identifier = nextIdentifier++;
            timers.set(identifier, { callback, due: clock + delay });
            return identifier;
        },
        clearTimeout(identifier) { timers.delete(identifier); },
        requestAnimationFrame(callback) {
            const identifier = nextIdentifier++;
            frames.set(identifier, callback);
            return identifier;
        },
        cancelAnimationFrame(identifier) { frames.delete(identifier); },
        matchMedia(query) {
            mediaQueries += 1;
            assert.equal(query, '(prefers-reduced-motion: reduce)');
            if (options.mediaThrows) throw new Error('Media unavailable');
            return { matches: Boolean(options.reducedMotion) };
        }
    });
    if (options.noRaf) delete window.requestAnimationFrame;
    if (options.noCancelRaf) delete window.cancelAnimationFrame;
    if (options.noMatchMedia) delete window.matchMedia;
    class LocalDate {
        getFullYear() { return localParts[0]; }
        getMonth() { return localParts[1]; }
        getDate() { return localParts[2]; }
        getUTCFullYear() { throw new Error('UTC is forbidden'); }
        getUTCMonth() { throw new Error('UTC is forbidden'); }
        getUTCDate() { throw new Error('UTC is forbidden'); }
    }
    const sandbox = vm.createContext({ window, document, Date: options.Date || LocalDate });

    function advance(milliseconds) {
        const target = clock + milliseconds;
        while (true) {
            const next = [...timers].filter(([, timer]) => timer.due <= target).sort((first, second) => first[1].due - second[1].due || first[0] - second[0])[0];
            if (!next) break;
            const [identifier, timer] = next;
            clock = timer.due;
            timers.delete(identifier);
            timer.callback();
        }
        clock = target;
    }

    return {
        window,
        document,
        created,
        timers,
        frames,
        transforms,
        evaluate() { vm.runInContext(source, sandbox); },
        advance,
        completeDom() { document.readyState = 'interactive'; document.dispatch('DOMContentLoaded'); },
        open() { this.evaluate(); this.completeDom(); advance(0); },
        overlay() { return document.body?.children.find(child => child.id === 'mygrain-birthday-overlay'); },
        frame(timestamp) {
            const callbacks = [...frames.values()];
            frames.clear();
            for (const callback of callbacks) callback(timestamp);
        },
        setDate(...parts) { localParts = parts; },
        get arcs() { return arcs; },
        get mediaQueries() { return mediaQueries; }
    };
}

test('inline feature precedes login gating and CSS remains uniquely scoped and nonanimated', () => {
    assert.ok(scriptTag.index < html.indexOf('<script src="mygrain-accounts.js'));
    assert.ok(scriptTag.index < html.indexOf('mygrain-account-unavailable'));
    assert.equal(html.match(/id="mygrain-birthday-script"/g).length, 1);
    assert.equal(html.match(/id="mygrain-birthday-style"/g).length, 1);
    for (const selectorBlock of styleTag[1].matchAll(/([^{}]+)\{/g)) {
        for (const selector of selectorBlock[1].split(',')) assert.match(selector.trim(), /#mygrain-birthday-overlay/);
    }
    assert.match(styleTag[1], /z-index:\s*2147483647/);
    assert.match(styleTag[1], /pointer-events:\s*none !important/);
    assert.match(styleTag[1], /html\[data-mygrain-locked="true"\] body > #mygrain-birthday-overlay\.mygrain-birthday-overlay\s*\{ display: grid !important;/);
    assert.doesNotMatch(styleTag[1], /animation|transition|@keyframes/);
    assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(|XMLHttpRequest|Audio|mygrainAccounts|setInterval|visibilitychange|MutationObserver/);
});

test('local Oct 18 is eligible every year from 2026 without UTC checks', () => {
    for (const year of [2026, 2027, 2036, 2100]) {
        const app = fixture({ localParts: [year, 9, 18] });
        app.open();
        assert.ok(app.overlay(), `Expected celebration in ${year}`);
        assert.equal(app.overlay().children.at(-1).textContent, 'Happy Birthday!');
        assert.equal(app.overlay().attributes.role, 'status');
    }
});

test('negative local dates create no feature DOM, timers, media queries or animation', () => {
    for (const localParts of [[2026, 9, 17], [2026, 9, 19], [2025, 9, 18], [2026, 8, 18], [2027, 0, 1]]) {
        const app = fixture({ localParts });
        app.open();
        assert.equal(app.created.length, 1);
        assert.equal(app.timers.size, 0);
        assert.equal(app.frames.size, 0);
        assert.equal(app.mediaQueries, 0);
        assert.deepEqual(app.document.activeEvents(), []);
        assert.deepEqual(app.window.activeEvents(), ['pageshow']);
    }
});

test('actual timezone boundaries use device-local dates rather than UTC', () => {
    const cases = [
        ['Europe/London', '2026-10-17T23:01:00Z', true],
        ['Europe/London', '2026-10-18T23:01:00Z', false],
        ['America/Los_Angeles', '2026-10-18T06:59:00Z', false],
        ['America/Los_Angeles', '2026-10-19T06:59:00Z', true],
        ['Pacific/Kiritimati', '2026-10-17T10:00:00Z', true],
        ['Pacific/Pago_Pago', '2026-10-19T10:59:00Z', true],
        ['Pacific/Pago_Pago', '2026-10-19T11:00:00Z', false]
    ];
    for (const [timezone, instant, eligible] of cases) {
        const output = execFileSync(process.execPath, ['-e', `
            const vm = require('node:vm');
            const NativeDate = Date;
            class FixedDate extends NativeDate { constructor() { super(${JSON.stringify(instant)}); } }
            const callbacks = [];
            const window = { addEventListener() {}, setTimeout(callback) { callbacks.push(callback); return 1; } };
            const document = { readyState: 'complete' };
            vm.runInNewContext(${JSON.stringify(source)}, { window, document, Date: FixedDate });
            process.stdout.write(String(callbacks.length));
        `], { env: { ...process.env, TZ: timezone }, encoding: 'utf8' });
        assert.equal(output, eligible ? '1' : '0', `${timezone} ${instant}`);
    }
});

test('timer mounts after all existing login DOMContentLoaded listeners replace the body', () => {
    const app = fixture();
    app.evaluate();
    app.document.addEventListener('DOMContentLoaded', () => {
        const shell = app.document.createElement('section');
        shell.id = 'mygrain-account-shell';
        app.document.body.replaceChildren(shell);
        assert.equal(app.overlay(), undefined);
    });
    app.completeDom();
    assert.equal(app.overlay(), undefined);
    app.advance(0);
    assert.deepEqual(app.document.body.children.map(child => child.id), ['mygrain-account-shell', 'mygrain-birthday-overlay']);
});

test('overlay stays visible for 5000ms then cancels all owned work except pageshow', () => {
    const app = fixture();
    app.open();
    app.frame(0);
    app.frame(500);
    assert.ok(app.arcs > 0);
    assert.equal(app.frames.size, 1);
    app.advance(4999);
    assert.ok(app.overlay());
    app.advance(1);
    assert.equal(app.overlay(), undefined);
    assert.equal(app.timers.size, 0);
    assert.equal(app.frames.size, 0);
    assert.deepEqual(app.window.activeEvents(), ['pageshow']);
    assert.deepEqual(app.document.activeEvents(), []);
});

test('duplicate evaluation and ordinary pageshow cannot restart a page-load celebration', () => {
    const app = fixture();
    app.evaluate();
    app.evaluate();
    assert.equal(app.document.listenerCount('DOMContentLoaded'), 1);
    assert.equal(app.window.listenerCount('pageshow'), 1);
    app.completeDom();
    app.window.dispatch('pageshow', { persisted: false });
    assert.equal(app.timers.size, 1);
    app.advance(0);
    app.evaluate();
    assert.equal(app.created.filter(node => node.id === 'mygrain-birthday-overlay').length, 1);
    app.advance(5000);
    app.evaluate();
    app.window.dispatch('pageshow', { persisted: false });
    app.advance(0);
    assert.equal(app.overlay(), undefined);
    const newOpen = fixture();
    newOpen.open();
    assert.ok(newOpen.overlay());
});

test('reduced motion uses static decoration without canvas, RAF or resize work', () => {
    const app = fixture({ reducedMotion: true });
    app.open();
    assert.ok(app.overlay());
    assert.equal(app.created.filter(node => node.className === 'mygrain-birthday-star').length, 4);
    assert.equal(app.created.some(node => node.tagName === 'canvas'), false);
    assert.equal(app.frames.size, 0);
    assert.equal(app.window.listenerCount('resize'), 0);
    app.advance(5000);
    assert.equal(app.overlay(), undefined);
    assert.deepEqual(app.window.activeEvents(), ['pageshow']);
});

test('canvas and optional browser API failures safely retain a static greeting and clean up', () => {
    for (const options of [{ nullContext: true }, { contextThrows: true }, { noRaf: true }, { noCancelRaf: true }, { noMatchMedia: true }, { mediaThrows: true }]) {
        const app = fixture(options);
        assert.doesNotThrow(() => app.open());
        assert.ok(app.overlay());
        assert.equal(app.frames.size, 0);
        assert.equal(app.window.listenerCount('resize'), 0);
        app.advance(5000);
        assert.equal(app.overlay(), undefined);
        assert.equal(app.timers.size, 0);
        assert.deepEqual(app.window.activeEvents(), ['pageshow']);
    }
    assert.doesNotThrow(() => vm.runInNewContext(source));
    assert.doesNotThrow(() => vm.runInNewContext(source, { window: {} }));
    const noBody = fixture({ noBody: true });
    assert.doesNotThrow(() => noBody.open());
    assert.equal(noBody.timers.size, 0);
});

test('draw failure cancels animation and leaves static text until the original deadline', () => {
    const app = fixture({ drawThrows: true });
    app.open();
    app.frame(0);
    assert.doesNotThrow(() => app.frame(500));
    assert.ok(app.overlay());
    assert.equal(app.frames.size, 0);
    assert.equal(app.window.listenerCount('resize'), 0);
    app.advance(5000);
    assert.equal(app.overlay(), undefined);
});

test('canvas resolution and particle drawing remain bounded even on huge high-DPR screens', () => {
    const app = fixture({ width: 16000, height: 9000, pixelRatio: 12 });
    app.open();
    const canvas = app.created.find(node => node.tagName === 'canvas');
    assert.equal(canvas.width, 5120);
    assert.equal(canvas.height, 3200);
    assert.deepEqual(app.transforms[0], [2, 0, 0, 2, 0, 0]);
    app.frame(0);
    app.frame(1200);
    assert.ok(app.arcs > 0 && app.arcs <= 224);
    app.window.innerWidth = 320;
    app.window.innerHeight = 568;
    app.window.devicePixelRatio = .5;
    app.window.dispatch('resize');
    assert.equal(canvas.width, 320);
    assert.equal(canvas.height, 568);
    assert.equal(app.frames.size, 1);
});

test('pagehide cleans immediately and persisted pageshow replays for a fresh five seconds', () => {
    const app = fixture();
    app.open();
    app.advance(1500);
    app.window.dispatch('pagehide', { persisted: true });
    assert.equal(app.overlay(), undefined);
    assert.equal(app.frames.size, 0);
    assert.equal(app.timers.size, 0);
    app.window.dispatch('pageshow', { persisted: true });
    app.advance(0);
    assert.ok(app.overlay());
    app.advance(4999);
    assert.ok(app.overlay());
    app.advance(1);
    assert.equal(app.overlay(), undefined);
    assert.equal(app.created.filter(node => node.id === 'mygrain-birthday-overlay').length, 2);
    assert.equal(app.window.listenerCount('pageshow'), 1);
});

test('BFcache checks the restored local date and never polls into a new date', () => {
    const app = fixture({ localParts: [2026, 9, 17] });
    app.open();
    app.setDate(2026, 9, 18);
    app.advance(86400000);
    assert.equal(app.overlay(), undefined);
    app.window.dispatch('pageshow', { persisted: true });
    app.advance(0);
    assert.ok(app.overlay());
    app.setDate(2026, 9, 19);
    app.window.dispatch('pagehide', { persisted: true });
    app.window.dispatch('pageshow', { persisted: true });
    app.advance(0);
    assert.equal(app.overlay(), undefined);
    assert.equal(app.timers.size, 0);
});

test('ready DOM starts with a task, midnight is rechecked, and render decks are untouched', () => {
    const ready = fixture({ readyState: 'complete' });
    ready.evaluate();
    assert.equal(ready.overlay(), undefined);
    ready.advance(0);
    assert.ok(ready.overlay());
    const midnight = fixture();
    midnight.evaluate();
    midnight.completeDom();
    midnight.setDate(2026, 9, 19);
    midnight.advance(0);
    assert.equal(midnight.overlay(), undefined);
    const render = fixture({ renderDeck: true });
    render.open();
    assert.equal(render.created.length, 1);
    assert.equal(render.timers.size, 0);
    assert.deepEqual(render.window.activeEvents(), []);
    assert.deepEqual(render.document.activeEvents(), []);
});
