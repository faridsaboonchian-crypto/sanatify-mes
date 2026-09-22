#!/usr/bin/env node
/* =====================================================================
   PURGE-36 — ریست کامل دادهٔ زنده به «صفر واقعی» (بدون هیچ دادهٔ نمایشی)
   ---------------------------------------------------------------------
   هدف: روی VM / نصب تازه، همهٔ داده‌ها به ساختار خالیِ معتبر برگردند —
   داشبورد/جدول‌ها/پیشنهادها خالی یا «پایهٔ مهندسی» می‌شوند (نه نمونه).
   هیچ دادهٔ نمایشی در کد وجود ندارد؛ دموی تجاری فقط با tools/demo-seed.js
   و فقط با فراخوانی صریح کاربر ساخته می‌شود (هیچ فراخوانی خودکاری در
   بوت/UI/اینستالر وجود ندارد و نخواهد داشت).

   مصرف:
     node tools/reset-live.js                    # بکاپ پیش‌فرض + ریست live/audit
     node tools/reset-live.js --no-backup        # بدون بکاپ (خطرناک)
     node tools/reset-live.js --include-users    # وب‌کاربران هم ریست شوند (هشدار!)
     node tools/reset-live.js --demo             # فقط دستور demo-seed چاپ می‌شود (اجرا نمی‌شود)

   قواعد:
     • --backup (پیش‌فرض): live.json + audit.json + زنجیرهٔ .bak/.corrupt به
       backups/pre-reset-<ts>/ منتقل می‌شوند (منتقل = نه حذف).
     • ساختار خالی معتبر با کل فهرست کلیدها ساخته می‌شود (سازگار با سرور).
     • --include-users: web-users.json (و .enc/بکاپ‌ها) هم منتقل و فایل خالی می‌شود —
       بعد از آن اولین راه‌اندازی با --create-admin باید مدیرعامل (CEO) را بسازد.
     • برگشت: خروجی همین ابزار دستور دقیق restore را چاپ می‌کند.
   ===================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ---------- آرگومان‌ها ---------- */
const args = {};
process.argv.slice(2).forEach((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) { console.error('✗ آرگومان نامعتبر: ' + a); process.exit(1); }
    args[m[1].toLowerCase()] = m[2] === undefined ? true : m[2];
});
const DO_BACKUP = !args['no-backup'];
const INCLUDE_USERS = !!args['include-users'];
const SHOW_DEMO = !!args.demo;

/* ---------- ساختار خالی معتبر (عین کلیدهای موردانتظار سرور) ---------- */
const EMPTY_ARRAY_KEYS = [
    'production_logs', 'waste_logs', 'downtime_logs', 'quality_inspections', 'billets', 'furnace_logs', 'rebar_bundles',
    'maintenance_logs', 'pm_plans', 'inventory_items', 'inventory_receipts', 'inventory_issues', 'inventory_transfers', 'inventory_adjustments', 'inventory_reservations', 'inventory_reservation_logs',
    'production_plans', 'power_outages', 'energy_logs',
    'fin_docs', 'fin_periods', 'fin_cost_centers', 'fin_bom',
    'customers', 'suppliers', 'price_list',
    'sales_orders', 'sales_invoices', 'sales_receipts', 'sales_exits',
    'purchase_requests', 'purchase_quotes', 'purchase_orders', 'purchase_receipts', 'purchase_invoices', 'purchase_payments',
    'sensor_events', 'qc_specs_24', 'qc_incoming_24', 'qc_grades_24', 'qc_ncr_24', 'qc_mtc_24'
];
function emptyLive() {
    const o = { generated_at: null };
    EMPTY_ARRAY_KEYS.forEach((k) => { o[k] = []; });
    return o;
}

/* ---------- جمع‌آوری فایل‌های داده/بکاپ برای انتقال ---------- */
function existingOf(base) {
    const out = [];
    [base, base + '.enc'].forEach((p) => { if (fs.existsSync(p)) out.push(p); });
    return out;
}
function debrisPatterns() {
    /* زنجیرهٔ بکاپ/خرابی کنار داده — همه «دادهٔ قدیمی»اند، نه ساختار ضروری */
    return ['live.json.bak', 'live.json.bak.', 'live.json.corrupt-', 'audit.json.bak', 'audit.json.bak.'];
}
function collectDataFiles() {
    const files = [];
    files.push(...existingOf(path.join(ROOT, 'live.json')));
    files.push(...existingOf(path.join(ROOT, 'audit.json')));
    debrisPatterns().forEach((pre) => {
        fs.readdirSync(ROOT).forEach((f) => {
            if (f.indexOf(pre) === 0) files.push(path.join(ROOT, f));
        });
    });
    if (INCLUDE_USERS) {
        files.push(...existingOf(path.join(ROOT, 'web-users.json')));
        fs.readdirSync(ROOT).forEach((f) => {
            if (f.indexOf('web-users.json.bak-') === 0) files.push(path.join(ROOT, f));
        });
    }
    return files;
}

