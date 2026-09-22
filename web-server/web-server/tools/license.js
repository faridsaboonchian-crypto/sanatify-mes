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
//    node tools/license.js --sign                           (FIX-LIC-27: امضای کامل — HMAC + Ed25519 با هم؛ بدون SANATIFY_LIC_ED_PRIV خطای صریح)
//                                                           (کلید HMAC از env یا license.key؛ اگر license.key کنار server.js نبود، با کلید env ساخته می‌شود — یک‌بار — تا بوت سرد بدون env هم معتبر بماند)
//    node tools/license.js --gen-ed-keys [--out=lic-ed-keys.json]  (تولید جفت‌کلید Ed25519 — خصوصی فقط نزد سازنده)
//    node tools/license.js --sign-ed                        (امضای Ed25519 → license_sig2 — کلید از env: SANATIFY_LIC_ED_PRIV پایه64-PKCS8)
//    node tools/license.js --verify                         (فقط بررسی امضا — چیزی نمی‌نویسد)
//    node tools/license.js --hwkey=HW-XXXX-XXXX-XXXX        (SEC-BIND-19f: قفل سخت‌افزاری — فقط روی ماشین دارای این HWKEY بالا می‌آید؛ خالی = حذف قفل)
//    node tools/license.js --hide-tabs=warehouse,finance,…   (GO-LIVE-32: گیت دامنهٔ راه‌اندازی — این تب‌ها در UI مشتری اصلاً ساخته نمی‌شوند؛ فقط UI، APIها دست‌نخورده؛ خالی = حذف گیت)
//    node tools/license.js --demo-on | --demo-off            (FIX-UI-19d: حالت دمو — بستن مالی/فروش/خرید در UI و API برای دموی تجاری)
//    (HWKEY را با tools/generate-hwkey.js روی ماشین مشتری می‌گیرید؛ حذف/تغییر hwkey = امضای نامعتبر = لایسنس پایه)
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

