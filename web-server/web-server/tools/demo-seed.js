#!/usr/bin/env node
// =====================================================================
// FIX-UI-19d — ابزار ساخت دادهٔ نمونهٔ دمو — صفر وابستگی
// «۳۰ روز تولید + ۵۰ بندیل + ۱۰ توقف + ۵ برنامهٔ PM»
//
// مصرف:
//   node tools/demo-seed.js --url=http://localhost:3001 --user=admin --pass=PASSWORD
//   گزینه‌ها: --days=30 --bundles=50 --stops=10 --pms=5 --prefix=demo19 --dry-run --help
//
// نکته‌ها:
//  • رکوردهای تولید/بندیل/توقف از POST /api/ingest عبور می‌کنند (صف تک‌نویسندهٔ 18D + نوشتن اتمیک 18A)
//  • idها قطعی (prefix + شماره) هستند → اجرای مکرر «دوباره‌نویسی هم‌شناسه» است، تکراری نمی‌سازد
//  • برنامه‌های PM از POST /api/pm/plan با نشست ادمین ثبت می‌شوند
//  • هیچ دادهٔ مالی/فروشی/خریدی نمی‌سازد — سناریوی دموی «فقط ماژول‌های فنی» (سازگار با demo_mode)
// =====================================================================
'use strict';
const http = require('http');

// ---------- args ----------
const arg = (n, d) => { const a = process.argv.find((x) => x.indexOf('--' + n + '=') === 0); return a ? a.slice(n.length + 3) : d; };
const URL0 = arg('url', 'http://localhost:3001');
const USER = arg('user', 'admin');
const PASS = arg('pass', '');
const DAYS = Math.max(1, Number(arg('days', 30)));
const BUNDLES = Math.max(0, Number(arg('bundles', 50)));
const STOPS = Math.max(0, Number(arg('stops', 10)));
const PMS = Math.max(0, Number(arg('pms', 5)));
const PREFIX = arg('prefix', 'demo19');
const DRY = process.argv.indexOf('--dry-run') !== -1;
if (process.argv.indexOf('--help') !== -1 || !PASS) {
    console.log('مصرف: node tools/demo-seed.js --url=http://localhost:3001 --user=admin --pass=رمز [--days=30 --bundles=50 --stops=10 --pms=5 --prefix=demo19] [--dry-run]');
    process.exit(!PASS ? 1 : 0);
}

// ---------- gregorian → jalali (الگوریتم استاندارد jalaali، بدون وابستگی) ----------
function div(a, b) { return ~~(a / b); }
function g2j(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let jy = (gy <= 1600) ? 0 : 979;
    gy -= (gy <= 1600) ? 621 : 1600;
    const gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = (365 * gy) + div(gy2 + 3, 4) - div(gy2 + 99, 100) + div(gy2 + 399, 400) - 80 + gd + g_d_m[gm - 1];
    jy += 33 * div(days, 12053); days %= 12053;
    jy += 4 * div(days, 1461); days %= 1461;
    if (days > 365) { jy += div(days - 1, 365); days = (days - 1) % 365; }
    const jm = (days < 186) ? 1 + div(days, 31) : 7 + div(days - 186, 30);
    const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return [jy, jm, jd];
}
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function jalaliOf(date) { const [jy, jm, jd] = g2j(date.getFullYear(), date.getMonth() + 1, date.getDate()); return jy + '/' + pad2(jm) + '/' + pad2(jd); }

// ---------- http helpers ----------
function req(method, p, body, headers) {
    return new Promise((resolve, reject) => {
        const u = new URL(p, URL0);
        const data = body ? Buffer.from(JSON.stringify(body)) : null;
        const h = Object.assign({}, headers || {});
        if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
        const r = http.request(u, { method, headers: h }, (res) => {
            let d = '';
            res.on('data', (c) => { d += c; });
            res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(d || '{}'), headers: res.headers }); } catch (e) { resolve({ status: res.statusCode, json: {}, headers: res.headers }); } });
        });
        r.on('error', reject);
        r.setTimeout(20000, () => r.destroy(new Error('timeout')));
        if (data) r.write(data);
        r.end();
    });
}

