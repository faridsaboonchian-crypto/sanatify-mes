// =====================================================================
//  auth.js  -  S1: server-side auth for the web panel (raw http version)
//  Works with http.createServer (NO express). In-memory sessions +
//  HttpOnly cookie + inline login page (with password show/hide eye).
//  Protects /api/* and static pages, but WHITELISTS /api/ingest and
//  /api/health (the mobile app + monitoring have no web session).
// =====================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ===== SEC-PROTECT-19e (begin): پشتیبانی باینری pkg — web-users.json کنار exe ===== */
const RUNTIME_ROOT_19E = (function () { try { return process.pkg ? path.dirname(process.execPath) : __dirname; } catch (e19e) { return __dirname; } })();
/* ===== SEC-PROTECT-19e (end) ===== */
const USERS_FILE = path.join(RUNTIME_ROOT_19E, 'web-users.json'); /* SEC-PROTECT-19e */
/* ===== SEC-ANTI-19g (begin): پشتیبانی پیکربندی رمزنگاری‌شده (web-users.json.enc) =====
   الگوریتم HWKEY عیناً با SEC-BIND-19f در server.js و tools/generate-hwkey.js یکی است؛
   قالب .enc عیناً با tools/encrypt-config.js و server.js (CFG_MAGIC_19G) — هر تغییر هم‌زمان در هر سه.
   در حالت source هیچ گارد اضافه‌ای فعال نمی‌شود؛ این فقط خواندن/نوشتن شفاف است. */
