(function () {
    'use strict';

    if (window.dances_plugin_ready) return;
    window.dances_plugin_ready = true;

    var KEY_URL = 'dances_public_url';
    var DEFAULT_URL = 'https://disk.yandex.ru/d/L4PW93XuLMuu3A';
    var API = 'https://cloud-api.yandex.net/v1/disk/public/resources';

    function log() {
        try { console.log.apply(console, ['[Dances]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function publicKey() {
        var saved = Lampa.Storage.field(KEY_URL);
        return (saved && saved.trim()) || DEFAULT_URL;
    }

    function apiUrl(base, path) {
        var u = API + '?public_key=' + encodeURIComponent(base) + '&limit=1000&sort=name&preview_size=M';
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

    var ICON_FOLDER = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/></svg>';
    var ICON_PLAY = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

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

    // ---------- экран списка ----------
    function DancesScreen(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var net = new Lampa.Reguest();
        var path = object.path || '/';
        var base = object.base || publicKey();
        var alive = true;
        var last = false;
        var playlist = [];

        this.create = function () {
            var self = this;

            net.timeout(25000);
            self.activity.loader(true);

            net.silent(apiUrl(base, path), function (data) {
                if (!alive) return;
                self.activity.loader(false);

                var items = (data && data._embedded && data._embedded.items) || [];
                var dirs = items.filter(function (i) { return i.type === 'dir'; });
                var files = items.filter(function (i) { return i.type === 'file' && isVideo(i.name); });

                if (!dirs.length && !files.length) {
                    self.activity.empty();
                    return;
                }

                playlist = files.filter(function (f) { return !!f.file; }).map(function (f) {
                    return { title: f.name, url: f.file };
                });

                if (playlist.length > 1) {
                    var all = buildRow(
                        '<div class="dances__ico">' + ICON_PLAY + '</div>',
                        'Смотреть всё',
                        playlist.length + ' видео подряд'
                    );
                    all.on('hover:enter', function () {
                        Lampa.Player.playlist(playlist);
                        Lampa.Player.play({ title: 'Танцы', url: playlist[0].url });
                    });
                    scroll.append(all);
                }

                dirs.forEach(function (item) {
                    var count = item._embedded && item._embedded.total ? item._embedded.total : '';
                    var el = buildRow(
                        '<div class="dances__ico">' + ICON_FOLDER + '</div>',
                        item.name,
                        count ? count + ' объектов' : 'папка'
                    );

                    el.on('hover:enter', function () {
                        Lampa.Activity.push({
                            url: '', title: item.name, component: 'dances_screen',
                            base: base, path: item.path || (path + '/' + item.name), page: 1
                        });
                    });

                    scroll.append(el);
                });

                files.forEach(function (item) {
                    var left = item.preview
                        ? '<img class="dances__thumb" src="' + item.preview + '" loading="lazy" />'
                        : '<div class="dances__ico">' + ICON_PLAY + '</div>';

                    var el = buildRow(left, item.name, humanSize(item.size));

                    el.on('hover:enter', function () {
                        playFile(base, item, playlist);
                    });

                    scroll.append(el);
                });
            }, function () {
                if (!alive) return;
                self.activity.loader(false);
                Lampa.Noty.show('Не удалось получить список файлов', { style: 'error' });
                self.activity.empty();
            });

            return this.render();
        };

        this.start = function () {
            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { Navigator.move('right'); },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                },
                down: function () {
                    if (Navigator.canmove('down')) Navigator.move('down');
                },
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
        this.empty = function () { this.activity.loader(false); this.activity.empty(); };
    }

    function playFile(base, item, playlist) {
        var start = function (url) {
            try {
                if (playlist && playlist.length > 1) Lampa.Player.playlist(playlist);
            } catch (e) { log('playlist error', e); }

            Lampa.Player.play({ title: item.name, url: url });
        };

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

    // ---------- инициализация ----------
    function init() {
        Lampa.Template.add('dances_css', '<style>' +
            '.dances__row{display:flex;align-items:center;gap:.9em;padding:.65em 1em;margin:.35em .5em;border-radius:.7em;background:rgba(255,255,255,.05);transition:background .15s ease,transform .15s ease}' +
            '.dances__row--focus{background:rgba(255,255,255,.19);transform:scale(1.012)}' +
            '.dances__left{flex:0 0 auto;display:flex;align-items:center;justify-content:center;min-width:104px}' +
            '.dances__ico{color:rgba(255,255,255,.9);display:flex;align-items:center;justify-content:center;min-width:104px}' +
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

        var btn = $(
            '<li class="menu__item selector">' +
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