// ---------- ثابت‌های فرآیند فولاد (هم‌راستا با STATIONS/محصولات سیستم) ----------
const PRODUCTS = ['RB-12', 'RB-14', 'RB-16', 'RB-18', 'RB-20', 'RB-22', 'RB-25'];
const SIZE_OF = { 'RB-12': 12, 'RB-14': 14, 'RB-16': 16, 'RB-18': 18, 'RB-20': 20, 'RB-22': 22, 'RB-25': 25 };
const GRADES = ['A3', 'A4', '5SP'];
const SHIFTS = ['shift-morning-301', 'shift-night-302'];
const STATIONS_DT = ['st-cut', 'st-form', 'st-seam', 'st-rib'];
const REASONS_DT = ['roll_change', 'billet_jam', 'furnace_temp', 'shear_adjust', 'mech_elec', 'hydraulic'];
const PM_DEFS = [
    { t: 'بازرسی و روغنکاری سیستم فرمینگ', m: 'st-form', iv: 30 },
    { t: 'تعویض غلتک‌های قیچی برش', m: 'st-seam', iv: 45 },
    { t: 'سرویس کوره و بازرسی مشعل‌ها', m: 'st-cut', iv: 60 },
    { t: 'کالیبراسیون دستگاه آزمون کشش', m: 'st-test', iv: 90 },
    { t: 'بازرسی سیستم آج‌زنی', m: 'st-rib', iv: 30 },
    { t: 'سرویس هیدرولیک بسته‌بندی بندیل', m: 'st-pack', iv: 45 },
    { t: 'بازرسی فن‌ها و خنک‌کنندهٔ خط', m: 'st-form', iv: 30 }
];
let seedState = 987654321;
function rnd() { seedState = (seedState * 1103515245 + 12345) % 2147483648; return seedState / 2147483648; }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
function rint(a, b) { return a + Math.floor(rnd() * (b - a + 1)); }

