#!/usr/bin/env node
// =====================================================================
// FIX-LIC-27 — license-doctor: تشخیص گام‌به‌گام لایسنس (صفر وابستگی)
//
// چرا: بنر «لایسنس نامعتبر» بعد از بوت سرد دو بار در استقرار واقعی تکرار شد —
// کلید فقط در env پوستهٔ دستی بود و بوت خودکار (Startup→wscript→bat / سرویس) env ندارد؛
// سرور با کلید پیش‌فرض verify می‌کرد. این ابزار همان زنجیرهٔ تأیید سرور را با همان
// ترتیب اجرا می‌کند، علت دقیق را چاپ می‌کند و دستور اصلاح می‌دهد.
//
// مصرف:
//   node tools/license-doctor.js                              (پوشهٔ استقرار = والد tools/ — کنار server.js)
//   node tools/license-doctor.js --dir="C:\Program Files\SanatifyMES"
//
// ترتیب چک (عین سرور): tenant موجود؟ → hwkey match؟ → انقضا؟ →
// امضای Ed25519 (مسیر اصلی — کلید عمومی embedded سرور)؟ → امضای HMAC (با کدام منبع کلید؟)
//
// کدهای خروج (متمایز):
//   ۰  سالم — لایسنس معتبر
//  ۱۰  tenant.json موجود نیست / JSON نامعتبر
//  ۱۱  قفل سخت‌افزاری: hwkey لایسنس ≠ این ماشین (بوت سرور exit 1 می‌شود — SEC-BIND-19f)
//  ۱۲  لایسنس منقضی شده
//  ۱۳  امضای Ed25519 (license_sig2) موجود ولی نامعتبر
//  ۱۴  امضای HMAC (license_sig) با منبع کلید موجود تأیید نمی‌شود
//  ۱۵  هیچ منبع کلید HMAC موجود نیست (نه env و نه license.key) — تلهٔ بوت سرد
//  ۱۶  امضای فروشنده اصلاً موجود نیست (بدون امضا / فقط کلید پیش‌فرض)
//
// ⚠ الگوریتم‌های canonical/HWKEY/کلید پیش‌فرض عیناً با server.js یکی است — هر تغییری
//   باید هم‌زمان در server.js و tools/license.js و همین فایل اعمال شود.
// =====================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* عیناً با LIC_ED_PUB_EMBEDDED_27 در server.js و tools/license.js یکی است — کلید عمومی راز نیست */
const LIC_ED_PUB_EMBEDDED_27 = 'MCowBQYDK2VwAyEAGAgTWhsg6AGqDDMf25ZHQfQZ8WiaiVTHZP5jdDzxKpY=';
/* عیناً با LIC_DEFAULT_KEY_27 در server.js — سقوط نهایی که امضای واقعی فروشنده با آن ساخته نمی‌شود */
const LIC_DEFAULT_KEY_27 = 'Sanatify-Lic-Verify::v1::1405';

// ---------- آرگومان ----------
const args = {};
process.argv.slice(2).forEach((a) => {
    const m = a.match(/^--([a-z-]+)(?:=(.*))?$/i);
    if (!m) { console.error('آرگومان نامعتبر: ' + a); process.exit(2); }
    args[m[1].toLowerCase()] = m[2] === undefined ? true : m[2];
});
const DIR27 = path.resolve(String(args.dir || path.join(__dirname, '..')));
const TENANT_FILE = path.join(DIR27, 'tenant.json');
const KEY_FILE = path.join(DIR27, 'license.key');

function finish(code, cause, fix) {
    console.log('────────────────────────────────────────────');
    if (code === 0) console.log('نتیجه: معتبر ✓');
    else {
        console.log('نتیجه: نامعتبر ✗  (کد خروج: ' + code + ')');
        console.log('علت: ' + cause);
        console.log('دستور اصلاح: ' + fix);
    }
    process.exit(code);
}

