/* ===== FEAT-PWA-8b: سرویس‌ورکر صنعتی فای =====
   ===== FIX-PWA-10b: fallback سالم (کش → شل → صفحهٔ آفلاین inline)؛ هرگز صفحهٔ سفید؛
   manifest/آیکون‌ها cache-first نسخه‌دار؛ دادهٔ حساس (/api/*) هرگز کش نمی‌شود =====
   ===== FIX-PWA-11a: ناوبری cache-first + بروزرسانی پس‌زمینه — شل با اولین کلیک فوری رندر می‌شود
   (≤~۱ ثانیه حتی cold start روی LAN کند)؛ واکشی تازه در پس‌زمینه؛ پاسخ‌های redirect (جلسهٔ منقضی)
   هرگز کش نمی‌شوند؛ ارتقای نسخهٔ کش تا نصب‌های قدیمی خودبه‌خود مهاجرت کنند ===== */
'use strict';
var SHELL_CACHE = 'sanatify-shell-v11a3'; /* FIX-PWA-11a + FIX-AN-20a: bump نسخه — نصب‌های موجود PWA خودبه‌خود شل تازه می‌گیرند (index.html با Chart.js محلی + پریکش فایل /vendor/chart.umd.min.js) */
var SHELL_ASSETS = [
    '/manifest.webmanifest',
    '/icon-192.png',
    '/icon-512.png',
    '/favicon.ico',
    '/vendor/chart.umd.min.js' /* FIX-AN-20a: Chart.js محلی — آفلاین هم نمودارها کار کند (قبلاً نسخهٔ CDN کش اول بود) */,
    '/login',
    '/index.html' /* FIX-PWA-11a: پیش‌بارگذاری شل — cold start فوری از همان نصب اول */
];
var BRAND_FA = ['\u0635\u0646\u0639\u062a\u06cc \u0641\u0627\u06cc', 'SANATIFY'].join(' ');

self.addEventListener('install', function (e) {
    e.waitUntil(
        caches.open(SHELL_CACHE)
            .then(function (c) {
                /* شل: مانیفست/آیکون‌ها + صفحهٔ لاگین — هر کدام جدا تا خطای یکی بقیه را نکشد */
                return Promise.all(SHELL_ASSETS.map(function (u) {
                    return fetch(new Request(u, { credentials: 'same-origin', cache: 'no-store' }))
                        .then(function (r) {
                            /* FIX-PWA-11a: پاسخ redirect (مثل 302 به /login هنگام جلسهٔ منقضی) هرگز زیر کلید شل ذخیره نمی‌شود */
                            if (r && r.ok && !r.redirected) return c.put(u, r.clone());
                        })
                        .catch(function () { });
                }));
            })
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

/* FIX-PWA-10b: fetch با مهلت — ناوبری هرگز هنگ سرد نمی‌کند */
function fetchWithTimeout(req, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) { } }, ms);
    return fetch(req, { signal: ctrl.signal }).finally(function () { clearTimeout(timer); });
}