(async () => {
    console.log('⏳ اتصال به ' + URL0 + ' …');
    const health = await req('GET', '/api/health');
    if (health.status !== 200) { console.error('✖ سرور در دسترس نیست: HTTP ' + health.status); process.exit(1); }

    // ورود ادمین (برای POST /api/pm/plan)
    const login = await req('POST', '/api/auth/login', { username: USER, password: PASS });
    if (login.status !== 200 || !login.json.ok) { console.error('✖ ورود ناموفق: ' + JSON.stringify(login.json).slice(0, 120)); process.exit(1); }
    const setc = login.headers['set-cookie'] || [];
    const cookie = (setc[0] || '').split(';')[0];
    const H = { Cookie: cookie, Origin: URL0 };

    const now = Date.now();
    const DAY = 86400000;
    const production = [], bundles = [], downtimes = [];
    let bIdx = 0;

    // ۱) ۳۰ روز تولید — دو شیفت در روز، هر شیفت ۱-۲ محصول
    for (let d = DAYS - 1; d >= 0; d--) {
        const ts = new Date(now - d * DAY);
        ts.setHours(d % 2 ? 6 : 18, rint(0, 55), 0, 0);
        for (let s = 0; s < 2; s++) {
            const pid = pick(PRODUCTS);
            const shift = SHIFTS[s];
            const branches = rint(110, 220);
            const pallets = rint(2, 5);
            const heat = PREFIX + '-HT-' + pad2(ts.getMonth() + 1) + pad2(ts.getDate()) + '-' + (s + 1);
            production.push({
                id: PREFIX + '-P-' + d + '-' + s,
                operator_id: USER,
                product_id: pid,
                shift_id: shift,
                good_quantity: branches,
                pallet_count: pallets,
                machine_id: 'st-pack',
                heat_number: heat,
                description: 'دادهٔ نمونهٔ دمو — شیفت ' + (s ? 'شب' : 'صبح'),
                source: 'manual',
                timestamp: new Date(ts.getTime() + s * 6 * 3600000).toISOString()
            });
            // ۲) بندیل‌ها — پخش روی روزها تا مجموع BUNDLES
            const perShift = Math.round(BUNDLES / (DAYS * 2));
            for (let b = 0; b < perShift && bIdx < BUNDLES; b++, bIdx++) {
                const netKg = rint(1800, 2400);
                bundles.push({
                    id: PREFIX + '-B-' + (bIdx + 1),
                    bundle_code: 'PLT-' + pad2(ts.getMonth() + 1) + pad2(ts.getDate()) + '-' + pad2(bIdx + 1),
                    heat_number: heat,
                    billet_id: PREFIX + '-BL-' + (bIdx + 1),
                    rebar_size: SIZE_OF[pid],
                    rebar_grade: pick(GRADES),
                    branch_count: rint(60, 150),
                    net_weight_kg: netKg,
                    quality_status: 'APPROVED',
                    produced_at: new Date(ts.getTime() + s * 6 * 3600000 + b * 900000).toISOString()
                });
            }
        }
    }
    // اگر گرد کردن، بندیل کم/زیاد ماند → تکمیل/برش به دقیقاً BUNDLES
    while (bIdx > BUNDLES) { bundles.pop(); bIdx--; }
    for (; bIdx < BUNDLES; bIdx++) {
        const ts = new Date(now - rint(0, DAYS - 1) * DAY);
        bundles.push({
            id: PREFIX + '-B-' + (bIdx + 1),
            bundle_code: 'PLT-XX-' + pad2(bIdx + 1),
            heat_number: PREFIX + '-HT-00-1',
            billet_id: PREFIX + '-BL-' + (bIdx + 1),
            rebar_size: Number(pick(PRODUCTS).slice(3)),
            rebar_grade: pick(GRADES),
            branch_count: rint(60, 150),
            net_weight_kg: rint(1800, 2400),
            quality_status: 'APPROVED',
            produced_at: ts.toISOString()
        });
    }

    // ۳) ۱۰ توقف پخش‌شده در ۳۰ روز
    for (let i = 0; i < STOPS; i++) {
        const start = new Date(now - rint(0, DAYS - 1) * DAY - rint(0, 20) * 3600000);
        const dur = rint(15, 120);
        downtimes.push({
            id: PREFIX + '-T-' + (i + 1),
            reason_id: pick(REASONS_DT),
            is_unplanned: rnd() > 0.3 ? 1 : 0,
            shift_id: pick(SHIFTS),
            start_time: start.toISOString(),
            end_time: new Date(start.getTime() + dur * 60000).toISOString(),
            machine_id: pick(STATIONS_DT),
            description: 'دادهٔ نمونهٔ دمو — توقف ' + (i + 1)
        });
    }

    // ۴) ۵ برنامهٔ PM (از POST /api/pm/plan — با تاریخ شمسی)
    const pmPlans = PM_DEFS.slice(0, PMS).map((p, i) => ({
        machine_id: p.m,
        title: p.t,
        interval_days: p.iv,
        last_done: jalaliOf(new Date(now - rint(1, Math.min(p.iv, 29)) * DAY)),
        responsible: 'تیم فنی دمو',
        priority: i % 3 === 0 ? 'high' : 'medium',
        notes: 'دادهٔ نمونهٔ دمو (prefix: ' + PREFIX + ')'
    }));

    const countsIngest = { production_logs: production.length, rebar_bundles: bundles.length, downtime_logs: downtimes.length };
    console.log('📦 برنامهٔ درج:', JSON.stringify(countsIngest), '+ pm_plans:', pmPlans.length, DRY ? '(DRY-RUN)' : '');
    if (!DRY) {
        const ing = await req('POST', '/api/ingest', { production_logs: production, rebar_bundles: bundles, downtime_logs: downtimes });
        if (ing.status !== 200 || !ing.json.ok) { console.error('✖ ingest ناموفق: HTTP ' + ing.status + ' ' + JSON.stringify(ing.json).slice(0, 160)); process.exit(1); }
        console.log('✅ ingest:', JSON.stringify(ing.json.counts || {}));
        let okPm = 0;
        for (const p of pmPlans) {
            const r = await req('POST', '/api/pm/plan', p, H);
            if (r.status === 201 || r.status === 200) okPm++;
            else if (r.status === 409) { okPm++; console.info('ℹ PM از قبل موجود (تکراری رد شد): ' + String(p.title).slice(0, 40)); }
            else console.warn('⚠ PM رد شد (' + r.status + '):', (r.json && r.json.error || '').slice(0, 100));
        }
        console.log('✅ برنامه‌های PM ثبت‌شده:', okPm + '/' + pmPlans.length);
        const sum = await req('GET', '/api/summary');
        if (sum.status === 200) {
            const s = sum.json || {};
            console.log('📊 خلاصه پس از seed → تولید(۳۰روز):', s.production_30d !== undefined ? s.production_30d : '-', '| بندیل:', s.bundle_count !== undefined ? s.bundle_count : '-', JSON.stringify(Object.keys(s).slice(0, 8)));
        }
    }
    console.log('🎉 دمو آماده است — prefix: ' + PREFIX + ' (اجرای مجدد = به‌روزرسانی هم‌شناسه، بدون تکرار)');
})().catch((e) => { console.error('✖ خطا:', e.message); process.exit(1); });
