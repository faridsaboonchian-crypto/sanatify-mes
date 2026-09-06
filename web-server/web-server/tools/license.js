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
//    node tools/license.js --sign                           (امضای HMAC فایل — کلید از env: SANATIFY_LIC_KEY)
//    node tools/license.js --gen-ed-keys [--out=lic-ed-keys.json]  (تولید جفت‌کلید Ed25519 — خصوصی فقط نزد فروشنده)
//    node tools/license.js --sign-ed                        (امضای Ed25519 → license_sig2 — کلید از env: SANATIFY_LIC_ED_PRIV پایه64-PKCS8)
//    node tools/license.js --verify                         (فقط بررسی امضا — چیزی نمی‌نویسد)
//  چند پرچم می‌تواند همزمان بیاید؛ ترتیب اجرا: only → enable → disable → بقیه
//  ⚠ SEC-LIC-24: tenant.json بدون امضای معتبر ⇒ سرور به لایسنس پایه (summary+production+inventory) برمی‌گردد
// =====================================================================
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TENANT_FILE = path.join(ROOT, 'tenant.json');
const TEMPLATE_FILE = path.join(ROOT, 'tenant.json.template');
const MODULES = ['summary', 'analytics', 'production', 'quality', 'inventory', 'maintenance', 'em', 'planning', 'finance', 'sales', 'purchase']; /* SEC-LIC-24: +فروش/خرید — هم‌تراز MODULES_15A سرور */
const MODULE_FA = {
    summary: 'خلاصه و شاخص‌ها', analytics: 'داشبورد تحلیلی', production: 'تولید (ثبت/ضایعات/توقف/ردیابی/بالانس)',
    quality: 'کیفیت', inventory: 'انبار', maintenance: 'نگهداری و تعمیرات (PM/EM)', em: 'مدیریت انرژی',
    planning: 'برنامه‌ریزی تولید', finance: 'مالی و بهای تمام‌شده',
    sales: 'فروش', purchase: 'خرید' /* SEC-LIC-24 */
};

function fail(msg) { console.error('✗ خطا: ' + msg); process.exit(1); }

