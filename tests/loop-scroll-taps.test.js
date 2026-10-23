const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
function source(name) {
    const start = html.indexOf(`function ${name}(`), body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let end = body; end < html.length; end++) {
        if (html[end] === '{') depth++;
        if (html[end] === '}' && --depth === 0) return html.slice(start, end + 1);
    }
    throw Error(name);
}
function fixture() {
    const handlers = new Map();
    const scope = { contains: target => target === button };
    const button = { closest: () => scope };
    const document = { addEventListener: (type, handler) => handlers.set(type, handler) };
    const context = vm.createContext({ document, Date, Math });
    vm.runInContext(source('installLoopScrollTapGuard'), context);
    context.installLoopScrollTapGuard();
    const touch = (x, y) => ({ clientX: x, clientY: y });
    const send = (type, x = 100, y = 200, count = 1) => handlers.get(type)({
        target: button, touches: type === 'touchend' || type === 'touchcancel' ? [] : Array(count).fill(touch(x, y)), changedTouches: [touch(x, y)]
    });
    const click = (extra = {}) => {
        let blocked = false, stopped = false;
        handlers.get('click')({ target: button, detail: 1, preventDefault: () => { blocked = true; }, stopImmediatePropagation: () => { stopped = true; }, ...extra });
        assert.equal(blocked, stopped);
        return blocked;
    };
    return { handlers, document, button, send, click };
}
test('stationary taps and harmless finger jitter stay immediate, including two rapid taps', () => {
    const f = fixture();
    for (let i = 0; i < 2; i++) {
        f.send('touchstart'); f.send('touchmove', 103, 203); f.send('touchend', 103, 203);
        assert.equal(f.click(), false);
    }
});
test('a swipe returning to its origin still cancels its compatibility click; next tap works', () => {
    const f = fixture(); f.send('touchstart'); f.send('touchmove', 100, 160); f.send('touchend');
    assert.equal(f.click(), true);
    f.send('touchstart'); f.send('touchend'); assert.equal(f.click(), false);
});
test('release movement alone cancels activation', () => {
    const f = fixture(); f.send('touchstart'); f.send('touchend', 100, 211); assert.equal(f.click(), true);
});
test('native ancestor scrolling cancels activation without requiring a touchmove', () => {
    const f = fixture(); f.send('touchstart'); f.handlers.get('scroll')({ target: f.document }); f.send('touchend'); assert.equal(f.click(), true);
});
test('unrelated scrolling does not poison the next native tap', () => {
    const f = fixture(); f.send('touchstart'); f.handlers.get('scroll')({ target: { contains: () => false } }); f.send('touchend'); assert.equal(f.click(), false);
});
for (const kind of ['touchcancel', 'multitouch']) test(`${kind} cannot activate an action`, () => {
    const f = fixture(); f.send('touchstart', 100, 200, kind === 'multitouch' ? 2 : 1);
    f.send(kind === 'touchcancel' ? 'touchcancel' : 'touchend'); assert.equal(f.click(), true);
});
test('keyboard, assistive and programmatic clicks remain available after a swipe', () => {
    const f = fixture(); f.send('touchstart'); f.send('touchmove', 100, 100); f.send('touchend'); assert.equal(f.click({ detail: 0 }), false);
});
test('mouse and pen input clear stale cancelled touch gestures', () => {
    for (const pointerType of ['mouse', 'pen']) {
        const f = fixture(); f.send('touchstart'); f.send('touchmove', 100, 100); f.send('touchend');
        f.handlers.get('pointerdown')({ pointerType }); assert.equal(f.click(), false);
    }
});
test('shared loop action binder has no down/up/hold interceptors and accepts rapid completed clicks', () => {
    const handlers = new Map(), button = { style: {}, addEventListener: (type, handler) => handlers.set(type, handler) };
    const context = vm.createContext({}); vm.runInContext(source('bindBastardLoopLMobileTap'), context);
    let actions = 0; context.bindBastardLoopLMobileTap(button, () => { actions++; });
    assert.deepEqual([...handlers.keys()], ['click']); assert.equal(actions, 0);
    for (let i = 0; i < 2; i++) handlers.get('click')({ preventDefault() {}, stopPropagation() {} });
    assert.equal(actions, 2);
});

test('sample browser Close also waits for a completed click', () => {
    assert.match(html, /dropboxSampleBrowserCloseBtn\?\.addEventListener\('click', handleDropboxSampleBrowserClose, \{ capture: true \}\)/);
    assert.doesNotMatch(html, /dropboxSampleBrowserCloseBtn\?\.addEventListener\(eventName, handleDropboxSampleBrowserClose/);
});
