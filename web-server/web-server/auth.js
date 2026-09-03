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
const SESSION_MS = 12 * 60 * 60 * 1000; // 12h sliding window
const MAX_FAIL = 5;
const LOCK_MS = 60 * 1000;

// endpoints the mobile app / monitoring hit WITHOUT a web session
const PUBLIC_API = ['/api/ingest', '/api/health', '/api/snapshot'];

const sessions = new Map();   // sid -> { user, expires }
const failures = new Map();   // username -> { count, until }

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
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=' + sid + '; HttpOnly; Path=/; SameSite=Lax; Max-Age=' + maxAge);
}
function clearCookie(res) {
    res.setHeader('Set-Cookie', SESSION_COOKIE + '=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let d = '';
        req.on('data', (c) => (d += c));
        req.on('end', () => resolve(d));
        req.on('error', reject);
    });
}
function jsonRes(res, obj, code) {
    const body = JSON.stringify(obj);
    res.writeHead(code || 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
    });
    res.end(body);
}
function redirect(res, loc) { res.writeHead(302, { 'Location': loc }); res.end(); }
function htmlRes(res, html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(html); }

function isLocked(username) {
    const f = failures.get(username);
    if (!f) return false;
    if (f.until && Date.now() < f.until) return true;
    if (f.until) failures.delete(username);
    return false;
}

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
function registerFail(username) {
    const f = failures.get(username) || { count: 0, until: 0 };
    f.count += 1;
    if (f.count >= MAX_FAIL) { f.until = Date.now() + LOCK_MS; f.count = 0; }
    failures.set(username, f);
}
function verify(username, password) {
    const u = loadUsers().find((x) => safeEqual(x.username, username));
    if (!u || !safeEqual(u.password, password)) return null;
    return { username: u.username, role: u.role || 'viewer', name: u.name || u.username };
}
function getSession(req) {
    const sid = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!sid) return null;
    const s = sessions.get(sid);
    if (!s) return null;
    if (s.expires < Date.now()) { sessions.delete(sid); return null; }
    s.expires = Date.now() + SESSION_MS; // sliding renewal
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
        const username = String(b.username || '').trim();
        const password = b.password != null ? String(b.password) : '';
        if (!username) return jsonRes(res, { ok: false, error: 'missing' }, 400);
        if (isLocked(username)) {
            return jsonRes(res, { ok: false, error: 'locked', retryAfterSec: Math.ceil(LOCK_MS / 1000) }, 429);
        }
        const user = verify(username, password);
        if (!user) { registerFail(username); console.log('[Auth] login FAIL ->', username); return jsonRes(res, { ok: false, error: 'invalid' }, 401); }
        failures.delete(username);
        const sid = crypto.randomBytes(32).toString('hex');
        sessions.set(sid, { user: user, expires: Date.now() + SESSION_MS });
        setCookie(res, sid);
        console.log('[Auth] login OK ->', user.username, '(' + user.role + ')');
        return jsonRes(res, { ok: true, user: user });
    }).catch((e) => jsonRes(res, { ok: false, error: String(e && e.message ? e.message : e) }, 500));
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

module.exports = { handlePublic: handlePublic, enforce: enforce, requireRole: requireRole, setTenantBranding15a: setTenantBranding15a };