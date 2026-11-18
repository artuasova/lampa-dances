(function () {
    'use strict';

    if (window.dances_plugin_ready) return;
    window.dances_plugin_ready = true;

    var PLUGIN_VERSION = 'v15';
    var KEY_URL = 'dances_public_url';
    var KEY_SORT = 'dances_sort';
    var KEY_PREVIEW = 'dances_preview';
    var KEY_VIEW = 'dances_view';
    var KEY_CACHE = 'dances_cache_';
    var KEY_KEYS = 'dances_cache_keys';
    var KEY_INDEX = 'dances_index_';

    var DEFAULT_URL = 'https://disk.yandex.ru/d/L4PW93XuLMuu3A';
    var API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
    var CACHE_TTL = 10 * 60 * 1000;
    var SEARCH_LIMIT = 300;
    var INDEX_LIMIT = 6000;
    var MAX_DEPTH = 6;
    var globalLastActivate = 0;
    var activeNav = null;

    function log() {
        try { console.log.apply(console, ['[Dances]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function setting(name, def) {
        var v = Lampa.Storage.field(name);
        return (v === undefined || v === null || v === '') ? def : v;
    }

    var KEY_SOURCES = 'dances_sources';
    var KEY_CURRENT = 'dances_cur';

    function sourcesGet() {
        try {
            var raw = Lampa.Storage.get(KEY_SOURCES, null);
            if (raw && Array.isArray(raw) && raw.length) return raw;
        } catch (e) {}

        var legacy = String(setting(KEY_URL, '') || '').trim();
        return [{ n: 'Танцы', u: legacy || DEFAULT_URL }];
    }

    function sourcesSave(list) {
        try { Lampa.Storage.set(KEY_SOURCES, list); } catch (e) {}
    }

    function currentIndex() {
        var list = sourcesGet();
        var i = Number(Lampa.Storage.get(KEY_CURRENT, 0));
        if (isNaN(i) || i < 0 || i >= list.length) i = 0;
        return i;
    }

    function currentSource() {
        var list = sourcesGet();
        return list[currentIndex()] || { n: 'Танцы', u: DEFAULT_URL };
    }

    function publicKey() {
        var src = currentSource();
        return String((src && src.u) || DEFAULT_URL).trim() || DEFAULT_URL;
    }

    function setCurrentSource(i) {
        try { Lampa.Storage.set(KEY_CURRENT, i); } catch (e) {}
    }

    function addSource(cb) {
        Lampa.Input.edit({ value: '', free: true, nosave: true }, function (value) {
            try { Lampa.Controller.toggle('content'); } catch (e) {}

            var url = String(value || '').trim();
            if (!url) return;

            if (!/^https?:\/\//i.test(url)) {
                Lampa.Noty.show('Нужна ссылка вида https://disk.yandex.ru/d/...', { style: 'error' });
                return;
            }

            var list = sourcesGet();
            list.push({ n: 'Папка ' + (list.length + 1), u: url });
            sourcesSave(list);
            setCurrentSource(list.length - 1);
            Lampa.Noty.show('Добавлена новая папка');
            if (cb) cb(url);
        });
    }

    function openSources(cb) {
        var list = sourcesGet();
        var cur = currentIndex();
        var items = list.map(function (s, i) {
            return { title: (i === cur ? '● ' : '') + s.n, idx: i };
        });

        items.push({ title: '＋ Добавить папку', add: true });
        if (list.length > 1) items.push({ title: '✕ Удалить текущую', del: true });

        Lampa.Select.show({
            title: 'Источники',
            items: items,
            onSelect: function (choice) {
                try { Lampa.Select.close(); } catch (e) {}

                if (choice.add) { addSource(cb); return; }

                if (choice.del) {
                    var l2 = sourcesGet();
                    l2.splice(cur, 1);
                    if (!l2.length) l2 = [{ n: 'Танцы', u: DEFAULT_URL }];
                    sourcesSave(l2);
                    setCurrentSource(0);
                    Lampa.Noty.show('Удалено');
                    if (cb) cb(publicKey());
                    return;
                }

                setCurrentSource(choice.idx);
                Lampa.Noty.show('Источник: ' + sourcesGet()[choice.idx].n);
                if (cb) cb(publicKey());
            },
            onBack: function () {
                try { Lampa.Select.close(); } catch (e) {}
                try { Lampa.Controller.toggle('content'); } catch (e) {}
            }
        });
    }

    function sortMode() { return setting(KEY_SORT, 'name'); }
    function viewMode() { return setting(KEY_VIEW, 'list'); }

    function previewsOn() {
        var v = Lampa.Storage.field(KEY_PREVIEW);
        return (v === undefined || v === null) ? true : !!v;
    }

    function apiUrl(base, path) {
        var u = API + '?public_key=' + encodeURIComponent(base) + '&limit=1000&sort=name';
        if (previewsOn()) u += '&preview_size=M';
        if (path && path !== '/') u += '&path=' + encodeURIComponent(path);
        return u;
    }

    function isVideo(name) {
        return /\.(mp4|mkv|avi|mov|webm|m4v|ts|mpg|mpeg|wmv|flv)$/i.test(name || '');
    }

    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function humanSize(bytes) {
        if (!bytes) return '';
        var mb = bytes / 1048576;
        if (mb < 1024) return Math.round(mb) + ' МБ';
        return (mb / 1024).toFixed(1).replace('.', ',') + ' ГБ';
    }

    function natCmp(a, b) {
        try {
            return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
        } catch (e) {
            a = String(a).toLowerCase();
            b = String(b).toLowerCase();
            return a < b ? -1 : (a > b ? 1 : 0);
        }
    }

    function dirOf(path) {
        var i = String(path || '').lastIndexOf('/');
        return i > 0 ? String(path).slice(0, i) : '/';
    }

    // ---------- кэш ----------
    function cacheGet(key) {
        try {
            var raw = Lampa.Storage.get(KEY_CACHE + key, null);
            if (!raw || !raw.ts || !raw.items) return null;
            if (Date.now() - raw.ts > CACHE_TTL) return null;
            return raw.items;
        } catch (e) { return null; }
    }

    function cacheSet(key, items) {
        try {
            Lampa.Storage.set(KEY_CACHE + key, { ts: Date.now(), items: items });
            var keys = Lampa.Storage.get(KEY_KEYS, []) || [];
            if (keys.indexOf(key) < 0) {
                keys.push(key);
                Lampa.Storage.set(KEY_KEYS, keys);
            }
        } catch (e) { log('cache set error', e); }
    }

    function cacheClear() {
        try {
            var keys = Lampa.Storage.get(KEY_KEYS, []) || [];
            keys.forEach(function (k) { Lampa.Storage.set(KEY_CACHE + k, null); });
            Lampa.Storage.set(KEY_KEYS, []);
        } catch (e) { log('cache clear error', e); }
    }

    function listingKey(base, path) {
        return base + '|' + path + '|' + (previewsOn() ? 'p' : 'n');
    }

    function fetchList(base, path, cb) {
        var key = listingKey(base, path);
        var cached = cacheGet(key);
        if (cached) { cb(cached, true); return; }

        var net = new Lampa.Reguest();
        net.timeout(25000);
        net.silent(apiUrl(base, path), function (data) {
            var items = (data && data._embedded && data._embedded.items) || [];
            cacheSet(key, items);
            cb(items, false);
        }, function () { cb([], false); });
    }

    // ---------- обход дерева ----------
    function walkTree(base, path, query, depth, limit, acc, done) {
        if (acc.length >= limit) { done(); return; }

        fetchList(base, path, function (items) {
            var dirs = [];
            var i, it;

            for (i = 0; i < items.length; i++) {
                it = items[i];
                if (it.type === 'dir') {
                    dirs.push(it);
                } else if (it.type === 'file' && isVideo(it.name)) {
                    if (!query || String(it.name).toLowerCase().indexOf(query) >= 0) {
                        if (acc.length < limit) acc.push(it);
                    }
                }
            }

            if (depth <= 0 || !dirs.length) { done(); return; }

            var n = 0;

            (function nextDir() {
                if (n >= dirs.length || acc.length >= limit) { done(); return; }
                walkTree(base, dirs[n++].path, query, depth - 1, limit, acc, nextDir);
            })();
        });
    }

    function collectIndex(base, cb) {
        var key = KEY_INDEX + base;

        try {
            var raw = Lampa.Storage.get(KEY_CACHE + key, null);
            if (raw && raw.ts && raw.items && (Date.now() - raw.ts) < CACHE_TTL) {
                cb(raw.items);
                return;
            }
        } catch (e) {}

        var acc = [];
        walkTree(base, '/', null, MAX_DEPTH, INDEX_LIMIT, acc, function () {
            try { Lampa.Storage.set(KEY_CACHE + key, { ts: Date.now(), items: acc }); } catch (e) {}
            cb(acc);
        });
    }

    // ---------- иконки ----------
    var ICON_FOLDER = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
    var ICON_PLAY = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var ICON_BACK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>';
    var ICON_REFRESH = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>';
    var ICON_SEARCH = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>';
    var ICON_SHUFFLE = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M17 3l4 4-4 4V8h-2.2l-1.6 1.9-1.3-1.6L13.9 6H17V3zM3 7h4.1l2.5 3-2.5 3H3V7zm14 6l4 4-4 4v-3h-3.1l-2.2-2.7 1.3-1.6 1.6 1.9H17v-2.6zM3 11h4.1l2.5 3-2.5 3H3v-6z"/></svg>';
    var ICON_INFO = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>';

    // ---------- элементы ----------
    function buildRow(leftHtml, title, subtitle) {
        var el = $(
            '<div class="selector dances__row">' +
                '<div class="dances__left">' + leftHtml + '</div>' +
                '<div class="dances__body">' +
                    '<div class="dances__title">' + esc(title) + '</div>' +
                    (subtitle ? '<div class="dances__sub">' + esc(subtitle) + '</div>' : '') +
                '</div>' +
            '</div>'
        );

        el.on('hover:focus', function () { el.addClass('dances__row--focus'); });
        el.on('hover:blur', function () { el.removeClass('dances__row--focus'); });

        return el;
    }

    function buildCard(innerHtml, title, subtitle) {
        var el = $(
            '<div class="selector dances__card">' +
                innerHtml +
                '<div class="dances__card-body">' +
                    '<div class="dances__card-title">' + esc(title) + '</div>' +
                    (subtitle ? '<div class="dances__card-sub">' + esc(subtitle) + '</div>' : '') +
                '</div>' +
            '</div>'
        );

        el.on('hover:focus', function () { el.addClass('dances__card--focus'); });
        el.on('hover:blur', function () { el.removeClass('dances__card--focus'); });

        return el;
    }

    // ---------- свой скролл + своя навигация ----------
    function Root() {
        this.el = $('<div class="dances-scroll"></div>');
        this.body = $('<div class="dances-scroll__body"></div>');
        this.el.append(this.body);
    }

    Root.prototype.append = function (node) { this.body.append(node); };
    Root.prototype.clear = function () { this.body.empty(); };
    Root.prototype.render = function () { return this.el; };
    Root.prototype.destroy = function () { this.el.remove(); };

    Root.prototype.fit = function () {
        try {
            var node = this.el[0];
            var parent = node && node.parentNode;
            var h = (parent && parent.clientHeight) || 0;
            if (h < 200) h = window.innerHeight || h;
            if (h > 0) node.style.height = h + 'px';
        } catch (e) { log('fit error', e); }
    };

    Root.prototype.scrollTo = function (jqEl) {
        var node = jqEl && jqEl[0];
        if (!node) return;

        try {
            node.scrollIntoView({ block: 'center', inline: 'nearest' });
            return;
        } catch (e) {}

        try {
            var box = this.el[0];
            var top = node.offsetTop;
            box.scrollTop = Math.max(0, top - box.clientHeight / 2 + node.offsetHeight / 2);
        } catch (e2) { log('scroll error', e2); }
    };

    function Nav(root, componentName) {
        var self = this;
        var items = [];
        var idx = 0;
        var bound = false;
        var prevFocused = null;

        var keypadWorks = false;
        try { keypadWorks = !!(Lampa.Keypad && Lampa.Keypad.listener && Lampa.Keypad.listener.follow); } catch (e) { keypadWorks = false; }

        function overlayOpen() {
            try { if (Lampa.Modal && Lampa.Modal.opened && Lampa.Modal.opened()) return true; } catch (e) {}
            try { if (Lampa.Select && Lampa.Select.opened && Lampa.Select.opened()) return true; } catch (e) {}
            try { if (Lampa.Player && Lampa.Player.opened && Lampa.Player.opened()) return true; } catch (e) {}
            try { if (Lampa.Input && Lampa.Input.opened && Lampa.Input.opened()) return true; } catch (e) {}
            try {
                var el = document.activeElement;
                if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return true;
            } catch (e) {}
            return false;
        }

        function isOurActivity() {
            try {
                var a = Lampa.Activity.active();
                if (!a || a.component !== componentName) return false;
                if (overlayOpen()) return false;
                return true;
            } catch (e) { return false; }
        }

        function rect(el) {
            try { return el[0].getBoundingClientRect(); } catch (e) { return { left: 0, top: 0, width: 0, height: 0 }; }
        }

        function applyFocus() {
            if (prevFocused && (!items[idx] || prevFocused !== items[idx])) {
                $(prevFocused).removeClass('dances--nav-focus dances__row--focus dances__card--focus dances__tool--focus');
                prevFocused = null;
            }

            if (items[idx]) {
                $(items[idx]).addClass('dances--nav-focus');
                prevFocused = items[idx];
                root.scrollTo($(items[idx]));
            }
        }

        this.reset = function () {
            if (prevFocused) $(prevFocused).removeClass('dances--nav-focus dances__row--focus dances__card--focus dances__tool--focus');
            prevFocused = null;
            items = [];
            idx = 0;
        };

        this.count = function () { return items.length; };
        this.keypadAvailable = function () { return keypadWorks; };
        this.add = function (el) { items.push(el); return el; };
        this.focusFirst = function () { idx = 0; applyFocus(); };
        this.focusCurrent = function () { applyFocus(); };

        this.activate = function () {
            var el = items[idx];
            if (!el) return;

            var now = Date.now();
            if (now - globalLastActivate < 450) return;
            globalLastActivate = now;

            try { $(el).trigger('hover:enter'); } catch (e) { log('activate error', e); }
        };

        this.move = function (dir) {
            if (!items.length) return;

            var cur = items[idx];
            var r = rect(cur);
            var best = -1;
            var bestScore = Infinity;

            for (var i = 0; i < items.length; i++) {
                if (i === idx) continue;
                var q = rect(items[i]);
                var dx = q.left - r.left;
                var dy = q.top - r.top;
                var ok = false;
                var score = 0;

                if (dir === 'down') {
                    ok = dy > 4 && Math.abs(dx) < Math.max(q.width, r.width) * 0.7;
                    score = dy * 1000 + Math.abs(dx);
                } else if (dir === 'up') {
                    ok = dy < -4 && Math.abs(dx) < Math.max(q.width, r.width) * 0.7;
                    score = -dy * 1000 + Math.abs(dx);
                } else if (dir === 'right') {
                    ok = dx > 4 && Math.abs(dy) < Math.max(q.height, r.height) * 0.7;
                    score = dx * 1000 + Math.abs(dy);
                } else if (dir === 'left') {
                    ok = dx < -4 && Math.abs(dy) < Math.max(q.height, r.height) * 0.7;
                    score = -dx * 1000 + Math.abs(dy);
                }

                if (ok && score < bestScore) { bestScore = score; best = i; }
            }

            if (best >= 0) { idx = best; applyFocus(); return; }

            // Если пространственно перейти некуда:
            if (dir === 'left') {
                // Если слева ничего нет — открываем боковое меню Lampa
                try { Lampa.Controller.toggle('menu'); } catch (e) {}
                return;
            }

            if (dir === 'down') {
                if (idx < items.length - 1) { idx++; applyFocus(); }
            } else if (dir === 'up') {
                if (idx > 0) { idx--; applyFocus(); }
            } else if (dir === 'right') {
                // В сетке переход в начало следующей строки, в списке — остаемся на месте
                if (viewMode() === 'grid' && idx < items.length - 1) {
                    idx++;
                    applyFocus();
                }
            }
        };

        var handlers = {
            down: function () { if (activeNav === self && isOurActivity()) { self.move('down'); return false; } },
            up: function () { if (activeNav === self && isOurActivity()) { self.move('up'); return false; } },
            left: function () { if (activeNav === self && isOurActivity()) { self.move('left'); return false; } },
            right: function () { if (activeNav === self && isOurActivity()) { self.move('right'); return false; } },
            enter: function () { if (activeNav === self && isOurActivity()) { self.activate(); return false; } }
        };

        this.bind = function () {
            if (activeNav && activeNav !== self) {
                try { activeNav.unbind(); } catch (e) {}
            }
            activeNav = self;

            if (bound || !keypadWorks) return;
            bound = true;
            try { Lampa.Keypad.listener.follow('down', handlers.down); } catch (e) {}
            try { Lampa.Keypad.listener.follow('up', handlers.up); } catch (e) {}
            try { Lampa.Keypad.listener.follow('left', handlers.left); } catch (e) {}
            try { Lampa.Keypad.listener.follow('right', handlers.right); } catch (e) {}
            try { Lampa.Keypad.listener.follow('enter', handlers.enter); } catch (e) {}
        };

        this.unbind = function () {
            if (activeNav === self) activeNav = null;
            if (!bound) return;
            bound = false;
            try { Lampa.Keypad.listener.remove('down', handlers.down); } catch (e) {}
            try { Lampa.Keypad.listener.remove('up', handlers.up); } catch (e) {}
            try { Lampa.Keypad.listener.remove('left', handlers.left); } catch (e) {}
            try { Lampa.Keypad.listener.remove('right', handlers.right); } catch (e) {}
            try { Lampa.Keypad.listener.remove('enter', handlers.enter); } catch (e) {}
        };

        this.useController = function () {
            try {
                if (keypadWorks) {
                    Lampa.Controller.add('content', {
                        toggle: function () {
                            self.bind();
                            applyFocus();
                        },
                        left: function () {}, right: function () {},
                        up: function () {}, down: function () {}, enter: function () {},
                        back: function () {
                            self.unbind();
                            Lampa.Activity.backward();
                        }
                    });

                    try { Lampa.Controller.collectionSet($()); } catch (e) {}
                    try { Lampa.Controller.clear(); } catch (e) {}

                    Lampa.Controller.toggle('content');
                    applyFocus();
                    return;
                }

                Lampa.Controller.add('content', {
                    toggle: function () {
                        self.bind();
                        applyFocus();
                    },
                    left: function () { self.move('left'); },
                    right: function () { self.move('right'); },
                    up: function () { self.move('up'); },
                    down: function () { self.move('down'); },
                    enter: function () { self.activate(); },
                    back: function () {
                        self.unbind();
                        Lampa.Activity.backward();
                    }
                });
                Lampa.Controller.toggle('content');
            } catch (e) { log('controller error', e); }
        };
    }

    var lastPlayed = '—';
    var queue = { items: [], idx: -1 };
    var KEY_POS = 'dances_pos_';
    var pendingSeek = 0;
    var currentUrl = '';
    var currentKey = '';
    var lastPosSave = 0;

    function hashStr(s) {
        var h = 0;
        s = String(s || '');
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
        return Math.abs(h).toString(36);
    }

    function fileKey(item) {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (item.resource_id) return 'res_' + item.resource_id;
        var p = item.path || item.name || '';
        return 'path_' + (item.base || publicKey()) + ':' + p;
    }

    function posGet(item) {
        var key = fileKey(item);
        if (!key) return null;
        try {
            var raw = Lampa.Storage.get(KEY_POS + hashStr(key), null);
            if (!raw || !raw.ts) return null;
            if (raw.t < 20) return null;
            if (raw.dur && raw.t > raw.dur - 25) return null;
            return raw;
        } catch (e) { return null; }
    }

    function posSet(key, t, dur, force) {
        if (!key) return;
        try {
            var now = Date.now();
            if (!force && now - lastPosSave < 5000) return;
            lastPosSave = now;

            var k = KEY_POS + hashStr(key);
            Lampa.Storage.set(k, { t: Math.round(t), dur: Math.round(dur || 0), ts: now });

            var keys = Lampa.Storage.get('dances_pos_keys', []) || [];
            if (keys.indexOf(k) < 0) {
                keys.push(k);
                if (keys.length > 200) {
                    var drop = keys.shift();
                    Lampa.Storage.set(drop, null);
                }
                Lampa.Storage.set('dances_pos_keys', keys);
            }
        } catch (e) {}
    }

    function posRemove(key) {
        if (!key) return;
        try {
            var k = KEY_POS + hashStr(key);
            Lampa.Storage.set(k, null);
        } catch (e) {}
    }

    function posReset() {
        try {
            var keys = Lampa.Storage.get('dances_pos_keys', []) || [];
            keys.forEach(function (k) { Lampa.Storage.set(k, null); });
            Lampa.Storage.set('dances_pos_keys', []);
        } catch (e) {}
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.round(sec));
        var h = Math.floor(sec / 3600);
        var m = Math.floor((sec % 3600) / 60);
        var s = sec % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function autoNextOn() {
        var v = Lampa.Storage.field('dances_autonext');
        return (v === undefined || v === null) ? true : !!v;
    }

    function playExact(item, startAt) {
        lastPlayed = item.name;
        currentUrl = item.file || '';
        currentKey = fileKey(item);
        pendingSeek = startAt || 0;
        log('play exact', item.name, 'key=', currentKey, 'seek=', pendingSeek);
        Lampa.Player.play({
            title: item.name,
            url: item.file,
            timeline: startAt ? { time: startAt } : undefined
        });
    }

    function playList(items, index) {
        var playable = items.filter(function (f) { return !!f.file; });
        var item = items[index] || items[0];

        if (!item) {
            Lampa.Noty.show('Пустой список', { style: 'error' });
            return;
        }

        if (!item.file) {
            Lampa.Noty.show('Нет прямой ссылки на файл', { style: 'error' });
            return;
        }

        // очередь для автоперехода — своя, без плейлиста Lampa
        queue.items = playable;
        queue.idx = playable.indexOf(item);
        if (queue.idx < 0) queue.idx = 0;

        var saved = posGet(item);

        if (saved && Lampa.Select && Lampa.Select.show) {
            Lampa.Select.show({
                title: 'Продолжить просмотр?',
                items: [
                    { title: 'Продолжить с ' + fmtTime(saved.t), seek: saved.t },
                    { title: 'С начала', seek: 0 }
                ],
                onSelect: function (choice) {
                    try { Lampa.Select.close(); } catch (e) {}
                    try { Lampa.Controller.toggle('content'); } catch (e) {}
                    if (choice.seek === 0) {
                        posRemove(fileKey(item));
                    }
                    playExact(item, choice.seek || 0);
                },
                onBack: function () {
                    try { Lampa.Select.close(); } catch (e) {}
                    try { Lampa.Controller.toggle('content'); } catch (e) {}
                    playExact(item, 0);
                }
            });
            return;
        }

        playExact(item, 0);
    }

    function playNextFromQueue() {
        if (!autoNextOn()) return;
        if (queue.idx < 0 || queue.idx + 1 >= queue.items.length) return;

        queue.idx++;
        var next = queue.items[queue.idx];
        if (!next || !next.file) return;

        log('auto next', next.name);
        playExact(next);
    }

    function playRandom(base) {
        Lampa.Noty.show('Собираю список видео…');

        collectIndex(base, function (files) {
            var playable = files.filter(function (f) { return !!f.file; });

            if (!playable.length) {
                Lampa.Noty.show('Не нашёл ни одного видео', { style: 'error' });
                return;
            }

            playList(playable, Math.floor(Math.random() * playable.length));
        });
    }

    // ---------- поиск ----------
    var searchState = { query: '', running: false, seq: 0 };

    function DancesResultsScreen(object) {
        var root = new Root();
        var items = object.items || [];
        var nav = new Nav(root, 'dances_results');

        this.create = function () {
            var act = this.activity;

            if (!items.length) {
                try { if (act) { act.loader(false); act.empty(); } } catch (e) {}
                return this.render();
            }

            var grid = viewMode() === 'grid' ? $('<div class="dances__grid"></div>') : null;
            if (grid) root.append(grid);

            items.forEach(function (item, idx) {
                var folder = dirOf(item.path);
                var el;

                if (grid) {
                    var poster = (previewsOn() && item.preview)
                        ? '<div class="dances__poster"><img src="' + item.preview + '" loading="lazy" onerror="this.style.display=\'none\'" /></div>'
                        : '<div class="dances__poster dances__poster--icon">' + ICON_PLAY + '</div>';
                    el = buildCard(poster, item.name, humanSize(item.size) + ' • ' + folder);
                    el.on('hover:enter', function () { playList(items, idx); });
                    grid.append(el);
                } else {
                    var left = (previewsOn() && item.preview)
                        ? '<img class="dances__thumb" src="' + item.preview + '" loading="lazy" onerror="this.style.display=\'none\'" />'
                        : '<div class="dances__ico">' + ICON_PLAY + '</div>';
                    el = buildRow(left, item.name, humanSize(item.size) + ' • ' + folder);
                    el.on('hover:enter', function () { playList(items, idx); });
                    root.append(el);
                }

                nav.add(el);
            });

            nav.focusFirst();
            return this.render();
        };

        this.start = function () {
            root.fit();
            nav.bind();
            nav.useController();
            if (nav.count()) nav.focusCurrent(); else nav.focusFirst();

            setTimeout(function () { root.fit(); }, 300);
        };

        this.stop = function () { nav.unbind(); };
        this.destroy = function () { nav.unbind(); root.destroy(); };
        this.render = function () { return root.render(); };
        this.empty = function () {
            try { if (this.activity) { this.activity.loader(false); this.activity.empty(); } } catch (e) {}
        };
    }

    function runSearch(base) {
        if (searchState.running) {
            Lampa.Noty.show('Поиск уже выполняется');
            return;
        }

        Lampa.Input.edit({
            value: searchState.query || '',
            free: true,
            nosave: true
        }, function (value) {
            try { Lampa.Controller.toggle('content'); } catch (e) {}

            var q = String(value || '').trim();
            if (!q) return;

            if (q.length < 2) {
                Lampa.Noty.show('Введите хотя бы 2 символа');
                return;
            }

            searchState.query = q;
            searchState.running = true;
            var curSeq = ++searchState.seq;
            Lampa.Noty.show('Ищу «' + q + '» по всем папкам…');

            var acc = [];

            walkTree(base, '/', q.toLowerCase(), MAX_DEPTH, SEARCH_LIMIT, acc, function () {
                if (curSeq !== searchState.seq) return;
                searchState.running = false;

                if (!acc.length) {
                    Lampa.Noty.show('Ничего не найдено', { style: 'error' });
                    return;
                }

                Lampa.Activity.push({
                    url: '', title: 'Поиск: ' + q, component: 'dances_results',
                    items: acc, query: q, page: 1
                });
            });
        });
    }

    // ---------- экран списка ----------
    function DancesScreen(object) {
        var root = new Root();
        var path = object.path || '/';
        var base = object.base || publicKey();
        var alive = true;
        var act = null;
        var nav = new Nav(root, 'dances_screen');

        function loader(state) {
            try { if (act) act.loader(state); } catch (e) {}
        }

        function emptyState() {
            loader(false);
            try { if (act) act.empty(); } catch (e) {}
        }

        function sortItems(items) {
            var mode = sortMode();
            var dirs = items.filter(function (i) { return i.type === 'dir'; });
            var files = items.filter(function (i) { return i.type === 'file' && isVideo(i.name); });

            dirs.sort(function (a, b) { return natCmp(a.name, b.name); });

            files.sort(function (a, b) {
                if (mode === 'date') return String(b.created || '').localeCompare(String(a.created || '')) || natCmp(a.name, b.name);
                if (mode === 'size') return (b.size || 0) - (a.size || 0);
                return natCmp(a.name, b.name);
            });

            return { dirs: dirs, files: files };
        }

        function paint(items, fromCache) {
            var sorted = sortItems(items);
            var dirs = sorted.dirs;
            var files = sorted.files;

            nav.reset();
            root.clear();
            loader(false);

            var toolbar = $('<div class="dances__toolbar"></div>');
            root.append(toolbar);

            var tool = function (icon, label, onEnter) {
                var el = $('<div class="selector dances__tool">' + icon +
                    '<div class="dances__tool-label">' + esc(label) + '</div></div>');
                el.on('hover:enter', onEnter);
                el.on('hover:focus', function () { el.addClass('dances__tool--focus'); });
                el.on('hover:blur', function () { el.removeClass('dances__tool--focus'); });
                toolbar.append(el);
                nav.add(el);
                return el;
            };

            if (path !== '/') {
                tool(ICON_BACK, 'Назад', function () {
                    nav.unbind();
                    Lampa.Activity.backward();
                });
            }

            tool(ICON_SEARCH, 'Поиск', function () { runSearch(base); });
            tool(ICON_SHUFFLE, 'Случайно', function () { playRandom(base); });
            tool(ICON_FOLDER, 'Источники', function () {
                openSources(function () {
                    base = publicKey();
                    path = '/';
                    cacheClear();
                    nav.reset();
                    root.clear();
                    try { if (act && act.title) act.title(currentSource().n); } catch (e) {}
                    load(false);
                });
            });

            if (files.length > 1) {
                tool(ICON_PLAY, 'Все', function () {
                    var first = files.filter(function (f) { return !!f.file; })[0];
                    if (first) playList(files, files.indexOf(first));
                    else Lampa.Noty.show('Нет доступных видео', { style: 'error' });
                });
            }

            if (fromCache) {
                tool(ICON_REFRESH, 'Обновить', function () {
                    cacheClear();
                    nav.reset();
                    root.clear();
                    load(false);
                    Lampa.Noty.show('Обновляю список');
                });
            }

            tool(ICON_REFRESH, 'Сброс позиций', function () {
                posReset();
                Lampa.Noty.show('Отметки просмотра сброшены');
            });

            tool(ICON_INFO, 'Проверка', function () {
                var ctrl = '?';
                try { ctrl = Lampa.Controller.enabled().name; } catch (e) {}
                var comp = '?';
                try { comp = Lampa.Activity.active().component; } catch (e) {}
                var scrolled = '?';
                try { scrolled = Math.round(root.el[0].scrollTop) + '/' + root.el[0].scrollHeight; } catch (e) {}
                Lampa.Noty.show(
                    'Танцы ' + PLUGIN_VERSION + ' • Keypad: ' + (nav.keypadAvailable() ? 'да' : 'нет') +
                    ' • фокус: ' + ctrl +
                    ' • экран: ' + comp +
                    ' • элементов: ' + nav.count() +
                    ' • скролл: ' + scrolled + ' • последнее: ' + lastPlayed,
                    { time: 8000 }
                );
            });

            if (!dirs.length && !files.length) {
                var empty = buildRow('<div class="dances__ico">' + ICON_INFO + '</div>',
                    'В этой папке нет видео', 'пусто');
                empty.on('hover:enter', function () {
                    nav.unbind();
                    Lampa.Activity.backward();
                });
                root.append(empty);
                nav.add(empty);
                nav.focusFirst();
                return;
            }

            var grid = viewMode() === 'grid' ? $('<div class="dances__grid"></div>') : null;
            if (grid) root.append(grid);

            dirs.forEach(function (item) {
                var el;

                if (grid) {
                    el = buildCard('<div class="dances__poster dances__poster--icon">' + ICON_FOLDER + '</div>', item.name, 'папка');
                    el.on('hover:enter', function () {
                        nav.unbind();
                        Lampa.Activity.push({
                            url: '', title: item.name, component: 'dances_screen',
                            base: base, path: item.path || (path + '/' + item.name), page: 1
                        });
                    });
                    grid.append(el);
                } else {
                    el = buildRow('<div class="dances__ico">' + ICON_FOLDER + '</div>', item.name, 'папка');
                    el.on('hover:enter', function () {
                        nav.unbind();
                        Lampa.Activity.push({
                            url: '', title: item.name, component: 'dances_screen',
                            base: base, path: item.path || (path + '/' + item.name), page: 1
                        });
                    });
                    root.append(el);
                }

                nav.add(el);
            });

            files.forEach(function (item, idx) {
                var el;

                if (grid) {
                    var poster = (previewsOn() && item.preview)
                        ? '<div class="dances__poster"><img src="' + item.preview + '" loading="lazy" onerror="this.style.display=\'none\'" /></div>'
                        : '<div class="dances__poster dances__poster--icon">' + ICON_PLAY + '</div>';
                    el = buildCard(poster, item.name, humanSize(item.size));
                    el.on('hover:enter', function () { playList(files, idx); });
                    grid.append(el);
                } else {
                    var left = (previewsOn() && item.preview)
                        ? '<img class="dances__thumb" src="' + item.preview + '" loading="lazy" onerror="this.style.display=\'none\'" />'
                        : '<div class="dances__ico">' + ICON_PLAY + '</div>';
                    el = buildRow(left, item.name, humanSize(item.size));
                    el.on('hover:enter', function () { playList(files, idx); });
                    root.append(el);
                }

                nav.add(el);
            });

            nav.focusFirst();
        }

        function load(useCache) {
            var cacheKey = listingKey(base, path);

            if (useCache) {
                var cached = cacheGet(cacheKey);
                if (cached && cached.length) { paint(cached, true); return; }
            }

            loader(true);

            fetchList(base, path, function (items, fromCache) {
                if (!alive) return;
                loader(false);

                if (!items.length) { emptyState(); return; }
                paint(items, fromCache && useCache);
            });
        }

        this.create = function () {
            act = this.activity;
            load(true);
            return this.render();
        };

        this.start = function () {
            root.fit();
            nav.bind();
            nav.useController();
            if (nav.count()) nav.focusCurrent(); else nav.focusFirst();

            setTimeout(function () { root.fit(); }, 300);
        };

        this.stop = function () { nav.unbind(); };

        this.destroy = function () {
            alive = false;
            nav.unbind();
            root.destroy();
        };

        this.render = function () { return root.render(); };
        this.empty = function () { emptyState(); };
    }

    // ---------- init ----------
    function bindAutoNext() {
        var currentCleanup = null;

        try {
            Lampa.Player.listener.follow('start', function (data) {
                if (!queue.items.length) return;

                var current = queue.items[queue.idx];

                // страхуемся: автопереход работает только для своего файла,
                // иначе он «доедал» чужие видео и включал лишнее
                if (!current || !data || data.title !== current.name) {
                    queue.items = [];
                    queue.idx = -1;
                    if (currentCleanup) { currentCleanup(); currentCleanup = null; }
                    return;
                }

                if (currentCleanup) {
                    currentCleanup();
                    currentCleanup = null;
                }

                var module = Lampa.PlayerVideo;
                if (!module || !module.listener) return;

                var onEnded = function () {
                    if (currentKey) posRemove(currentKey);
                    playNextFromQueue();
                };

                try { module.listener.follow('ended', onEnded); } catch (e) { return; }

                var seeked = !pendingSeek;
                var onTime = function (e) {
                    try {
                        if (!seeked && pendingSeek > 0) {
                            var v = module.video;
                            if (v && (v.readyState >= 1 || (e && e.current > 0))) {
                                try {
                                    if (typeof module.to === 'function') module.to(pendingSeek);
                                    else v.currentTime = pendingSeek;
                                    seeked = true;
                                    pendingSeek = 0;
                                } catch (seekErr) {}
                            }
                        }

                        if (currentKey && e && e.current > 10) {
                            posSet(currentKey, e.current, e.duration);
                        }
                    } catch (err) {}
                };

                try { module.listener.follow('timeupdate', onTime); } catch (e) {}

                var onDestroy = function () {
                    if (currentCleanup) {
                        currentCleanup();
                        currentCleanup = null;
                    }
                };

                currentCleanup = function () {
                    try {
                        var v = module.video;
                        if (currentKey && v && v.currentTime > 10 && !v.ended && (!v.duration || v.currentTime < v.duration - 20)) {
                            posSet(currentKey, v.currentTime, v.duration, true);
                        }
                    } catch (e) {}

                    try { module.listener.remove('ended', onEnded); } catch (e) {}
                    try { module.listener.remove('timeupdate', onTime); } catch (e) {}
                    try { Lampa.Player.listener.remove('destroy', onDestroy); } catch (e) {}
                };

                try { Lampa.Player.listener.follow('destroy', onDestroy); } catch (e) {}
            });
        } catch (e) { log('autonext bind error', e); }
    }

    function init() {
        bindAutoNext();

        Lampa.Template.add('dances_css', '<style>' +
            '.dances-scroll{position:relative;height:100%;max-height:100%;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;outline:none}' +
            '.dances-scroll__body{padding:.4em .2em 8em}' +
            '.dances__toolbar{display:flex;flex-wrap:wrap;gap:.45em;padding:.45em .6em .15em}' +
            '.dances__tool{width:5.4em;height:5.4em;border-radius:.7em;background:rgba(255,255,255,.07);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.15em;transition:background .15s ease,transform .15s ease}' +
            '.dances__tool--focus,.dances__tool.dances--nav-focus{background:rgba(255,255,255,.24);transform:scale(1.06)}' +
            '.dances__tool svg{width:1.7em;height:1.7em;opacity:.9}' +
            '.dances__tool-label{font-size:.62em;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:96%}' +
            '.dances__row{display:flex;align-items:center;gap:.9em;padding:.6em 1em;margin:.32em .5em;border-radius:.7em;background:rgba(255,255,255,.05);transition:background .15s ease,transform .15s ease}' +
            '.dances__row--focus,.dances__row.dances--nav-focus{background:rgba(255,255,255,.19);transform:scale(1.012)}' +
            '.dances__left{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:104px}' +
            '.dances__ico{color:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;min-width:104px}' +
            '.dances__thumb{width:104px;height:58px;object-fit:cover;border-radius:.4em;background:#000}' +
            '.dances__body{flex:1 1 auto;min-width:0}' +
            '.dances__title{font-size:1.02em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.dances__sub{font-size:.82em;opacity:.55;margin-top:.15em}' +
            '.dances__grid{display:flex;flex-wrap:wrap;padding:.4em .5em 1em;width:100%}' +
            '.dances__card{flex:0 0 23%;margin:0 .6% 1em;border-radius:.7em;overflow:hidden;background:rgba(255,255,255,.05);transition:background .15s ease,transform .15s ease}' +
            '.dances__card--focus,.dances__card.dances--nav-focus{background:rgba(255,255,255,.2);transform:scale(1.03)}' +
            '.dances__poster{position:relative;width:100%;padding-top:56.25%;background:#000;overflow:hidden}' +
            '.dances__poster img{position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;display:block}' +
            '.dances__poster--icon{position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.85)}' +
            '.dances__card-body{padding:.45em .6em .6em}' +
            '.dances__card-title{font-size:.95em;line-height:1.25;max-height:2.5em;overflow:hidden}' +
            '.dances__card-sub{font-size:.8em;opacity:.55;margin-top:.2em}' +
            '</style>');
        $('body').append(Lampa.Template.get('dances_css', {}, true));

        if (!Lampa.Component.get('dances_screen')) Lampa.Component.add('dances_screen', DancesScreen);
        if (!Lampa.Component.get('dances_results')) Lampa.Component.add('dances_results', DancesResultsScreen);

        Lampa.SettingsApi.addComponent({
            component: 'dances',
            name: 'Танцы (Яндекс.Диск)',
            icon: '<svg viewBox="0 0 24 24"><path d="M12 3v12.5a3.5 3.5 0 1 1-2-3.16V5l8-2v10.5a3.5 3.5 0 1 1-2-3.16V3z"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_URL, type: 'input', default: DEFAULT_URL },
            field: { name: 'Ссылка на папку Яндекс.Диска', description: 'Публичная ссылка вида https://disk.yandex.ru/d/XXXX' }
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_VIEW, type: 'select', values: 'list,grid', default: 'list' },
            field: { name: 'Вид', description: 'list — строки, grid — карточки' }
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_SORT, type: 'select', values: 'name,date,size', default: 'name' },
            field: { name: 'Сортировка', description: 'name — по имени, date — по дате, size — по размеру' }
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_PREVIEW, type: 'trigger', default: true },
            field: { name: 'Превью видео', description: 'Кадры из видео' }
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: 'dances_autonext', type: 'trigger', default: true },
            field: { name: 'Следующее видео само', description: 'Включать следующее в папке после окончания текущего' }
        });

        $('.menu .menu__list .dances-menu-item').remove();
        var btn = $(
            '<li class="menu__item selector dances-menu-item">' +
                '<div class="menu__ico">' +
                    '<svg viewBox="0 0 24 24" fill="currentColor">' +
                        '<path d="M12 2.2a2.1 2.1 0 0 0-2.1 2.1c0 .5.2 1 .5 1.3l-3.1 8.1a1 1 0 0 0 .9 1.3h.4l1.6-4.2 1 2.6a3 3 0 1 0 3.3 2.9V8.9l2.6-1.5a1 1 0 0 0-.9-1.8l-1.7 1V4.3A2.1 2.1 0 0 0 12 2.2zm0 13.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/>' +
                    '</svg>' +
                '</div>' +
                '<div class="menu__text">Танцы</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            Lampa.Activity.push({
                url: '', title: 'Танцы', component: 'dances_screen',
                base: publicKey(), path: '/', page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
        log('initialized ' + PLUGIN_VERSION + ', view:', viewMode());
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init(); });
})();