function hwNorm19gA(v) { return String(v || '').trim().toUpperCase().replace(/[\s"']/g, ''); }
function hwFactors19gA() {
    let machineId = '';
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const o19g = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
            try {
                const m19g = String(execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', o19g)).match(/REG_SZ\s+([^\r\n\s]+)/);
                machineId = m19g ? m19g[1] : '';
            } catch (e19g) { machineId = ''; }
            if (!machineId) { try { machineId = String(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', o19g)).trim(); } catch (e19g) { machineId = ''; } }
            if (!machineId) { try { const lines19g = String(execSync('wmic csproduct get uuid', o19g)).split(/\r?\n/).filter((l) => l.trim() && l.indexOf('UUID') === -1); machineId = (lines19g[0] || '').trim(); } catch (e19g) { machineId = ''; } }
        } else if (process.platform === 'linux') {
            try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch (e19g) { machineId = ''; }
            if (!machineId) { try { machineId = fs.readFileSync('/sys/class/dmi/id/product_uuid', 'utf8').trim(); } catch (e19g) { machineId = ''; } }
        } else if (process.platform === 'darwin') {
            try {
                const { execSync } = require('child_process');
                const m19g = String(execSync('ioreg -rd1 -c IOPlatformExpertDevice', { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })).match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
                machineId = m19g ? m19g[1] : '';
            } catch (e19g) { machineId = ''; }
        }
    } catch (e19g) { machineId = ''; }
    return machineId || '';
}
const HWKEY_19G_A = (function () {
    try {
        let mid = hwFactors19gA();
        if (!mid) {
            const osc = require('os');
            let mac = '';
            try {
                const ifs = osc.networkInterfaces();
                for (const nm of Object.keys(ifs)) { const arr = ifs[nm] || []; for (const it of arr) { if (it && !it.internal && it.mac && it.mac !== '00:00:00:00:00:00') { mac = it.mac; break; } } if (mac) break; }
            } catch (e) { /* بی‌ضرر */ }
            mid = JSON.stringify({ h: osc.hostname(), p: process.platform, c: (osc.cpus()[0] && osc.cpus()[0].model) || '', n: osc.cpus().length, m: osc.totalmem(), mac: mac, salt: 'sanatify-mes-hw-v1' });
        }
        const core = mid.indexOf('{') === 0 ? mid : JSON.stringify({ mid: mid, salt: 'sanatify-mes-hw-v1' });
        const hex = crypto.createHash('sha256').update(core).digest('hex').slice(0, 12).toUpperCase();
        return hwNorm19gA('HW-' + hex.slice(0, 4) + '-' + hex.slice(4, 8) + '-' + hex.slice(8, 12));
    } catch (e) { return 'HW-UNKNOWN'; }
})();
const CFG_MAGIC_19G_A = 'sanatify-cfg-19g';
/* ===== DEV-BYPASS-40 (begin): دورزدن قفل HWKEY برای توسعه/آزمون — opt-in، در production ممنوع =====
   فعال‌سازی:  --dev-bypass-hwkey (اولویت بالاتر)  یا  env SANATIFY_DEV_BYPASS_HWKEY=1
   کلید مؤثر web-users.json.enc ثابت می‌شود: scrypt(SHA256('dev-key-sanatify-2026'), salt)
   ⇒ فایل .enc مستقل از HWKEY/SANATIFY_LIC_KEY روی هر ماشینی رمزگشایی می‌شود (تست دو-ماشینی QA).
   گارد production در server.js (devBypass40Boot): SANATIFY_ENV=production ⇒ رفض بوت (exit 1). */
const DEV_BYPASS_SECRET_40 = crypto.createHash('sha256').update('dev-key-sanatify-2026', 'utf8').digest('hex');
function devBypass40() {
    if (process.argv.indexOf('--dev-bypass-hwkey') !== -1) return true; /* CLI — اولویت بالاتر از env */
    return String(process.env.SANATIFY_DEV_BYPASS_HWKEY || '').trim() === '1';
}
/* ===== DEV-BYPASS-40 (end) ===== */
function cfgDerivedKey19gA(salt19g) {
    const secret19g = devBypass40() ? DEV_BYPASS_SECRET_40 : (String(process.env.SANATIFY_LIC_KEY || 'Sanatify-Lic-Verify::v1::1405') + '|' + HWKEY_19G_A); /* DEV-BYPASS-40 */
    return crypto.scryptSync(secret19g, salt19g, 32, { N: 16384, r: 8, p: 1 });
}
function readMaybeEnc19g(filePath) {
    const encPath19g = filePath + '.enc';
    if (fs.existsSync(encPath19g)) {
        try {
            const box19g = JSON.parse(fs.readFileSync(encPath19g, 'utf8'));
            if (box19g && box19g.enc === CFG_MAGIC_19G_A && box19g.alg === 'aes-256-gcm') {
                const key19g = cfgDerivedKey19gA(Buffer.from(String(box19g.salt), 'base64'));
                const d19g = crypto.createDecipheriv('aes-256-gcm', key19g, Buffer.from(String(box19g.iv), 'base64'));
                d19g.setAuthTag(Buffer.from(String(box19g.tag), 'base64'));
                return Buffer.concat([d19g.update(Buffer.from(String(box19g.data), 'base64')), d19g.final()]).toString('utf8');
            }
        } catch (e19g) {
            console.error('[SEC-ANTI-19g] رمزگشایی ' + path.basename(encPath19g) + ' ناموفق (' + ((e19g && e19g.message) || e19g) + ') ⇒ plaintext (اگر باشد) — کلید/HWKEY عوض شده؟');
        }
    }
    try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null; } catch (e19g) { return null; }
}
function dropEnc19g(filePath) {
    try {
        if (fs.existsSync(filePath + '.enc')) {
            fs.unlinkSync(filePath + '.enc');
            console.warn('[SEC-ANTI-19g] ' + path.basename(filePath) + ' به‌روزرسانی شد ⇒ ' + path.basename(filePath) + '.enc کهنه حذف شد — برای رمزکردن دوباره: node tools/encrypt-config.js --file=' + path.basename(filePath));
        }
    } catch (e19g) { /* بی‌ضرر */ }
}
/* ===== SEC-ANTI-19g (end) ===== */
/* ===== VENDOR-37 (begin): صاحب سیستم (vendor) + رمزنگاری اجباری web-users =====
   • web-users روی دیسک فقط ciphertext است (AES-256-GCM — پاکت عیناً SEC-ANTI-19g، کلید=scrypt(SANATIFY_LIC_KEY|HWKEY))
     ⇒ فقط روی همین VM رمزگشایی می‌شود؛ IT با ویرایش دستی نمی‌تواند vendor جعل کند.
   • .enc موجود ولی رمزگشایی‌ناشدنی ⇒ فایل رد می‌شود (fallback به plaintext کهنه ممنوع) — فقط vendor امضاشده
     با recovery (کلید خصوصی فروشنده) فعال می‌ماند.
   • plaintext بدون .enc ⇒ مهاجرت یک‌بارهٔ خودکار (به‌جز vendor بی‌امضا در فایل دست‌ساز = جعل ⇒ رد).
   • نقش vendor = صاحب سیستم؛ 'owner' (SEC-LIC-24) در بارگذاری به vendor نرمال می‌شود. */
const VENDOR_ROLE_37_A = 'vendor';
function vendorRole37A(r) { return r === 'vendor' || r === 'owner'; }
function normalizeRole37A(arr) {
    (Array.isArray(arr) ? arr : []).forEach((u) => { if (u && String(u.role || '') === 'owner') u.role = 'vendor'; });
    return Array.isArray(arr) ? arr : [];
}
function encryptText37A(text) { /* پاکت عیناً CFG_MAGIC_19G_A — هر تغییر هم‌زمان با server.js/tools/encrypt-config.js */
    const salt37a = crypto.randomBytes(16);
    const key37a = cfgDerivedKey19gA(salt37a);
    const iv37a = crypto.randomBytes(12);
    const c37a = crypto.createCipheriv('aes-256-gcm', key37a, iv37a);
    const data37a = Buffer.concat([c37a.update(String(text), 'utf8'), c37a.final()]);
    return JSON.stringify({ enc: CFG_MAGIC_19G_A, alg: 'aes-256-gcm', salt: salt37a.toString('base64'), iv: iv37a.toString('base64'), tag: c37a.getAuthTag().toString('base64'), data: data37a.toString('base64') });
}
function decryptUsersEnc37A() { /* سخت‌گیرانه: رمزگشایی ناموفق ⇒ {ok:false} — برخلاف readMaybeEnc19g که plaintext کهنه را برمی‌گرداند */
    try {
        const box37a = JSON.parse(fs.readFileSync(USERS_FILE + '.enc', 'utf8'));
        if (box37a && box37a.enc === CFG_MAGIC_19G_A && box37a.alg === 'aes-256-gcm') {
            const key37a = cfgDerivedKey19gA(Buffer.from(String(box37a.salt), 'base64'));
            const d37a = crypto.createDecipheriv('aes-256-gcm', key37a, Buffer.from(String(box37a.iv), 'base64'));
            d37a.setAuthTag(Buffer.from(String(box37a.tag), 'base64'));
            return { ok: true, text: Buffer.concat([d37a.update(Buffer.from(String(box37a.data), 'base64')), d37a.final()]).toString('utf8') };
        }
        return { ok: false, reason: 'قالب پاکت ناشناخته است' };
    } catch (e37a) { return { ok: false, reason: (e37a && e37a.message) || 'رمزگشایی ناموفق' }; }
}
function writeUsersEnc37A(arr) { /* نوشتن اتمیک رمزنگاری‌شده + حذف plaintext — ciphertext تنها حالت روی دیسک */
    try {
        const tmp37a = USERS_FILE + '.tmp37';
        const fd37a = fs.openSync(tmp37a, 'w');
        try { fs.writeFileSync(fd37a, encryptText37A(JSON.stringify(normalizeRole37A(arr))), 'utf8'); fs.fsyncSync(fd37a); } finally { try { fs.closeSync(fd37a); } catch (e37a2) { /* noop */ } }
        fs.renameSync(tmp37a, USERS_FILE + '.enc');
        try { if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE); } catch (e37a3) { /* noop */ }
        try { fs.chmodSync(USERS_FILE + '.enc', 0o600); } catch (e37a4) { /* ویندوز: غیرمرگبار */ }
        return true;
    } catch (e37a5) { return false; }
}
/* ===== VENDOR-37 (end) ===== */
const SESSION_COOKIE = 'mes_session';
const SESSION_MS = 8 * 60 * 60 * 1000; /* SEC-15b: timeout مطلق ۸ ساعت (قبلاً ۱۲ ساعته لغزان) */
const SESSION_IDLE_MS = 30 * 60 * 1000; /* SEC-15b: idle timeout ۳۰ دقیقه از آخرین فعالیت */
const MAX_FAIL = 5;
const LOCK_MS = 60 * 1000;

// endpoints the mobile app / monitoring hit WITHOUT a web session
const PUBLIC_API = ['/api/ingest', '/api/health', '/api/snapshot'];
/* ===== FEAT-QC-PRO-24b (begin): تأیید آنلاین گواهی کیفیت MTC عمومی است (QR مشتری/گمر بدون لاگین) — فقط مسیر دقیق با VID الفبایی-عددی و پاسخ حداقلی ===== */
function isPublicApi24(pathname) {
    if (pathname.indexOf('/api/qcpro/mtc/verify/') === 0) {
        const v = pathname.slice('/api/qcpro/mtc/verify/'.length);
        return /^[A-Za-z0-9]+$/.test(v);
    }
    return false;
}
/* ===== FEAT-QC-PRO-24b (end) ===== */

const sessions = new Map();   // sid -> { user, expires, lastSeen }
/* SEC-15b: سیستم قدیمی قفل ۶۰ثانیه‌ای per-username باregisterLoginFail15b دولایه جایگزین شد */

/* SEC-15b: نویسندهٔ audit از server.js تزریق می‌شود (مسیر واحد + چرخش ماهانه) */
let auditWriter15b = null;
function setAuditWriter15b(fn) { auditWriter15b = typeof fn === 'function' ? fn : null; }
function audit15b(entry) { try { if (auditWriter15b) auditWriter15b(entry); } catch (e) { /* بی‌ضرر */ } }

function loadUsers() {
    /* VENDOR-37: web-users فقط ciphertext — plaintext/نامعتبر رد می‌شود (فقط vendor امضاشده با recovery فعال می‌ماند) */
    const hasEnc37 = fs.existsSync(USERS_FILE + '.enc');
    const hasPlain37 = fs.existsSync(USERS_FILE);
    if (hasEnc37) {
        const dec37 = decryptUsersEnc37A();
        if (!dec37.ok) {
            console.error('[VENDOR-37] web-users.json.enc پذیرفته نشد (' + dec37.reason + ') — فایل دستکاری/نامعتبر یا HWKEY این ماشین نیست.');
            console.error('  فقط vendor امضاشده فعال می‌ماند — recovery با کلید خصوصی فروشنده:');
            console.error('    SANATIFY_LIC_ED_PRIV="…" <server> --recover-vendor=نام‌کاربری:رمز-اولیه');
            return [];
        }
        try { return normalizeRole37A(JSON.parse(dec37.text)); } catch (e37) { console.error('[VENDOR-37] web-users.json.enc تجزیه نشد — رد شد.'); return []; }
    }
    if (hasPlain37) {
        /* مهاجرت یک‌بارهٔ استقرارهای قدیمی به ciphertext — با گارد vendor جعلی در فایل دست‌ساز */
        try {
            const arr37 = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            if (!Array.isArray(arr37)) throw new Error('آرایه نیست');
            const forged37 = arr37.some((u) => u && String(u.role || '') === 'vendor' && !String(u.vendor_sig || '').trim()); /* نقش vendor پیش از این نسخه وجود نداشت — vendor بی‌امضا در plaintext = جعل */
            if (forged37) {
                const rej37 = USERS_FILE + '.rejected-37-' + Date.now();
                try { fs.renameSync(USERS_FILE, rej37); } catch (e37r) { /* noop */ }
                console.error('[VENDOR-37] web-users.json plaintext حاوی vendor بدون امضای معتبر است — پذیرفته نشد (نسخه: ' + rej37 + ').');
                console.error('  vendor فقط با کلید خصوصی فروشنده قابل ساخت است: --recover-vendor=نام‌کاربری:رمز');
                return [];
            }
            const norm37 = normalizeRole37A(arr37);
            if (!writeUsersEnc37A(norm37)) { console.error('[VENDOR-37] رمزنگاری web-users ناموفق بود — فایل plaintext دست‌نخورده ماند.'); return norm37; }
            const mig37 = USERS_FILE + '.migrated-37-' + Date.now();
            try { fs.renameSync(USERS_FILE, mig37); } catch (e37m) { try { fs.unlinkSync(USERS_FILE); } catch (e37m2) { /* noop */ } }
            console.log('[VENDOR-37] مهاجرت رمزنگاری web-users انجام شد ⇒ web-users.json.enc (کلید مشتق از HWKEY؛ plaintext به ' + mig37 + ' منتقل شد).');
            return norm37;
        } catch (e37p) {
            console.warn('[Auth] web-users.json plaintext نامعتبر است ⇒ پذیرفته نشد — nobody can log in (recovery: --recover-vendor).');
            return [];
        }
    }
    console.warn('[Auth] web-users.json(.enc) موجود نیست ⇒ هیچ‌کس وارد نمی‌شود — بوت‌استرپ: --create-admin (صاحب سیستم را می‌سازد).');
    return [];
}

// constant-time compare (no timing leak)
function safeEqual(a, b) {
    const ba = Buffer.from(String(a == null ? '' : a));
    const bb = Buffer.from(String(b == null ? '' : b));
    if (ba.length !== bb.length) { crypto.timingSafeEqual(ba, ba); return false; }
    return crypto.timingSafeEqual(ba, bb);
}

// ===== SEC-15b (begin): هش رمز — scrypt داخلی Node (KDF حافظه‌سخت، جایگزین stdlib برای bcrypt — بدون npm جدید) =====
// قالب: scrypt$N$r$p$<salt-b64>$<hash-b64> — پسوند‌پذیر برای الگوریتم‌های آینده (الگوی $2b$ bcrypt)
function hashPassword(plain) {
    const N = 16384, r = 8, p = 1, keylen = 64;
    const salt = crypto.randomBytes(16);
    const key = crypto.scryptSync(String(plain), salt, keylen, { N: N, r: r, p: p });
    return 'scrypt$' + N + '$' + r + '$' + p + '$' + salt.toString('base64') + '$' + key.toString('base64');
}
function verifyPassword(plain, stored) {
    const s = String(stored || '');
    if (s.indexOf('scrypt$') !== 0) return safeEqual(plain, s); /* backward-compat موقت: plaintext قدیمی */
    const parts = s.split('$');
    if (parts.length !== 6) return false;
    try {
        const N = parseInt(parts[1], 10), r = parseInt(parts[2], 10), p = parseInt(parts[3], 10);
        if (!N || !r || !p) return false;
        const salt = Buffer.from(parts[4], 'base64');
        const want = Buffer.from(parts[5], 'base64');
        const got = crypto.scryptSync(String(plain), salt, want.length, { N: N, r: r, p: p });
        return got.length === want.length && crypto.timingSafeEqual(got, want);
    } catch (e) { return false; }
}
function usersWrite15b(arr) { /* نوشتن web-users — VENDOR-37: همیشه رمزنگاری‌شده (.enc) + حذف plaintext */
    return writeUsersEnc37A(arr);
}
// ===== FEAT-ADMIN-17a (begin): مدیریت کاربران از پنل سازمان — نشست‌ها + گارد غیرفعال + نوشتن با بکاپ =====
function sessionsOfUser17a(username) {
    const out = []; const now = Date.now(); const un = String(username == null ? '' : username);
    for (const [sid, s] of sessions) { if (s && s.user && s.user.username === un && s.expires > now) out.push(sid); }
    return out;
}
function killSessionsByUsername17a(username) { /* غیرفعال‌سازی/تغییر نقش/بازنشانی رمز ⇒ خروج اجباری در درخواست بعدی */
    let n = 0; sessionsOfUser17a(username).forEach((sid) => { sessions.delete(sid); n++; }); return n;
}
function activeSessionCount17a(username) { return sessionsOfUser17a(username).length; }
function refreshSessionUser17a(username, patch) { /* به‌روزرسانی snapshot نام/نقش در نشست‌های زنده (بدون logout) */
    sessionsOfUser17a(username).forEach((sid) => { const s = sessions.get(sid); if (s) s.user = Object.assign({}, s.user, patch || {}); });
}
function findUser17a(username) {
    const un = String(username == null ? '' : username);
    return loadUsers().find((x) => safeEqual(x.username, un)) || null;
}
function isUserInactive17a(username) { const u = findUser17a(username); return !!(u && u.active === false); }
/* ===== HARDEN-18P (begin): سیاست رمز عبور — حداقل ۸ + پیچیدگی (حرف+رقم) + ممنوعیت هم‌نامی با کاربر ===== */
function passwordPolicyError18P(pw, username) {
    const p = String(pw || '');
    if (p.length < 8 || p.length > 128) return 'رمز عبور باید ۸ تا ۱۲۸ کاراکتر باشد (حداقل ۸ کاراکتر).';
    if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) return 'رمز عبور باید هم حرف و هم رقم داشته باشد (مثل sanatify2024).';
    const u = String(username || '').toLowerCase();
    if (u && (p.toLowerCase().indexOf(u) !== -1 || u.indexOf(p.toLowerCase()) !== -1)) return 'رمز عبور نباید شامل نام کاربری یا برابر آن باشد.';
    return null;
}
/* ===== HARDEN-18P (end) ===== */
function writeUsers17a(arr) { /* بکاپ زمان‌دار (پوشش gitignore *.bak-*) + نوشتن اتمیک — سازگار با migrate-hashes */
    try {
        try {
            if (fs.existsSync(USERS_FILE) || fs.existsSync(USERS_FILE + '.enc')) { /* SEC-ANTI-19g: حالت رمز هم بکاپ می‌گیرد */
                const d = new Date();
                const stamp = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + String(d.getSeconds()).padStart(2, '0');
                /* ===== HARDEN-18P (begin): گارد بکاپ — بکاپ کاربران هرگز plaintext نمی‌شود؛
                   اگر فیلد plaintext (password) در فایل بود، بکاپ نسخهٔ پاک‌سازی‌شده (فقط هش) می‌شود ===== */
                /* VENDOR-37: بکاپ بایت‌به‌بایتِ همان حالت دیسک (اولویت: .enc ciphertext) — بکاپ کاربران هرگز plaintext نمی‌شود؛
                   تنها استثنا: plaintextِ مهاجرت‌نرفته با فیلد password (HARDEN-18P) ⇒ نسخهٔ پاک‌سازی‌شده */
                const bakSrc37 = fs.existsSync(USERS_FILE + '.enc') ? USERS_FILE + '.enc' : (fs.existsSync(USERS_FILE) ? USERS_FILE : null);
                const backupTxt37 = bakSrc37 ? fs.readFileSync(bakSrc37, 'utf8') : null;
                let backupArr37 = null;
                if (backupTxt37 != null && bakSrc37 === USERS_FILE) { /* فقط plaintext اسکن می‌شود */
                    try {
                        const raw18p = JSON.parse(backupTxt37);
                        if (Array.isArray(raw18p) && raw18p.some((u) => u && u.password != null)) {
                            backupArr37 = raw18p.map((u) => { const c = Object.assign({}, u); delete c.password; return c; });
                            console.warn('[HARDEN-18P] بکاپ کاربران: فیلد plaintext یافت شد — بکاپ فقط با نسخهٔ هش/پاک‌سازی‌شده نوشته شد (plaintext هرگز بکاپ نمی‌شود).');
                        }
                    } catch (e2) { /* خواندن ناموفق — بکاپ خام مثل قبل */ }
                }
                if (backupArr37) fs.writeFileSync(USERS_FILE + '.bak-' + stamp, JSON.stringify(backupArr37, null, 2) + String.fromCharCode(10), 'utf8');
                else if (backupTxt37 != null) fs.writeFileSync(USERS_FILE + '.bak-' + stamp, backupTxt37, 'utf8');
                else fs.copyFileSync(USERS_FILE, USERS_FILE + '.bak-' + stamp);
                /* ===== HARDEN-18P (end) ===== */
                /* نگه‌داری حداکثر ۱۰ بکاپ اخیر */
                const dir = path.dirname(USERS_FILE);
                const baks = fs.readdirSync(dir).filter((f) => f.indexOf('web-users.json.bak-') === 0).sort();
                while (baks.length > 10) { try { fs.unlinkSync(path.join(dir, baks.shift())); } catch (e2) { break; } }
            }
        } catch (eb) { /* بکاپ اختیاری است — نوشتن اصلی ادامه می‌یابد */ }
        /* VENDOR-37: نوشتن همیشه رمزنگاری‌شده (.enc) — plaintext باقی‌مانده حذف می‌شود؛
           dropEnc19g اینجا دیگر معنا ندارد (هرگز plaintext نمی‌نویسیم) */
        if (!writeUsersEnc37A(arr)) return false;
        return true;
    } catch (e) { return false; }
}
// ===== FEAT-ADMIN-17a (end) =====
// ===== SEC-15b (end) =====

function parseCookies(header) {
    const out = {};
    if (!header) return out;
    header.split(';').forEach((pair) => {
        const i = pair.indexOf('=');
        if (i < 0) return;
        const k = pair.slice(0, i).trim();
        if (k) out[k] = decodeURIComponent(pair.slice(i + 1).trim());
    });
    return out;
}
function setCookie(res, sid) {
    const maxAge = Math.floor(SESSION_MS / 1000);
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + sid + '; HttpOnly; Path=/; SameSite=Lax' + (cookieSecure15b ? '; Secure' : '') + '; Max-Age=' + maxAge);
}
function clearCookie(res) {
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=; HttpOnly; Path=/; SameSite=Lax' + (cookieSecure15b ? '; Secure' : '') + '; Max-Age=0');
}
let cookieSecure15b = false; /* SEC-15b: از server.js با tlsMode تنظیم می‌شود */
function setSecureCookie15b(v) { cookieSecure15b = !!v; }

function readBody(req) {
    // ===== SEC-15b: سقف ۱MB (لاگین بدنهٔ کوچکی دارد) =====
    const CAP_15B = 1024 * 1024;
    return new Promise((resolve, reject) => {
        let d = '';
        let over15b = false;
        req.on('data', (c) => {
            if (over15b) return;
            d += c;
            if (d.length > CAP_15B) { over15b = true; const e = new Error('payload too large'); e.code15b = 'PAYLOAD_TOO_LARGE'; try { req.destroy(); } catch (e2) { /* noop */ } reject(e); }
        });
        req.on('end', () => { if (!over15b) resolve(d); });
        req.on('error', reject);
    });
}
// ===== SEC-15b: CORS دقیق — فهرست مجاز از tenant.custom_settings.allowed_origins (null = همان‌مبدأ) =====
let corsAllowedOrigins15b = null;
function setCorsConfig15b(origins) { corsAllowedOrigins15b = (Array.isArray(origins) && origins.length) ? origins.map(String) : null; }
function isOriginAllowed15b(origin) {
    const o = String(origin || '');
    if (!o) return false;
    return !!(corsAllowedOrigins15b && corsAllowedOrigins15b.indexOf(o) !== -1);
}
function clientIp15b(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) { const first = String(xf).split(',')[0].trim(); if (first) return first; }
    return (req.socket && req.socket.remoteAddress) || '?';
}
function activeSessions15c() { /* SAAS-15c: تعداد نشست‌های فعال برای آمار مصرف */ let n = 0; const now = Date.now(); for (const [, s] of sessions) { if (s.expires > now) n++; } return n; }
function jsonRes(res, obj, code) {
    const body = JSON.stringify(obj);
    /* SEC-15b: حذف ACAO:* — فقط originهای مجاز tenant (پیش‌فرض همان‌مبدأ بدون هدر) */
    const h15b = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    const req15b = res.__req15b;
    const origin15b = req15b ? String(req15b.headers.origin || '') : '';
    if (origin15b && isOriginAllowed15b(origin15b)) { h15b['Access-Control-Allow-Origin'] = origin15b; h15b['Access-Control-Allow-Credentials'] = 'true'; }
    res.writeHead(code || 200, h15b);
    res.end(body);
}
function redirect(res, loc) { res.writeHead(302, { 'Location': loc }); res.end(); }
function htmlRes(res, html, req) {
    /* HARDEN-18G: تزریق nonce به سند لاگین — هم‌گام با CSP هدر (همان req) */
    const n18g = req && req.__cspNonce18G ? String(req.__cspNonce18G) : '';
    if (n18g) {
        html = html.replace(/<style>/g, '<style nonce="' + n18g + '">').replace(/<script>/g, '<script nonce="' + n18g + '">');
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html);
}

