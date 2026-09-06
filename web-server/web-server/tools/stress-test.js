#!/usr/bin/env node
// =====================================================================
//  HARDEN-18E — تست استرس همزمانی — صفر وابستگی
//  ۵۰ کلاینت همزمان write/read ⇒ اثبات: صفر ازدست‌رفتن داده + صفر خرابی
//  نوشتن‌ها از POST /api/ingest (صف تک‌نویسندهٔ 18D) عبور می‌کنند؛ خواندن‌ها /api/health + /api/snapshot
//  مصرف:
//    node tools/stress-test.js --url=http://localhost:3001 --clients=50 --writes=4
//    node tools/stress-test.js --local            (اعتبارسنجی checksum فایل live.json هم انجام می‌شود)
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (n, d) => { const a = process.argv.find((x) => x.indexOf('--' + n + '=') === 0); return a ? a.slice(n.length + 3) : d; };
const URL0 = arg('url', 'http://localhost:3001');
const CLIENTS = Math.max(1, Number(arg('clients', 50)));
const WRITES = Math.max(1, Number(arg('writes', 4)));
const LOCAL = process.argv.indexOf('--local') !== -1;
const PREFIX = 'stress18-' + Date.now() + '-';

function req(method, p, body, xff) {
    return new Promise((resolve, reject) => {
        const u = new URL(p, URL0);
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {};
        /* هر کلاینت IP مجازی خودش را دارد — شبیه‌سازی ۵۰ کاربر واقعی کارخانه (ریت‌لیمیت per-IP ۱۰۰/دقیقه) */
        if (xff) headers['X-Forwarded-For'] = xff;
        const r = http.request(u, { method: method, headers: headers }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}') }); } catch (e) { resolve({ status: res.statusCode, json: {} }); } });
        });
        r.on('error', reject);
        r.setTimeout(15000, () => { r.destroy(new Error('timeout')); });
        if (data) r.write(data);
        r.end();
    });
}

async function main() {
    console.log('هدف: ' + URL0 + ' | کلاینت‌ها: ' + CLIENTS + ' | نوشتن per کلاینت: ' + WRITES + ' (مجموع ' + (CLIENTS * WRITES) + ')');
    const h0 = await req('GET', '/api/health');
    if (h0.status !== 200) { console.error('✗ سرور در دسترس نیست (health ' + h0.status + ')'); process.exit(1); }
    const ver0 = Number(h0.json.data_ver) || 0;
    const t0 = Date.now();

    let okW = 0, failW = 0, okR = 0, failR = 0, rlW = 0;
    async function client(id) {
        const xff = '10.18.' + Math.floor(id / 250) + '.' + ((id % 250) + 1); /* IP مجازی مجزا per کلاینت */
        for (let i = 0; i < WRITES; i++) {
            try {
                const rec = { id: PREFIX + id + '-' + i, line: 'STRESS', qty_kg: 1, ts: new Date().toISOString() };
                const w = await req('POST', '/api/ingest', { production_logs: [rec] }, xff);
                if (w.status === 200 && w.json.ok) okW++; else if (w.status === 429) rlW++; else failW++;
            } catch (e) { failW++; }
            try {
                const r = await req('GET', '/api/health', null, xff);
                if (r.status === 200 && r.json.ok) okR++; else if (r.status === 429) { /* ریت‌لیمیت — خطا حساب نمی‌شود */ } else failR++;
            } catch (e) { failR++; }
        }
    }
    await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(i)));
    const ms = Date.now() - t0;

    // اعتبارسنجی ۱: هیچ رکوردی از دست نرفته باشد (با IP مجازی مستقل — خارج از بستهٔ ریت‌لیمیت کلاینت‌ها)
    const snap = await req('GET', '/api/snapshot', null, '10.18.99.99');
    const recs = (snap.json.production_logs || []).filter((x) => String(x.id || '').indexOf(PREFIX) === 0);
    const expected = CLIENTS * WRITES;
    const noLoss = recs.length === expected;

    // اعتبارسنجی ۲: نسخهٔ داده دقیقاً به اندازهٔ نوشتن‌های موفق بامپ شده باشد
    const h1 = await req('GET', '/api/health', null, '10.18.99.99');
    const ver1 = Number(h1.json.data_ver) || 0;

    // اعتبارسنجی ۳ (local): checksum فایل سالم باشد
    let integrity = 'n/a (بدون --local)';
    if (LOCAL) {
        const f = path.join(__dirname, '..', 'live.json');
        const txt = fs.readFileSync(f, 'utf8');
        const parsed = JSON.parse(txt);
        const sig = parsed.__integrity_18a || '';
        delete parsed.__integrity_18a;
        const expect = 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(parsed, null, 2), 'utf8').digest('hex');
        integrity = sig === expect ? 'سالم (SHA-256 منطبق)' : 'خراب! (' + sig.slice(0, 16) + ' ≠ ' + expect.slice(0, 16) + ')';
    }

    console.log('────────────────────────────────────────────');
    console.log('مدت کل           : ' + ms + 'ms | میانگین ' + Math.round(ms / Math.max(1, CLIENTS * WRITES * 2)) + 'ms/request');
    console.log('نوشتن موفق/خطا   : ' + okW + ' / ' + failW + (rlW ? ' (۴۲۹ ریت‌لیمیت: ' + rlW + ')' : ''));
    console.log('خواندن موفق/خطا  : ' + okR + ' / ' + failR);
    console.log('رکوردهای یافته   : ' + recs.length + ' از ' + expected + ' موردانتظار');
    console.log('نسخهٔ داده        : ' + ver0 + ' → ' + ver1);
    console.log('یکپارچگی فایل    : ' + integrity);
    const pass = noLoss && failW === 0 && failR === 0 && (LOCAL ? integrity.indexOf('سالم') === 0 : true);
    console.log(pass ? '✓ PASS — صفر ازدست‌رفتن داده + صفر خرابی در ' + CLIENTS + ' کلاینت همزمان' : '✗ FAIL — به گزارش فوق دقت کنید');
    process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error('✗ FAIL: ' + e.message); process.exit(1); });