function offlineHtml() {
    return new Response('<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="UTF-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'
        + '<title>' + BRAND_FA + ' — \u0622\u0641\u0644\u0627\u06cc\u0646</title>'
        + '<style>body{font-family:Tahoma,sans-serif;background:#0b1622;color:#dbe7f3;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;direction:rtl}'
        + '.c{text-align:center;padding:24px}.b{background:#10293c;border:1px solid #1d3a55;border-radius:14px;padding:28px 24px;max-width:340px}'
        + 'h1{font-size:17px;color:#7fb4d8;margin:0 0 10px}p{font-size:13px;color:#9fb3c8;line-height:2;margin:0 0 18px}'
        + 'button{background:#0e7490;color:#fff;border:none;border-radius:8px;padding:11px 22px;font-family:inherit;font-weight:bold;font-size:13px;cursor:pointer}</style></head>'
        + '<body><div class="c"><div class="b"><h1>\u0635\u0646\u0639\u062a\u06cc \u0641\u0627\u06cc \u2014 \u062d\u0627\u0644\u062a \u0622\u0641\u0644\u0627\u06cc\u0646</h1>'
        + '<p>\u0627\u062a\u0635\u0627\u0644 \u0628\u0647 \u0633\u0631\u0648\u0631 \u0628\u0631\u0642\u0631\u0627\u0631 \u0646\u06cc\u0633\u062a. \u0628\u0631\u0627\u06cc \u062a\u0644\u0627\u0634 \u062f\u0648\u0628\u0627\u0631\u0647\u060c \u062f\u06a9\u0645\u0647\u0654 \u0632\u06cc\u0631 \u0631\u0627 \u0628\u0632\u0646\u06cc\u062f.</p>'
        + '<button onclick="location.reload()">\u062a\u0644\u0627\u0634 \u062f\u0648\u0628\u0627\u0631\u0647</button></div></div></body></html>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'GET') return; /* ثبت/تغییر داده هرگز کش نمی‌شود */
    var url = new URL(req.url);

    if (url.origin !== location.origin) {
        /* CDN (فونت/Chart.js) — کش اول با بروزرسانی پس‌زمینه؛ هرگز هنگ نمی‌کند */
        event.respondWith(
            caches.open(SHELL_CACHE).then(function (c) {
                return c.match(req).then(function (hit) {
                    var net = fetch(req).then(function (r) {
                        try { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(function () { }); } catch (e) { }
                        return r;
                    }).catch(function () { return hit; });
                    return hit || net;
                });
            })
        );
        return;
    }

    /* API داخلی: همیشه شبکه — هیچ پاسخی ذخیره نمی‌شود (دادهٔ حساس) */
    if (url.pathname.indexOf('/api/') === 0) return;

    /* FIX-PWA-10b: مانیفست/آیکون‌ها — cache-first نسخه‌دار (پاسخ فوری) */
    if (url.pathname === '/manifest.webmanifest' || url.pathname === '/icon-192.png' || url.pathname === '/icon-512.png' || url.pathname === '/favicon.ico') {
        event.respondWith(
            caches.open(SHELL_CACHE).then(function (c) {
                return c.match(url.pathname).then(function (hit) {
                    var net = fetch(req).then(function (r) {
                        if (r && r.ok) c.put(url.pathname, r.clone()).catch(function () { });
                        return r;
                    }).catch(function () { return hit; });
                    return hit || net;
                });
            })
        );
        return;
    }

    if (req.mode === 'navigate' || req.headers.get('accept') === 'text/html') {
        /* FIX-PWA-11a: ناوبری cache-first + بروزرسانی پس‌زمینه (stale-while-revalidate):
           پاسخ فوری از کش شل — حتی cold start روی LAN کند یا قطع (≤~۱ ثانیه، بدون blank)؛
           همزمان واکشی تازه در پس‌زمینه (event.waitUntil) و ذخیره برای بازدید بعدی؛
           /api/* همچنان فقط شبکه؛ پاسخ‌های redirect (جلسهٔ منقضی → /login) هرگز کش نمی‌شوند */
        var shellKey = url.pathname === '/login' ? '/login' : '/index.html';
        var netP = fetchWithTimeout(req, 4000).then(function (r) {
            if (r && r.ok && r.type === 'basic' && !r.redirected) {
                caches.open(SHELL_CACHE).then(function (c) {
                    try { c.put(shellKey, r.clone()).catch(function () { }); } catch (e) { }
                }).catch(function () { });
            }
            return r;
        }).catch(function () { return null; });
        try { event.waitUntil(netP.then(function () { }).catch(function () { })); } catch (e) { }
        event.respondWith(
            caches.open(SHELL_CACHE).then(function (c) {
                return c.match(shellKey).then(function (hit) {
                    if (hit) return hit; /* پاسخ فوری از کش */
                    return netP.then(function (r) {
                        if (r && r.ok) return r; /* اولین بازدید بدون کش */
                        return c.match(req).then(function (h1) {
                            return h1 || offlineHtml(); /* هرگز صفحهٔ سفید */
                        });
                    });
                });
            }).catch(function () { return offlineHtml(); })
        );
        return;
    }

    /* سایر GETهای هم‌مبدا: stale-while-revalidate */
    event.respondWith(
        caches.open(SHELL_CACHE).then(function (c) {
            return c.match(req).then(function (hit) {
                var net = fetch(req).then(function (r) {
                    try { if (r.ok) c.put(req, r.clone()).catch(function () { }); } catch (e) { }
                    return r;
                }).catch(function () { return hit; });
                return hit || net;
            });
        })
    );
});