// ===== SEC-15b (begin): ضد-BruteForce دولایه — شمارش per-IP و per-username با پنجرهٔ لغزان =====
// ۵ خطا در ۱۰ دقیقه ⇒ قفل ۱۵ دقیقه (۴۲۹)؛ ۱۰ خطا در ۱ ساعت ⇒ قفل ۲ ساعته + هشدار audit
const BF_WINDOW_MS = 10 * 60 * 1000;
const BF_SHORT_THRESHOLD = 5, BF_SHORT_LOCK_MS = 15 * 60 * 1000;
const BF_LONG_WINDOW_MS = 60 * 60 * 1000, BF_LONG_THRESHOLD = 10, BF_LONG_LOCK_MS = 2 * 60 * 60 * 1000;
const bfUser15b = new Map();
const bfIp15b = new Map();
function bfHit15b(map, key, now) {
    const v = map.get(key) || { short: [], long: [], lockUntil: 0 };
    v.short = v.short.filter((t) => now - t < BF_WINDOW_MS);
    v.long = v.long.filter((t) => now - t < BF_LONG_WINDOW_MS);
    v.short.push(now); v.long.push(now);
    map.set(key, v);
    return v;
}
function bfLockedMs15b(map, key, now) {
    const v = map.get(key);
    if (!v || !v.lockUntil) return 0;
    if (now < v.lockUntil) return v.lockUntil - now;
    v.lockUntil = 0;
    return 0;
}
function bfSweep15b() {
    const now = Date.now();
    [bfUser15b, bfIp15b].forEach((map) => {
        for (const [k, v] of map) {
            v.short = v.short.filter((t) => now - t < BF_WINDOW_MS);
            v.long = v.long.filter((t) => now - t < BF_LONG_WINDOW_MS);
            if (!v.short.length && !v.long.length && now >= (v.lockUntil || 0)) map.delete(k);
        }
    });
}
var bfSweepTimer15b = setInterval(bfSweep15b, 5 * 60 * 1000);
if (bfSweepTimer15b.unref) bfSweepTimer15b.unref();
/* برمی‌گرداند مدت قفل (ms) یا صفر؛ هشدار بلند را با auditFn ثبت می‌کند */
function registerLoginFail15b(username, ip, auditFn) {
    const now = Date.now();
    const u = bfHit15b(bfUser15b, username, now);
    const i = bfHit15b(bfIp15b, ip, now);
    let lockMs = 0, long15b = false;
    if (u.short.length >= BF_SHORT_THRESHOLD || i.short.length >= BF_SHORT_THRESHOLD) lockMs = BF_SHORT_LOCK_MS;
    if (u.long.length >= BF_LONG_THRESHOLD || i.long.length >= BF_LONG_THRESHOLD) { lockMs = BF_LONG_LOCK_MS; long15b = true; }
    if (lockMs) {
        u.lockUntil = Math.max(u.lockUntil || 0, now + lockMs);
        i.lockUntil = Math.max(i.lockUntil || 0, now + lockMs);
        if (auditFn) auditFn('auth.bruteforce_lock', { username: username, ip: ip, long_lock: long15b, locked_sec: Math.round(lockMs / 1000), fails_short: u.short.length, fails_long: u.long.length });
    }
    return lockMs;
}
// ===== SEC-15b (end) =====

