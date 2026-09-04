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

const USERS_FILE = path.join(__dirname, 'web-users.json');
const SESSION_COOKIE = 'mes_session';
const SESSION_MS = 8 * 60 * 60 * 1000; /* SEC-15b: timeout مطلق ۸ ساعت (قبلاً ۱۲ ساعته لغزان) */
const SESSION_IDLE_MS = 30 * 60 * 1000; /* SEC-15b: idle timeout ۳۰ دقیقه از آخرین فعالیت */
const MAX_FAIL = 5;
const LOCK_MS = 60 * 1000;

// endpoints the mobile app / monitoring hit WITHOUT a web session
const PUBLIC_API = ['/api/ingest', '/api/health', '/api/snapshot'];

const sessions = new Map();   // sid -> { user, expires, lastSeen }
/* SEC-15b: سیستم قدیمی قفل ۶۰ثانیه‌ای per-username باregisterLoginFail15b دولایه جایگزین شد */

/* SEC-15b: نویسندهٔ audit از server.js تزریق می‌شود (مسیر واحد + چرخش ماهانه) */
let auditWriter15b = null;
function setAuditWriter15b(fn) { auditWriter15b = typeof fn === 'function' ? fn : null; }
function audit15b(entry) { try { if (auditWriter15b) auditWriter15b(entry); } catch (e) { /* بی‌ضرر */ } }

function loadUsers() {
    try {
        const arr = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.warn('[Auth] web-users.json missing/invalid -> nobody can log in to the web panel.');
        return [];
    }
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
function usersWrite15b(arr) { /* نوشتن اتمیک web-users.json — برای ارتقای خودکار per-user */
    try { const tmp = USERS_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(arr, null, 2) + String.fromCharCode(10), 'utf8'); fs.renameSync(tmp, USERS_FILE); return true; } catch (e) { return false; }
}
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
function htmlRes(res, html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); }

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
function escBrand15a(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function setTenantBranding15a(b) {
    tenantBrand15a = (b && (b.name || b.logo)) ? { name: String(b.name || ''), logo: String(b.logo || '') } : null;
}
function loginHtml15a() {
    if (!tenantBrand15a) return LOGIN_HTML;
    let html = LOGIN_HTML;
    if (tenantBrand15a.name) {
        html = html.split('ورود | صنعتی فای (SANATIFY) — ERP/MES فولاد').join('ورود | ' + escBrand15a(tenantBrand15a.name));
        html = html.split('<div class="brand-name">صنعتی فای (SANATIFY)<small>').join('<div class="brand-name">' + escBrand15a(tenantBrand15a.name) + '<small>');
    }
    if (tenantBrand15a.logo) {
        html = html.replace(/<div class="brand-mark"([^>]*)>[\s\S]*?<\/div>/, '<div class="brand-mark"><img src="' + escBrand15a(tenantBrand15a.logo) + '" alt="لوگو" style="width:34px;height:34px;border-radius:8px;object-fit:contain" /></div>');
    }
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
    return { username: u.username, role: u.role || 'viewer', name: u.name || u.username };
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
        if (o.body && o.body.ok) { window.location.href = '/'; return; }
        if (o.status === 429) { err.textContent = 'تلاش بیش از حد؛ لطفاً کمی صبر کنید.'; }
        else { err.textContent = 'نام کاربری یا رمز عبور اشتباه است.'; }
        btn.disabled = false; btn.textContent = 'ورود به پنل';
      })
      .catch(function () { err.textContent = 'خطا در ارتباط با سرور.'; btn.disabled = false; btn.textContent = 'ورود به پنل'; });
    });
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
        htmlRes(res, loginHtml15a()); /* SAAS-15a: برندینگ تنانت */
        return true;
    }
    if (req.method === 'POST' && pathname === '/api/auth/login') { doLogin(req, res); return true; }
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
        /* SEC-15b: rotation — نشستِ کوکی قبلی (در صورت وجود) باطل و sid تازه صادر می‌شود (ضد fixation) */
        const oldSid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
        if (oldSid) sessions.delete(oldSid);
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(sid, { user: user, expires: Date.now() + SESSION_MS, lastSeen: Date.now() });
        setCookie(res, sid);
        audit15b({ ts: new Date().toISOString(), user: user.username, role: user.role, ip: ip15b, action: 'auth.login_ok', endpoint: '/api/auth/login', status: 200, user_agent: String(req.headers['user-agent'] || '').slice(0, 200) });
        console.log('[Auth] login OK ->', user.username, '(' + user.role + ')', ip15b);
        return jsonRes(res, { ok: true, user: user });
    }).catch((e) => {
        if (e && e.code15b === 'PAYLOAD_TOO_LARGE') return jsonRes(res, { ok: false, error: 'payload_too_large', message: 'حجم درخواست بیش از حد مجاز است.' }, 413);
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
    jsonRes(res, { ok: true, user: s.user });
}

// ---------------------------------------------------------------------
//  enforce: block unauthenticated access to everything EXCEPT the
//  whitelisted app/monitoring endpoints. Returns TRUE if it blocked.
// ---------------------------------------------------------------------
function enforce(req, res, pathname) {
    if (PUBLIC_API.indexOf(pathname) !== -1) return false; // app + monitoring stay open
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
    return allowed.indexOf(role) !== -1;
}

module.exports = {
    handlePublic: handlePublic, enforce: enforce, requireRole: requireRole,
    setTenantBranding15a: setTenantBranding15a,
    setSecureCookie15b: setSecureCookie15b, setCorsConfig15b: setCorsConfig15b, isOriginAllowed15b: isOriginAllowed15b,
    hashPassword: hashPassword, verifyPassword: verifyPassword, clientIp15b: clientIp15b, setAuditWriter15b: setAuditWriter15b, activeSessions15c: activeSessions15c, /* SEC-15b + SAAS-15c */
};