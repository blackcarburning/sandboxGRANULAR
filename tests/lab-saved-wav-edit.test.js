const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const radio = require('../radiolab.js');
const video = require('../videolab.js');

class Element {
    constructor(tag = 'div') {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.dataset = {};
        this.attributes = {};
        this.listeners = new Map();
        this.value = '';
        this.textContent = '';
        this.disabled = false;
        this.style = { setProperty() {} };
    }
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
    replaceChildren(...children) { this.children.forEach(child => { child.parentNode = null; }); this.children = []; this.append(...children); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
    dispatch(type, event = {}) { for (const callback of this.listeners.get(type) || []) callback({ target: this, preventDefault() {}, ...event }); }
    click() { if (!this.disabled) this.dispatch('click'); }
    focus() { this.focused = true; }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return { width: 260, height: 100 }; }
    getContext() { return { setTransform() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} }; }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tagName === tag.toUpperCase() ? [child] : []), ...child.querySelectorAll(tag)]); }
}

function audio(channels = [Float32Array.from([.125, -.25, .5, -.125, .25, -.5, .125, -.25]), Float32Array.from([-.0625, .125, -.25, .0625, -.125, .25, -.0625, .125])]) {
    return { length: channels[0].length, duration: channels[0].length / 8, sampleRate: 8, numberOfChannels: channels.length, getChannelData: index => channels[index] };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
    return { promise, resolve, reject };
}

function fixture(kind, overrides = {}) {
    const api = kind === 'radio' ? radio : video;
    const prefix = kind === 'radio' ? 'radiolab' : 'videolab';
    const elements = new Map();
    const document = {
        createElement: tag => new Element(tag),
        getElementById: id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); }
    };
    const observers = [];
    const sources = [];
    const requests = [];
    const buffer = audio();
    const original = radio.encodeWav([Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))], buffer.sampleRate, buffer.numberOfChannels);
    const context = {
        state: 'running', destination: {},
        decodeAudioData: async () => buffer,
        createBuffer(channels, frames, sampleRate) {
            const data = Array.from({ length: channels }, () => new Float32Array(frames));
            return { numberOfChannels: channels, length: frames, sampleRate, data, copyToChannel: (values, channel, offset) => data[channel].set(values, offset) };
        },
        createBufferSource() {
            const source = { connect() {}, disconnect() { this.disconnected = true; }, start() { this.started = true; }, stop() { this.stopped = true; } };
            sources.push(source);
            return source;
        }
    };
    const root = {
        document, MygrainRadiolab: radio,
        mygrainAccounts: { authenticated: true, user: { username: 'fixture-user' } },
        ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
    };
    const current = new radio.PCMRecorder({ sampleRate: 8 }).start(null, 0, { station: { id: 'current', name: 'Current' } });
    current.append([Float32Array.from([.25, -.25, .125]), Float32Array.from([-.125, .125, -.25])]);
    current.stop();
    const sample = { filename: 'stable-abc.wav', name: 'Original broadcast', duration: 1, station: 'bbc-radio-4', url: `/mygrain/api/${prefix}/stable-abc.wav` };
    const controller = Object.assign(Object.create(api.Controller.prototype), {
        root, username: 'fixture-user', epoch: 0, browserEpoch: 1, requestEpoch: 0, previewEpoch: 0,
        locked: false, closed: false, busy: false, requests: new Set(), browserRequests: new Set(),
        samples: [sample], sampleRows: new Map(), recorder: current, adapter: { getContext: () => context },
        dialog: { open: true },
        render() { this.savedEditor?.render(); }, syncMonitor() {},
        ensureContext: async () => context,
        request: async (route, options = {}) => {
            requests.push({ route, ...options });
            if (overrides.request) return overrides.request(route, options, sample);
            if (route.includes('rename')) return { sample: { ...sample, name: JSON.parse(options.body).name, downloadName: 'new-name.wav' } };
            if (options.method === 'POST') return { sample: { ...sample, filename: 'new-trim.wav', name: new URLSearchParams(route.split('?')[1]).get('name') } };
            return original.slice(0);
        }
    });
    controller.element(`${prefix}LoadTarget`).value = 'grainMain';
    controller.renderSamples();
    return { controller, sample, prefix, sources, requests, observers, buffer, original, context, current, root };
}