// ===== SAAS-15a (begin): برندینگ تنانت روی صفحهٔ ورود — بدون tenant.json: بدون هیچ تغییر =====
let tenantBrand15a = null;
/* ===== FIX-ORG-16b (begin): رنگ‌های برند صفحهٔ ورود — فقط HEX معتبر تزریق می‌شود ===== */
let tenantColors16b = null;
function safeHex16b(v) { const s = String(v == null ? '' : v).trim().toLowerCase(); return /^#[0-9a-f]{6}$/.test(s) ? s : ''; }
function setTenantBranding15a(b) {
    tenantBrand15a = (b && (b.name || b.logo)) ? { name: String(b.name || ''), logo: String(b.logo || '') } : null;
    const c = (b && b.colors) || {};
    const p = safeHex16b(c.primary), a = safeHex16b(c.accent);
    tenantColors16b = (p || a) ? { primary: p, accent: a } : null;
}
function escBrand15a(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function loginHtml15a() {
    if (!tenantBrand15a) return LOGIN_HTML;
    let html = LOGIN_HTML;
    if (tenantBrand15a.name) {
        html = html.split('ورود | صنعتی فای (SANATIFY) — ERP/MES فولاد').join('ورود | ' + escBrand15a(tenantBrand15a.name));
        html = html.split('<div class="brand-name">صنعتی فای (SANATIFY)<small>').join('<div class="brand-name">' + escBrand15a(tenantBrand15a.name) + '<small>');
    }
    if (tenantBrand15a.logo) {
        html = html.replace(/<div class="brand-mark"([^>]*)>[\s\S]*?<\/div>/, '<div class="brand-mark" style="width:56px;height:56px;border-radius:15px"><img src="' + escBrand15a(tenantBrand15a.logo) + '" alt="لوگو" style="width:48px;height:48px;border-radius:12px;object-fit:contain;padding:3px;background:rgba(255,255,255,.15)" /></div>'); /* FIX-UI-18c: لوگوی لاگین متناسب بزرگ‌تر — جعبه ۵۶px + تصویر ۴۸px واضح */
    }
    /* ===== FIX-ORG-16b (begin): تزریق CSS رنگ برند — فقط HEX سنجیده‌شده ⇒ بدون ریسک تزریق ===== */
    if (tenantColors16b) {
        let css16b = '';
        if (tenantColors16b.primary) css16b += '.card{border-top-color:' + tenantColors16b.primary + '!important}button.submit{background:linear-gradient(135deg,' + tenantColors16b.primary + ',#0f2a43)!important}';
        if (tenantColors16b.accent) css16b += '.brand-mark{background:linear-gradient(135deg,' + tenantColors16b.accent + ',#0f2a43)!important}input:focus{border-color:' + tenantColors16b.accent + '!important}';
        if (css16b) html = html.replace('</head>', '<style>/* FIX-ORG-16b tenant brand colors */' + css16b + '</style></head>');
    }
    /* ===== FIX-ORG-16b (end) ===== */
    return html;
}
// ===== SAAS-15a (end) =====
function registerFail(username) { /* SECURITY-DEAD: با SEC-15b جایگزین شد — نگه‌داشته نشد */ }
function verify(username, password) {
    const users = loadUsers();
    const u = users.find((x) => safeEqual(x.username, username));
    if (!u) {
        /* SEC-15b: زمان‌مشابه ضد شمارش کاربر — کاربر ناموجود هم هزینهٔ scrypt می‌پردازد */
        try { crypto.scryptSync(String(password), 'decoy-salt-sec15b', 32, { N: 16384, r: 8, p: 1 }); } catch (e) { /* noop */ }
        return null;
    }
    const stored = (u.password_hash != null && String(u.password_hash).indexOf('scrypt$') === 0) ? u.password_hash : (u.password != null ? u.password : null);
    if (stored == null || !verifyPassword(password, stored)) return null;
    /* SEC-15b: ارتقای خودکار plaintext → hash پس از اولین ورود موفق (مهاجرت نرم per-user) */
    if (u.password_hash == null && u.password != null) {
        try {
            const upgraded = users.map((x) => {
                if (x !== u) return x;
                const c = Object.assign({}, x);
                delete c.password;
                c.password_hash = hashPassword(password);
                return c;
            });
            if (usersWrite15b(upgraded)) console.log('[Auth] SEC-15b: رمز کاربر', username, 'به hash ارتقا یافت');
        } catch (e) { /* بی‌ضرر — دفعهٔ بعد دوباره تلاش می‌شود */ }
    }
    /* HARDEN-18P: پرچم تغییر اجباری رمز همراه نشست حمل می‌شود (پاسخ لاگین + /api/auth/me) */
    return { username: u.username, role: u.role || 'viewer', name: u.name || u.username, must_change_pw: u.must_change_pw === true, modules: Array.isArray(u.modules) ? u.modules.slice() : undefined, modules_override: u.modules_override === true ? true : undefined }; /* USER-MGMT-39a: +ماژول‌ها | MODULE-OVERRIDE-41: +پرچم اجبار بر نقش — تک‌منبع گیت نمایش تب‌ها */
}
function getSession(req) {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s) return null;
    const now = Date.now();
    if (s.expires < now) { sessions.delete(sid); return null; } /* SEC-15b: سقف مطلق ۸ ساعت */
    if (s.lastSeen && now - s.lastSeen > SESSION_IDLE_MS) { sessions.delete(sid); return null; } /* SEC-15b: بی‌کاری ۳۰ دقیقه */
    s.lastSeen = now;
    return s;
}

// ---------------------------------------------------------------------
//  Inline login page (with password show/hide eye button).
//  The <script> below uses NO backticks / ${} so it is safe inside this
//  template literal.
// ---------------------------------------------------------------------
const LOGIN_HTML = `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ورود | صنعتی فای (SANATIFY) — ERP/MES فولاد</title>
<link href="https://cdn.jsdelivr.net/gh/rastikerdar/vazirmatn@v33.003/Vazirmatn-font-face.css" rel="stylesheet" />
<style>
  /* ===== FEAT-UI-4a: صفحهٔ ورود صنعتی — گرادیان سرمه‌ای + بافت خطوط کارخانه ===== */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { min-height: 100vh; }
  body {
    font-family: Vazirmatn, Tahoma, "Segoe UI", Arial, sans-serif;
    background:
      repeating-linear-gradient(115deg, rgba(127,180,216,.05) 0 2px, transparent 2px 46px),
      repeating-linear-gradient(0deg, rgba(127,180,216,.035) 0 1px, transparent 1px 90px),
      linear-gradient(135deg, #0b1622 0%, #0f2a43 55%, #12385a 100%);
    color: #e6f1f9;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 20px 16px;
  }
  .brand-top { display: flex; align-items: center; gap: 10px; margin-bottom: 22px; animation: ui4a-in .55s ease-out both; }
  .brand-mark {
    width: 46px; height: 46px; border-radius: 13px;
    background: linear-gradient(135deg, #0e7490, #0f2a43);
    display: flex; align-items: center; justify-content: center;
    font-size: 24px; box-shadow: 0 8px 22px rgba(2, 8, 20, .45), inset 0 0 0 1px rgba(127,180,216,.35);
  }
  .brand-name { font-size: 19px; font-weight: 800; letter-spacing: .2px; }
  .brand-name small { display: block; font-size: 10.5px; font-weight: 400; color: #7fb4d8; margin-top: 2px; }
  .card {
    background: #fff; color: #0f172a;
    border-radius: 18px; padding: 30px 28px 24px; width: 100%; max-width: 400px;
    box-shadow: 0 24px 60px rgba(2, 8, 20, .5);
    border-top: 4px solid #0e7490;
    animation: ui4a-in .55s ease-out .08s both;
  }
  @keyframes ui4a-in { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .brand-top, .card { animation: none; } }
  .card-head { text-align: center; margin-bottom: 22px; }
  .card-head .t { font-size: 15.5px; font-weight: 800; color: #0f2a43; }
  .card-head .s { font-size: 11.5px; color: #64748b; margin-top: 4px; }
  label { display: block; font-size: 12px; color: #334155; margin-bottom: 6px; font-weight: bold; }
  input { width: 100%; padding: 11px 13px; border: 1px solid #cbd5e1; border-radius: 10px; font-family: inherit; font-size: 14px; margin-bottom: 16px; text-align: right; background: #f8fafc; transition: border-color .2s, box-shadow .2s; }
  input:focus { outline: none; border-color: #0e7490; background: #fff; box-shadow: 0 0 0 3px rgba(14,116,144,.15); }
  .pw-wrap { position: relative; margin-bottom: 16px; }
  .pw-wrap input { margin-bottom: 0; padding-left: 46px; }
  .eye { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 18px; line-height: 1; color: #64748b; padding: 6px; border-radius: 6px; }
  .eye:hover { background: #f1f5f9; }
  button.submit {
    width: 100%; padding: 12px; border: none; border-radius: 10px;
    background: linear-gradient(135deg, #0e7490, #0f2a43); color: #fff;
    font-family: inherit; font-size: 15px; font-weight: 800; cursor: pointer;
    box-shadow: 0 6px 16px rgba(14,116,144,.35); transition: filter .2s, transform .1s;
  }
  button.submit:hover { filter: brightness(1.12); }
  button.submit:active { transform: translateY(1px); }
  button.submit:disabled { opacity: .6; cursor: not-allowed; }
  .err { color: #dc2626; font-size: 12px; text-align: center; min-height: 18px; margin-bottom: 10px; }
  .secure-note { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 10.5px; color: #64748b; margin-top: 14px; padding-top: 12px; border-top: 1px dashed #e2e8f0; }
  .page-foot { margin-top: 20px; text-align: center; font-size: 10.5px; color: #7fb4d8; opacity: .85; line-height: 1.9; animation: ui4a-in .55s ease-out .16s both; }
  .page-foot .sep { margin: 0 7px; opacity: .5; }
</style>
</head>
<body>
  <div class="brand-top">
    <div class="brand-mark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 20V9l6 4V9l6 4V5l8 4v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" fill="#7fd3e8"/><path d="M2 20V9l6 4V9l6 4V5l8 4v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" stroke="#e6f7ff" stroke-width="1.1"/><rect x="5" y="16" width="2.6" height="2.6" fill="#0f2a43"/><rect x="10.5" y="16" width="2.6" height="2.6" fill="#0f2a43"/><rect x="16" y="16" width="2.6" height="2.6" fill="#0f2a43"/></svg></div>
    <div class="brand-name">صنعتی فای (SANATIFY)<small>سامانه یکپارچه صنعتی فای (SANATIFY) — ERP/MES مدیریت، گزارش‌گیری و ردیابی تولید فولاد</small></div>
  </div>
  <form class="card" id="lf" autocomplete="on">
    <div class="card-head">
      <div class="t">ورود به سامانه</div>
      <div class="s">گزارش‌گیری و ردیابی تولید فولاد</div>
    </div>
    <label for="u">نام کاربری</label>
    <input id="u" name="username" type="text" autocomplete="username" required />
    <label for="p">رمز عبور</label>
    <div class="pw-wrap">
      <input id="p" name="password" type="password" autocomplete="current-password" required />
      <button type="button" class="eye" id="eye" tabindex="-1" aria-label="نمایش یا پنهان‌کردن رمز">👁</button>
    </div>
    <div class="err" id="err"></div>
    <button class="submit" id="btn" type="submit">ورود به پنل</button>
    <div class="secure-note">🔒 دسترسی محدود به پرسنل مجاز — تمام ورودها ثبت می‌شود</div>
  </form>
  <!-- ===== HARDEN-18P: فرم تغییر اجباری رمز (پیش از ورود به اپ) ===== -->
  <form class="card" id="chg" style="display:none" autocomplete="off">
    <div class="card-head">
      <div class="t">🔑 تغییر رمز عبور الزامی است</div>
      <div class="s">رمز فعلی شما ضعیف تشخیص داده شده است — برای ادامه، یک رمز جدید (حداقل ۸ کاراکتر، شامل حرف و رقم) بگذارید.</div>
    </div>
    <label for="np">رمز جدید</label>
    <input id="np" type="password" minlength="8" required autocomplete="new-password" />
    <label for="np2">تکرار رمز جدید</label>
    <input id="np2" type="password" minlength="8" required autocomplete="new-password" />
    <div class="err" id="chgErr"></div>
    <button class="submit" id="chgBtn" type="submit">ذخیره و ورود</button>
    <div class="secure-note">🔒 رمز جدید فقط به‌صورت هش (scrypt) ذخیره می‌شود</div>
  </form>
  <div class="page-foot">Sanatify ERP/MES v2.6<span class="sep">|</span>© ۱۴۰۵ صنعتی فای — تمام حقوق محفوظ است</div>
  <script>
    var f = document.getElementById('lf');
    var err = document.getElementById('err');
    var btn = document.getElementById('btn');
    var eye = document.getElementById('eye');
    var pw = document.getElementById('p');
    eye.addEventListener('click', function () {
      if (pw.type === 'password') { pw.type = 'text'; eye.textContent = '🙈'; }
      else { pw.type = 'password'; eye.textContent = '👁'; }
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      err.textContent = '';
      btn.disabled = true; btn.textContent = 'در حال ورود...';
      var u = document.getElementById('u').value;
      var p = pw.value;
      fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p })
      })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (o) {
        if (o.body && o.body.ok) {
          /* HARDEN-18P: تغییر اجباری رمز در ورود بعدی — فرم دوم روی همان صفحه */
          if (o.body.must_change_pw) { showChange18P(); return; }
          window.location.href = '/'; return;
        }
        if (o.status === 429) { err.textContent = 'تلاش بیش از حد؛ لطفاً کمی صبر کنید.'; }
        else { err.textContent = 'نام کاربری یا رمز عبور اشتباه است.'; }
        btn.disabled = false; btn.textContent = 'ورود به پنل';
      })
      .catch(function () { err.textContent = 'خطا در ارتباط با سرور.'; btn.disabled = false; btn.textContent = 'ورود به پنل'; });
    });
    /* ===== HARDEN-18P (begin): فرم تغییر اجباری رمز — تا تغییر، خروج به اپ ممکن نیست ===== */
    function showChange18P() {
      var lf18p = document.getElementById('lf'); if (lf18p) lf18p.style.display = 'none';
      var c2 = document.getElementById('chg');
      c2.style.display = 'block';
      c2.querySelector('#np').focus();
    }
    var chgForm = document.getElementById('chg'); /* همان فرم — شناسهٔ یکتا */
    if (chgForm) chgForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var chgErr = document.getElementById('chgErr');
      chgErr.textContent = '';
      var np = document.getElementById('np').value, np2 = document.getElementById('np2').value;
      if (np !== np2) { chgErr.textContent = 'تکرار رمز مطابقت ندارد.'; return; }
      var btn2 = document.getElementById('chgBtn');
      btn2.disabled = true; btn2.textContent = 'در حال ذخیره...';
      fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: pw.value, new_password: np })
      })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (o) {
        if (o.body && o.body.ok) { window.location.href = '/'; return; }
        chgErr.textContent = (o.body && o.body.message) || 'تغییر رمز ناموفق بود.';
        btn2.disabled = false; btn2.textContent = 'ذخیره و ورود';
      })
      .catch(function () { chgErr.textContent = 'خطا در ارتباط با سرور.'; btn2.disabled = false; btn2.textContent = 'ذخیره و ورود'; });
    });
    /* ===== HARDEN-18P (end) ===== */
  </script>
</body>
</html>`;

// ---------------------------------------------------------------------
//  handlePublic: serve login page + all /api/auth/* routes.
//  Returns TRUE if it handled the request (caller must `return`).
// ---------------------------------------------------------------------
function handlePublic(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/login') {
        if (getSession(req)) { redirect(res, '/'); return true; }
        htmlRes(res, loginHtml15a(), req); /* SAAS-15a: برندینگ تنانت + HARDEN-18G: nonce */
        return true;
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') { doLogin(req, res); return true; }
    /* ===== HARDEN-18P (begin): تغییر رمز توسط خود کاربر (جریان تغییر اجباری پس از لاگین) ===== */
    if (req.method === 'POST' && pathname === '/api/auth/change-password') { doChangePassword18P(req, res); return true; }
    /* ===== HARDEN-18P (end) ===== */
    if ((req.method === 'GET' || req.method === 'POST') && pathname === '/api/auth/logout') { doLogout(req, res); return true; }
    if (req.method === 'GET' && pathname === '/api/auth/me') { doMe(req, res); return true; }
    return false;
}

function doLogin(req, res) {
    readBody(req).then((body) => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch (e) { return jsonRes(res, { ok: false, error: 'invalid' }, 400); }
        /* SEC-15b: username پاک‌سازی می‌شود؛ password کلمه‌به‌کلمه (هش باید روی ورودی دقیق باشد) */
        const username = String(b.username || '').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, 100);
        const password = b.password != null ? String(b.password) : '';
        if (!username) return jsonRes(res, { ok: false, error: 'missing' }, 400);
        const ip15b = clientIp15b(req);
        const now = Date.now();
        const lockMs = Math.max(bfLockedMs15b(bfUser15b, username, now), bfLockedMs15b(bfIp15b, ip15b, now));
        if (lockMs > 0) {
            const ra = Math.ceil(lockMs / 1000);
            audit15b({ ts: new Date().toISOString(), user: username, role: '-', ip: ip15b, action: 'auth.login_locked', endpoint: '/api/auth/login', status: 429, user_agent: String(req.headers['user-agent'] || '').slice(0, 200), retry_after_sec: ra });
            return jsonRes(res, { ok: false, error: 'locked', message: 'تلاش بیش از حد — حساب موقتاً قفل شده است؛ لطفاً بعداً تلاش کنید.', retryAfterSec: ra }, 429);
        }
        const user = verify(username, password);
        if (!user) {
            const lockFor = registerLoginFail15b(username, ip15b, audit15b);
            console.log('[Auth] login FAIL ->', username, '(', ip15b, ')');
            if (lockFor > 0) {
                return jsonRes(res, { ok: false, error: 'locked', message: 'تلاش بیش از حد — ورود موقتاً قفل شد؛ ' + Math.round(lockFor / 60000) + ' دقیقه دیگر تلاش کنید.', retryAfterSec: Math.round(lockFor / 1000) }, 429);
            }
            return jsonRes(res, { ok: false, error: 'invalid' }, 401);
        }
        /* ===== FEAT-ADMIN-17a: کاربر غیرفعال‌شده توسط مدیر ⇒ لاگین مسدود با پیام فارسی ===== */
        if (isUserInactive17a(user.username)) {
            audit15b({ ts: new Date().toISOString(), user: user.username, role: user.role, ip: ip15b, action: 'auth.login_inactive', endpoint: '/api/auth/login', status: 403, user_agent: String(req.headers['user-agent'] || '').slice(0, 200) });
            console.log('[Auth] login BLOCKED (inactive) ->', user.username);
            return jsonRes(res, { ok: false, error: 'inactive', message: 'حساب کاربری شما غیرفعال شده است — لطفاً با مدیر سامانه تماس بگیرید.' }, 403);
        }
        /* SEC-15b: rotation — نشستِ کوکی قبلی (در صورت وجود) باطل و sid تازه صادر می‌شود (ضد fixation) */
        const oldSid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (oldSid) sessions.delete(oldSid);
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(sid, { user: user, expires: Date.now() + SESSION_MS, lastSeen: Date.now() });
        setCookie(res, sid);
        audit15b({ ts: new Date().toISOString(), user: user.username, role: user.role, ip: ip15b, action: 'auth.login_ok', endpoint: '/api/auth/login', status: 200, user_agent: String(req.headers['user-agent'] || '').slice(0, 200) });
        console.log('[Auth] login OK ->', user.username, '(' + user.role + ')', ip15b);
        /* HARDEN-18P: پرچم «تغییر اجباری رمز در ورود بعدی» به پاسخ لاگین می‌آید — صفحهٔ لاگین فرم اجباری نشان می‌دهد */
        return jsonRes(res, { ok: true, user: user, must_change_pw: user.must_change_pw === true });
    }).catch((e) => {
        if (e && e.code15b === 'PAYLOAD_TOO_LARGE') return jsonRes(res, { ok: false, error: 'payload_too_large', message: 'حجم درخواست بیش از حد مجاز است.' }, 413);
        return jsonRes(res, { ok: false, error: String(e && e.message ? e.message : e) }, 500);
    });
}
/* ===== HARDEN-18P: تغییر رمز توسط خود کاربر — نیازمند نشست فعال + رمز فعلی + رعایت سیاست ===== */
function doChangePassword18P(req, res) {
    const s = getSession(req);
    if (!s) return jsonRes(res, { ok: false, error: 'unauthorized' }, 401);
    readBody(req).then((body) => {
        let b = {};
        try { b = JSON.parse(body || '{}'); } catch (e) { return jsonRes(res, { ok: false, error: 'invalid' }, 400); }
        const curPw = b.current_password != null ? String(b.current_password) : '';
        const newPw = b.new_password != null ? String(b.new_password) : '';
        const ip18p = clientIp15b(req);
        const u = findUser17a(s.user.username);
        if (!u) return jsonRes(res, { ok: false, error: 'invalid', message: 'کاربر یافت نشد.' }, 401);
        const okCur = (() => { const uu = findUser17a(s.user.username); try { return verifyPassword(curPw, (uu && (uu.password_hash != null ? uu.password_hash : uu.password)) || ''); } catch (e) { return false; } })();
        if (!okCur) {
            audit15b({ ts: new Date().toISOString(), user: s.user.username, role: s.user.role, ip: ip18p, action: 'auth.change_pw_wrong_current', endpoint: '/api/auth/change-password', status: 403, user_agent: String(req.headers['user-agent'] || '').slice(0, 200) });
            return jsonRes(res, { ok: false, error: 'wrong_current', message: 'رمز فعلی اشتباه است.' }, 403);
        }
        const polErr = passwordPolicyError18P(newPw, s.user.username);
        if (polErr) return jsonRes(res, { ok: false, error: 'policy', message: polErr }, 400);
        const users18p = loadUsers();
        const target18p = users18p.find((x) => String(x.username || '').toLowerCase() === String(s.user.username).toLowerCase());
        if (!target18p) return jsonRes(res, { ok: false, error: 'invalid' }, 401);
        delete target18p.password; /* هر باقیماندهٔ plaintext پاک می‌شود */
        target18p.password_hash = hashPassword(newPw);
        target18p.password_changed_at = new Date().toISOString();
        target18p.must_change_pw = false;
        if (!writeUsers17a(users18p)) return jsonRes(res, { ok: false, error: 'write_failed', message: 'خطا در ذخیره‌سازی — دوباره تلاش کنید.' }, 500);
        /* rotation نشست: sid جدید برای همین کاربر با اسنپ‌شات تازه (پرچم must_change_pw=false) */
        const freshUser18p = Object.assign({}, s.user, { must_change_pw: false });
        const oldSid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        for (const [k, v] of sessions) { if (v.user && v.user.username === s.user.username && k !== oldSid) sessions.delete(k); }
        const newSid = crypto.randomBytes(32).toString('hex');
        sessions.delete(oldSid);
        sessions.set(newSid, { user: freshUser18p, expires: Date.now() + SESSION_MS, lastSeen: Date.now() });
        setCookie(res, newSid);
        audit15b({ ts: new Date().toISOString(), user: s.user.username, role: s.user.role, ip: ip18p, action: 'auth.password_changed', endpoint: '/api/auth/change-password', status: 200, user_agent: String(req.headers['user-agent'] || '').slice(0, 200) });
        console.log('[Auth] password changed (self) ->', s.user.username);
        return jsonRes(res, { ok: true });
    }).catch((e) => {
        if (e && e.code15b === 'PAYLOAD_TOO_LARGE') return jsonRes(res, { ok: false, error: 'payload_too_large' }, 413);
        return jsonRes(res, { ok: false, error: String(e && e.message ? e.message : e) }, 500);
    });
}
function doLogout(req, res) {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (sid) sessions.delete(sid);
    clearCookie(res);
    console.log('[Auth] logout');
    jsonRes(res, { ok: true });
}
function doMe(req, res) {
    const s = getSession(req);
    if (!s) return jsonRes(res, { ok: false }, 401);
    /* ===== SEC-LIC-24 (begin): is_owner — backward-compat: تا وقتی کاربر owner صریح نیست، admin همان مالک است ===== */
    const u24 = s.user || {};
    const role24 = String(u24.role || 'viewer');
    let isOwner24 = vendorRole37A(role24); /* VENDOR-37: vendor/owner = صاحب سیستم */
    if (!isOwner24 && role24 === 'admin') {
        try { isOwner24 = !loadUsers().some((x) => x && vendorRole37A(x.role) && x.active !== false); } catch (e) { isOwner24 = true; }
    }
    jsonRes(res, { ok: true, user: Object.assign({}, u24, { is_owner: isOwner24 }), dev_bypass: devBypass40() }); /* DEV-BYPASS-40: بنر قرمز کلاینت */
    /* ===== SEC-LIC-24 (end) ===== */
}