const fa = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(1776 + Number(d)));

/* ---------- اجرا ---------- */
const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupDir = path.join(ROOT, 'backups', 'pre-reset-' + ts);

console.log('════════════════════════════════════════════════');
console.log('  PURGE-36 — ریست دادهٔ زنده به صفر واقعی');
console.log('════════════════════════════════════════════════');

if (INCLUDE_USERS) {
    console.log('⚠ هشدار: --include-users فعال است — همهٔ وب‌کاربران حذف می‌شوند.');
    console.log('  بعد از ریست، اولین راه‌اندازی باید با --create-admin=نام‌کاربری:رمز مدیرعامل (CEO) (vendor) را بسازد.');
}

const files = collectDataFiles();
if (!files.length) console.log('• فایل دادهٔ موجودی یافت نشد — از قبل خالی است.');

console.log('ℹ اگر سرویس در حال اجراست، اول آن را متوقف کنید — سرویس زنده ممکن است همزمان فایل‌ها را بازنویسی/بکاپ کند.');

if (DO_BACKUP && files.length) {
    fs.mkdirSync(backupDir, { recursive: true });
    let moved = 0;
    files.forEach((f) => {
        try {
            if (!fs.existsSync(f)) return; /* همزمان با سرویس زنده ناپدید شده — نادیده */
            fs.renameSync(f, path.join(backupDir, path.basename(f))); /* منتقل — نه حذف */
            moved++;
        } catch (e) { console.warn('  ⚠ انتقال ناموفق: ' + path.basename(f) + ' (' + ((e && e.message) || e) + ')'); }
    });
    console.log('✓ بکاپ: ' + fa(moved) + ' فایل به backups/pre-reset-' + ts + ' منتقل شد (حذف نشد).');
} else if (!DO_BACKUP && files.length) {
    files.forEach((f) => { try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (e) { /* noop */ } });
    console.log('⚠ --no-backup: فایل‌های داده/بکاپ بدون نسخهٔ پشتیبان حذف شدند.');
}

/* ---------- ساخت ساختار خالی معتبر ---------- */
fs.writeFileSync(path.join(ROOT, 'live.json'), JSON.stringify(emptyLive(), null, 2) + String.fromCharCode(10), 'utf8');
if (!fs.existsSync(path.join(ROOT, 'audit.json'))) fs.writeFileSync(path.join(ROOT, 'audit.json'), '[]' + String.fromCharCode(10), 'utf8');
if (INCLUDE_USERS) {
    /* web-users.json منتقل شده — خالیِ معتبر می‌سازیم (بوت‌استرپ مدیرعامل (CEO) با --create-admin) */
    fs.writeFileSync(path.join(ROOT, 'web-users.json'), '[]' + String.fromCharCode(10), 'utf8');
    try { fs.chmodSync(path.join(ROOT, 'web-users.json'), 0o600); } catch (e) { /* ویندوز: غیرمرگبار */ }
}
console.log('✓ live.json خالی معتبر ساخته شد (' + fa(EMPTY_ARRAY_KEYS.length) + ' کلید آرایه‌ای + generated_at).');
console.log('✓ audit.json خالی شد.');

/* ---------- گزینهٔ demo: فقط راهنما — هیچ اجرای خودکاری (خط قرمز PURGE-36) ---------- */
if (SHOW_DEMO) {
    console.log('');
    console.log('ℹ --demo: دادهٔ نمایشی هرگز خودکار ساخته نمی‌شود. برای دموی تجاری، صریحاً اجرا کنید:');
    console.log('    node tools/demo-seed.js --url=http://127.0.0.1:3001 --user=<ادمین> --pass=<رمز> --days=30 --bundles=50 --stops=10 --pms=5');
    console.log('  (سرور باید در حال اجرا باشد؛ demo_mode در tenant.json هم باید فعال شده باشد.)');
}

console.log('');
console.log('برگشت داده‌ها' + (DO_BACKUP && files.length ? ' (در صورت نیاز):' : ':'));
console.log('    node tools/restore-live.js --from=' + ts);
console.log('');
console.log('✓ ریست کامل شد — داشبورد/جدول‌ها/پیشنهادها اکنون خالی یا «پایهٔ مهندسی» هستند (بدون هیچ دادهٔ نمونه).');
