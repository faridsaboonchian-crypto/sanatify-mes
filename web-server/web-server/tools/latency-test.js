#!/usr/bin/env node
// =====================================================================
//  HARDEN-18F — تست تأخیر تحت بار — صفر وابستگی
//  ۲۰۰ درخواست همزمان → p50/p95/p99 گزارش می‌شود
//  مصرف:
//    node tools/latency-test.js --url=http://localhost:3001 --total=200 --conc=200
//    node tools/latency-test.js --user=admin --pass=...   (لاگین اختیاری برای پوشش /api/summary)
// =====================================================================
const http = require('http');

const arg = (n, d) => { const a = process.argv.find((x) => x.indexOf('--' + n + '=') === 0); return a ? a.slice(n.length + 3) : d; };
const getArg = (n) => { const a = process.argv.find((x) => x.indexOf('--' + n + '=') === 0); return a ? a.slice(n.length + 3) : null; };
const URL0 = arg('url', 'http://localhost:3001');
const TOTAL = Math.max(1, Number(arg('total', 200)));
const CONC = Math.max(1, Number(arg('conc', 200)));
const USER = getArg('user'), PASS = getArg('pass');

function req(method, p, body, cookie) {
    return timed(method, p, body, cookie);
}
function timed(method, p, body, cookie, xff) {
    return new Promise((resolve, reject) => {
        const u = new URL(p, URL0);
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const headers = data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {};
        if (cookie) headers['Cookie'] = cookie;
        if (xff) headers['X-Forwarded-For'] = xff; /* IP مجازی — تست تأخیر نه جنگ با ضد-DoS */
        const t0 = Date.now();
        const r = http.request(u, { method: method, headers: headers }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, setCookie: res.headers['set-cookie'] }));
        });
        r.on('error', reject);
        r.setTimeout(20000, () => { r.destroy(new Error('timeout')); });
        if (data) r.write(data);
        r.end();
    });
}

function pct(sorted, p) { const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1); return sorted[Math.max(0, i)]; }

async function main() {
    let cookie = null;
    if (USER && PASS) {
        const lg = await timed('POST', '/api/auth/login', { username: USER, password: PASS });
        const m = lg.setCookie && lg.setCookie[0] && lg.setCookie[0].match(/mes_session=([^;]+)/);
        if (m) { cookie = 'mes_session=' + m[1]; console.log('لاگین موفق — مسیرهای احرازشده هم پوشش داده می‌شوند'); }
        else console.log('لاگین ناموفق — فقط مسیرهای عمومی تست می‌شوند');
    }
    const paths = ['/api/health', '/api/snapshot'];
    if (cookie) paths.push('/api/summary');
    console.log('هدف: ' + URL0 + ' | درخواست‌ها: ' + TOTAL + ' | همزمانی: ' + CONC + ' | مسیرها: ' + paths.join(', '));
    const lat = []; let errors = 0; const t0 = Date.now();
    async function fire(i) {
        const p = paths[i % paths.length];
        const xff = '10.19.' + Math.floor(i / 250) + '.' + ((i % 250) + 1);
        try {
            const r = await timed('GET', p, null, cookie, xff);
            if (r.status === 200) lat.push(r.ms); else errors++;
        } catch (e) { errors++; }
    }
    await Promise.all(Array.from({ length: TOTAL }, (_, i) => fire(i)));
    const wall = Date.now() - t0;
    if (!lat.length) { console.error('✗ FAIL — هیچ پاسخ موفقی نبود'); process.exit(1); }
    lat.sort((a, b) => a - b);
    console.log('────────────────────────────────────────────');
    console.log('مدت دیوار        : ' + wall + 'ms | موفق: ' + lat.length + ' | خطا: ' + errors);
    console.log('p50 = ' + pct(lat, 50) + 'ms | p95 = ' + pct(lat, 95) + 'ms | p99 = ' + pct(lat, 99) + 'ms | max = ' + lat[lat.length - 1] + 'ms');
    console.log(errors === 0 ? '✓ PASS — صفر خطا در ' + TOTAL + ' درخواست همزمان' : '✗ FAIL — ' + errors + ' خطا');
    process.exit(errors === 0 ? 0 : 1);
}
main().catch((e) => { console.error('✗ FAIL: ' + e.message); process.exit(1); });
