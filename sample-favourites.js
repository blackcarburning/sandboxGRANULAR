(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else {
        root.MygrainFavourites = api;
        root.mygrainFavourites = new api.Library();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const itemKey = (scope, identity) => JSON.stringify([String(scope), String(identity)]);

    class Library {
        constructor(options = {}) {
            this.document = options.document || root.document;
            this.fetch = options.fetch || root.fetch?.bind(root);
            this.storage = options.storage;
            if (!this.storage) {
                try { this.storage = root.localStorage; } catch (error) {}
            }
            this.groups = [];
            this.revision = 0;
            this.loaded = false;
            this.loading = null;
            this.views = new Map();
            this.states = {};
            try { this.states = JSON.parse(this.storage?.getItem('mygrain-favourite-views-v1') || '{}'); } catch (error) {}
            if (!this.states || typeof this.states !== 'object' || Array.isArray(this.states)) this.states = {};
        }

        state(browser) {
            if (!this.states[browser] || typeof this.states[browser] !== 'object') this.states[browser] = { filter: '', collection: 'default' };
            return this.states[browser];
        }

        remember() {
            try { this.storage?.setItem('mygrain-favourite-views-v1', JSON.stringify(this.states)); } catch (error) {}
        }

        group(browser) {
            return this.groups.find(group => group.id === this.state(browser).collection) || this.groups[0];
        }

        searchText(key) {
            return this.groups.map(group => group.items[key]?.name || '').join(' ');
        }

        matches(browser, key) {
            const filter = this.state(browser).filter;
            if (!filter) return true;
            return this.groups.some(group => (filter === '*' || group.id === filter) && Object.hasOwn(group.items, key));
        }

        async request(body) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30000);
            try {
                const response = await this.fetch('/mygrain/api/favourites', {
                    method: body ? 'POST' : 'GET',
                    cache: 'no-store',
                    signal: controller.signal,
                    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
                });
                const payload = await response.json();
                if (!response.ok || !payload.ok || !Array.isArray(payload.groups)) throw new Error(payload.error || `Favourites request failed (${response.status})`);
                if (Number(payload.revision) >= this.revision) {
                    this.groups = payload.groups;
                    this.revision = Number(payload.revision);
                    this.loaded = true;
                }
                return payload;
            } finally { clearTimeout(timer); }
        }

        async refresh() {
            if (this.loading) return this.loading;
            this.loading = this.request().then(() => { this.status('Favourites ready · shared across browsers and devices.'); this.notify(); }).catch(error => {
                this.status(`Favourites unavailable: ${error.message}. Use Refresh hearts to retry.`, true);
                throw error;
            }).finally(() => { this.loading = null; });
            return this.loading;
        }

        async change(browser, body) {
            this.status('Saving favourites…');
            try {
                const payload = await this.request(body);
                if (body.operation === 'create') this.state(browser).collection = payload.selectedGroupId;
                this.remember();
                this.status('Favourites saved. Source files and song parts are unchanged.');
                this.notify();
                return true;
            } catch (error) {
                this.status(`Favourites not saved: ${error.message}`, true);
                return false;
            }
        }

        async renamed(scope, oldName, newName) {
            if (oldName === newName) return;
            await this.change('renamed', { operation: 'rekey', oldKey: itemKey(scope, oldName), newKey: itemKey(scope, newName) });
        }

        status(message, error = false) {
            for (const view of this.views.values()) {
                view.status.textContent = message;
                view.status.classList.toggle('favourite-error', error);
                if (error) view.management.open = true;
            }
        }

        notify() {
            for (const [browser, view] of this.views) {
                this.syncToolbar(browser, view);
                const dialog = view.list.closest('dialog');
                if (!view.list.closest('[hidden]') && (!dialog || dialog.open)) {
                    if (this.state(browser).filter) {
                        const scroll = view.list.scrollTop;
                        view.render();
                        view.list.scrollTop = scroll;
                    } else {
                        for (const control of view.list.querySelectorAll('.sample-favourite-item')) {
                            const head = control.parentElement;
                            const key = control.dataset.favouriteKey;
                            const name = control.dataset.favouriteName;
                            control.remove();
                            this.decorate(browser, key, name, head);
                        }
                    }
                }
            }
        }

        syncToolbar(browser, view) {
            const state = this.state(browser);
            if (state.filter && state.filter !== '*' && !this.groups.some(group => group.id === state.filter)) state.filter = '';
            if (!this.groups.some(group => group.id === state.collection)) state.collection = this.groups[0]?.id || 'default';
            const options = (select, entries, value) => {
                select.replaceChildren();
                for (const [id, name] of entries) {
                    const option = this.document.createElement('option');
                    option.value = id;
                    option.textContent = name;
                    select.append(option);
                }
                select.value = value;
            };
            options(view.filter, [['', 'All files'], ['*', '♥ All favourites'], ...this.groups.map(group => [group.id, `♥ ${group.name}`])], state.filter);
            options(view.collection, this.groups.map(group => [group.id, group.name]), state.collection);
            for (const button of view.toolbar.querySelectorAll('button[data-requires-favourites]')) button.disabled = !this.loaded;
        }

        ensureToolbar(browser, list, render) {
            if (root.__mygrainSongRenderDeck || !list || this.views.has(browser)) return;
            const toolbar = this.document.createElement('div');
            toolbar.className = 'sample-favourites-toolbar';
            toolbar.setAttribute('data-mygrain-workspace', 'favourites');
            const makeSelect = (labelText, kind) => {
                const label = this.document.createElement('label');
                label.textContent = labelText;
                const select = this.document.createElement('select');
                select.id = `favourites-${browser}-${kind}`;
                select.setAttribute('data-favourite-select', kind);
                label.append(select);
                toolbar.append(label);
                return select;
            };
            const filter = makeSelect('Show', 'filter');
            const collection = makeSelect('Heart collection', 'collection');
            const actions = this.document.createElement('div');
            actions.className = 'sample-favourites-actions';
            const management = this.document.createElement('details');
            management.className = 'sample-favourites-management';
            const summary = this.document.createElement('summary');
            summary.textContent = '♥ Manage favourites';
            const button = (label, action, needsLoaded = true) => {
                const control = this.document.createElement('button');
                control.type = 'button';
                control.className = 'performance-btn';
                control.textContent = label;
                if (needsLoaded) control.setAttribute('data-requires-favourites', '');
                control.addEventListener('click', action);
                actions.append(control);
            };
            button('+ Collection', () => {
                const name = root.prompt('Name the new favourite collection:');
                if (name?.trim()) this.change(browser, { operation: 'create', name });
            });
            button('Rename collection', () => {
                const group = this.group(browser);
                if (!group) return;
                const name = root.prompt('Rename favourite collection (not the source files):', group.name);
                if (name?.trim()) this.change(browser, { operation: 'rename', groupId: group.id, name });
            });
            button('Remove collection', () => {
                const group = this.group(browser);
                if (group && root.confirm(`Remove the ${group.name} favourite collection? Source files will not be deleted.`)) this.change(browser, { operation: 'delete', groupId: group.id });
            });
            button('Refresh hearts', () => this.refresh().catch(() => {}), false);
            const status = this.document.createElement('div');
            status.className = 'sample-favourites-status';
            status.setAttribute('role', 'status');
            status.textContent = 'Loading shared favourites…';
            management.append(summary, actions, status);
            toolbar.append(management);
            list.before(toolbar);
            const view = { toolbar, filter, collection, status, management, list, render };
            this.views.set(browser, view);
            filter.addEventListener('change', () => {
                const state = this.state(browser);
                state.filter = filter.value;
                if (filter.value && filter.value !== '*') state.collection = filter.value;
                this.remember();
                this.syncToolbar(browser, view);
                render();
            });
            collection.addEventListener('change', () => {
                this.state(browser).collection = collection.value;
                this.remember();
                render();
            });
            this.syncToolbar(browser, view);
            this.refresh().catch(() => {});
        }

        decorate(browser, key, name, head) {
            const group = this.group(browser);
            const selected = Boolean(group && Object.hasOwn(group.items, key));
            const controls = this.document.createElement('div');
            controls.className = 'sample-favourite-item';
            controls.dataset.favouriteKey = key;
            controls.dataset.favouriteName = name;
            const heart = this.document.createElement('button');
            heart.type = 'button';
            heart.className = `performance-btn sample-favourite-heart${selected ? ' active' : ''}`;
            heart.textContent = selected ? '♥' : '♡';
            heart.setAttribute('aria-pressed', String(selected));
            heart.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${name} ${selected ? 'from' : 'to'} ${group?.name || 'favourites'}`);
            heart.title = heart.getAttribute('aria-label');
            heart.disabled = !this.loaded || !group;
            heart.addEventListener('click', async () => {
                heart.disabled = true;
                await this.change(browser, { operation: 'set', groupId: group.id, key, selected: !selected, name });
                if (heart.isConnected) heart.disabled = false;
            });
            controls.append(heart);
            if (selected) {
                const label = this.document.createElement('span');
                label.className = 'sample-favourite-label';
                label.textContent = group.items[key].name;
                const rename = this.document.createElement('button');
                rename.type = 'button';
                rename.className = 'performance-btn sample-favourite-rename';
                rename.textContent = 'Rename favourite';
                rename.setAttribute('aria-label', `Rename favourite ${group.items[key].name}`);
                rename.addEventListener('click', () => {
                    const next = root.prompt('Favourite display name (the source filename stays unchanged):', group.items[key].name);
                    if (next?.trim()) this.change(browser, { operation: 'label', groupId: group.id, key, name: next });
                });
                controls.append(label, rename);
            }
            head.append(controls);
        }
    }

    return { Library, itemKey };
});