// ---------------------------------------------------------------------
//  enforce: block unauthenticated access to everything EXCEPT the
//  whitelisted app/monitoring endpoints. Returns TRUE if it blocked.
// ---------------------------------------------------------------------
function enforce(req, res, pathname) {
    if (PUBLIC_API.indexOf(pathname) !== -1 || isPublicApi24(pathname)) return false; // app + monitoring + MTC verify (FEAT-QC-PRO-24b) stay open
    const s = getSession(req);
    if (s) { req.user = s.user; return false; } // authenticated -> allow
    if (pathname.indexOf('/api/') === 0) { jsonRes(res, { error: 'unauthorized' }, 401); return true; }
    redirect(res, '/login');
    return true;
}

// ✅ ADDITIVE — RBAC: بررسی نقش کاربر برای endpointهای ورودی وب
function requireRole(req, allowed) {
    const u = req.user;
    if (!u) return false;
    const role = String(u.role || 'viewer');
    if (role === 'admin') return true;
    if (role === 'owner') return true; /* SEC-LIC-24: مالک سیستم — دسترسی کامل مثل admin (ویرایش لایسنس فقط مالک) */
    if (role === 'vendor') return true; /* VENDOR-37: صاحب سیستم — دسترسی کامل مثل admin */
    return allowed.indexOf(role) !== -1;
}

