const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

function extract(name) {
    const start = html.indexOf(`function ${name}(`);
    assert.ok(start >= 0, name);
    const body = html.indexOf(') {', start) + 2;
    let depth = 0;
    for (let index = body; index < html.length; index += 1) {
        if (html[index] === '{') depth += 1;
        if (html[index] === '}') depth -= 1;
        if (depth === 0) return html.slice(start, index + 1);
    }
    throw new Error(name);
}

test('the slider shortcut card comes first in Mixer, before gain analysis and all levels', () => {
    assert.match(html, /class="performance-mixer-stack">\s*<section[^>]+id="performanceMixerJumpCard"/);
    assert.ok(html.indexOf('id="performanceMixerJumpCard"') < html.indexOf('id="performanceMixerBlendGrid"'));
    assert.match(html, /id="sectionJumpBastardMixerBtn"[^>]+data-jump-target="#performanceMixerCard"/);
    assert.doesNotMatch(html, /function jumpToPerformanceMixerTarget\(/);
    assert.doesNotMatch(html, /const PERFORMANCE_MIXER_JUMP_BUTTONS/);
});

test('shortcut mounting follows every actual mixer slider, uses its label and mounts only once', () => {
    const controls = [
        { id: 'osc', labels: [{ querySelector: () => ({ textContent: ' Osc Volume ' }) }] },
        { id: 'trim', labels: [{ querySelector: () => ({ textContent: 'Master Trim' }) }] },
        { id: 'unlabelled' }
    ];
    const jumps = [];
    const grid = { children: [], appendChild(button) { this.children.push(button); } };
    const context = vm.createContext({
        performanceMixerCard: { querySelectorAll: selector => { assert.equal(selector, 'input[type="range"]'); return controls; } },
        document: {
            getElementById: id => id === 'performanceMixerSliderJumps' ? grid : null,
            createElement: tag => {
                assert.equal(tag, 'button');
                return { attributes: {}, handlers: [], setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(type, handler) { this.handlers.push({ type, handler }); } };
            }
        },
        jumpToPerformanceMixerSlider: id => jumps.push(id)
    });
    for (const name of ['getPerformanceMixerJumpButtonId', 'ensurePerformanceMixerJumpButtonsMounted']) vm.runInContext(extract(name), context);
    context.ensurePerformanceMixerJumpButtonsMounted();
    context.ensurePerformanceMixerJumpButtonsMounted();
    assert.equal(grid.children.length, 3);
    assert.deepEqual(grid.children.map(button => button.textContent), ['Osc Volume', 'Master Trim', 'unlabelled']);
    for (const [index, button] of grid.children.entries()) {
        assert.equal(button.type, 'button');
        assert.equal(button.id, `${controls[index].id}JumpBtn`);
        assert.equal(button.attributes['aria-controls'], controls[index].id);
        assert.equal(button.attributes['aria-label'], `Jump to ${button.textContent} slider`);
        assert.equal(button.handlers.length, 1);
        button.handlers[0].handler();
    }
    assert.deepEqual(jumps, ['osc', 'trim', 'unlabelled']);
});

test('shortcut mounting safely skips a missing mixer or shortcut grid', () => {
    for (const gridPresent of [false, true]) {
        const context = vm.createContext({ performanceMixerCard: null, document: { getElementById: () => gridPresent ? { children: [] } : null } });
        vm.runInContext(extract('ensurePerformanceMixerJumpButtonsMounted'), context);
        context.ensurePerformanceMixerJumpButtonsMounted();
    }
});

test('Mix keeps its pointer target stable until release and still navigates on click', () => {
    const handlers = new Map();
    const calls = [];
    const classes = { add() {}, remove() {}, toggle() {}, contains: () => false };
    const button = { id: 'sectionJumpBastardMixerBtn', dataset: { jumpTarget: '#performanceMixerCard' }, addEventListener: (type, handler) => handlers.set(type, handler), blur: () => calls.push('blur') };
    const drawer = { classList: classes, addEventListener() {} };
    const handle = { setAttribute() {}, addEventListener() {} };
    const target = { classList: classes, scrollIntoView: () => calls.push('scroll') };
    const context = vm.createContext({
        document: { body:{classList:classes}, getElementById: id => ({ sectionJumpDrawer: drawer, sectionJumpHandle: handle })[id], querySelectorAll: () => [button], querySelector: () => target, addEventListener() {} },
        window: { clearTimeout() {}, setTimeout: () => 1, matchMedia: () => ({ matches: true }) }
    });
    vm.runInContext(extract('initSectionJumpDrawer'), context);
    context.initSectionJumpDrawer();
    handlers.get('pointerdown')({ button: 0, pointerType:'mouse', preventDefault: () => calls.push('prevent') });
    handlers.get('pointerdown')({ button: 2, preventDefault: () => assert.fail('Secondary click must remain unchanged') });
    handlers.get('click')();
    assert.deepEqual(calls, ['prevent', 'blur', 'scroll']);
});

for (const reducedMotion of [false, true]) {
    test(`shortcuts focus the slider and arrive at its card top without changing its value (${reducedMotion ? 'reduced motion' : 'smooth'})`, () => {
        const calls = [];
        class Element {
            constructor(type) { this.type = type; this.value = '50'; }
            closest() { return null; }
            focus(options) { calls.push(['focus', { ...options }]); }
            scrollIntoView(options) { calls.push(['scroll', { ...options }]); }
        }
        const slider = new Element('range');
        const outside = new Element('range');
        const button = new Element('button');
        const context = vm.createContext({
            HTMLElement: Element,
            document: { getElementById: id => ({ slider, outside, button })[id] },
            performanceMixerCard: { contains: control => control !== outside },
            window: { matchMedia: () => ({ matches: reducedMotion }) }
        });
        vm.runInContext(extract('jumpToPerformanceMixerSlider'), context);
        context.jumpToPerformanceMixerSlider('slider');
        context.jumpToPerformanceMixerSlider('outside');
        context.jumpToPerformanceMixerSlider('button');
        context.jumpToPerformanceMixerSlider('missing');
        assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { behavior: reducedMotion ? 'auto' : 'smooth', block: 'start', inline: 'nearest' }]]);
        assert.equal(slider.value, '50');
    });
}
