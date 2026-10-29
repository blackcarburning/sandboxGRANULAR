(function (root) {
    'use strict';

    const accountPrefix = 'mygrain-account:';
    const eventKey = '__mygrain_account_event__';

    function namespace(username) {
        return username === 'admin' ? '' : `${accountPrefix}${encodeURIComponent(username)}:`;
    }

    function scopedStorage(storage, username, writable = () => true) {
        const prefix = namespace(username);
        const owns = key => key !== eventKey && (prefix ? key.startsWith(prefix) : !key.startsWith(accountPrefix));
        const keys = () => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key !== null && owns(key));
        const check = () => { if (!writable()) throw new DOMException('This account session is locked.', 'SecurityError'); };
        const methods = {
            getItem(key) { const name = prefix + String(key); return owns(name) ? storage.getItem(name) : null; },
            setItem(key, value) { check(); const name = prefix + String(key); if (owns(name)) storage.setItem(name, String(value)); },
            removeItem(key) { check(); const name = prefix + String(key); if (owns(name)) storage.removeItem(name); },
            clear() { check(); keys().forEach(key => storage.removeItem(key)); },
            key(index) { const key = keys()[Number(index) >>> 0]; return key === undefined ? null : key.slice(prefix.length); }
        };
        return new Proxy(Object.create(null), {
            get(target, key) {
                if (key === 'length') return keys().length;
                if (key === Symbol.toStringTag) return 'Storage';
                if (Object.hasOwn(methods, key)) return methods[key];
                return typeof key === 'string' ? methods.getItem(key) ?? undefined : undefined;
            },
            set(target, key, value) { methods.setItem(key, value); return true; },
            deleteProperty(target, key) { methods.removeItem(key); return true; },
            ownKeys() { return keys().map(key => key.slice(prefix.length)); },
            has(target, key) { return Object.hasOwn(methods, key) || key === 'length' || methods.getItem(key) !== null; },
            getOwnPropertyDescriptor(target, key) {
                const value = methods.getItem(key);
                return value === null ? undefined : { configurable: true, enumerable: true, writable: true, value };
            },
            defineProperty(target, key, descriptor) { if ('value' in descriptor) methods.setItem(key, descriptor.value); return true; }
        });
    }

    function scopedDatabases(database, username, writable = () => true, trackDatabase = () => {}, trackTransaction = () => {}) {
        const prefix = namespace(username);
        const owns = name => prefix ? name.startsWith(prefix) : !name.startsWith(accountPrefix);
        return new Proxy(database, {
            get(target, key) {
                if (key === 'open' || key === 'deleteDatabase') return (name, ...args) => {
                    if (!writable()) throw new DOMException('This account session is locked.', 'SecurityError');
                    const scoped = prefix + String(name);
                    if (!owns(scoped)) throw new DOMException('Reserved account database.', 'SecurityError');
                    const request = target[key](scoped, ...args);
                    if (key === 'open') request.addEventListener('success', () => {
                        const connection = request.result;
                        if (!writable()) { connection.close(); return; }
                        const transaction = connection.transaction.bind(connection);
                        const close = connection.close.bind(connection);
                        Object.defineProperty(connection, 'close', { configurable: true, value: () => {
                            trackDatabase(connection, false);
                            close();
                        } });
                        connection.addEventListener('close', () => trackDatabase(connection, false), { once: true });
                        Object.defineProperty(connection, 'transaction', { configurable: true, value: (...args) => {
                            if (!writable()) throw new DOMException('This account session is locked.', 'SecurityError');
                            const result = transaction(...args);
                            trackTransaction(result);
                            return result;
                        } });
                        trackDatabase(connection, true);
                    });
                    return request;
                };
                if (key === 'databases' && target.databases) return async () => (await target.databases()).filter(entry => owns(entry.name || '')).map(entry => ({ ...entry, name: entry.name.slice(prefix.length) }));
                const value = Reflect.get(target, key, target);
                return typeof value === 'function' ? value.bind(target) : value;
            }
        });
    }

    function renderDatabases(database, username, bridge, writable = () => true) {
        const prefix = namespace(username);
        return {
            open(name, version) {
                if (!database || !writable()) throw new DOMException('The account renderer is unavailable.', 'SecurityError');
                const logical = String(name);
                if (!logical.includes('-song-render-')) throw new DOMException('Not a temporary renderer database.', 'SecurityError');
                bridge.databases.add(logical);
                const request = database.open(prefix + logical, version);
                request.addEventListener('success', () => {
                    if (bridge.disposed) {
                        request.result.close();
                        database.deleteDatabase(prefix + logical);
                    } else bridge.connections.add(request.result);
                });
                return request;
            },
            deleteDatabase(name) {
                if (!bridge.databases.has(name)) throw new DOMException('Not a registered renderer database.', 'SecurityError');
                return database.deleteDatabase(prefix + name);
            }
        };
    }

    function protectedUrl(input, base) {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, base);
        return /^https?:$/.test(url.protocol) && url.origin === new URL(base).origin && /^\/mygrain(?:\/(?:api|patches)(?:\/|$)|-(?:wavs|stems|midi|bastardloops)(?:\/|$)|\/?$)/.test(url.pathname);
    }

    function creditName(value) {
        const name = value && typeof value === 'object' ? value.username : value;
        return typeof name === 'string' ? name.trim() : '';
    }

    function wavCredits(file = {}) {
        const creator = creditName(file.createdBy) || 'unknown';
        const sharer = creditName(file.sharedBy);
        return `Created by ${creator}${sharer ? ` · Shared by ${sharer}` : ''}`;
    }

    function wavNotesLabel(file = {}) {
        const parts = ['Repo Notes'];
        if (file.feedback?.comment) {
            parts.push(`Comment by ${creditName(file.feedback.commentBy ?? file.commentBy) || 'unknown'}`);
        }
        const sharer = creditName(file.sharedBy);
        if (sharer) parts.push(`Your Repo Notes on this copy are visible to ${sharer}.`);
        return parts.join(' · ');
    }

    function commentText(comments, commentsBy = '', authorLabel = '') {
        const entries = Array.isArray(comments) ? comments : comments ? [comments] : [];
        return entries.map(entry => {
            if (typeof entry === 'string') return entry ? `${creditName(commentsBy) ? `${authorLabel}${creditName(commentsBy)}: ` : ''}${entry}` : '';
            if (!entry || typeof entry !== 'object') return '';
            const author = creditName(entry.username) || creditName(entry.author) || creditName(entry.commentBy) || creditName(commentsBy);
            const text = entry.comment || entry.text || entry.message || '';
            const reaction = entry.reaction ? ` (${entry.reaction})` : '';
            return `${author ? `${authorLabel}${author}: ` : ''}${text}${reaction}`;
        }).filter(Boolean).join('\n');
    }

    function createMediaPreview(audio, source, host = globalThis) {
        let generation = 0;
        let controller;
        let blobUrl;
        let disposed = false;
        const stop = () => {
            generation += 1;
            controller?.abort();
            controller = null;
            try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch {}
            if (blobUrl) host.URL.revokeObjectURL(blobUrl);
            blobUrl = null;
        };
        const ended = () => stop();
        audio.addEventListener('ended', ended);
        return {
            async play() {
                if (disposed) return false;
                if (blobUrl) {
                    try { await audio.play(); return !disposed; } catch (error) {
                        if (error.name === 'NotAllowedError') return !disposed;
                        stop();
                        throw error;
                    }
                }
                stop();
                const current = generation;
                const request = controller = new AbortController();
                try {
                    const response = await host.fetch(source, { cache: 'no-store', signal: request.signal });
                    if (!response.ok) throw new Error(`Audio download failed (${response.status}).`);
                    const blob = await response.blob();
                    if (current !== generation || disposed) return false;
                    blobUrl = host.URL.createObjectURL(blob);
                    audio.src = blobUrl;
                    audio.load();
                    try { await audio.play(); } catch (error) { if (error.name !== 'NotAllowedError') throw error; }
                    return current === generation && !disposed;
                } catch (error) {
                    if (current !== generation || disposed || request.signal.aborted) return false;
                    stop();
                    throw error;
                } finally { if (controller === request) controller = null; }
            },
            stop,
            dispose() { disposed = true; stop(); audio.removeEventListener('ended', ended); }
        };
    }

    const exports = { namespace, scopedStorage, scopedDatabases, renderDatabases, protectedUrl, wavCredits, wavNotesLabel, commentText, createMediaPreview };
    if (typeof module !== 'undefined' && module.exports) module.exports = exports;
    if (!root.document) return;

    const document = root.document;
    const renderDeck = Boolean(root.__mygrainSongRenderDeck);
    const context = renderDeck ? root.parent.mygrainAccountContext : root.mygrainAccountContext;
    const username = typeof context?.user?.username === 'string' && context.user.username ? context.user.username : null;
    const identity = username ? Object.freeze({ username }) : null;
    root.mygrainAccountContext = Object.freeze({ user: identity });
    let active = Boolean(identity);
    let failure = '';
    let rawLocal;
    let rawDatabases;
    let channel;
    const audioContexts = new Set();
    const databaseConnections = new Set();
    const transactions = new Set();
    const pendingRequests = new Set();
    const mediaPreviews = new Set();
    const nativeFetch = root.fetch.bind(root);
    const byId = id => document.getElementById(id);

    function stopAudio() {
        pendingRequests.forEach(controller => controller.abort());
        pendingRequests.clear();
        mediaPreviews.forEach(preview => preview.dispose());
        mediaPreviews.clear();
        shareController?.abort();
        transactions.forEach(transaction => { try { transaction.abort(); } catch {} });
        transactions.clear();
        databaseConnections.forEach(connection => connection.close());
        databaseConnections.clear();
        document.querySelectorAll('audio, video').forEach(media => { try { media.pause(); } catch {} });
        audioContexts.forEach(context => {
            try { Promise.resolve(context.suspend()).catch(() => {}); } catch {}
            try { Promise.resolve(context.close()).catch(() => {}); } catch {}
        });
        root.dispatchEvent(new Event('mygrain-account-lock'));
    }

    function publish(action, user) {
        const event = { action, username: user || null, nonce: root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` };
        try { rawLocal?.setItem(eventKey, JSON.stringify(event)); } catch {}
        try { channel?.postMessage(event); } catch {}
    }

    function lock(message = 'Your session ended. Log in to continue.') {
        if (renderDeck) return;
        active = false;
        failure = message;
        document.documentElement.dataset.mygrainLocked = 'true';
        stopAudio();
        byId('mygrainShareDialog')?.close();
        showLogin(message);
    }

    function accountEvent(event) {
        if (event && (event.action === 'logout' || event.username !== username)) lock('The account changed in another tab. Log in to reload your workspace.');
    }

    try {
        if (!renderDeck) {
            rawLocal = root.localStorage;
            if (identity) {
                Object.defineProperty(root, 'localStorage', { configurable: true, value: scopedStorage(rawLocal, username, () => active) });
                Object.defineProperty(root, 'sessionStorage', { configurable: true, value: scopedStorage(root.sessionStorage, username, () => active) });
                rawDatabases = root.indexedDB;
                if (rawDatabases) Object.defineProperty(root, 'indexedDB', { configurable: true, value: scopedDatabases(rawDatabases, username, () => active,
                    (connection, opened) => opened ? databaseConnections.add(connection) : databaseConnections.delete(connection), transaction => {
                        transactions.add(transaction);
                        const done = () => transactions.delete(transaction);
                        transaction.addEventListener('complete', done, { once: true });
                        transaction.addEventListener('abort', done, { once: true });
                    }) });
            }
        }
    } catch {
        active = false;
        failure = 'Account storage could not be isolated. Allow browser storage, then reload.';
    }

    root.fetch = async function (input, options) {
        if (!protectedUrl(input, document.baseURI)) return nativeFetch(input, options);
        if (!active) throw new DOMException('Log in before using this workspace.', 'NotAllowedError');
        const request = new Request(input, options);
        const headers = new Headers(request.headers);
        headers.set('X-Mygrain-User', username);
        const controller = new AbortController();
        const abort = () => controller.abort(request.signal.reason);
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
        pendingRequests.add(controller);
        const cleanup = () => { pendingRequests.delete(controller); request.signal.removeEventListener('abort', abort); };
        const guard = () => { if (!active || controller.signal.aborted) throw new DOMException('The account request was cancelled.', 'AbortError'); };
        const guarded = response => new Proxy(response, { get(target, key) {
            if (['json', 'text', 'blob', 'arrayBuffer', 'formData', 'bytes'].includes(key) && typeof target[key] === 'function') return async (...args) => {
                try { guard(); const body = await target[key](...args); guard(); return body; } finally { cleanup(); }
            };
            if (key === 'clone') return () => { guard(); return guarded(target.clone()); };
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
        } });
        try {
            const response = await nativeFetch(new Request(request, { headers, credentials: 'same-origin', signal: controller.signal }));
            if (response.status === 401 || response.status === 403) lock('Your session expired or changed. Log in to reload your workspace.');
            guard();
            if (!response.body) cleanup();
            return guarded(response);
        } catch (error) { cleanup(); throw error; }
    };

    async function api(path, options = {}, auth = false) {
        const fetcher = auth ? nativeFetch : root.fetch;
        const headers = new Headers(options.headers);
        if (auth && identity && /\/auth\/(session|logout)$/.test(path)) headers.set('X-Mygrain-User', username);
        const response = await fetcher(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
        return payload;
    }

    function showLogin(message = '', mode = new URL(root.location.href).searchParams.get('account')) {
        if (!document.body) return;
        let shell = byId('mygrain-account-shell');
        if (!shell) {
            shell = document.createElement('section');
            shell.id = 'mygrain-account-shell';
            shell.className = 'mygrain-account-shell';
            shell.setAttribute('aria-labelledby', 'mygrainLoginTitle');
            shell.innerHTML = `<div class="mygrain-account-panel"><button type="button" id="mygrainLoginBackBtn">Back</button><h1 id="mygrainLoginTitle">MYGRAIN</h1>
                <p>Log in or request your own workspace. New accounts require approval before they can be used.</p>
                <form id="mygrainLoginForm" action="/mygrain/api/auth/login" method="post">
                    <label for="mygrainLoginUsername">Username</label><input id="mygrainLoginUsername" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required maxlength="64">
                    <label for="mygrainLoginPassword">Password</label><input id="mygrainLoginPassword" name="password" type="password" autocomplete="current-password" required maxlength="1024">
                    <label for="mygrainLoginEmail">Email (for new account requests)</label><input id="mygrainLoginEmail" name="email" type="email" autocomplete="email" maxlength="254"><p class="mygrain-account-hint">We will email you once approved. Your request IP and approximate location, when available, are recorded for owner review only.</p>
                    <div class="mygrain-account-actions"><button id="mygrainLoginBtn" type="submit">Log in</button><button id="mygrainCreateUserBtn" type="submit" name="create" value="true">Request account</button></div>
                    <p id="mygrainLoginStatus" role="status" aria-live="polite"></p>
                </form><p class="mygrain-account-hint">Passwords are never saved in app storage. Only your password manager and a persistent server session remember your login.</p>
                <p class="mygrain-account-hint">Build v2026.10.21.V.1</p></div>`;
            document.body.append(shell);
            byId('mygrainLoginBackBtn').addEventListener('click', () => {
                if (byId('mygrainLoginForm').dataset.pending) return;
                if (!byId('start-overlay')?.querySelector('[data-account-state="guest"]')) return;
                shell.remove();
                const next = new URL(root.location.href);
                next.searchParams.delete('account');
                root.history.replaceState(null, '', next.href);
                byId('start-btn')?.focus();
            });
            const password = byId('mygrainLoginPassword');
            byId('mygrainCreateUserBtn').addEventListener('focus', () => password.autocomplete = 'new-password');
            byId('mygrainLoginBtn').addEventListener('focus', () => password.autocomplete = 'current-password');
            byId('mygrainLoginForm').noValidate = true;
            byId('mygrainLoginForm').addEventListener('submit', async event => {
                event.preventDefault();
                const create = event.submitter?.id === 'mygrainCreateUserBtn';
                const form = event.currentTarget;
                const email = byId('mygrainLoginEmail'); email.required = create;
                if (!byId('mygrainLoginUsername').reportValidity() || !password.reportValidity() || (create && !email.reportValidity())) return;
                if (form.dataset.pending) return;
                form.dataset.pending = 'true';
                password.autocomplete = create ? 'new-password' : 'current-password';
                byId('mygrainLoginBtn').disabled = true;
                byId('mygrainCreateUserBtn').disabled = true;
                byId('mygrainLoginStatus').textContent = create ? 'Submitting your account request…' : 'Logging in…';
                try {
                    if (!/^https?:$/.test(root.location.protocol)) throw new Error('Open MYGRAIN from its server to log in. File previews cannot authenticate.');
                    const requested = byId('mygrainLoginUsername').value.trim();
                    const payload = await api(`/mygrain/api/auth/${create ? 'register' : 'login'}`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: requested, password: password.value, ...(create ? {email:email.value.trim()} : {}) })
                    }, true);
                    if (payload.pending) {
                        password.value='';
                        byId('mygrainLoginStatus').textContent=payload.message;
                        byId('mygrainLoginBtn').disabled=false;byId('mygrainCreateUserBtn').disabled=false;delete form.dataset.pending;
                        return;
                    }
                    publish('login', payload.user?.username || requested);
                    password.value = '';
                    const next = new URL(root.location.href);
                    next.searchParams.delete('account');
                    root.history.replaceState(null, '', next.href);
                    root.location.reload();
                } catch (error) {
                    byId('mygrainLoginStatus').textContent = error.message || 'Could not reach the account server. Please retry.';
                    byId('mygrainLoginBtn').disabled = false;
                    byId('mygrainCreateUserBtn').disabled = false;
                    delete form.dataset.pending;
                }
            });
        }
        byId('mygrainLoginBackBtn').hidden = !byId('start-overlay')?.querySelector('[data-account-state="guest"]');
        if (mode === 'create') {
            byId('mygrainLoginTitle').textContent = 'MYGRAIN · Request account';
            byId('mygrainLoginPassword').autocomplete = 'new-password';
            const create = byId('mygrainCreateUserBtn');
            create.parentElement.prepend(create);
        }
        byId('mygrainLoginStatus').textContent = message;
    }

    function renderStartAccount(start) {
        const account = document.createElement('section');
        account.className = 'mygrain-start-account';
        account.dataset.accountState = active ? 'signed-in' : 'guest';
        account.setAttribute('aria-label', 'Account');
        account.innerHTML = '<strong>Account: <span id="mygrainStartCurrentUser"></span></strong><div class="mygrain-account-actions"><button type="button" data-mygrain-account-action="login"></button><button type="button" data-mygrain-account-action="create">Request account</button></div>';
        const label = account.querySelector('#mygrainStartCurrentUser');
        label.textContent = active ? username : 'Not signed in';
        label.title = label.textContent;
        account.querySelector('[data-mygrain-account-action="login"]').textContent = active ? 'Switch user' : 'Log in';
        account.querySelectorAll('[data-mygrain-account-action]').forEach(button => {
            button.addEventListener('click', () => active
                ? logout(button.dataset.mygrainAccountAction)
                : showLogin('', button.dataset.mygrainAccountAction));
        });
        if (active) {
            const logoutButton = document.createElement('button');
            logoutButton.type = 'button';
            logoutButton.dataset.mygrainLogout = 'true';
            logoutButton.textContent = 'Log out';
            logoutButton.addEventListener('click', logout);
            account.querySelector('.mygrain-account-actions').append(logoutButton);
        }
        start.insertBefore(account, byId('start-btn'));
        byId('start-btn').disabled = false;
    }

    async function logout(destination) {
        if (!active) return;
        lock('Logging out…');
        const form = byId('mygrainLoginForm');
        if (form) {
            form.dataset.pending = 'logout';
            form.querySelectorAll('input, button').forEach(control => control.disabled = true);
        }
        publish('logout');
        try {
            await api('/mygrain/api/auth/logout', { method: 'POST' }, true);
            if (destination === 'login' || destination === 'create') {
                const next = new URL(root.location.href);
                next.searchParams.set('account', destination);
                root.location.replace(next.href);
            } else {
                root.location.reload();
            }
        } catch (error) {
            if (form) {
                delete form.dataset.pending;
                form.querySelectorAll('input, button').forEach(control => control.disabled = false);
            }
            showLogin(`The workspace is locked, but server logout failed: ${error.message}. Retry logging in when connected.`);
        }
    }

    async function verifySession() {
        if (!active || renderDeck) return;
        try {
            const payload = await api('/mygrain/api/auth/session', {}, true);
            if (!payload.authenticated || payload.user?.username !== username) lock('Your session changed. Log in to reload your workspace.');
        } catch {}
    }

    let shareGeneration = 0;
    let shareController;
    let shareFilename = null;
    function renderComments(shares, filename) {
        const thread = byId('mygrainShareThread');
        thread.replaceChildren();
        const matching = shares.filter(share => !filename || share.filename === filename);
        matching.forEach(share => {
            const item = document.createElement('article');
            item.className = 'mygrain-share-thread-item';
            const heading = document.createElement('h3');
            heading.textContent = `${share.filename} → ${share.recipient}`;
            const copy = document.createElement('p');
            copy.textContent = `Recipient copy: ${share.recipientFilename || share.filename}`;
            const credits = document.createElement('p');
            credits.className = 'mygrain-wav-credits';
            credits.textContent = wavCredits(share);
            const comments = document.createElement('p');
            comments.className = 'mygrain-share-comment';
            comments.dataset.shareId = String(share.id || '');
            comments.textContent = commentText(share.comments, creditName(share.commentsBy) || 'unknown', 'Comment by ') || 'No recipient comments yet.';
            item.append(heading, copy, credits, comments);
            thread.append(item);
        });
        if (!matching.length) thread.textContent = 'No WAVs shared yet.';
    }

    function ensureShareDialog() {
        if (byId('mygrainShareDialog')) return byId('mygrainShareDialog');
        const dialog = document.createElement('dialog');
        dialog.id = 'mygrainShareDialog';
        dialog.className = 'mygrain-share-dialog';
        dialog.setAttribute('aria-labelledby', 'mygrainShareTitle');
        dialog.innerHTML = `<div class="mygrain-share-head"><h2 id="mygrainShareTitle">Share WAV</h2><button id="mygrainShareClose" type="button" aria-label="Close sharing">Close</button></div>
            <p id="mygrainShareFilename"></p><p id="mygrainShareCredits" class="mygrain-wav-credits"></p><form id="mygrainShareForm"><label for="mygrainShareRecipient">Choose a username</label><select id="mygrainShareRecipient" name="username" required></select><button id="mygrainShareSubmit" type="submit" disabled>Share a WAV copy</button></form>
            <p id="mygrainShareStatus" role="status" aria-live="polite"></p><section id="mygrainShareComments" aria-labelledby="mygrainShareCommentsTitle"><div class="mygrain-share-head"><h3 id="mygrainShareCommentsTitle">Recipient comments</h3><button id="mygrainShareRefresh" type="button">Refresh comments</button></div><div id="mygrainShareThread"></div></section>`;
        document.body.append(dialog);
        byId('mygrainShareClose').addEventListener('click', () => dialog.close());
        dialog.addEventListener('close', () => { shareGeneration += 1; shareController?.abort(); });
        byId('mygrainShareRefresh').addEventListener('click', () => loadShares());
        byId('mygrainShareForm').addEventListener('submit', async event => {
            event.preventDefault();
            if (!active || !shareFilename || byId('mygrainShareSubmit').disabled) return;
            const generation = shareGeneration;
            const recipient = byId('mygrainShareRecipient').value;
            if (!recipient) return;
            byId('mygrainShareSubmit').disabled = true;
            byId('mygrainShareStatus').textContent = 'Copying WAV…';
            try {
                const result = await api('/mygrain-wavs/api/share', {
                    method: 'POST', signal: shareController.signal, headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: shareFilename, username: recipient })
                });
                if (generation !== shareGeneration) return;
                byId('mygrainShareStatus').textContent = `Shared a copy with ${result.share?.recipient || recipient}. They can add feedback in their WAV Repo Notes.`;
                await loadShares(false);
            } catch (error) {
                if (generation === shareGeneration) byId('mygrainShareStatus').textContent = `Share failed: ${error.message}. Refresh comments before retrying if the connection was interrupted.`;
            } finally {
                if (generation === shareGeneration && active) byId('mygrainShareSubmit').disabled = false;
            }
        });
        return dialog;
    }

    async function loadShares(status = true) {
        const generation = shareGeneration;
        if (status) byId('mygrainShareStatus').textContent = 'Loading recipient comments…';
        try {
            const payload = await api('/mygrain-wavs/api/shares', { signal: shareController.signal });
            if (generation !== shareGeneration) return;
            renderComments(payload.shares || [], shareFilename);
            if (status) byId('mygrainShareStatus').textContent = 'Comments show the current notes on each recipient’s copy.';
        } catch (error) {
            if (generation === shareGeneration) byId('mygrainShareStatus').textContent = `Could not refresh comments: ${error.message}`;
        }
    }

    async function openShare(file) {
        if (!active) return;
        const dialog = ensureShareDialog();
        shareController?.abort();
        shareController = new AbortController();
        const generation = ++shareGeneration;
        shareFilename = file?.name || null;
        byId('mygrainShareTitle').textContent = shareFilename ? 'Share WAV' : 'Shared WAVs';
        byId('mygrainShareFilename').textContent = shareFilename || 'Your outbound WAV copies and recipient feedback.';
        byId('mygrainShareCredits').textContent = shareFilename ? wavCredits(file) : '';
        byId('mygrainShareCredits').hidden = !shareFilename;
        byId('mygrainShareForm').hidden = !shareFilename;
        byId('mygrainShareRecipient').replaceChildren();
        byId('mygrainShareSubmit').disabled = true;
        byId('mygrainShareThread').textContent = 'Loading…';
        if (!dialog.open) dialog.showModal();
        byId('mygrainShareStatus').textContent = shareFilename ? 'Loading usernames and recipient comments…' : 'Loading recipient comments…';
        const comments = loadShares(!shareFilename);
        if (shareFilename) {
            try {
                const payload = await api('/mygrain/api/auth/users', { signal: shareController.signal });
                if (generation !== shareGeneration) return;
                (payload.users || []).filter(user => user.username !== username).forEach(user => {
                    const option = document.createElement('option');
                    option.value = user.username;
                    option.textContent = user.username;
                    byId('mygrainShareRecipient').append(option);
                });
                byId('mygrainShareSubmit').disabled = !byId('mygrainShareRecipient').options.length;
                byId('mygrainShareStatus').textContent = byId('mygrainShareSubmit').disabled ? 'No other users yet. Create a user before sharing.' : 'Choose a username to share a WAV copy.';
            } catch (error) {
                if (generation === shareGeneration) byId('mygrainShareStatus').textContent = `Could not load usernames: ${error.message}`;
            }
        }
        await comments;
    }

    root.mygrainAccounts = Object.freeze({
        get authenticated() { return active; }, user: identity, logout, openShare, verifySession, wavCredits, wavNotesLabel,
        createRenderDatabaseFactory(bridge) {
            if (!active) throw new DOMException('The account session is locked.', 'SecurityError');
            return renderDatabases(rawDatabases, username, bridge, () => active);
        },
        createMediaPreview(audio, source) {
            const preview = createMediaPreview(audio, source, root);
            const dispose = preview.dispose;
            preview.dispose = () => { dispose(); mediaPreviews.delete(preview); };
            mediaPreviews.add(preview);
            return preview;
        },
        loadScript(source, attributes = {}) {
            if (!active || (renderDeck && new URL(source, document.baseURI).origin !== new URL(document.baseURI).origin)) return;
            const script = document.createElement('script');
            script.setAttribute('src', source);
            Object.entries(attributes).forEach(([key, value]) => script.setAttribute(key, value));
            document.write(script.outerHTML);
        },
        loadStyle(source) {
            if (!active) return;
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.setAttribute('href', source);
            document.write(link.outerHTML);
        }
    });

    if (renderDeck) {
        root.parent.addEventListener('mygrain-account-lock', () => {
            active = false;
            pendingRequests.forEach(controller => controller.abort());
            pendingRequests.clear();
            mediaPreviews.forEach(preview => preview.dispose());
            mediaPreviews.clear();
        }, { once: true });
        root.mygrainStartup?.reveal();
        return;
    }
    document.documentElement.dataset.mygrainLocked = String(!active);
    if (!active && document.readyState === 'loading') document.write('<template id="mygrain-account-inert-app">');
    if (identity) {
        for (const key of ['AudioContext', 'webkitAudioContext']) {
            const Constructor = root[key];
            if (!Constructor) continue;
            root[key] = new Proxy(Constructor, { construct(target, args, newTarget) {
                if (!active) throw new DOMException('The account session is locked.', 'NotAllowedError');
                const context = Reflect.construct(target, args, newTarget);
                audioContexts.add(context);
                context.addEventListener('statechange', () => { if (context.state === 'closed') audioContexts.delete(context); });
                return context;
            } });
        }
    }
    root.addEventListener('storage', event => {
        if (event.key !== eventKey || !event.newValue) return;
        try { accountEvent(JSON.parse(event.newValue)); } catch {}
    });
    try {
        channel = new BroadcastChannel('mygrain-account-session');
        channel.addEventListener('message', event => accountEvent(event.data));
    } catch {}
    root.addEventListener('focus', verifySession);
    root.addEventListener('pageshow', event => { if (event.persisted) verifySession(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) verifySession(); });
    document.addEventListener('click', event => {
        if (!active && event.target.closest?.('#start-btn')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            showLogin();
        }
    }, true);
    document.addEventListener('DOMContentLoaded', () => {
        if (!active) {
            // Keep the protected app inert; clone only the public opening screen.
            const start = byId('mygrain-account-inert-app')?.content.querySelector('#start-overlay')?.cloneNode(true);
            document.body.replaceChildren(...(start ? [start] : []));
            if (start) renderStartAccount(start);
            if (!start || failure || new URL(root.location.href).searchParams.has('account') || !/^https?:$/.test(root.location.protocol)) {
                showLogin(failure || (!/^https?:$/.test(root.location.protocol) ? 'Open MYGRAIN from its server to log in.' : ''));
            }
            root.mygrainStartup?.reveal();
            return;
        }
        const toolbar = document.createElement('nav');
        toolbar.id = 'mygrainAccountToolbar';
        toolbar.className = 'mygrain-account-toolbar';
        toolbar.setAttribute('aria-label', 'Your account');
        toolbar.innerHTML = '<span>Account: <strong id="mygrainCurrentUser"></strong></span><button id="mygrainSharedWavsBtn" type="button">Shared WAVs</button><button id="mygrainLogoutBtn" type="button">Log out</button>';
        const accountControls = byId('mygrainAccountControls');
        if (accountControls) accountControls.append(toolbar);
        else document.body.prepend(toolbar);
        byId('mygrainCurrentUser').textContent = username;
        byId('mygrainLogoutBtn').addEventListener('click', logout);
        byId('mygrainSharedWavsBtn').addEventListener('click', () => openShare());
        const start = byId('start-overlay');
        if (start) renderStartAccount(start);
        if (byId('start-btn')) byId('start-btn').disabled = false;
        root.mygrainStartup?.reveal();
    }, { once: true });
})(typeof window === 'undefined' ? globalThis : window);
