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
<title>ورود | Sanatify MES</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Vazirmatn, Tahoma, "Segoe UI", Arial, sans-serif; background: #1e3d59; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .card { background: #fff; border-radius: 16px; padding: 32px 28px; width: 100%; max-width: 380px; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
  .logo { font-size: 20px; font-weight: bold; color: #1e3d59; text-align: center; margin-bottom: 6px; }
  .sub { font-size: 12px; color: #64748b; text-align: center; margin-bottom: 24px; }
  label { display: block; font-size: 12px; color: #475569; margin-bottom: 6px; font-weight: bold; }
  input { width: 100%; padding: 11px 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-family: inherit; font-size: 14px; margin-bottom: 16px; text-align: right; }
  input:focus { outline: none; border-color: #1e3d59; box-shadow: 0 0 0 3px rgba(30,61,89,.12); }
  .pw-wrap { position: relative; margin-bottom: 16px; }
  .pw-wrap input { margin-bottom: 0; padding-left: 46px; }
  .eye { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: 18px; line-height: 1; color: #64748b; padding: 6px; border-radius: 6px; }
  .eye:hover { background: #f1f5f9; }
  button.submit { width: 100%; background: #1e3d59; color: #fff; border: none; padding: 12px; border-radius: 10px; font-family: inherit; font-size: 15px; font-weight: bold; cursor: pointer; }
  button.submit:disabled { opacity: .6; cursor: not-allowed; }
  .err { color: #dc2626; font-size: 12px; text-align: center; min-height: 18px; margin-bottom: 10px; }
  .foot { font-size: 10px; color: #94a3b8; text-align: center; margin-top: 18px; }
</style>
</head>
<body>
  <form class="card" id="lf" autocomplete="on">
    <div class="logo">🏭 Sanatify MES</div>
    <div class="sub">ورود به پنل گزارش‌گیری و ردیابی</div>
    <label for="u">نام کاربری</label>
    <input id="u" name="username" type="text" autocomplete="username" required />
    <label for="p">رمز عبور</label>
    <div class="pw-wrap">
      <input id="p" name="password" type="password" autocomplete="current-password" required />
      <button type="button" class="eye" id="eye" tabindex="-1" aria-label="نمایش یا پنهان‌کردن رمز">👁</button>
    </div>
    <div class="err" id="err"></div>
    <button class="submit" id="btn" type="submit">ورود</button>
    <div class="foot">دسترسی محدود به پرسنل مجاز — تمام ورودها ثبت می‌شود</div>
  </form>
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
        btn.disabled = false; btn.textContent = 'ورود';
      })
      .catch(function () { err.textContent = 'خطا در ارتباط با سرور.'; btn.disabled = false; btn.textContent = 'ورود'; });
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
        htmlRes(res, LOGIN_HTML);
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

module.exports = { handlePublic: handlePublic, enforce: enforce, requireRole: requireRole };