module.exports = {
    handlePublic: handlePublic, enforce: enforce, requireRole: requireRole,
    setTenantBranding15a: setTenantBranding15a,
    setSecureCookie15b: setSecureCookie15b, setCorsConfig15b: setCorsConfig15b, isOriginAllowed15b: isOriginAllowed15b,
    hashPassword: hashPassword, verifyPassword: verifyPassword, clientIp15b: clientIp15b, setAuditWriter15b: setAuditWriter15b, activeSessions15c: activeSessions15c, /* SEC-15b + SAAS-15c */
    passwordPolicyError18P: passwordPolicyError18P, /* HARDEN-18P: سیاست رمز برای endpoints ساخت/بازنشانی کاربر */
    killSessionsByUsername17a: killSessionsByUsername17a, activeSessionCount17a: activeSessionCount17a, refreshSessionUser17a: refreshSessionUser17a, isUserInactive17a: isUserInactive17a, writeUsers17a: writeUsers17a, findUser17a: findUser17a, /* FEAT-ADMIN-17a */
    loadUsers37: loadUsers, /* VENDOR-37: بارگذاری نرمال/سخت‌گیرانه/مهاجرت — server.js readUsers17a از همین مسیر می‌خواند */
    devBypass40: devBypass40, devBypassSecret40: function () { return DEV_BYPASS_SECRET_40; }, /* DEV-BYPASS-40: هم‌گامی مشتق‌کلید server.js */
};