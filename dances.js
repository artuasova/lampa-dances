(function () {
    'use strict';

    if (window.dances_plugin_ready) return;
    window.dances_plugin_ready = true;

    var KEY_URL = 'dances_public_url';
    var API = 'https://cloud-api.yandex.net/v1/disk/public/resources';

    function log() {
        try { console.log.apply(console, ['[Dances]'].concat([].slice.call(arguments))); } catch (e) {}
    }

    function publicKey() {
        return (Lampa.Storage.field(KEY_URL) || '').trim();
    }

    function apiUrl(base, path) {
        var u = API + '?public_key=' + encodeURIComponent(base) + '&limit=500&sort=name';
        if (path && path !== '/') u += '&path=' + encodeURIComponent(path);
        return u;
    }

    function isVideo(name) {
        return /\.(mp4|mkv|avi|mov|webm|m4v|ts|mpg|mpeg|wmv|flv)$/i.test(name || '');
    }

    // ---------- экран списка ----------
    function DancesScreen(object) {
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var net = new Lampa.Reguest();
        var path = object.path || '/';
        var base = object.base || publicKey();
        var alive = true;

        this.create = function () {
            var self = this;

            if (!base) {
                Lampa.Noty.show('Сначала укажи ссылку на папку Яндекс.Диска в настройках плагина');
                self.activity.loader(false);
                self.activity.empty();
                return self.render();
            }

            self.activity.loader(true);

            net.timeout(20000);
            net.silent(apiUrl(base, path), function (data) {
                if (!alive) return;
                self.activity.loader(false);

                var items = (data && data._embedded && data._embedded.items) || [];
                if (!items.length) {
                    self.activity.empty();
                    return;
                }

                var dirs = items.filter(function (i) { return i.type === 'dir'; });
                var files = items.filter(function (i) { return i.type === 'file' && isVideo(i.name); });

                dirs.concat(files).forEach(function (item) {
                    var el = $(
                        '<div class="selector dances-item">' +
                            '<div class="dances-item__ico">' + (item.type === 'dir' ? '📁' : '🎬') + '</div>' +
                            '<div class="dances-item__name">' + (item.name || '').replace(/</g, '&lt;') + '</div>' +
                        '</div>'
                    );

                    el.on('hover:enter', function () {
                        if (item.type === 'dir') {
                            Lampa.Activity.push({
                                url: '', title: item.name, component: 'dances_screen',
                                base: base, path: item.path || (path + '/' + item.name), page: 1
                            });
                        } else {
                            play(base, item);
                        }
                    });

                    scroll.append(el);
                });
            }, function () {
                if (!alive) return;
                self.activity.loader(false);
                Lampa.Noty.show('Не удалось получить список. Проверь ссылку на папку');
                self.activity.empty();
            });

            return this.render();
        };

        this.start = function () {};
        this.stop = function () {};
        this.destroy = function () { alive = false; net.clear(); scroll.destroy(); };
        this.render = function () { return scroll.render(); };
        this.empty = function () { this.activity.loader(false); this.activity.empty(); };
    }

    function play(base, item) {
        var start = function (url) {
            log('play', item.name, url);

            Lampa.Player.play({
                title: item.name,
                url: url
            });
        };

        if (item.file) {
            start(item.file);
            return;
        }

        // запасной путь: получить прямую ссылку через download-эндпоинт
        var net = new Lampa.Reguest();
        net.timeout(20000);
        net.silent(
            'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=' +
                encodeURIComponent(base) + '&path=' + encodeURIComponent(item.path),
            function (data) {
                if (data && data.href) start(data.href);
                else Lampa.Noty.show('Не удалось получить ссылку на файл');
            },
            function () { Lampa.Noty.show('Не удалось получить ссылку на файл'); }
        );
    }

    // ---------- инициализация ----------
    function init() {
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
            param: { name: KEY_URL, type: 'input', default: 'https://disk.yandex.ru/d/L4PW93XuLMuu3A' },
            field: {
                name: 'Ссылка на папку Яндекс.Диска',
                description: 'Публичная ссылка вида https://disk.yandex.ru/d/XXXX'
            }
        });

        var btn = $(
            '<li class="menu__item selector">' +
                '<div class="menu__ico"><svg viewBox="0 0 24 24"><path d="M12 3v12.5a3.5 3.5 0 1 1-2-3.16V5l8-2v10.5a3.5 3.5 0 1 1-2-3.16V3z"/></svg></div>' +
                '<div class="menu__text">Танцы</div>' +
            '</li>'
        );

        btn.on('hover:enter', function () {
            var base = publicKey();
            if (!base) {
                Lampa.Noty.show('Укажи ссылку на папку в Настройки → Танцы (Яндекс.Диск)');
                return;
            }
            Lampa.Activity.push({
                url: '', title: 'Танцы', component: 'dances_screen',
                base: base, path: '/', page: 1
            });
        });

        $('.menu .menu__list').eq(0).append(btn);
        log('initialized');
    }

    if (window.appready) init();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') init(); });
})();
