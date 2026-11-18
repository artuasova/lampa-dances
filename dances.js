(function () {
    'use strict';

    if (window.dances_plugin_ready) return;
    window.dances_plugin_ready = true;

    var KEY_URL = 'dances_public_url';
    var KEY_SORT = 'dances_sort';
    var KEY_PREVIEW = 'dances_preview';
    var KEY_CACHE = 'dances_cache_';
    var KEY_KEYS = 'dances_cache_keys';

    var DEFAULT_URL = 'https://disk.yandex.ru/d/L4PW93XuLMuu3A';
    var API = 'https://cloud-api.yandex.net/v1/disk/public/resources';
    var CACHE_TTL = 5 * 60 * 1000;

    function log() {
        try { console.log.apply(console, ['[Dances]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function publicKey() {
        var saved = Lampa.Storage.field(KEY_URL);
        return (saved && saved.trim()) || DEFAULT_URL;
    }

    function sortMode() { return Lampa.Storage.field(KEY_SORT) || 'name'; }

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

    // ---------- экран ----------
    function DancesScreen(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var net = new Lampa.Reguest();
        var path = object.path || '/';
        var base = object.base || publicKey();
        var alive = true;
        var last = false;
        var act = null;
        var playlist = [];

        function loader(state) {
            try { if (act) act.loader(state); } catch (e) {}
        }

        function emptyState() {
            loader(false);
            try { if (act) act.empty(); } catch (e) {}
        }

        function resetScroll() {
            try {
                if (typeof scroll.clear === 'function') scroll.clear();
            } catch (e) { log('scroll clear error', e); }
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

            if (!dirs.length && !files.length) {
                emptyState();
                return;
            }

            if (path !== '/') {
                var back = buildRow('<div class="dances__ico">' + ICON_BACK + '</div>', 'Назад', 'на уровень выше');
                back.on('hover:enter', function () { Lampa.Activity.backward(); });
                scroll.append(back);
            }

            var totalSize = files.reduce(function (s, f) { return s + (f.size || 0); }, 0);

            if (fromCache) {
                var ref = buildRow('<div class="dances__ico">' + ICON_REFRESH + '</div>', 'Обновить список', 'сейчас показан кэш');
                ref.on('hover:enter', function () {
                    cacheClear();
                    resetScroll();
                    load(false);
                    Lampa.Noty.show('Обновляю список');
                    Lampa.Controller.toggle('content');
                });
                scroll.append(ref);
            }

            playlist = files.filter(function (f) { return !!f.file; }).map(function (f) {
                return { title: f.name, url: f.file };
            });

            if (playlist.length > 1) {
                var sub = playlist.length + ' видео';
                if (totalSize) sub += ' • ' + humanSize(totalSize);
                var all = buildRow('<div class="dances__ico">' + ICON_PLAY + '</div>', 'Смотреть всё', sub);
                all.on('hover:enter', function () {
                    Lampa.Player.playlist(playlist);
                    Lampa.Player.play({ title: 'Танцы', url: playlist[0].url });
                });
                scroll.append(all);
            }

            dirs.forEach(function (item) {
                var el = buildRow('<div class="dances__ico">' + ICON_FOLDER + '</div>', item.name, 'папка');
                el.on('hover:enter', function () {
                    Lampa.Activity.push({
                        url: '', title: item.name, component: 'dances_screen',
                        base: base, path: item.path || (path + '/' + item.name), page: 1
                    });
                });
                scroll.append(el);
            });

            files.forEach(function (item) {
                var left = (previewsOn() && item.preview)
                    ? '<img class="dances__thumb" src="' + item.preview + '" loading="lazy" />'
                    : '<div class="dances__ico">' + ICON_PLAY + '</div>';

                var el = buildRow(left, item.name, humanSize(item.size));
                el.on('hover:enter', function () { playFile(base, item, playlist); });
                scroll.append(el);
            });
        }

        function load(useCache) {
            var cacheKey = base + '|' + path + '|' + sortMode() + '|' + (previewsOn() ? 'p' : 'n');

            if (useCache) {
                var cached = cacheGet(cacheKey);
                if (cached && cached.length) {
                    paint(cached, true);
                    return;
                }
            }

            net.timeout(25000);
            loader(true);

            net.silent(apiUrl(base, path), function (data) {
                if (!alive) return;
                loader(false);

                var items = (data && data._embedded && data._embedded.items) || [];
                if (!items.length) {
                    emptyState();
                    return;
                }

                cacheSet(cacheKey, items);
                paint(items, false);
            }, function () {
                if (!alive) return;
                loader(false);
                Lampa.Noty.show('Не удалось получить список файлов', { style: 'error' });
                emptyState();
            });
        }

        this.create = function () {
            act = this.activity;
            load(true);
            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    try {
                        Lampa.Controller.collectionSet(scroll.render());
                        Lampa.Controller.collectionFocus(last || false, scroll.render());
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
        };

        this.stop = function () {};
        this.destroy = function () {
            alive = false;
            net.clear();
            scroll.destroy();
        };
        this.render = function () { return scroll.render(); };
        this.empty = function () { emptyState(); };
    }

    function playFile(base, item, playlist) {
        function start(url) {
            try {
                if (playlist && playlist.length > 1) Lampa.Player.playlist(playlist);
            } catch (e) { log('playlist error', e); }

            Lampa.Player.play({ title: item.name, url: url });
        }

        if (item.file) {
            start(item.file);
            return;
        }

        var net = new Lampa.Reguest();
        net.timeout(25000);
        net.silent(
            'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=' +
                encodeURIComponent(base) + '&path=' + encodeURIComponent(item.path),
            function (data) {
                if (data && data.href) start(data.href);
                else Lampa.Noty.show('Не удалось получить ссылку на файл', { style: 'error' });
            },
            function () { Lampa.Noty.show('Не удалось получить ссылку на файл', { style: 'error' }); }
        );
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
            '</style>');
        $('body').append(Lampa.Template.get('dances_css', {}, true));

        if (!Lampa.Component.get('dances_screen')) {
            Lampa.Component.add('dances_screen', DancesScreen);
        }

        Lampa.SettingsApi.addComponent({
            component: 'dances',
            name: 'Танцы (Яндекс.Диск)',
            icon: '<svg viewBox="0 0 24 24"><path d="M12 3v12.5a3.5 3.5 0 1 1-2-3.16V5l8-2v10.5a3.5 3.5 0 1 1-2-3.16V3z"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_URL, type: 'input', default: DEFAULT_URL },
            field: {
                name: 'Ссылка на папку Яндекс.Диска',
                description: 'Публичная ссылка вида https://disk.yandex.ru/d/XXXX'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_SORT, type: 'select', values: 'name,date,size', default: 'name' },
            field: { name: 'Сортировка', description: 'name — по имени, date — по дате, size — по размеру' }
        });

        Lampa.SettingsApi.addParam({
            component: 'dances',
            param: { name: KEY_PREVIEW, type: 'trigger', default: true },
            field: { name: 'Превью видео', description: 'Кадры из видео в списке' }
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
        log('initialized');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init(); });
})();