// ===== SEC-LIC-24 (begin): امضای HMAC-SHA256 لایسنس — کلید مخفی فقط از env: SANATIFY_LIC_KEY =====
// canonical باید عیناً با licCanonical24 در server.js یکی باشد (۴ فیلد بخش لایسنس)
function licCanonical24(cfg) {
    return JSON.stringify({
        active_modules: (Array.isArray(cfg.active_modules) ? cfg.active_modules.slice() : []).sort(),
        max_users: Number(cfg.max_users) || 0,
        max_records: Number(cfg.max_records) || 0,
        expires_at: String(cfg.expires_at || ''),
    });
}
function licKey24() {
    const k = process.env.SANATIFY_LIC_KEY;
    if (!k) fail('متغیر محیطی SANATIFY_LIC_KEY تنظیم نیست — کلید مخفی هرگز در ریپو/کد ذخیره نمی‌شود.\n  نمونه:  SANATIFY_LIC_KEY="کلید-مخفی-شما" node tools/license.js --sign');
    return String(k);
}
function licSign24(cfg) { return require('crypto').createHmac('sha256', licKey24()).update(licCanonical24(cfg)).digest('hex'); }
function licVerify24(cfg) {
    const sig = String((cfg && cfg.license_sig) || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    const a = Buffer.from(sig), b = Buffer.from(licSign24(cfg));
    return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
// ===== SEC-LIC-24 (end) =====

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

/* SEC-LIC-24: --verify — بررسی امضای فایل موجود بدون هیچ نوشتنی */
/* HARDEN-18J (begin): جفت‌کلید Ed25519 + امضا/تأیید — کلید خصوصی هرگز در ریپو/سرور نیست */
function edPriv18J() {
    const v = String(process.env.SANATIFY_LIC_ED_PRIV || '').trim();
    if (!v) fail('متغیر محیطی SANATIFY_LIC_ED_PRIV تنظیم نیست (PKCS8 پایه64 — خروجی --gen-ed-keys).\n  نمونه:  SANATIFY_LIC_ED_PRIV="..." node tools/license.js --sign-ed');
    try { return require('crypto').createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' }); }
    catch (e) { fail('کلید خصوصی Ed25519 نامعتبر است: ' + e.message); }
}
function edPubFromFile18J() {
    const v = String(process.env.SANATIFY_LIC_ED_PUB || '').trim();
    if (!v) return null;
    try { return require('crypto').createPublicKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'spki' }); }
    catch (e) { fail('کلید عمومی Ed25519 (SANATIFY_LIC_ED_PUB) نامعتبر است: ' + e.message); }
}
if (args['gen-ed-keys']) {
    const { generateKeyPairSync } = require('crypto');
    const kp = generateKeyPairSync('ed25519');
    const privB64 = kp.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const pubB64 = kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const outF = args.out ? String(args.out) : 'lic-ed-keys.json';
    fs.writeFileSync(outF, JSON.stringify({ private_pkcs8_b64: privB64, public_spki_b64: pubB64, note: 'فایل خصوصی — فقط نزد فروشنده؛ هرگز commit/ارسال نشود' }, null, 2) + String.fromCharCode(10), { mode: 0o600 });
    console.log('✓ جفت‌کلید Ed25519 ساخته شد → ' + outF + ' (دسترسی ۰۶۰۰)');
    console.log('  کلید خصوصی (env سرورِ فروشنده هنگام امضا):');
    console.log('    SANATIFY_LIC_ED_PRIV="' + privB64 + '"');
    console.log('  کلید عمومی (env سرور استقرار):');
    console.log('    SANATIFY_LIC_ED_PUB="' + pubB64 + '"');
    process.exit(0);
}
/* HARDEN-18J (end) */
if (args.verify) {
    const okV = licVerify24(cfg);
    const pub18j = edPubFromFile18J();
    const sig2 = String((cfg && cfg.license_sig2) || '').trim();
    let edLine = '  Ed25519: license_sig2 ' + (sig2 ? 'موجود' : 'غایب') + (sig2 && !pub18j ? ' — کلید عمومی (SANATIFY_LIC_ED_PUB) تنظیم نیست؛ تأیید ممکن نیست' : '');
    if (sig2 && pub18j) {
        const ok2 = require('crypto').verify(null, Buffer.from(licCanonical24(cfg)), pub18j, Buffer.from(sig2, 'base64'));
        edLine += ' — تأیید: ' + (ok2 ? '✓ معتبر' : '✗ نامعتبر');
    }
    if (okV) { console.log('✓ امضای HMAC لایسنس معتبر است (license_sig تطبیق دارد).'); console.log(edLine); process.exit(0); }
    console.error('✗ امضای لایسنس نامعتبر/غایب است — سرور هنگام خواندن به لایسنس پایه (summary+production+inventory) برمی‌گردد.');
    console.error(edLine);
    console.error('  برای امضا:  SANATIFY_LIC_KEY="..." node tools/license.js --sign   |   Ed25519: SANATIFY_LIC_ED_PRIV="..." node tools/license.js --sign-ed');
    process.exit(1);
}

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

/* ===== SEC-LIC-24 (begin): --sign — امضا با کلید env (نرمال‌سازی عین سرور: فیلتر ماژول + خالی ⇒ همه) ===== */
if (args.sign) {
    cfg.active_modules = (Array.isArray(cfg.active_modules) ? cfg.active_modules : []).filter((m) => MODULES.indexOf(m) !== -1);
    if (!cfg.active_modules.length) cfg.active_modules = MODULES.slice();
    cfg.license_sig = licSign24(cfg);
}
if (args['sign-ed']) { /* HARDEN-18J: امضای Ed25519 روی همان canonical — کنار HMAC می‌ماند (مهاجرت تدریجی) */
    cfg.active_modules = (Array.isArray(cfg.active_modules) ? cfg.active_modules : []).filter((m) => MODULES.indexOf(m) !== -1);
    if (!cfg.active_modules.length) cfg.active_modules = MODULES.slice();
    cfg.license_sig2 = require('crypto').sign(null, Buffer.from(licCanonical24(cfg)), edPriv18J()).toString('base64');
}
// ===== SEC-LIC-24 (end) =====

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
/* SEC-LIC-24: وضعیت امضا در گزارش */
if (args['sign-ed']) console.log('  امضا: ✓ license_sig2 ثبت شد (Ed25519 — کلید خصوصی سمت فروشنده).');
if (args.sign) console.log('  امضا: ✓ license_sig ثبت شد (HMAC-SHA256).');
else if (!cfg.license_sig) console.warn('  ⚠ امضا ندارد (license_sig غایب) — سرور به لایسنس پایه برمی‌گردد. امضا: SANATIFY_LIC_KEY="..." node tools/license.js --sign');
else if (process.env.SANATIFY_LIC_KEY && !licVerify24(cfg)) console.warn('  ⚠ امضای موجود با کلید فعلی تأیید نمی‌شود (کهنه/کلید دیگر) — دوباره --sign بزنید.');
