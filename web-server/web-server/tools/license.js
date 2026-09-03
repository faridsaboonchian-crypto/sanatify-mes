#!/usr/bin/env node
// =====================================================================
//  SAAS-15a — ابزار CLI لایسنس (صفر وابستگی)
//  فعال/غیرفعال‌کردن ماژول‌ها و تنظیم لایسنس بدون ویرایش دستی tenant.json
//
//  مصرف:
//    node tools/license.js --list
//    node tools/license.js --tenant=sanatify --enable=finance,em
//    node tools/license.js --disable=planning,analytics
//    node tools/license.js --only=inventory,finance        (تنها این ماژول‌ها فعال بمانند)
//    node tools/license.js --expires=2027-03-20            (تاریخ میلادی ISO؛ خالی = حذف انقضا)
//    node tools/license.js --name="فولاد ..." --max-users=25 --max-records=200000
//  چند پرچم می‌تواند همزمان بیاید؛ ترتیب اجرا: only → enable → disable → بقیه
// =====================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TENANT_FILE = path.join(ROOT, 'tenant.json');
const TEMPLATE_FILE = path.join(ROOT, 'tenant.json.template');
const MODULES = ['summary', 'analytics', 'production', 'quality', 'inventory', 'maintenance', 'em', 'planning', 'finance'];
const MODULE_FA = {
    summary: 'خلاصه و شاخص‌ها', analytics: 'داشبورد تحلیلی', production: 'تولید (ثبت/ضایعات/توقف/ردیابی/بالانس)',
    quality: 'کیفیت', inventory: 'انبار', maintenance: 'نگهداری و تعمیرات (PM/EM)', em: 'مدیریت انرژی',
    planning: 'برنامه‌ریزی تولید', finance: 'مالی و بهای تمام‌شده'
};

function fail(msg) { console.error('✗ خطا: ' + msg); process.exit(1); }

// ---------- آرگومان‌ها ----------
const args = {};
process.argv.slice(2).forEach((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) fail('آرگومان نامعتبر: ' + a);
    args[m[1].toLowerCase()] = m[2] === undefined ? true : m[2];
});

// ---------- خواندن/ساخت پیکربندی ----------
function loadConfig() {
    if (fs.existsSync(TENANT_FILE)) {
        try { return JSON.parse(fs.readFileSync(TENANT_FILE, 'utf8')); }
        catch (e) { fail('tenant.json موجود ولی نامعتبر است: ' + e.message); }
    }
    if (fs.existsSync(TEMPLATE_FILE)) {
        try { return JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8')); }
        catch (e) { /* قالب خراب → پیش‌فرض */ }
    }
    return { tenant_id: 'sanatify', name: 'صنعتی فای', active_modules: MODULES.slice() };
}

function parseModules(v, label) {
    if (v === true || String(v).trim() === '') fail('پرچم ' + label + ' به فهرست ماژول نیاز دارد. مثال: --' + label + '=finance,em');
    const parts = String(v).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const bad = parts.filter((p) => MODULES.indexOf(p) === -1);
    if (bad.length) fail('ماژول نامعتبر: ' + bad.join(', ') + '\n  ماژول‌های مجاز: ' + MODULES.join(', '));
    return parts;
}

const cfg = loadConfig();
if (!Array.isArray(cfg.active_modules)) cfg.active_modules = MODULES.slice();

// ---------- اعمال ----------
if (args.list && Object.keys(args).length === 1) {
    console.log('━━━ وضعیت لایسنس تنانت ━━━');
    console.log('  شناسه: ' + (cfg.tenant_id || '?') + '   نام: ' + (cfg.name || '?'));
    console.log('  انقضا: ' + (cfg.expires_at ? cfg.expires_at + (Date.parse(cfg.expires_at) < Date.now() ? '  (منقضی!)' : '') : 'بدون محدودیت'));
    console.log('  سقف: کاربران ' + (Number(cfg.max_users) || '∞') + ' | رکوردها ' + (Number(cfg.max_records) || '∞'));
    console.log('  ماژول‌ها:');
    MODULES.forEach((m) => console.log('   ' + (cfg.active_modules.indexOf(m) !== -1 ? '✓' : '✗') + '  ' + m.padEnd(12) + ' ' + MODULE_FA[m]));
    process.exit(0);
}

if (args['tenant-id']) cfg.tenant_id = String(args['tenant-id']);
if (args.tenant) {
    const t = String(args.tenant);
    if (cfg.tenant_id && cfg.tenant_id !== t) console.warn('⚠ tenant_id فعلی «' + cfg.tenant_id + '» است (پرچم --tenant صرفاً اطمینان است)؛ برای تغییر: --tenant-id=' + t);
}
if (args.only) cfg.active_modules = parseModules(args.only, 'only');
if (args.enable) parseModules(args.enable, 'enable').forEach((m) => { if (cfg.active_modules.indexOf(m) === -1) cfg.active_modules.push(m); });
if (args.disable) {
    const dis = parseModules(args.disable, 'disable');
    cfg.active_modules = cfg.active_modules.filter((m) => dis.indexOf(m) === -1);
    if (!cfg.active_modules.length) fail('حداقل یک ماژول باید فعال بماند (قفل کامل سامانه مجاز نیست).');
}
if (args.name) cfg.name = String(args.name);
if (args['max-users'] !== undefined) cfg.max_users = Math.max(0, Number(args['max-users']) || 0);
if (args['max-records'] !== undefined) cfg.max_records = Math.max(0, Number(args['max-records']) || 0);
if (args.expires !== undefined) {
    const e = String(args.expires || '').trim();
    if (e) { const t = Date.parse(e); if (isNaN(t)) fail('تاریخ انقضا نامعتبر است (نمونه: 2027-03-20).'); cfg.expires_at = new Date(t).toISOString(); }
    else cfg.expires_at = '';
}

// ---------- نوشتن اتمیک ----------
const out = JSON.stringify(cfg, null, 2) + '\n';
const tmp = TENANT_FILE + '.tmp';
fs.writeFileSync(tmp, out, 'utf8');
fs.renameSync(tmp, TENANT_FILE);

// ---------- گزارش ----------
console.log('✓ tenant.json ذخیره شد → ' + TENANT_FILE);
console.log('  ماژول‌های فعال (' + cfg.active_modules.length + '/' + MODULES.length + '): ' + cfg.active_modules.join(', '));
const off = MODULES.filter((m) => cfg.active_modules.indexOf(m) === -1);
if (off.length) console.log('  غیرفعال: ' + off.join(', ') + '\n  (تب‌ها در UI پنهان و APIهایشان 403 می‌شود — بدون نیاز به ری‌استارت سرور)');
if (cfg.expires_at && Date.parse(cfg.expires_at) < Date.now()) console.warn('  ⚠ لایسنس منقضی است — همهٔ APIها 403 می‌دهند تا انقضا حذف/تمدید شود.');