// ===== SEC-LIC-24 (begin): امضای HMAC-SHA256 لایسنس — منبع کلید: env → license.key کنار server.js (FIX-LIC-27) =====
// canonical باید عیناً با licCanonical24 در server.js یکی باشد (۵ فیلد بخش لایسنس — SEC-BIND-19f: +hwkey)
const LIC_KEY_FILE_27 = path.join(ROOT, 'license.key');
function licResolveKey27() {
    const env27 = String(process.env.SANATIFY_LIC_KEY || '').trim();
    if (env27) return { key: env27, source: 'env:SANATIFY_LIC_KEY' };
    try {
        const raw27 = fs.readFileSync(LIC_KEY_FILE_27, 'utf8').trim();
        if (raw27) return { key: raw27, source: 'license.key' };
    } catch (e27) { /* فایل نیست */ }
    return null;
}
function licKey24() {
    const r27 = licResolveKey27();
    if (!r27) fail('هیچ منبع کلید HMAC موجود نیست — نه env: SANATIFY_LIC_KEY و نه فایل license.key کنار server.js.\n  نمونه:  SANATIFY_LIC_KEY="کلید-مخفی-شما" node tools/license.js --sign\n  (FIX-LIC-27: پرچم --sign خودش license.key را کنار server.js می‌سازد تا بوت سرد بدون env هم معتبر بماند)');
    return r27;
}
function licSign24(cfg) { return require('crypto').createHmac('sha256', licKey24().key).update(licCanonical24(cfg)).digest('hex'); }
function licVerify24(cfg) {
    const sig = String((cfg && cfg.license_sig) || '').toLowerCase();
    const r27 = licResolveKey27();
    if (!r27 || !/^[0-9a-f]{64}$/.test(sig)) return false;
    const a = Buffer.from(sig), b = Buffer.from(require('crypto').createHmac('sha256', r27.key).update(licCanonical24(cfg)).digest('hex'));
    return a.length === b.length && require('crypto').timingSafeEqual(a, b);
}
/* FIX-LIC-27: ساخت license.key از کلید env — فقط یک‌بار (موجود = دست نمی‌زنیم)؛ ACL ویندوز: فقط Administrators/System */
function ensureKeyFile27() {
    if (fs.existsSync(LIC_KEY_FILE_27)) return false;
    const env27 = String(process.env.SANATIFY_LIC_KEY || '').trim();
    if (!env27) return false; /* منبع کلید خود فایل بود — چیزی برای ساختن نیست */
    try {
        fs.writeFileSync(LIC_KEY_FILE_27, env27 + String.fromCharCode(10), { mode: 0o600 });
        if (process.platform !== 'win32') { try { fs.chmodSync(LIC_KEY_FILE_27, 0o600); } catch (e27) { /* posix */ } }
        else {
            try { require('child_process').execSync('icacls "' + LIC_KEY_FILE_27 + '" /inheritance:r /grant:r "Administrators:F" /grant:r "SYSTEM:F"', { stdio: ['ignore', 'ignore', 'ignore'], timeout: 10000, windowsHide: true }); }
            catch (e27) { console.warn('  ⚠ تنظیم ACL ویندوز ناموفق بود (به‌عنوان Administrator اجرا کنید) — فایل ساخته شد ولی دسترسی آن محدود نشد.'); }
        }
        console.log('  FIX-LIC-27: ✓ license.key کنار server.js ساخته شد' + (process.platform === 'win32' ? ' (ACL: Administrators/System)' : ' (دسترسی ۰۶۰۰)') + ' — بوت سرد بدون env هم معتبر می‌ماند؛ هنگام استقرار کنار exe کپی کنید.');
        return true;
    } catch (e27) { console.warn('  ⚠ ساخت license.key ناموفق بود: ' + ((e27 && e27.message) || e27) + ' — امضا انجام شد ولی بوت سرد به env متکی است.'); return false; }
}
function licCanonical24(cfg) {
    return JSON.stringify({
        active_modules: (Array.isArray(cfg.active_modules) ? cfg.active_modules.slice() : []).sort(),
        max_users: Number(cfg.max_users) || 0,
        max_records: Number(cfg.max_records) || 0,
        expires_at: String(cfg.expires_at || ''),
        hwkey: normHw19f(cfg.hwkey), /* SEC-BIND-19f: قفل سخت‌افزاری داخل امضا */
    });
}
/* SEC-BIND-19f: نرمال‌سازی HWKEY — عیناً با hwNorm19f در server.js یکی است */
function normHw19f(v) { return String(v || '').trim().toUpperCase().replace(/[\s"']/g, ''); }
function hwFormatOk19f(v) { return !v || /^HW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(v) || v === 'HW-UNKNOWN'; }
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
/* HARDEN-18J (begin): جفت‌کلید Ed25519 + امضا/تأیید — کلید خصوصی هرگز در ریپو/سرور نیست
   FIX-LIC-27: کلید عمومی سرور embed شده — env فقط برای چرخش کلید بر آن مقدم است (عیناً با LIC_ED_PUB_EMBEDDED_27 در server.js یکی است) */
const LIC_ED_PUB_EMBEDDED_27 = 'MCowBQYDK2VwAyEAGAgTWhsg6AGqDDMf25ZHQfQZ8WiaiVTHZP5jdDzxKpY=';
function edPriv18J() {
    const v = String(process.env.SANATIFY_LIC_ED_PRIV || '').trim();
    if (!v) fail('متغیر محیطی SANATIFY_LIC_ED_PRIV تنظیم نیست (PKCS8 پایه64 — خروجی --gen-ed-keys).\n  نمونه:  SANATIFY_LIC_ED_PRIV="..." node tools/license.js --sign-ed');
    try { return require('crypto').createPrivateKey({ key: Buffer.from(v, 'base64'), format: 'der', type: 'pkcs8' }); }
    catch (e) { fail('کلید خصوصی Ed25519 نامعتبر است: ' + e.message); }
}
function edPubResolver27() {
    const envPub = String(process.env.SANATIFY_LIC_ED_PUB || '').trim();
    try { return { pub: require('crypto').createPublicKey({ key: Buffer.from(envPub || LIC_ED_PUB_EMBEDDED_27, 'base64'), format: 'der', type: 'spki' }), src: envPub ? 'env:SANATIFY_LIC_ED_PUB' : 'embedded سرور' }; }
    catch (e) { return null; }
}
if (args['gen-ed-keys']) {
    const { generateKeyPairSync } = require('crypto');
    const kp = generateKeyPairSync('ed25519');
    const privB64 = kp.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    const pubB64 = kp.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const outF = args.out ? String(args.out) : 'lic-ed-keys.json';
    fs.writeFileSync(outF, JSON.stringify({ private_pkcs8_b64: privB64, public_spki_b64: pubB64, note: 'فایل خصوصی — فقط نزد سازنده؛ هرگز commit/ارسال نشود' }, null, 2) + String.fromCharCode(10), { mode: 0o600 });
    console.log('✓ جفت‌کلید Ed25519 ساخته شد → ' + outF + ' (دسترسی ۰۶۰۰)');
    console.log('  کلید خصوصی (env سرورِ سازنده هنگام امضا):');
    console.log('    SANATIFY_LIC_ED_PRIV="' + privB64 + '"');
    console.log('  کلید عمومی (env سرور استقرار):');
    console.log('    SANATIFY_LIC_ED_PUB="' + pubB64 + '"');
    process.exit(0);
}
/* HARDEN-18J (end) */
if (args.verify) {
    /* FIX-LIC-27: گزارش هم‌تراز با سرور — مسیر اصلی Ed25519 اول، بعد HMAC با نام منبع کلید */
    const sig2 = String((cfg && cfg.license_sig2) || '').trim();
    const pubR = edPubResolver27();
    let edOk = null;
    if (sig2 && pubR) edOk = require('crypto').verify(null, Buffer.from(licCanonical24(cfg)), pubR.pub, Buffer.from(sig2, 'base64'));
    const edLine = '  Ed25519: ' + (sig2 ? (edOk === true ? '✓ معتبر' : '✗ نامعتبر') : 'غایب') + (pubR ? ' — کلید عمومی: ' + pubR.src : ' — کلید عمومی در دسترس نیست (env نامعتبر؟)');
    const r27 = licResolveKey27();
    let hmacOk = null;
    if (r27) {
        try {
            const sig = String((cfg && cfg.license_sig) || '').toLowerCase();
            if (!/^[0-9a-f]{64}$/.test(sig)) hmacOk = false;
            else { const a = Buffer.from(sig), b = Buffer.from(require('crypto').createHmac('sha256', r27.key).update(licCanonical24(cfg)).digest('hex')); hmacOk = a.length === b.length && require('crypto').timingSafeEqual(a, b); }
        } catch (e) { hmacOk = false; }
    }
    const hmacLine = r27 ? ('  HMAC: ' + (hmacOk ? '✓ معتبر' : '✗ نامعتبر/غایب') + ' — منبع کلید: ' + r27.source) : '  HMAC: منبع کلید موجود نیست (نه env و نه license.key) — سرور با کلید پیش‌فرض verify می‌کند ⇒ نامعتبر';
    if (edOk === true) {
        console.log('✓ لایسنس معتبر است — مسیر اصلی Ed25519 (license_sig2) تأیید شد؛ HMAC لازم نیست.');
        console.log(edLine); console.log(hmacLine);
        process.exit(0);
    }
    if (hmacOk === true) {
        console.log('✓ لایسنس معتبر است — امضای HMAC تأیید شد (license_sig2 معتبری موجود نیست).');
        console.log(edLine); console.log(hmacLine);
        process.exit(0);
    }
    console.error('✗ لایسنس نامعتبر/غایب است — سرور هنگام خواندن به لایسنس پایه (summary+production+inventory) برمی‌گردد.');
    console.error(edLine); console.error(hmacLine);
    console.error('  تشخیص کامل با علت/دستور اصلاح:  node tools/license-doctor.js');
    console.error('  برای امضا:  SANATIFY_LIC_KEY="..." SANATIFY_LIC_ED_PRIV="..." node tools/license.js --sign');
    process.exit(1);
}

// ---------- اعمال ----------
if (args.list && Object.keys(args).length === 1) {
    console.log('━━━ وضعیت لایسنس تنانت ━━━');
    console.log('  شناسه: ' + (cfg.tenant_id || '?') + '   نام: ' + (cfg.name || '?'));
    console.log('  انقضا: ' + (cfg.expires_at ? cfg.expires_at + (Date.parse(cfg.expires_at) < Date.now() ? '  (منقضی!)' : '') : 'بدون محدودیت'));
    console.log('  سقف: کاربران ' + (Number(cfg.max_users) || '∞') + ' | رکوردها ' + (Number(cfg.max_records) || '∞'));
    console.log('  قفل سخت‌افزاری: ' + (normHw19f(cfg.hwkey) ? normHw19f(cfg.hwkey) + '  (فقط همین ماشین)' : 'بدون قفل — روی هر ماشینی بالا می‌آید'));
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
/* ===== SEC-BIND-19f (begin): قفل سخت‌افزاری — hwkey داخل canonical ⇒ حذف/تغییرش امضا را نامعتبر می‌کند ===== */
if (args.hwkey !== undefined) {
    const hw19f = normHw19f(args.hwkey);
    if (hw19f && !hwFormatOk19f(hw19f)) fail('فرمت HWKEY نامعتبر است: ' + hw19f + '\n  نمونهٔ درست: HW-3F2A-91BC-04DE  (از tools/generate-hwkey.js روی ماشین مشتری بگیرید)\n  برای حذف قفل: --hwkey= (خالی)');
    cfg.hwkey = hw19f; /* خالی ⇒ حذف قفل */
}
/* ===== SEC-BIND-19f (end) ===== */
/* ===== GO-LIVE-32 (begin): گیت دامنهٔ راه‌اندازی — hidden_tabs (فقط UI) =====
   • بیرون licCanonical24 است ⇒ تغییرش امضای لایسنس را نمی‌شکند (ولی --sign همیشه امضای تازه می‌زند)
   • شناسه‌های مجاز عیناً از #nav button[data-tab] در public/index.html استخراج شده‌اند؛ «org» پنل سازمان است و هرگز مخفی نمی‌شود */
const TABS_LIC_32 = ['summary', 'analytics', 'production', 'waste', 'downtime', 'quality', 'genealogy', 'balance', 'warehouse', 'maintenance', 'planning', 'finance', 'sales', 'purchase'];
if (args['hide-tabs'] !== undefined) {
    const raw32 = String(args['hide-tabs'] || '').trim();
    if (!raw32) cfg.hidden_tabs = []; /* خالی = حذف گیت */
    else {
        const parts32 = raw32.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        const bad32 = parts32.filter((p) => TABS_LIC_32.indexOf(p) === -1);
        if (bad32.length) fail('تب نامعتبر: ' + bad32.join(', ') + '\n  تب‌های مجاز: ' + TABS_LIC_32.join(', ') + '\n  (تب «org» پنل سازمان است و هرگز مخفی نمی‌شود)');
        cfg.hidden_tabs = parts32.filter((p, i) => parts32.indexOf(p) === i); /* حذف تکراری — ترتیب ورودی حفظ می‌شود */
    }
}
if (args['demo-on']) cfg.demo_mode = true;
if (args['demo-off']) cfg.demo_mode = false;
/* ===== GO-LIVE-32 (end) ===== */
if (args.expires !== undefined) {
    const e = String(args.expires || '').trim();
    if (e) { const t = Date.parse(e); if (isNaN(t)) fail('تاریخ انقضا نامعتبر است (نمونه: 2027-03-20).'); cfg.expires_at = new Date(t).toISOString(); }
    else cfg.expires_at = '';
}

/* ===== SEC-LIC-24 (begin): --sign — FIX-LIC-27: امضای کامل (HMAC + Ed25519 با هم) =====
   • Ed25519 مسیر اصلی است — --sign بدون SANATIFY_LIC_ED_PRIV خطای صریح می‌دهد؛ «امضای نیمه‌کارهٔ بی‌صدا» (فقط HMAC) دیگر ساخته نمی‌شود
   • کلید HMAC: env → license.key؛ اگر فایل نبود با کلید env ساخته می‌شود (یک‌بار) تا بوت سرد بدون env هم معتبر بماند */
if (args.sign) {
    if (!String(process.env.SANATIFY_LIC_ED_PRIV || '').trim()) {
        fail('FIX-LIC-27: --sign بدون SANATIFY_LIC_ED_PRIV انجام نمی‌شود — Ed25519 مسیر اصلی است و امضای نیمه‌کارهٔ بی‌صدا ممنوع است.\n  جفت‌کلید ندارید؟  node tools/license.js --gen-ed-keys --out=lic-ed-keys.json\n  سپس:  SANATIFY_LIC_KEY="..." SANATIFY_LIC_ED_PRIV="..." node tools/license.js --sign\n  (license.key کنار server.js خودکار ساخته می‌شود؛ فایل خصوصی Ed هرگز به مشتری داده نمی‌شود)');
    }
    licKey24(); /* زودتر fail — پیش از هر نوشتنی */
    cfg.active_modules = (Array.isArray(cfg.active_modules) ? cfg.active_modules : []).filter((m) => MODULES.indexOf(m) !== -1);
    if (!cfg.active_modules.length) cfg.active_modules = MODULES.slice();
    cfg.license_sig = licSign24(cfg);
    cfg.license_sig2 = require('crypto').sign(null, Buffer.from(licCanonical24(cfg)), edPriv18J()).toString('base64');
    ensureKeyFile27();
}
if (args['sign-ed']) { /* HARDEN-18J: فقط امضای Ed25519 — وقتی امضای HMAC فعلی می‌خواهد دست‌نخورده بماند */
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
if (Array.isArray(cfg.hidden_tabs) && cfg.hidden_tabs.length) console.log('  گیت دامنه (GO-LIVE-32): تب‌های مخفی UI (' + cfg.hidden_tabs.length + '): ' + cfg.hidden_tabs.join(', ') + '\n  (فقط UI — کل بخش شامل اکسل/چاپ از DOM حذف می‌شود؛ APIها دست‌نخورده)');
if (cfg.demo_mode === true) console.log('  حالت دمو: فعال (FIX-UI-19d — مالی/فروش/خرید در UI پنهان و APIهایشان 403)');
if (cfg.expires_at && Date.parse(cfg.expires_at) < Date.now()) console.warn('  ⚠ لایسنس منقضی است — همهٔ APIها 403 می‌دهند تا انقضا حذف/تمدید شود.');
/* SEC-LIC-24: وضعیت امضا در گزارش */
if (args['sign-ed']) console.log('  امضا: ✓ license_sig2 ثبت شد (Ed25519 — کلید خصوصی سمت سازنده).');
if (args.sign) console.log('  امضا: ✓ license_sig (HMAC-SHA256) + license_sig2 (Ed25519 — مسیر اصلی) ثبت شد.');
else if (!cfg.license_sig) console.warn('  ⚠ امضا ندارد (license_sig غایب) — سرور به لایسنس پایه برمی‌گردد. امضا: SANATIFY_LIC_KEY="..." SANATIFY_LIC_ED_PRIV="..." node tools/license.js --sign');
else if (licResolveKey27() && !licVerify24(cfg)) console.warn('  ⚠ امضای موجود با منبع کلید فعلی تأیید نمی‌شود (کهنه/کلید دیگر) — دوباره --sign بزنید.');
