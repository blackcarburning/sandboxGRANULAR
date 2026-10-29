(function () {
    'use strict';
    const bridge = parent.__mygrainSongRenderBridges.get(window.name);
    if (!bridge) throw new Error('Song render bridge is missing.');
    bridge.connections ||= new Set();
    window.__mygrainSongRenderDeck = true;
    const values = new Map([['granularSynthState', JSON.stringify(bridge.state)]]);
    const storage = {
        getItem: key => values.get(String(key)) ?? null,
        setItem: (key, value) => values.set(String(key), String(value)),
        removeItem: key => values.delete(String(key)),
        clear: () => values.clear(),
        key: index => [...values.keys()][index] ?? null,
        get length() { return values.size; }
    };
    Object.defineProperty(window, 'localStorage', { value: storage });
    Object.defineProperty(window, 'sessionStorage', { value: storage });
    let database = bridge.databaseFactory;
    if (!database) try { database = window.indexedDB; } catch {}
    bridge.databaseFactory = database;
    Object.defineProperty(window, 'indexedDB', { value: {
        open(name, version) {
            if (!database) throw new Error('Browser audio storage is unavailable; song sources must come from the saved snapshot.');
            const isolated = `${name}-song-render-${window.name}`;
            bridge.databases.add(isolated);
            const request = database.open(isolated, version);
            request.addEventListener('success', () => {
                if (bridge.disposed) { request.result.close(); database.deleteDatabase(isolated); }
                else bridge.connections.add(request.result);
            });
            return request;
        }
    } });
    const localProperties = new Map();
    const contextListeners = [];
    const captureOption = options => typeof options === 'boolean' ? options : Boolean(options?.capture);
    bridge.disposeContext = () => {
        window.mygrainWasp?.dispose();
        window.mygrainNoise?.dispose();
        for (const entry of contextListeners) bridge.context.removeEventListener(entry.type, entry.listener, entry.capture);
        contextListeners.length = 0;
        localProperties.clear();
        values.clear();
    };
    const context = new Proxy(bridge.context, {
        get(target, key) {
            if (key === '__mygrainNativeContext') return bridge.context;
            if (key === 'destination') return bridge.destination;
            if (key === 'state' && bridge.disposed) return 'closed';
            if (key === 'close' || key === 'suspend') return async () => {};
            if (key === 'addEventListener') return (type, listener, options) => {
                if (bridge.disposed) throw new DOMException('Cancelled', 'AbortError');
                target.addEventListener(type, listener, options);
                contextListeners.push({ type, listener, capture: captureOption(options) });
            };
            if (key === 'removeEventListener') return (type, listener, options) => {
                target.removeEventListener(type, listener, options);
                for (let index = contextListeners.length - 1; index >= 0; index -= 1) {
                    const entry = contextListeners[index];
                    if (entry.type === type && entry.listener === listener && entry.capture === captureOption(options)) contextListeners.splice(index, 1);
                }
            };
            if (localProperties.has(key)) return localProperties.get(key);
            const value = Reflect.get(target, key, target);
            if (typeof value !== 'function') return value;
            return (...args) => {
                if (bridge.disposed && String(key).startsWith('create')) throw new DOMException('Cancelled', 'AbortError');
                const result = value.apply(target, args);
                if (String(key).startsWith('create') && result?.disconnect) {
                    bridge.nodes.add(result);
                    const connect = result.connect;
                    if (connect) result.connect = function (...args) {
                        const value = connect.apply(this, args);
                        bridge.nodes.add(result);
                        return value;
                    };
                    const disconnect = result.disconnect;
                    result.disconnect = function (...args) {
                        const value = disconnect.apply(this, args);
                        // Scheduled sources remain tracked until ended so
                        // cancellation can stop even temporarily unrouted audio.
                        if (!args.length && typeof result.start !== 'function') bridge.nodes.delete(result);
                        return value;
                    };
                    if (typeof result.start === 'function' && typeof result.stop === 'function') {
                        // Do not retain every finished grain/drum/oscillator for
                        // the duration of a long part. Let its own ended handler
                        // finish first, then release the parent-owned reference.
                        result.addEventListener?.('ended', () => Promise.resolve().then(() => {
                            bridge.nodes.delete(result);
                            result.onended = null;
                            try { result.disconnect(); } catch {}
                            try { if ('buffer' in result) result.buffer = null; } catch {}
                        }), { once: true });
                    }
                }
                return result;
            };
        },
        set(target, key, value) {
            localProperties.set(key, value);
            return true;
        }
    });
    window.AudioContext = function () { return context; };
    window.webkitAudioContext = window.AudioContext;
})();
