/* ===== FEAT-PWA-8b (begin): سرویس‌ورکر صنعتی فای — ناوبری و API همیشه network-first؛
   کش نسخه‌دار فقط برای شل استاتیک؛ دادهٔ حساس (همهٔ /api/*) هرگز کش نمی‌شود ===== */
'use strict';
var SHELL_CACHE = 'sanatify-shell-v8b1';
var SHELL_ASSETS = ['/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function (c) { return c.addAll(SHELL_ASSETS); })
            .then(function () { return self.skipWaiting(); })
    );
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        caches.keys()
            .then(function (keys) {
                return Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE; })
                    .map(function (k) { return caches.delete(k); }));
            })
            .then(function () { return self.clients.claim(); })
    );
});

self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return; // ثبت/تغییر داده هرگز کش نمی‌شود
    var url = new URL(req.url);

    if (url.origin !== location.origin) {
        // CDN (فونت/Chart.js) — کش اول برای آفلاین؛ محتوای عمومی
        event.respondWith(
            caches.open(SHELL_CACHE).then(function (c) {
                return c.match(req).then(function (hit) {
                    var net = fetch(req).then(function (r) {
                        try { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); } catch (e) { }
                        return r;
                    }).catch(function () { return hit; });
                    return hit || net;
                });
            })
        );
        return;
    }

    // API داخلی: همیشه شبکه — هیچ پاسخی ذخیره نمی‌شود (دادهٔ حساس)
    if (url.pathname.indexOf('/api/') === 0) return;

    if (req.mode === 'navigate') {
        // ناوبری: network-first، آفلاین → شل کش‌شده
        event.respondWith(
            fetch(req).then(function (r) {
                caches.open(SHELL_CACHE).then(function (c) {
                    try { c.put('/index.html', r.clone()); } catch (e) { }
                });
                return r;
            }).catch(function () {
                return caches.match('/index.html').then(function (r) { return r || caches.match('/'); });
            })
        );
        return;
    }

    // سایر GETهای هم‌مبدا: stale-while-revalidate
    event.respondWith(
        caches.open(SHELL_CACHE).then(function (c) {
            return c.match(req).then(function (hit) {
                var net = fetch(req).then(function (r) {
                    try { if (r.ok) c.put(req, r.clone()); } catch (e) { }
                    return r;
                }).catch(function () { return hit; });
                return hit || net;
            });
        })
    );
});
/* ===== FEAT-PWA-8b (end) ===== */