// ---------- HWKEY — عیناً با SEC-BIND-19f در server.js / tools/generate-hwkey.js ----------
function hwNorm19f(v) { return String(v || '').trim().toUpperCase().replace(/[\s"']/g, ''); }
function hwFactors19f() {
    let machineId = '';
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const o19f = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
            try {
                const m19f = String(execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', o19f)).match(/REG_SZ\s+([^\r\n\s]+)/);
                machineId = m19f ? m19f[1] : '';
            } catch (e19f) { machineId = ''; }
            if (!machineId) { try { machineId = String(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', o19f)).trim(); } catch (e19f) { machineId = ''; } }
            if (!machineId) { try { const lines19f = String(execSync('wmic csproduct get uuid', o19f)).split(/\r?\n/).filter((l) => l.trim() && l.indexOf('UUID') === -1); machineId = (lines19f[0] || '').trim(); } catch (e19f) { machineId = ''; } }
        } else if (process.platform === 'linux') {
            try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e19f) { machineId = ''; }
            if (!machineId) { try { machineId = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim(); } catch (e19f) { machineId = ''; } }
        } else if (process.platform === 'darwin') {
            try {
                const { execSync } = require('child_process');
                const m19f = String(execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
                machineId = m19f ? m19f[1] : '';
            } catch (e19f) { machineId = ''; }
        }
    } catch (e19f) { machineId = ''; }
    let mac19f = '';
    try {
        const os19f = require('os');
        const ifs19f = os19f.networkInterfaces();
        const names19f = Object.keys(ifs19f);
        for (let i = 0; i < names19f.length && !mac19f; i++) {
            const arr19f = ifs19f[names19f[i]] || [];
            for (let j = 0; j < arr19f.length; j++) {
                const it19f = arr19f[j];
                if (it19f && !it19f.internal && it19f.mac && it19f.mac !== '00:00:00:00:00:00') { mac19f = it19f.mac; break; }
            }
        }
    } catch (e19f) { mac19f = ''; }
    const os19c = require('os');
    return {
        machine_id: machineId || '', hostname: os19c.hostname() || '', platform: process.platform,
        cpu_model: (os19c.cpus()[0] && os19c.cpus()[0].model) || '', cpu_count: os19c.cpus().length,
        mem_total: os19c.totalmem(), mac: mac19f,
    };
}
function hwCore19f(f19f) {
    return f19f.machine_id
        ? JSON.stringify({ mid: f19f.machine_id, salt: 'sanatify-mes-hw-v1' })
        : JSON.stringify({ h: f19f.hostname, p: f19f.platform, c: f19f.cpu_model, n: f19f.cpu_count, m: f19f.mem_total, mac: f19f.mac, salt: 'sanatify-mes-hw-v1' });
}
function computeHwkey19f() {
    const f19f = hwFactors19f();
    const hex19f = crypto.createHash('sha256').update(hwCore19f(f19f)).digest('hex').slice(0, 12).toUpperCase();
    return 'HW-' + hex19f.slice(0, 4) + '-' + hex19f.slice(4, 8) + '-' + hex19f.slice(8, 12);
}

// ---------- canonical — عیناً با licCanonical24 در server.js ----------
function licCanonical27(cfg) {
    return JSON.stringify({
        active_modules: (Array.isArray(cfg.active_modules) ? cfg.active_modules.slice() : []).sort(),
        max_users: Number(cfg.max_users) || 0,
        max_records: Number(cfg.max_records) || 0,
        expires_at: String(cfg.expires_at || ''),
        hwkey: hwNorm19f(cfg.hwkey),
    });
}
/* منبع کلید HMAC — عین ترتیب licResolveKey27 سرور: env → license.key → پیش‌فرض */
function keySource27() {
    const env27 = String(process.env.SANATIFY_LIC_KEY || '').trim();
    if (env27) return { key: env27, source: 'env:SANATIFY_LIC_KEY', real: true };
    try {
        const raw27 = fs.readFileSync(KEY_FILE, 'utf8').trim();
        if (raw27) return { key: raw27, source: 'license.key (کنار server.js)', real: true };
    } catch (e27) { /* نیست */ }
    return { key: LIC_DEFAULT_KEY_27, source: 'پیش‌فرض — نه env و نه license.key', real: false };
}
/* کلید عمومی Ed25519 — env (چرخش) → embedded سرور */
function edPub27() {
    const envPub = String(process.env.SANATIFY_LIC_ED_PUB || '').trim();
    try { return { pub: crypto.createPublicKey({ key: Buffer.from(envPub || LIC_ED_PUB_EMBEDDED_27, 'base64'), format: 'der', type: 'spki' }), src: envPub ? 'env:SANATIFY_LIC_ED_PUB' : 'embedded سرور' }; }
    catch (e27) { return null; }
}

// ---------- اجرا ----------
const HWKEY27 = (function () { try { return computeHwkey19f(); } catch (e27) { return 'HW-UNKNOWN'; } })();
console.log('━━━ license-doctor — تشخیص لایسنس (FIX-LIC-27) ━━━');
console.log('پوشهٔ استقرار : ' + DIR27);
console.log('HWKEY ماشین  : ' + HWKEY27);

// ① tenant موجود؟
let cfg27 = null;
const hasEnc27 = fs.existsSync(TENANT_FILE + '.enc');
if (!fs.existsSync(TENANT_FILE)) {
    console.log(' ① tenant.json        : ✗ موجود نیست' + (hasEnc27 ? '  (⚠ tenant.json.enc رمزنگاری‌شده هست — این ابزار آن را باز نمی‌کند؛ وضعیت را از خط «وضعیت لایسنس» در لاگ بوت بخوانید)‌' : ''));
    finish(10,
        'tenant.json کنار server.js/exe موجود نیست' + (hasEnc27 ? ' (فقط نسخهٔ رمزنگاری‌شدهٔ .enc هست)' : '') + '.',
        'tenant.json امضاشده را کنار server.js/exe کپی کنید. امضا روی ماشین فروشنده: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign   (بخش ۴-۵ README-DEPLOY)' + (hasEnc27 ? ' — یا اگر .enc عمدی است: SANATIFY_LIC_KEY باید در env همان پروسهٔ سرور باشد.' : ''));
}
try {
    cfg27 = JSON.parse(fs.readFileSync(TENANT_FILE, 'utf8'));
    if (!cfg27 || typeof cfg27 !== 'object') throw new Error('شیء JSON نیست');
} catch (e27) {
    console.log(' ① tenant.json        : ✗ JSON نامعتبر (' + ((e27 && e27.message) || e27) + ')');
    finish(10, 'tenant.json موجود است ولی JSON نامعتبر است: ' + ((e27 && e27.message) || e27), 'فایل خراب را با نسخهٔ پشتیبان/امضاشدهٔ سالم جایگزین کنید — دوباره امضا: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign');
}
console.log(' ① tenant.json        : ✓ موجود (نام: ' + (cfg27.name || '?') + ' | ماژول‌ها: ' + ((Array.isArray(cfg27.active_modules) ? cfg27.active_modules.length : 0)) + ' | سقف کاربر: ' + (Number(cfg27.max_users) || '∞') + ')');

// ② hwkey match؟
const bound27 = hwNorm19f(cfg27.hwkey);
if (!bound27) {
    console.log(' ② قفل سخت‌افزاری     : — بدون قفل (hwkey خالی — روی هر ماشینی بالا می‌آید)');
} else if (bound27 !== hwNorm19f(HWKEY27)) {
    console.log(' ② قفل سخت‌افزاری     : ✗ تطبیق ندارد — لایسنس: ' + bound27 + ' | این ماشین: ' + HWKEY27 + '  (بوت سرور exit 1 می‌شود)');
    finish(11,
        'hwkey لایسنس («' + bound27 + '») با HWKEY این ماشین («' + HWKEY27 + '») تطبیق ندارد — سرور با گیت SEC-BIND-19f بالا نمی‌آید.',
        'HWKEY بالا («' + HWKEY27 + '») را برای صدور نزد فروشنده بفرستید؛ امضای تازه: node tools/license.js --hwkey=' + HWKEY27 + ' --only=… --expires=… --sign');
} else {
    console.log(' ② قفل سخت‌افزاری     : ✓ تطبیق دارد (' + bound27 + ')');
}

// ③ انقضا؟
const expRaw27 = String(cfg27.expires_at || '').trim();
if (!expRaw27) {
    console.log(' ③ انقضا              : — بدون محدودیت');
} else {
    const t27 = Date.parse(expRaw27);
    if (isNaN(t27)) {
        console.log(' ③ انقضا              : ⚠ فرمت تاریخ نامعتبر («' + expRaw27 + '»)');
        finish(12, 'expires_at فرمت تاریخ معتبر نیست («' + expRaw27 + '»).', 'node tools/license.js --expires=YYYY-MM-DD --sign');
    } else if (t27 < Date.now()) {
        console.log(' ③ انقضا              : ✗ منقضی شده (' + expRaw27 + ')');
        finish(12, 'لایسنس منقضی شده است (' + expRaw27 + ') — همهٔ APIها 403 می‌دهند.', 'تمدید: node tools/license.js --expires=YYYY-MM-DD --sign');
    } else {
        console.log(' ③ انقضا              : ✓ تا ' + expRaw27);
    }
}

// ④ امضای Ed25519 (مسیر اصلی)
const sig227 = String(cfg27.license_sig2 || '').trim();
const pubR27 = edPub27();
let edOk27 = null;
if (sig227 && pubR27) {
    try { edOk27 = crypto.verify(null, Buffer.from(licCanonical27(cfg27)), pubR27.pub, Buffer.from(sig227, 'base64')); }
    catch (e27) { edOk27 = false; }
}
if (!sig227) {
    console.log(' ④ امضای Ed25519     : — license_sig2 غایب (بررسی به امضای HMAC می‌رسد)');
} else if (edOk27 === true) {
    console.log(' ④ امضای Ed25519     : ✓ معتبر (کلید عمومی: ' + pubR27.src + ') — مسیر اصلی؛ HMAC لازم نیست');
} else {
    console.log(' ④ امضای Ed25519     : ✗ نامعتبر' + (pubR27 ? ' (کلید عمومی: ' + pubR27.src + ')' : ' (کلید عمومی در دسترس نیست — env SANATIFY_LIC_ED_PUB نامعتبر است)'));
    finish(13,
        'امضای Ed25519 (license_sig2) موجود ولی نامعتبر است — tenant دستکاری شده یا با کلید خصوصی دیگری امضا شده است.',
        'دوباره امضا کنید: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign   (فایل خصوصی Ed باید همان کلیدِ جفتِ «کلید عمومی embedded سرور» باشد)');
}

// ⑤ امضای HMAC (با کدام منبع کلید؟) — FIX-LIC-27: اگر Ed25519 معتبر باشد، سرور HMAC را اصلاً بررسی
// نمی‌کند (مسیر اصلی کافی است) — doctor هم عیناً: ⑤ فقط اطلاع‌رسانی می‌شود و در نتیجه دخالت ندارد.
const sig127 = String(cfg27.license_sig || '').toLowerCase();
const ks27 = keySource27();
let hmacOk27 = null;
try {
    if (/^[0-9a-f]{64}$/.test(sig127)) {
        const a27 = Buffer.from(sig127), b27 = Buffer.from(crypto.createHmac('sha256', ks27.key).update(licCanonical27(cfg27)).digest('hex'));
        hmacOk27 = a27.length === b27.length && crypto.timingSafeEqual(a27, b27);
    }
} catch (e27) { hmacOk27 = false; }
if (edOk27 === true) {
    /* مسیر اصلی کافی است — فقط نمایش وضعیت HMAC با نام منبع کلید (بدون اثر بر نتیجه) */
    const st27 = sig127 ? (hmacOk27 ? '✓ معتبر' : '✗ تأیید نمی‌شود') : 'غایب';
    console.log(' ⑤ امضای HMAC        : ' + st27 + ' — منبع کلید: ' + ks27.source + '  (ملاک نیست — Ed25519 کافی است)');
    if (!ks27.real) console.log('   ⚠ توجه: هیچ منبع کلید واقعی موجود نیست — اگر sig2 را حذف/منقضی کنید لایسنس می‌افتد؛ توصیه: license.key بسازید (دستور در بخش اصلاح پایین).');
} else if (!/^[0-9a-f]{64}$/.test(sig127)) {
    console.log(' ⑤ امضای HMAC        : ✗ ' + (sig127 ? 'فرمت license_sig نامعتبر است' : 'license_sig غایب است'));
    finish(16, 'tenant.json هیچ امضای فروشنده‌ای ندارد (license_sig غایب/خراب و license_sig2 هم معتبر نیست).', 'امضا: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign');
} else if (hmacOk27 === true && !ks27.real) {
    console.log(' ⑤ امضای HMAC        : ✓ معتبر — منبع کلید: ' + ks27.source);
    finish(16,
        'امضا فقط با «کلید پیش‌فرض» تأیید می‌شود (نه env و نه license.key موجود است) — این امضای فروشنده نیست؛ در استقرار واقعی/بوت سرد لایسنس نامعتبر تلقی می‌شود.',
        'یک‌بار با env امضا بزنید تا license.key برای همیشه ساخته شود: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign');
} else if (hmacOk27 === true) {
    console.log(' ⑤ امضای HMAC        : ✓ معتبر — منبع کلید: ' + ks27.source);
} else if (!ks27.real) {
    console.log(' ⑤ امضای HMAC        : ✗ تأیید نمی‌شود — منبع کلید: ' + ks27.source);
    finish(15,
        'هیچ منبع کلید واقعی موجود نیست (نه env SANATIFY_LIC_KEY و نه فایل license.key کنار server.js) — سرور بوت سرد را با کلید پیش‌فرض verify می‌کند ⇒ بنر «لایسنس نامعتبر». (این همان سناریوی تکرارشده در استقرار است.)',
        'یک‌بار با env امضا بزنید تا license.key ساخته شود: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign → فایل license.key کنار server.js/exe می‌ماند و بوت سرد بدون env هم معتبر است. (در ویندوز فایل ساخته‌شده را هم کنار exe کپی کنید.)');
} else {
    console.log(' ⑤ امضای HMAC        : ✗ تأیید نمی‌شود — منبع کلید: ' + ks27.source);
    finish(14,
        'امضای HMAC با منبع کلید «' + ks27.source + '» تطبیق ندارد (کلید دیگر یا امضای کهنه).',
        'با منبع درست دوباره امضا کنید: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign   — یا اگر license.key کهنه است، آن را با کلید درست به‌روز کنید.');
}

// سالم
console.log('────────────────────────────────────────────');
console.log('نتیجه: معتبر ✓  (روش: ' + (edOk27 === true ? 'Ed25519 — مسیر اصلی، HMAC لازم نبود' : 'HMAC — منبع کلید: ' + ks27.source) + ')');
process.exit(0);