for (const kind of ['radio', 'video']) {
    test(`${kind}: saved WAV cards expose rename and re-trim without starting audio`, () => {
        const { controller, sample, sources } = fixture(kind);
        assert.ok(controller.sampleRows.get(sample.filename).rename);
        assert.ok(controller.sampleRows.get(sample.filename).trim);
        assert.equal(controller.sampleRows.get(sample.filename).row.dataset.filename, sample.filename);
        assert.equal(sources.length, 0);
    });

    test(`${kind}: rename persists returned human name while keeping stable source references and current take`, async () => {
        const { controller, sample, requests, current } = fixture(kind);
        const currentBytes = current.wav();
        controller.editSampleName(sample);
        const editor = controller.savedEditor;
        editor.name.value = '<img src=x onerror=alert(1)> renamed';
        await controller.renameSavedSample(editor);
        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'POST');
        assert.deepEqual(JSON.parse(requests[0].body), kind === 'radio' ? { filename: sample.filename, name: '<img src=x onerror=alert(1)> renamed' } : { name: '<img src=x onerror=alert(1)> renamed' });
        assert.equal(controller.samples[0].name, '<img src=x onerror=alert(1)> renamed');
        assert.equal(controller.samples[0].filename, sample.filename);
        assert.equal(controller.samples[0].url, sample.url);
        assert.equal(controller.sampleRows.get(sample.filename).row.children[0].textContent, controller.samples[0].name);
        assert.equal(editor.panel, null);
        assert.equal(controller.recorder, current);
        assert.deepEqual(current.wav(), currentBytes);
    });

    test(`${kind}: invalid names do not call rename API or discard the editor`, async () => {
        const { controller, sample, requests } = fixture(kind);
        controller.editSampleName(sample);
        for (const name of ['', '   ', 'a'.repeat(101), '../bad', 'a\\b', 'null\0name', 'line\nname']) {
            controller.savedEditor.name.value = name;
            await assert.rejects(controller.renameSavedSample(controller.savedEditor), /1–100/);
        }
        assert.equal(requests.length, 0);
        assert.ok(controller.savedEditor.panel);
    });

    test(`${kind}: rename failure keeps original list and editable requested name`, async () => {
        const { controller, sample } = fixture(kind, { request: async () => { throw new Error('Storage unavailable'); } });
        controller.editSampleName(sample);
        controller.savedEditor.name.value = 'Try again';
        await assert.rejects(controller.renameSavedSample(controller.savedEditor), /Storage unavailable/);
        assert.equal(controller.samples[0].name, sample.name);
        assert.equal(controller.savedEditor.name.value, 'Try again');
    });

    test(`${kind}: re-trim has separate PCM, default copy name, no autoplay and no current-take replacement`, async () => {
        const { controller, sample, sources, current } = fixture(kind);
        const currentBytes = current.wav();
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        assert.equal(editor.name.value, 'Original broadcast trimmed');
        assert.notEqual(editor.recorder, current);
        assert.equal(editor.recorder.frames, 8);
        assert.equal(sources.length, 0);
        assert.equal(controller.recorder, current);
        assert.deepEqual(current.wav(), currentBytes);
        assert.match(editor.duration.textContent, /Original: 1\.000 s/);
    });

    test(`${kind}: Preview plays only chosen stereo frames; trim stops it and clamps to at least one frame`, async () => {
        const { controller, sample, sources } = fixture(kind);
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        editor.setTrim('Start', .25);
        editor.setTrim('End', .75);
        await controller.previewSavedTrim(editor);
        assert.equal(sources.length, 1);
        assert.equal(sources[0].started, true);
        assert.equal(sources[0].loop, false);
        assert.equal(sources[0].buffer.length, 4);
        assert.deepEqual(Array.from(sources[0].buffer.data[0]), [.5, -.125, .25, -.5]);
        assert.deepEqual(Array.from(sources[0].buffer.data[1]), [-.25, .0625, -.125, .25]);
        editor.setTrim('Start', 100);
        assert.equal(sources[0].stopped, true);
        assert.equal(sources[0].disconnected, true);
        assert.equal(editor.recorder.selectedFrames, 1);
        editor.setTrim('End', -100);
        assert.equal(editor.recorder.selectedFrames, 1);
        assert.equal(controller.savedTrimPreview, null);
    });

    test(`${kind}: real input events survive host.run synchronous render and preview/save only the selected interval`, async () => {
        const { controller, sample, sources, requests, current, original } = fixture(kind);
        const currentBytes = current.wav();
        const originalBytes = original.slice(0);
        assert.equal(controller.run, (kind === 'radio' ? radio : video).Controller.prototype.run);
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        editor.name.value = 'Event-selected copy';
        editor.ranges.Start.input.value = '.25';
        editor.ranges.Start.input.dispatch('input');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(editor.recorder.trimStartFrame, 2);
        assert.equal(editor.ranges.Start.input.value, '0.25');
        editor.ranges.End.input.value = '.75';
        editor.ranges.End.input.dispatch('input');
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(editor.recorder.endFrame, 6);
        assert.equal(editor.recorder.selectedFrames, 4);
        assert.equal(editor.ranges.End.input.value, '0.75');
        assert.equal(editor.name.value, 'Event-selected copy');
        assert.equal(sources.length, 0);
        editor.previewButton.click();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(sources.length, 1);
        assert.equal(sources[0].buffer.length, 4);
        assert.deepEqual(Array.from(sources[0].buffer.data[0]), [.5, -.125, .25, -.5]);
        editor.saveButton.click();
        await new Promise(resolve => setImmediate(resolve));
        const upload = requests.find(request => request.method === 'POST');
        assert.ok(upload);
        assert.equal(new DataView(upload.body).getUint32(40, true), 4 * 2 * 2);
        assert.equal(new URLSearchParams(upload.route.split('?')[1]).get('name'), 'Event-selected copy');
        assert.equal(sources[0].stopped, true);
        assert.equal(controller.recorder, current);
        assert.deepEqual(current.wav(), currentBytes);
        assert.deepEqual(original, originalBytes);
    });

    test(`${kind}: Save new WAV sends only selected normalized frames and retains original/current take`, async () => {
        const { controller, sample, requests, current, original } = fixture(kind);
        const originalBytes = original.slice(0);
        const currentBytes = current.wav();
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        const editorRecorder = editor.recorder;
        editor.setTrim('Start', .25);
        editor.setTrim('End', .75);
        editor.name.value = 'My trimmed copy';
        await controller.saveSavedTrim(editor);
        const upload = requests.find(request => request.method === 'POST');
        const body = new DataView(upload.body);
        assert.equal(body.getUint32(24, true), 8);
        assert.equal(body.getUint16(22, true), 2);
        assert.equal(body.getUint32(40, true), 4 * 2 * 2);
        assert.equal(body.getInt16(44, true), 32767);
        assert.equal(body.getInt16(46, true), -16384);
        assert.equal(new URLSearchParams(upload.route.split('?')[1]).get('name'), 'My trimmed copy');
        assert.equal(new URLSearchParams(upload.route.split('?')[1]).get('sourceFilename'), sample.filename);
        assert.deepEqual(controller.samples.map(item => item.filename), ['new-trim.wav', sample.filename]);
        assert.equal(controller.samples[1], sample);
        assert.equal(editorRecorder.frames, 0);
        assert.equal(editor.panel, null);
        assert.deepEqual(original, originalBytes);
        assert.equal(controller.recorder, current);
        assert.deepEqual(current.wav(), currentBytes);
    });

    test(`${kind}: failed new-copy save retains trim and the original file`, async () => {
        const { controller, sample, original } = fixture(kind, { request: async (route, options) => {
            if (options.method === 'POST') throw new Error('Disk full');
            return original.slice(0);
        } });
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        editor.setTrim('End', .5);
        await assert.rejects(controller.saveSavedTrim(editor), /Disk full/);
        assert.equal(editor.recorder.selectedFrames, 4);
        assert.ok(editor.panel);
        assert.deepEqual(controller.samples, [sample]);
    });

    test(`${kind}: same-file save response never reports a successful non-destructive trim`, async () => {
        const state = fixture(kind);
        await state.controller.trimSample(state.sample);
        state.controller.request = async () => ({ sample: state.sample });
        await assert.rejects(state.controller.saveSavedTrim(state.controller.savedEditor), /NEW WAV/);
        assert.ok(state.controller.savedEditor.recorder.frames);
        assert.deepEqual(state.controller.samples, [state.sample]);
    });

    test(`${kind}: closing editor stops preview, clears PCM/name and disconnects resize observer`, async () => {
        const { controller, sample, sources, observers } = fixture(kind);
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        const recorder = editor.recorder;
        const chunks = recorder.chunks;
        const name = editor.name;
        await controller.previewSavedTrim(editor);
        editor.close();
        assert.equal(sources[0].stopped, true);
        assert.equal(sources[0].disconnected, true);
        assert.equal(recorder.frames, 0);
        assert.ok(chunks.every(chunk => chunk.every(channel => channel.every(value => value === 0))));
        assert.equal(name.value, '');
        assert.equal(editor.name, null);
        assert.equal(editor.panel, null);
        assert.ok(observers.every(observer => observer.disconnected));
    });

    for (const invalidation of ['close', 'account']) {
        test(`${kind}: late trim decode cannot reopen after browser ${invalidation}`, async () => {
            const { controller, sample, context, root, buffer, current } = fixture(kind);
            const decode = deferred();
            context.decodeAudioData = () => decode.promise;
            const pending = controller.trimSample(sample);
            await new Promise(resolve => setImmediate(resolve));
            if (invalidation === 'close') { controller.dialog.open = false; controller.browserEpoch += 1; }
            else root.mygrainAccounts.user.username = 'other-account';
            if (kind === 'video') controller.close = () => { controller.closed = true; controller.locked = true; };
            decode.resolve(buffer);
            await assert.rejects(pending, /closed|session ended/);
            assert.equal(controller.savedEditor?.panel || null, null);
            assert.equal(controller.recorder, current);
        });
    }

    test(`${kind}: an old rename response cannot update a later editor session`, async () => {
        const { controller, sample } = fixture(kind);
        const response = deferred();
        controller.request = () => response.promise;
        controller.editSampleName(sample);
        const editor = controller.savedEditor;
        editor.name.value = 'Old pending name';
        const pending = controller.renameSavedSample(editor);
        editor.close();
        controller.editSampleName(sample);
        controller.savedEditor.name.value = 'Current name';
        response.resolve({ sample: { ...sample, name: 'Old pending name' } });
        await assert.rejects(pending, /editor has closed/);
        assert.equal(controller.samples[0].name, sample.name);
        assert.equal(controller.savedEditor.name.value, 'Current name');
    });

    test(`${kind}: rename response cannot silently change a stable identifier or URL`, async () => {
        for (const changed of [{ filename: 'changed.wav' }, { url: '/somewhere-else.wav' }]) {
            const { controller, sample } = fixture(kind);
            controller.editSampleName(sample);
            controller.savedEditor.name.value = 'Safe new name';
            controller.request = async () => ({ sample: { ...sample, name: 'Safe new name', ...changed } });
            await assert.rejects(controller.renameSavedSample(controller.savedEditor), /same source link/);
            assert.deepEqual(controller.samples, [sample]);
            assert.ok(controller.savedEditor.panel);
        }
    });

    test(`${kind}: resize redraws editor waveform and reopening clears the previous private PCM`, async () => {
        const { controller, sample, observers } = fixture(kind);
        await controller.trimSample(sample);
        const editor = controller.savedEditor;
        const previousRecorder = editor.recorder;
        const previousObserver = observers[0];
        previousObserver.callback();
        assert.match(editor.canvas.attributes['aria-label'], /Selected 0\.000 to 1\.000/);
        controller.editSampleName(sample);
        assert.equal(previousRecorder.frames, 0);
        assert.equal(previousObserver.disconnected, true);
        assert.equal(controller.savedEditor.recorder, null);
        assert.match(controller.savedEditor.panel.children[0].textContent, /Rename file/);
    });
}

test('mobile browser/editor CSS preserves one whole scroll surface and 44px controls', () => {
    const css = fs.readFileSync(path.join(__dirname, '../radiolab.css'), 'utf8');
    const videoCss = fs.readFileSync(path.join(__dirname, '../videolab.css'), 'utf8');
    assert.match(css, /#radiolabSamplesDialog \{[^}]*overflow: auto;/);
    assert.match(videoCss, /#videolabSamplesDialog \{[^}]*overflow: auto;/);
    assert.match(css, /@media \(max-width: 480px\), \(pointer: coarse\)/);
    assert.match(css, /\.lab-saved-editor-actions button\.performance-btn[^}]*min-height: 44px/);
    assert.doesNotMatch(css, /\.lab-saved-editor[^{}]*\{[^}]*overflow:\s*(?:auto|scroll)/);
    assert.doesNotMatch(css, /\.lab-saved-editor[^{}]*\{[^}]*position:\s*(?:fixed|sticky)/);
});
