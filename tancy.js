(function () {
    'use strict';

    if (window.dances_plugin_ready) return;
    window.dances_plugin_ready = true;

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

    function log() {
        try { console.log.apply(console, ['[Dances]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function setting(name, def) {
        var v = Lampa.Storage.field(name);
        return (v === undefined || v === null || v === '') ? def : v;
    }

    function publicKey() {
        var saved = setting(KEY_URL, '');
        return String(saved || '').trim() || DEFAULT_URL;
    }

    function sortMode() { return setting(KEY_SORT, 'name'); }
    function viewMode() { return setting(KEY_VIEW, 'grid'); }

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
        return String(a).localeCompare(String(b), 'ru', { numeric: true, sensitivity: 'base' });
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

    // ---------- безопасные обёртки ----------
    function canmove(dir) {
        try { return Navigator.canmove(dir); } catch (e) { return false; }
    }
    function moveFocus(dir) {
        try { Navigator.move(dir); } catch (e) { log('move error', e); }
    }

    var ICON_FOLDER = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
    var ICON_PLAY = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var ICON_BACK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>';
    var ICON_REFRESH = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z"/></svg>';
    var ICON_SEARCH = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M15.5 14h-.8l-.3-.3a6.5 6.5 0 1 0-.7.7l.3.3v.8l5 5 1.5-1.5-5-5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z"/></svg>';
    var ICON_SHUFFLE = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M17 3l4 4-4 4V8h-2.2l-1.6 1.9-1.3-1.6L13.9 6H17V3zM3 7h4.1l2.5 3-2.5 3H3V7zm14 6l4 4-4 4v-3h-3.1l-2.2-2.7 1.3-1.6 1.6 1.9H17v-2.6zM3 11h4.1l2.5 3-2.5 3H3v-6z"/></svg>';

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

    function attachController(scroll, getLast) {
        Lampa.Controller.add('content', {
            toggle: function () {
                try {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(getLast() || false, scroll.render());
                } catch (e) { log('focus error', e); }
            },
            left: function () {
                if (canmove('left')) moveFocus('left');
                else Lampa.Controller.toggle('menu');
            },
            right: function () { moveFocus('right'); },
            up: function () { if (canmove('up')) moveFocus('up'); },
            down: function () { if (canmove('down')) moveFocus('down'); },
            back: function () { Lampa.Activity.backward(); }
        });

        Lampa.Controller.toggle('content');
    }

    function playList(items, index) {
        var playlist = items.filter(function (f) { return !!f.file; }).map(function (f) {
            return { title: f.name, url: f.file };
        });

        if (!playlist.length) {
            Lampa.Noty.show('Нет доступных видео', { style: 'error' });
            return;
        }

        try { Lampa.Player.playlist(playlist); } catch (e) { log('playlist error', e); }

        var item = items[index] || items[0];
        Lampa.Player.play({ title: item.name, url: item.file });
    }

    // ---------- случайное видео ----------
    function playRandom(base) {
        Lampa.Noty.show('Собираю список видео…');

        collectIndex(base, function (files) {
            var playable = files.filter(function (f) { return !!f.file; });

            if (!playable.length) {
                Lampa.Noty.show('Не нашёл ни одного видео', { style: 'error' });
                return;
            }

            var idx = Math.floor(Math.random() * playable.length);
            log('random', idx, 'of', playable.length);
            playList(playable, idx);
        });
    }

    // ---------- поиск ----------
    var searchState = { query: '', running: false };

    function DancesResultsScreen(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var items = object.items || [];
        var last = false;

        this.create = function () {
            var act = this.activity;

            if (!items.length) {
                act.loader(false);
                act.empty();
                return this.render();
            }

            var grid = viewMode() === 'grid' ? $('<div class="dances__grid"></div>') : null;
            if (grid) scroll.append(grid);

            items.forEach(function (item, idx) {
                var folder = dirOf(item.path);

                if (grid) {
                    var poster = (previewsOn() && item.preview)
                        ? '<div class="dances__poster"><img src="' + item.preview + '" loading="lazy" /></div>'
                        : '<div class="dances__poster dances__poster--icon">' + ICON_PLAY + '</div>';

                    var card = buildCard(poster, item.name, humanSize(item.size) + ' • ' + folder);
                    card.on('hover:focus', function () { last = card; });
                    card.on('hover:enter', function () { playList(items, idx); });
                    grid.append(card);
                } else {
                    var left = (previewsOn() && item.preview)
                        ? '<img class="dances__thumb" src="' + item.preview + '" loading="lazy" />'
                        : '<div class="dances__ico">' + ICON_PLAY + '</div>';

                    var el = buildRow(left, item.name, humanSize(item.size) + ' • ' + folder);
                    el.on('hover:focus', function () { last = el; });
                    el.on('hover:enter', function () { playList(items, idx); });
                    scroll.append(el);
                }
            });

            return this.render();
        };

        this.start = function () { attachController(scroll, function () { return last; }); };
        this.stop = function () {};
        this.destroy = function () { scroll.destroy(); };
        this.render = function () { return scroll.render(); };
        this.empty = function () {
            try { this.activity.loader(false); this.activity.empty(); } catch (e) {}
        };
    }

    function runSearch(base) {
        if (searchState.running) {
            Lampa.Noty.show('Поиск уже выполняется');
            return;
        }

        var controller = 'content';
        try { controller = Lampa.Controller.enabled().name; } catch (e) {}

        Lampa.Input.edit({
            value: searchState.query || '',
            free: true,
            nosave: true
        }, function (value) {
            try { Lampa.Controller.toggle(controller); } catch (e) {}

            var q = String(value || '').trim();

            if (q.length < 2) {
                Lampa.Noty.show('Введите хотя бы 2 символа');
                return;
            }

            searchState.query = q;
            searchState.running = true;
            Lampa.Noty.show('Ищу «' + q + '» по всем папкам…');

            var acc = [];

            walkTree(base, '/', q.toLowerCase(), MAX_DEPTH, SEARCH_LIMIT, acc, function () {
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
    var prefetched = {};

    function DancesScreen(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var path = object.path || '/';
        var base = object.base || publicKey();
        var alive = true;
        var last = false;
        var act = null;

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

            if (!dirs.length && !files.length) { emptyState(); return; }

            if (path !== '/') {
                var back = buildRow('<div class="dances__ico">' + ICON_BACK + '</div>', 'Назад', 'на уровень выше');
                back.on('hover:focus', function () { last = back; });
                back.on('hover:enter', function () { Lampa.Activity.backward(); });
                scroll.append(back);
            }

            var search = buildRow('<div class="dances__ico">' + ICON_SEARCH + '</div>', 'Поиск по всем папкам', 'нажми и введи название');
            search.on('hover:focus', function () { last = search; });
            search.on('hover:enter', function () { runSearch(base); });
            scroll.append(search);

            var rnd = buildRow('<div class="dances__ico">' + ICON_SHUFFLE + '</div>', 'Случайное видео', 'из всех папок');
            rnd.on('hover:focus', function () { last = rnd; });
            rnd.on('hover:enter', function () { playRandom(base); });
            scroll.append(rnd);

            var totalSize = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);

            if (fromCache) {
                var ref = buildRow('<div class="dances__ico">' + ICON_REFRESH + '</div>', 'Обновить список', 'сейчас показан кэш');
                ref.on('hover:focus', function () { last = ref; });
                ref.on('hover:enter', function () {
                    cacheClear();
                    try { if (typeof scroll.clear === 'function') scroll.clear(); } catch (e) {}
                    load(false);
                    Lampa.Noty.show('Обновляю список');
                    Lampa.Controller.toggle('content');
                });
                scroll.append(ref);
            }

            if (files.length > 1) {
                var sub = files.length + ' видео';
                if (totalSize) sub += ' • ' + humanSize(totalSize);
                var all = buildRow('<div class="dances__ico">' + ICON_PLAY + '</div>', 'Смотреть всё', sub);
                all.on('hover:focus', function () { last = all; });
                all.on('hover:enter', function () { playList(files, 0); });
                scroll.append(all);
            }

            var grid = viewMode() === 'grid' ? $('<div class="dances__grid"></div>') : null;
            if (grid) scroll.append(grid);

            dirs.forEach(function (item) {
                var open = function () {
                    Lampa.Activity.push({
                        url: '', title: item.name, component: 'dances_screen',
                        base: base, path: item.path || (path + '/' + item.name), page: 1
                    });
                };

                var prefetch = function () {
                    var key = listingKey(base, item.path);
                    if (!prefetched[key]) {
                        prefetched[key] = true;
                        fetchList(base, item.path, function () {});
                    }
                };

                if (grid) {
                    var card = buildCard('<div class="dances__poster dances__poster--icon">' + ICON_FOLDER + '</div>', item.name, 'папка');
                    card.on('hover:focus', function () { last = card; prefetch(); });
                    card.on('hover:enter', open);
                    grid.append(card);
                } else {
                    var el = buildRow('<div class="dances__ico">' + ICON_FOLDER + '</div>', item.name, 'папка');
                    el.on('hover:focus', function () { last = el; prefetch(); });
                    el.on('hover:enter', open);
                    scroll.append(el);
                }
            });

            files.forEach(function (item, idx) {
                if (grid) {
                    var poster = (previewsOn() && item.preview)
                        ? '<div class="dances__poster"><img src="' + item.preview + '" loading="lazy" /></div>'
                        : '<div class="dances__poster dances__poster--icon">' + ICON_PLAY + '</div>';

                    var card = buildCard(poster, item.name, humanSize(item.size));
                    card.on('hover:focus', function () { last = card; });
                    card.on('hover:enter', function () { playList(files, idx); });
                    grid.append(card);
                } else {
                    var left = (previewsOn() && item.preview)
                        ? '<img class="dances__thumb" src="' + item.preview + '" loading="lazy" />'
                        : '<div class="dances__ico">' + ICON_PLAY + '</div>';

                    var el = buildRow(left, item.name, humanSize(item.size));
                    el.on('hover:focus', function () { last = el; });
                    el.on('hover:enter', function () { playList(files, idx); });
                    scroll.append(el);
                }
            });
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

        this.start = function () { attachController(scroll, function () { return last; }); };
        this.stop = function () {};
        this.destroy = function () {
            alive = false;
            scroll.destroy();
        };
        this.render = function () { return scroll.render(); };
        this.empty = function () { emptyState(); };
    }

    // ---------- init ----------
    function init() {
        Lampa.Template.add('dances_css', '<style>' +
            '.dances__row{display:flex;align-items:center;gap:.9em;padding:.6em 1em;margin:.32em .5em;border-radius:.7em;background:rgba(255,255,255,.05);transition:background .15s ease,transform .15s ease}' +
            '.dances__row--focus{background:rgba(255,255,255,.19);transform:scale(1.012)}' +
            '.dances__left{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:104px}' +
            '.dances__ico{color:rgba(255,255,255,.92);display:flex;align-items:center;justify-content:center;min-width:104px}' +
            '.dances__thumb{width:104px;height:58px;object-fit:cover;border-radius:.4em;background:#000}' +
            '.dances__body{flex:1 1 auto;min-width:0}' +
            '.dances__title{font-size:1.02em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
            '.dances__sub{font-size:.82em;opacity:.55;margin-top:.15em}' +
            '.dances__grid{display:flex;flex-wrap:wrap;padding:.4em .5em 1em}' +
            '.dances__card{flex:0 0 23%;margin:0 .6% 1em;border-radius:.7em;overflow:hidden;background:rgba(255,255,255,.05);transition:background .15s ease,transform .15s ease}' +
            '.dances__card--focus{background:rgba(255,255,255,.2);transform:scale(1.03)}' +
            '.dances__poster{position:relative;width:100%;aspect-ratio:16/9;background:#000;overflow:hidden}' +
            '.dances__poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}' +
            '.dances__poster--icon{display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.85)}' +
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
            param: { name: KEY_VIEW, type: 'select', values: 'grid,list', default: 'grid' },
            field: { name: 'Вид', description: 'grid — карточки, list — строки' }
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

        var btn = $(
            '<li class="menu__item selector">' +
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
        log('initialized, view:', viewMode());
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init(); });
})();
