// =====================================================================
//  Sanatify MES — سرور یکپارچهٔ مقاوم (ابر = پشتیبان، داخلی = قلب)
//  صفر وابستگی خارجی. ترتیب خواندن: Supabase -> live.json -> data.json
//  endpoint /api/ingest : دادهٔ sync‌شده از اپ را در live.json نگه می‌دارد
//  S1: احراز هویت وب (login + session) — /api/ingest و /api/health باز می‌مانند
// =====================================================================
const http = require('http');
// ===== FEAT-HTTPS-11c: ماژول داخلی https — صفر وابستگی جدید =====
const https = require('https');
// ===== FEAT-HTTPS-11d: ماژول داخلی net برای peek اولین بایت پورت اصلی — صفر وابستگی جدید =====
const net = require('net');
// ===== SEC-15b: ماژول داخلی crypto — هش رمز (scrypt معادل bcrypt در stdlib)، payload_hash و session id =====
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const PORT = process.env.PORT || 3001;
// ===== FEAT-HTTPS-11c: پورت قدیمی کارخانه (HTTP) — همهٔ درخواست‌ها 301 می‌شوند به سرویس اصلی =====
const REDIRECT_PORT = process.env.REDIRECT_PORT || 3000;
/* ===== SEC-PROTECT-19e (begin): پشتیبانی باینری pkg — فایل‌های داده (live.json/tenant.json/web-users.json/…) کنار exe، نه داخل snapshot فقط‌خواندنی ===== */
const RUNTIME_ROOT_19E = (function () { try { return process.pkg ? path.dirname(process.execPath) : __dirname; } catch (e19e) { return __dirname; } })();
/* ===== SEC-PROTECT-19e (end) ===== */
const ROOT = RUNTIME_ROOT_19E; /* SEC-PROTECT-19e */
const PUBLIC_DIR = path.join(__dirname, 'public'); /* SEC-PROTECT-19e: پوستهٔ استاتیک (index/sw/vendor) — در pkg از snapshot می‌خواند؛ در اجرای عادی همان قبل */
const PUBLIC_DATA_DIR_19E = path.join(RUNTIME_ROOT_19E, 'public'); /* SEC-PROTECT-19e: فایل‌های دادهٔ public (لوگوی آپلودی تنانت) کنار exe — در اجرای عادی همان PUBLIC_DIR */
try { fs.mkdirSync(PUBLIC_DATA_DIR_19E, { recursive: true }); } catch (e19e) { /* noop */ } /* SEC-PROTECT-19e */
const DATA_FILE = path.join(ROOT, 'data.json');  // ساختار خالی پیش‌فرض (fallback نهایی — PURGE-36: صفر دادهٔ نمایشی)
const LIVE_FILE = path.join(ROOT, 'live.json');  // آینهٔ زنده دادهٔ واقعی

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://djtrqqknanzrojrcgsca.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqdHJxcWtuYW56cm9qcmNnc2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NDM4ODcsImV4cCI6MjA4MjIxOTg4N30.-7O1_wGrD5JQqn2IRv2bFV9gb1PG_ot3Lk0FyxNJuDI';

const CACHE_TTL_MS = 4000;
const FETCH_TIMEOUT_MS = 6000;
const TABLES = ['production_logs', 'waste_logs', 'downtime_logs', 'quality_inspections', 'billets', 'furnace_logs', 'rebar_bundles'];

// ---------- ابزارهای فایل ----------
let cache = { data: null, at: 0, source: 'none' }; /* HARDEN-18F: از محل قدیمی به اینجا منتقل شد (بالای همهٔ مصرف‌کنندگان) */
function emptyDataset() {
    return { generated_at: null, production_logs: [], waste_logs: [], downtime_logs: [], quality_inspections: [], billets: [], furnace_logs: [], rebar_bundles: [] };
}
function isSupabaseConfigured() {
    return !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
        !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
        !SUPABASE_ANON_KEY.includes('YOUR-ANON-PUBLIC-KEY') &&
        !SUPABASE_ANON_KEY.includes('PASTE_YOUR_ANON_KEY');
}
// ===== HARDEN-18A (begin): لایهٔ محکم‌سازی ذخیره‌سازی — نوشتن اتمیک (tmp→fsync→rename) + checksum SHA-256 + بازیابی خودکار از زنجیرهٔ .bak شماره‌دار =====
const INTEG_FIELD_18A = '__integrity_18a'; /* فیلد checksum داخل خود JSON — خودکفا و مقاوم به کپی */
const BAK_CHAIN_LEN_18A = 5; /* زنجیرهٔ بازیابی: .bak.1 (تازه‌ترین) تا .bak.5 */
const BAK_MIN_INTERVAL_18A = Math.max(10, Number(process.env.HARDEN_BAK_MIN_SEC_18A) || 180) * 1000; /* حداقل فاصلهٔ بکاپ‌گیری (پیش‌فرض ۳ دقیقه) */
let lastBakAt18A = 0;
function sha256Hex18A(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex'); }
function integrityHash18A(obj) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const c = Object.assign({}, obj); delete c[INTEG_FIELD_18A];
        return sha256Hex18A(JSON.stringify(c, null, 2));
    }
    return sha256Hex18A(JSON.stringify(obj));
}
function atomicWriteText18A(file, text) { /* نوشتن اتمیک: tmp → fsync → rename → fsync پوشه (الگوی بهترین‌روال) */
    const tmp = file + '.tmp18a';
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); } finally { try { fs.closeSync(fd); } catch (e0) { /* noop */ } }
    fs.renameSync(tmp, file);
    try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { try { fs.closeSync(dfd); } catch (e2) { /* noop */ } } } catch (e) { /* fsync پوشه اختیاری است (ویندوز پشتیبانی نمی‌کند) */ }
}
function parseWithIntegrity18A(text) {
    /* خروجی: { ok, value } — فایل بدون فیلد integrity = legacy سالم (سازگاری به‌عقب) */
    let v;
    try { v = JSON.parse(text); } catch (e) { return { ok: false, value: null }; }
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof v[INTEG_FIELD_18A] === 'string') {
        const sig = v[INTEG_FIELD_18A];
        const expect = 'sha256:' + integrityHash18A(v);
        if (sig !== expect) return { ok: false, value: null }; /* دستکاری/خرابی جزئی */
        delete v[INTEG_FIELD_18A];
        return { ok: true, value: v };
    }
    return { ok: true, value: v };
}
function emergencyKeep18A(file, text) { /* نگه‌داری نسخهٔ خراب برای بازیابی دستی — دادهٔ کاربر هرگز از بین نمی‌رود */
    try { const p = file + '.corrupt-' + Date.now(); fs.writeFileSync(p, String(text || ''), 'utf8'); return p; } catch (e) { return ''; }
}
function bakChainPaths18A(file) { const out = []; for (let i = 1; i <= BAK_CHAIN_LEN_18A; i++) out.push(file + '.bak.' + i); return out; }
function rotateBaks18A(file) { /* بکاپ از نسخهٔ سالمِ قبلی پیش از بازنویسی — با throttle زمانی */
    const now = Date.now();
    if (now - lastBakAt18A < BAK_MIN_INTERVAL_18A) return;
    try {
        if (!fs.existsSync(file)) return;
        const cur = fs.readFileSync(file, 'utf8');
        if (!parseWithIntegrity18A(cur).ok) return; /* از نسخهٔ مشکوک بکاپ نمی‌گیریم */
        const chain = bakChainPaths18A(file);
        for (let i = BAK_CHAIN_LEN_18A; i > 1; i--) {
            try { if (fs.existsSync(chain[i - 2])) fs.renameSync(chain[i - 2], chain[i - 1]); else { try { fs.unlinkSync(chain[i - 1]); } catch (e2) { /* noop */ } } } catch (e) { /* noop */ }
        }
        fs.writeFileSync(chain[0], cur, 'utf8');
        lastBakAt18A = now;
    } catch (e) { /* بکاپ اختیاری است — نوشتن اصلی ادامه می‌یابد */ }
}
/* ===== HARDEN-18K (begin): محکم‌سازی آپلود — magic-bytes + پیوستن امن مسیر سراسری =====
   این دو کمک‌تابع در سطح ماژول‌اند تا هر endpoint آینده هم از آن‌ها استفاده کند (قاعدهٔ ضد path-traversal سراسری) */
function hardSafeJoin18K(baseDir, relName) {
    /* فقط نام فایل سادهٔ کوتاه؛ هرگونه / یا \ یا .. یا بایت تهی یا پیشوند درایو ویندوزی = رد قطعی */
    const rel = String(relName || '').trim();
    if (!rel || rel.length > 200) return null;
    if (rel.indexOf('\0') !== -1) return null;
    if (/[\\\/]/.test(rel) || /\.\./.test(rel) || /^[A-Za-z]:/.test(rel)) return null;
    const full = path.resolve(baseDir, rel);
    const base18k = path.resolve(baseDir) + path.sep;
    if (full.indexOf(base18k) !== 0) return null; /* حتماً داخل پوشهٔ پایه بماند (حتی پس از resolve) */
    return full;
}
function hardMagicOk18K(buf, ext) {
    /* تشخیص نوع واقعی فایل از امضای بایتی — نه اعتماد به پسوند/نام */
    try {
        if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
        if (ext === 'pdf') return buf.slice(0, 5).toString('latin1') === '%PDF-';
        if (ext === 'png') { const p18k = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]; for (let i = 0; i < 8; i++) { if (buf[i] !== p18k[i]) return false; } return true; }
        if (ext === 'jpg') return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
        return false;
    } catch (e) { return false; }
}
/* ===== HARDEN-18K (end) ===== */
function recoverFromBaks18A(file) { /* جدیدترین → قدیمی‌ترین؛ اولین نسخهٔ سالم برنده است */
    const chain = bakChainPaths18A(file);
    for (let i = 0; i < chain.length; i++) {
        try {
            if (!fs.existsSync(chain[i])) continue;
            const text = fs.readFileSync(chain[i], 'utf8');
            const r = parseWithIntegrity18A(text);
            if (r.ok) return { text: text, value: r.value, from: path.basename(chain[i]) };
        } catch (e) { /* بکاپ بعدی */ }
    }
    return null;
}
function alarm18A(msg) { /* گزارش خرابی در audit + کنسول — الگوی SEC-LIC-24 */
    console.error('[HARDEN-18A] ' + msg);
    try {
        if (typeof writeAudit15b === 'function') writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: 'storage.integrity', endpoint: 'hardening-18a', status: 500, user_agent: 'HARDEN-18A', payload_hash: '', ms: 0, detail: String(msg).slice(0, 300) });
    } catch (e) { /* noop */ }
}
function readJson(file) { /* HARDEN-18A: خواندن با اعتبارسنجی checksum + بازیابی خودکار از زنجیرهٔ .bak */
    let text = readMaybeEnc19g(file); /* SEC-ANTI-19g: tenant/web-users رمزنگاری‌شده پشتیبانی می‌شود — بقیه فایل‌ها بدون .enc مثل قبل */
    if (text == null) {
        if (!fs.existsSync(file) && !fs.existsSync(file + '.enc')) return null; /* فایل موجود نیست — رفتار قدیمی حفظ شد */
        text = '';
    }
    const r = parseWithIntegrity18A(text);
    if (r.ok) return r.value;
    /* خرابی/دستکاری → نگه‌داری نسخهٔ خراب + بازیابی خودکار */
    const kept = text ? emergencyKeep18A(file, text) : '';
    const rec = recoverFromBaks18A(file);
    if (rec) {
        try { atomicWriteText18A(file, rec.text); } catch (e) { /* بازیابی روی دیسک ناموفق — مقدار از حافظه برمی‌گردد */ }
        alarm18A('فایل ' + path.basename(file) + ' خراب/دستکاری‌شده بود → بازیابی خودکار از ' + rec.from + (kept ? ' (نسخهٔ خراب حفظ شد: ' + path.basename(kept) + ')' : ''));
        return rec.value;
    }
    if (text) alarm18A('فایل ' + path.basename(file) + ' غیرقابل‌خواندن است و بکاپ سالمی یافت نشد' + (kept ? ' — نسخهٔ خراب حفظ شد: ' + path.basename(kept) : ''));
    return null; /* رفتار قدیمی (null) حفظ شد */
}
function writeJson(file, obj) { /* HARDEN-18A: اتمیک + checksum — امضای قدیمی (true/false) حفظ شد */
    try {
        const isObj = obj && typeof obj === 'object' && !Array.isArray(obj);
        const out = isObj ? Object.assign({}, obj) : obj;
        if (isObj) {
            /* HARDEN-18D: شمارندهٔ نسخهٔ داده — هر نوشتن live.json یک واحد افزایش می‌یابد (برای 409 خوش‌بینانه) */
            if (file === LIVE_FILE) out.__ver = (Number(obj.__ver) || 0) + 1;
            out[INTEG_FIELD_18A] = 'sha256:' + integrityHash18A(out); /* آرایه‌ها (audit.json) بدون فیلد — زنجیرهٔ هش 18-m پوشش می‌دهد */
        }
        const body = JSON.stringify(out, null, 2);
        rotateBaks18A(file);
        atomicWriteText18A(file, body);
        /* HARDEN-18F (begin): invalidation دقیق کش خواندن — پس از نوشتن موفق live.json، کش همان لحظه با نسخهٔ تازه (بدون فیلد integrity، با __ver) به‌روز می‌شود */
        if (file === LIVE_FILE) {
            try {
                const fresh18f = Object.assign({}, out);
                delete fresh18f[INTEG_FIELD_18A];
                cache.data = fresh18f; cache.at = Date.now(); cache.source = 'live-cache';
            } catch (e) { cache.data = null; cache.at = 0; } /* خطا ⇒ کش خالی — خواندن بعدی از دیسک */
        }
        /* HARDEN-18F (end) */
        return true;
    } catch (e) { console.warn('[Server] writeJson failed:', e.message); return false; }
}
function bootValidate18A() { /* HARDEN-18A: validation اسکیما در بوت + گزارش یک‌خطی */
    const out18a = [];
    try {
        const live18a = readJson(LIVE_FILE);
        if (!live18a) out18a.push('live.json: خالی/ناموجد');
        else {
            const okT18a = TABLES.filter((t) => Array.isArray(live18a[t])).length;
            const miss18a = TABLES.filter((t) => !Array.isArray(live18a[t]));
            out18a.push('live.json: OK (' + okT18a + '/' + TABLES.length + ' جدول' + (miss18a.length ? '؛ غایب: ' + miss18a.join(',') : '') + ')');
        }
        const u18a = readJson(path.join(ROOT, 'web-users.json'));
        out18a.push('web-users.json: ' + (Array.isArray(u18a) ? 'OK (' + u18a.length + ' کاربر)' : 'ناموجد/خراب'));
        const a18a = readJson(AUDIT_FILE_15B);
        out18a.push('audit.json: ' + (Array.isArray(a18a) ? 'OK (' + a18a.length + ' رکورد)' : 'جدید/ناموجد'));
    } catch (e) { out18a.push('خطا: ' + ((e && e.message) || e)); }
    console.log('[HARDEN-18A] اعتبارسنجی بوت → ' + out18a.join(' | '));
}
// ===== HARDEN-18A (end) =====
// ===== HARDEN-18D (begin): صف تک‌نویسنده (Single-Writer Queue) + همزمانی خوش‌بینانه (__ver + 409 VER_CONFLICT) =====
// در سرور تک‌نخ (Node) هر بخشِ همگامِ خواندن-تغییر-نوشتن ذاتاً اتمیک است؛ صف برای هر جریانی که
// فاصلهٔ async میان خواندن و نوشتن داشته باشد ترتیب را تضمین می‌کند (ورود اپ موبایل + جریان‌های آینده).
let liveWriteChain18D = Promise.resolve();
function withLiveWrite18D(fn) { /* همهٔ نوشتن‌ها از یک زنجیرهٔ ترتیبی عبور می‌کنند — خطای یک کار صف را نمی‌شکند */
    const run = liveWriteChain18D.then(() => Promise.resolve().then(fn));
    liveWriteChain18D = run.then(() => undefined, () => undefined);
    return run;
}
function currentVer18D(liveObj) { /* نسخهٔ فعلی داده — از شیء موجود یا خواندن فایل */
    if (liveObj && typeof liveObj === 'object') return Number(liveObj.__ver) || 0;
    try { return Number(JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8')).__ver) || 0; } catch (e) { return 0; }
}
function assertFreshVer18D(req, liveObj) { /* خوش‌بینانه: هدر X-Base-Ver کهنه ⇒ تعارض (انتخابی — بدون هدر = رفتار قدیمی) */
    const raw = req && req.headers ? req.headers['x-base-ver'] : null;
    if (raw == null || String(raw).trim() === '') return null;
    const base = Number(raw);
    const cur = currentVer18D(liveObj);
    if (isNaN(base) || base !== cur) return { expected: base, actual: cur };
    return null;
}
function verConflict18D(res, vc) {
    return sendJson(res, { error: 'نسخهٔ داده در این فاصله تغییر کرده است — دوباره بارگذاری و تلاش کنید.', code: 'VER_CONFLICT', base_ver: vc.expected, current_ver: vc.actual }, 409);
}
// ===== HARDEN-18D (end) =====
// ===== REVERT-STEEL-4: مهاجرت امن و برگشت‌پذیر انبار فولادی — ادغام spare→raw (مواد اولیه/قطعات/ملزومات) =====
function migrateSteelWarehouses(live) {
    if (!live || live._steel_wh_v1) return live;
    const MAP = { spare: 'raw' };
    const cols = ['inventory_receipts', 'inventory_issues', 'inventory_transfers', 'inventory_adjustments', 'inventory_reservations'];
    const fields = ['warehouse', 'from_warehouse', 'to_warehouse'];
    let moved = 0;
    cols.forEach((k) => {
        if (!Array.isArray(live[k])) return;
        live[k].forEach((r) => {
            fields.forEach((f) => { if (r && r[f] && MAP[r[f]]) { r[f] = MAP[r[f]]; moved++; } });
        });
    });
    let backupOk = false;
    try {
        const backupName = LIVE_FILE + '.bak_steel_wh_v1';
        if (!fs.existsSync(backupName)) fs.copyFileSync(LIVE_FILE, backupName);
        backupOk = true;
        console.log('[STEEL-WH] backup ready: live.json.bak_steel_wh_v1');
    } catch (e) { console.warn('[STEEL-WH] backup failed:', e.message); }
    live._steel_wh_v1 = { at: new Date().toISOString(), moved: moved, backup: backupOk ? 'live.json.bak_steel_wh_v1' : '', note: 'ادغام انبار قطعات و مصرفی در مواد اولیه/قطعات/ملزومات — بازگشت: بازگردانی فایل بکاپ و حذف این فیلد' };
    writeJson(LIVE_FILE, live);
    console.log('[STEEL-WH] migration v1 done, moved=' + moved);
    return live;
}
function readLive() { return readJson(LIVE_FILE) || emptyDataset(); }
async function readJsonAsync18F(file) { /* HARDEN-18F: خواندن غیرمسدودکنندهٔ دیسک با fs.promises — بدون تغییر معناشناسی؛ خرابی ⇒ مسیر بازیابی همگام 18A */
    try { return parseWithIntegrity18A(await fs.promises.readFile(file, 'utf8')).value; }
    catch (e) { if (e && e.code === 'ENOENT') return null; return readJson(file); }
}
function hasAnyLive(live) { return TABLES.some((t) => Array.isArray(live[t]) && live[t].length > 0); }

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const ac = new AbortController();
        const t = setTimeout(() => { ac.abort(); reject(new Error('timeout')); }, ms);
        promise(ac.signal).then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
    });
}

async function fetchTable(table, signal) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, {
        method: 'GET', signal,
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} on ${table}`);
    const d = await res.json();
    return Array.isArray(d) ? d : [];
}

// ادغام دادهٔ ورودی (از اپ یا ابر) در آینهٔ زنده، بر اساس id
function mergeIntoLive(incoming) {
    const live = readLive();
    const counts = {};
    for (const t of TABLES) {
        const inc = Array.isArray(incoming && incoming[t]) ? incoming[t] : [];
        const map = new Map();
        (live[t] || []).forEach((r) => { if (r && r.id) map.set(r.id, r); });
        inc.forEach((r) => { if (r && r.id) map.set(r.id, r); });
        live[t] = Array.from(map.values());
        counts[t] = inc.length;
    }
    live.generated_at = new Date().toISOString();
    writeJson(LIVE_FILE, live);
    return counts;
}

// ---------- خواندن داده با ترتیبِ مقاوم ----------
/* HARDEN-18F: اعلان cache به بالای فایل منتقل شد تا writeJson بتواند پس از هر نوشتن، کش را همان لحظه تازه کند (invalidation دقیق — قبلاً تا ۴ ثانیه کهنه می‌ماند) */
// ---------- خواندن داده با ترتیبِ مقاوم (داخلی = قلب، ابر = پشتیبان) ----------
async function loadData() {
    const now = Date.now();
    if (cache.data && (now - cache.at) < CACHE_TTL_MS) return cache.data;
    // ۱) داخلی اول: آینهٔ زندهٔ کارخانه (آفلاین-اول) — HARDEN-18F: خواندن با fs.promises (غیرمسدودکننده)
    const live = (await readJsonAsync18F(LIVE_FILE)) || emptyDataset();
    if (hasAnyLive(live)) { cache = { data: live, at: now, source: 'live-cache' }; return live; }
    // ۲) داخلی خالی است -> ابر (پشتیبان)؛ و هرگز ابرِ خالی را روی داخلی ننویس
    if (isSupabaseConfigured()) {
        try {
            const obj = await withTimeout(async (signal) => {
                const results = await Promise.all(TABLES.map((t) => fetchTable(t, signal)));
                const o = { generated_at: new Date().toISOString() };
                TABLES.forEach((t, i) => { o[t] = results[i]; });
                return o;
            }, FETCH_TIMEOUT_MS);
            if (hasAnyLive(obj)) { writeJson(LIVE_FILE, obj); cache = { data: obj, at: now, source: 'supabase' }; return obj; }
        } catch (e) {
            console.warn('[Server] Supabase unreachable -> sample fallback:', e.message);
        }
    }
    // ۳) هر دو خالی -> نمونهٔ اولیه
    const sample = readJson(DATA_FILE) || emptyDataset();
    cache = { data: sample, at: now, source: 'local-sample' };
    return sample;
}

// ---------- پاسخ‌ها ----------
function sendJson(res, obj, code = 200) {
    const body = JSON.stringify(obj);
    // ===== SEC-15b: CORS دقیق — فقط originهای مجاز از tenant.custom_settings.allowed_origins (پیش‌فرض: همان‌مبدأ = بدون هدر ACAO) =====
    const h15b = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
    const req15b = res.__req15b;
    const origin15b = req15b ? String(req15b.headers.origin || '') : '';
    if (origin15b && auth.isOriginAllowed15b(origin15b)) {
        h15b['Access-Control-Allow-Origin'] = origin15b;
        h15b['Access-Control-Allow-Credentials'] = 'true';
    }
    res.writeHead(code, h15b);
    res.end(body);
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' }); res.end(data);
    });
}
/* ===== HARDEN-18G (begin): سرو HTML با nonce per درخواست — تزریق به <script>/<style> + global __CSP_NONCE__ برای پنجره‌های چاپ (about:blank CSP opener را به ارث می‌برد) ===== */
function sendHtmlNonce18G(res, filePath, nonce18g) {
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
        const n18g = String(nonce18g || '');
        let html = data.toString('utf8');
        if (n18g) {
            html = html.replace('<head>', '<head><script nonce="' + n18g + '">window.__CSP_NONCE__=' + JSON.stringify(n18g) + ';</script>');
            html = html.replace(/<script>/g, '<script nonce="' + n18g + '">').replace(/<style>/g, '<style nonce="' + n18g + '">');
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });
}
/* ===== HARDEN-18G (end) ===== */
function readBody(req) {
    // ===== SEC-15b: سقف ۱MB روی بدنه + پاک‌سازی JSON مرکزی (همهٔ هندلرها خودکار پوشش می‌شوند) =====
    const CAP_15B = 1024 * 1024;
    return new Promise((resolve, reject) => {
        let d = '';
        let over15b = false;
        req.on('data', (c) => {
            if (over15b) return;
            d += c;
            if (d.length > CAP_15B) {
                over15b = true;
                const e = new Error('payload too large'); e.code15b = 'PAYLOAD_TOO_LARGE';
                try { req.destroy(); } catch (e2) { /* noop */ }
                reject(e);
            }
        });
        req.on('end', () => { if (!over15b) resolve(sanitizeRawJson15b(d)); });
        req.on('error', reject);
    });
}
// ===== SEC-15b (begin): پاک‌سازی ورودی سراسری — trim + سقف طول + حذف کنترل‌کاراکترها + خنثی‌سازی <> =====
// الگوی OWASP: اعتبارسنجی ورودی + کدگذاری در رندر (esc() کلاینت) — این لایه سد دوم است
const INPUT_MAX_STR_15B = 100000; // سقف رشتهٔ واحد (بدون آسیب به پای‌لودهای بزرگ ingest)
function sanitizeInput15b(obj, depth) {
    const d = depth || 0;
    if (d > 8) return null; // عمق غیرمعمول → حذف
    if (obj === null || obj === undefined) return obj;
    const t = typeof obj;
    if (t === 'string') {
        let s = obj;
        const isDataUrl15c = s.indexOf('data:image/') === 0; /* SEC-15c: dataURL لوگو از سقف رشته مستثنی */
        if (!isDataUrl15c && s.length > INPUT_MAX_STR_15B) s = s.slice(0, INPUT_MAX_STR_15B);
        s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); // کنترل‌کاراکترها (به‌جز \n \r \t)
        s = s.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return s;
    }
    if (t === 'number' || t === 'boolean') return obj;
    if (Array.isArray(obj)) {
        if (obj.length > 5000) obj = obj.slice(0, 5000);
        return obj.map((x) => sanitizeInput15b(x, d + 1));
    }
    if (t === 'object') {
        const keys = Object.keys(obj);
        const o = {};
        keys.slice(0, 500).forEach((k) => { o[k] = sanitizeInput15b(obj[k], d + 1); });
        return o;
    }
    return null; // توابع/سایر انواع → حذف
}
// اگر بدنه JSON معتبر بود → پاک‌سازی و بازسری؛ وگرنه عبور خام (هندلرهای JSON آن را ۴۰۰ می‌دهند)
function sanitizeRawJson15b(raw) {
    try {
        const t = String(raw || '').trim();
        if (!t || (t[0] !== '{' && t[0] !== '[')) return raw;
        return JSON.stringify(sanitizeInput15b(JSON.parse(t)));
    } catch (e) { return raw; }
}
// ===== SEC-15b (end) =====

// ---------- محاسبات ----------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (p, t) => (t > 0 ? round2((p / t) * 100) : 0);
/* ===== FIX-WASTE-26a (begin): ضایعات وزنی — پایان شیفت بر اساس تُن اعلام می‌شود (مثلاً «سایز ۱۴، ۵ تن ضایعات»).
    فیلد جدید tonnage_ton (تناژ بر حسب تن، اعشاری) + product_size (اختیاری).
    رکوردهای قدیمی که فقط quantity (تعداد) دارند دست‌نخورده می‌مانند (legacy) و در جمع‌های وزنی حذف می‌شوند
    (نه صفر شدن — صرفاً مشارکت ندارند)؛ ابزار مهاجرت وجود ندارد و دادهٔ قدیمی تغییر نمی‌کند. ===== */
const wasteKgOf26a = (r) => (r && Number(r.tonnage_ton) > 0) ? Number(r.tonnage_ton) * 1000 : 0; /* kg معادل تناژ — رکورد بدون تناژ → ۰ (حذف از جمع وزنی) */
function buildSummary(d) {
    const prodQty = (d.production_logs || []).reduce((s, r) => s + (Number(r.good_quantity) || 0), 0);
    const wasteQty = (d.waste_logs || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const wasteTon26a = (d.waste_logs || []).reduce((s, r) => s + (Number(r.tonnage_ton) > 0 ? Number(r.tonnage_ton) : 0), 0); /* FIX-WASTE-26a: جمع تناژ (تن) */
    const downMin = (d.downtime_logs || []).reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0);
    const bundleWeight = (d.rebar_bundles || []).reduce((s, r) => s + (Number(r.net_weight_kg) || 0), 0);
    const billetWeight = (d.billets || []).reduce((s, r) => s + (Number(r.initial_weight_kg) || 0), 0);
    return {
        generated_at: d.generated_at || null, production_good_quantity: prodQty, production_log_count: (d.production_logs || []).length,
        waste_quantity: wasteQty, waste_tonnage_ton: round2(wasteTon26a) /* FIX-WASTE-26a: تناژ وزنی ضایعات (تن) */, waste_log_count: (d.waste_logs || []).length, downtime_minutes: downMin, downtime_count: (d.downtime_logs || []).length,
        quality_count: (d.quality_inspections || []).length, bundle_count: (d.rebar_bundles || []).length, bundle_weight_kg: round2(bundleWeight),
        billet_weight_kg: round2(billetWeight), yield_rate_percent: pct(bundleWeight, billetWeight),
    };
}
function buildGenealogy(d, heat) {
    const h = String(heat || '').trim();
    return { heat_number: h, billets: (d.billets || []).filter((x) => String(x.heat_number) === h), furnace_logs: (d.furnace_logs || []).filter((x) => String(x.heat_number) === h), rebar_bundles: (d.rebar_bundles || []).filter((x) => String(x.heat_number) === h), production_logs: (d.production_logs || []).filter((x) => String(x.heat_number || '') === h), consumed_materials: (d.inventory_issues || []).filter((x) => String(x.heat_number || '') === h || String(x.work_order || '') === h || String(x.destination_ref || '') === h) };
}
function buildBalance(d, heat) {
    const g = buildGenealogy(d, heat);
    const input = g.billets.reduce((s, r) => s + (Number(r.initial_weight_kg) || 0), 0);
    const output = g.rebar_bundles.reduce((s, r) => s + (Number(r.net_weight_kg) || 0), 0);
    let scale = round2(input - output); if (scale < 0) scale = 0;
    return { heat_number: g.heat_number, input_weight_kg: round2(input), output_weight_kg: round2(output), scrap_weight_kg: 0, scale_loss_kg: scale, yield_rate_percent: pct(output, input), scrap_rate_percent: 0, scale_loss_percent: pct(scale, input), billet_count: g.billets.length, bundle_count: g.rebar_bundles.length };
}

// ✅ ADDITIVE — health سریع و مستقل؛ هرگز پشتِ fetchِ ابر قفل نمی‌شود
function handleHealthFast(req, res) {
    const live = readLive();
    return sendJson(res, {
        ok: true,
        source: cache.source,
        configured: isSupabaseConfigured(),
        live_cache_present: hasAnyLive(live),
        generated_at: (live && live.generated_at) || null,
        data_ver: Number(live.__ver) || 0, /* HARDEN-18D: نسخهٔ داده برای همزمانی خوش‌بینانه (افزاینده) */
        pid: process.pid,
        uptime_sec: Math.round(process.uptime()),
    });
}

// ---------- سرور ----------
// ===== SAAS-15a (begin): تنانت + لایسنس — تک‌نمونه با فایل tenant.json کنار server.js =====
// الگو: استقرار per-tenant (یک سرور برای هر مشتری، پیکربندی با tenant.json — الگوی standalone-app
// الگوهای SaaS Azure با ایزوله‌سازی کامل داده؛ ERPNext هر tenant را یک site جدا می‌گیرد، ما هر استقرار را)
const TENANT_FILE_15A = path.join(ROOT, 'tenant.json');
const MODULES_15A = ['summary', 'analytics', 'production', 'quality', 'inventory', 'maintenance', 'em', 'planning', 'finance', 'sales', 'purchase']; /* FEAT-SALES-21a: +ماژول فروش (گیت لایسنس مثل بقیه) + FEAT-PURCHASE-22a: +ماژول خرید */
/* ===== GO-LIVE-32 (begin): گیت دامنهٔ راه‌اندازی — hidden_tabs (فقط UI؛ هیچ endpoint/منطق عملیاتی تغییر نمی‌کند) =====
   • tenant.json: hidden_tabs: ["warehouse","finance",…] — غایب/خالی = همهٔ تب‌ها (سازگاری کامل با استقرارهای موجود)
   • شناسه‌ها عیناً از #nav button[data-tab] در public/index.html استخراج شدند (نه حدس)؛ «org» پنل سازمان است و هرگز مخفی نمی‌شود
   • بیرون licCanonical24 است ⇒ امضای لایسنس را نمی‌شکند */
const TABS_32 = ['summary', 'analytics', 'production', 'waste', 'downtime', 'quality', 'genealogy', 'balance', 'warehouse', 'maintenance', 'planning', 'finance', 'sales', 'purchase', 'org'];
/* ===== GO-LIVE-32 (end) ===== */
const DEFAULT_TENANT_15A = {
    tenant_id: 'sanatify', name: 'صنعتی فای', logo: '', brand_colors: {},
    active_modules: MODULES_15A.slice(), max_users: 0, max_records: 0,
    hidden_tabs: [], /* GO-LIVE-32: گیت دامنهٔ راه‌اندازی */
    role_caps: {}, /* FEAT-ADMIN-17a: سقف نفرات هر نقش (۰ = بی‌سقف) */
    license_key: '', expires_at: '', custom_settings: {}
};
let tenantCache15a = null, tenantMtime15a = 0;
// خواندن با کش mtime — تغییر CLI/پنل بدون ری‌استارت از درخواست بعدی اعمال می‌شود
function loadTenant15a() {
    try {
        /* SEC-ANTI-19g: tenant.json.enc اولویت دارد — mtime هرکدام که موجود است ملاک کش */
        const st = fs.existsSync(TENANT_FILE_15A) ? fs.statSync(TENANT_FILE_15A) : (fs.existsSync(TENANT_FILE_15A + '.enc') ? fs.statSync(TENANT_FILE_15A + '.enc') : null);
        if (!st) { tenantCache15a = null; return DEFAULT_TENANT_15A; }
        if (tenantCache15a && st.mtimeMs === tenantMtime15a) return tenantCache15a;
        const rawTxt15g = readMaybeEnc19g(TENANT_FILE_15A); /* SEC-ANTI-19g */
        if (rawTxt15g == null) { tenantCache15a = null; return DEFAULT_TENANT_15A; }
        const raw = JSON.parse(rawTxt15g);
        const cfg = Object.assign({}, DEFAULT_TENANT_15A, raw);
        if (!Array.isArray(cfg.active_modules)) cfg.active_modules = MODULES_15A.slice();
        else cfg.active_modules = cfg.active_modules.filter((m) => MODULES_15A.indexOf(m) !== -1);
        if (!cfg.active_modules.length) cfg.active_modules = MODULES_15A.slice(); // پیکربندی خراب → قفل کامل نه؛ همهٔ ماژول‌ها
        if (!cfg.custom_settings || typeof cfg.custom_settings !== 'object' || Array.isArray(cfg.custom_settings)) cfg.custom_settings = {};
        if (!Array.isArray(cfg.hidden_tabs)) cfg.hidden_tabs = []; /* GO-LIVE-32: گیت دامنه — پاک‌سازی شناسه‌های ناشناخته */
        else cfg.hidden_tabs = cfg.hidden_tabs.map((t) => String(t || '').trim()).filter((t) => TABS_32.indexOf(t) !== -1);
        if (!cfg.role_caps || typeof cfg.role_caps !== 'object' || Array.isArray(cfg.role_caps)) cfg.role_caps = {}; /* FEAT-ADMIN-17a */
        applyLicenseSigGuard24(cfg, st.mtimeMs); /* SEC-LIC-24: تأیید امضا در هر خواندن/بوت */
        tenantCache15a = cfg; tenantMtime15a = st.mtimeMs;
        return cfg;
    } catch (e) {
        console.warn('[SaaS-15a] tenant.json نامعتبر — حالت پیش‌فرض (همهٔ ماژول‌ها فعال):', (e && e.message) || e);
        tenantCache15a = null; return DEFAULT_TENANT_15A;
    }
}
// ===== SEC-LIC-24 (begin): امضای دیجیتال لایسنس (HMAC-SHA256) + لایسنس پایه + نقش مالک =====
/* FIX-LIC-27: ترتیب منبع کلید HMAC در سرور —
   ۱) env SANATIFY_LIC_KEY   ۲) فایل ماشین‌محلی license.key کنار server.js/exe (ACL: فقط Administrators/System —
   tools/license.js هنگام --sign اگر نبود، با کلید env می‌سازد)   ۳) پیش‌فرض (که همیشه نامعتبر است — ابزار امضا
   هرگز با آن امضا نمی‌کند). قبلاً کلید فقط هنگام بارگذاری ماژول از env خوانده می‌شد؛ بوت سردِ خودکار
   (Startup→wscript→bat / سرویس) بدون env با کلید پیش‌فرض verify می‌کرد ⇒ بنر «لایسنس نامعتبر» —
   دو بار در استقرار واقعی تکرار شد؛ حالا ساختاری حل شده است، نه دستی. */
const LIC_KEY_FILE_27 = path.join(ROOT, 'license.key');
const LIC_DEFAULT_KEY_27 = 'Sanatify-Lic-Verify::v1::1405'; /* فقط سقوط نهایی — امضای واقعی فروشنده با این ساخته نمی‌شود */
let licKeyCache27 = null; /* کش بر اساس mtime — ساخت/تغییر فایل بدون ری‌استارت اعمال می‌شود */
function licResolveKey27() {
    const env27 = String(process.env.SANATIFY_LIC_KEY || '').trim();
    if (env27) return { key: env27, source: 'env:SANATIFY_LIC_KEY' };
    try {
        const st27 = fs.statSync(LIC_KEY_FILE_27);
        if (st27.isFile() && st27.size > 0) {
            if (licKeyCache27 && licKeyCache27.mtime === st27.mtimeMs) return licKeyCache27;
            const raw27 = fs.readFileSync(LIC_KEY_FILE_27, 'utf8').trim();
            if (raw27) { licKeyCache27 = { key: raw27, source: 'license.key', mtime: st27.mtimeMs }; return licKeyCache27; }
        }
    } catch (e27) { /* فایل موجود نیست — عادی */ }
    return { key: LIC_DEFAULT_KEY_27, source: 'پیش‌فرض — نه env و نه license.key (امضای واقعی با این تأیید نمی‌شود)' };
}
// کلید مخفیِ امضا فقط سمت فروشنده است (env یا license.key) — هرگز در ریپو/tenant.json نیست.
// الگوریتم: HMAC-SHA256 روی نسخهٔ متعارف (canonical) بخش لایسنس tenant.json → فیلد license_sig
const LIC_BASE_MODULES_24 = ['summary', 'production', 'inventory']; /* لایسنس پایه — fallback ضد دستکاری */
function licCanonical24(cfg) {
    return JSON.stringify({
        active_modules: (Array.isArray(cfg && cfg.active_modules) ? cfg.active_modules.slice() : []).sort(),
        max_users: Number(cfg && cfg.max_users) || 0,
        max_records: Number(cfg && cfg.max_records) || 0,
        expires_at: String((cfg && cfg.expires_at) || ''),
        /* SEC-BIND-19f: قفل سخت‌افزاری داخل امضا — حذف/تغییر hwkey ⇒ امضا نامعتبر ⇒ لایسنس پایه؛ دورزدن ممکن نیست */
        hwkey: hwNorm19f(cfg && cfg.hwkey),
    });
}
function licSign24(cfg, key) {
    return crypto.createHmac('sha256', String(key || licResolveKey27().key)).update(licCanonical24(cfg)).digest('hex');
}
/* FIX-LIC-27: تأیید با علت — علت دقیق برای خودآزمایی بوت و tools/license-doctor.js */
function licVerifyCause27(cfg) {
    try {
        const sig24 = String((cfg && cfg.license_sig) || '').toLowerCase();
        if (!sig24) return { ok: false, cause: 'license_sig غایب است (tenant.json اصلاً امضا نشده)' };
        if (!/^[0-9a-f]{64}$/.test(sig24)) return { ok: false, cause: 'فرمت license_sig نامعتبر است' };
        const r27 = licResolveKey27();
        const a24 = Buffer.from(sig24), b24 = Buffer.from(licSign24(cfg, r27.key));
        if (a24.length === b24.length && crypto.timingSafeEqual(a24, b24)) return { ok: true, cause: '', source: r27.source };
        return { ok: false, cause: 'امضای HMAC با منبع کلید «' + r27.source + '» تطبیق ندارد (کلید دیگر یا امضای کهنه)', source: r27.source };
    } catch (e) { return { ok: false, cause: 'خطا در تأیید امضای HMAC: ' + ((e && e.message) || e) }; }
}
function licVerify24(cfg) { return licVerifyCause27(cfg).ok; }
let licGuardLogged24 = ''; /* هر نسخهٔ فایل فقط یک‌بار audit — ضد طغیان لاگ */
/* ===== HARDEN-18J (begin): ارتقای امضای لایسنس به Ed25519 — کلید خصوصی فقط سمت فروشنده (env در CLI) =====
   قواعد (FIX-LIC-27 — Ed25519 مسیر اصلی):
   • license_sig2 معتبر با کلید عمومی سرور ⇒ کافی است — HMAC اصلاً بررسی نمی‌شود
   • کلید عمومی حالا در سرور embed شده (LIC_ED_PUB_EMBEDDED_27) — بوت سرد بدون env هم sig2 را تأیید می‌کند؛
     env SANATIFY_LIC_ED_PUB فقط برای چرخش کلید بر embed مقدم است (کلید عمومی راز نیست؛ خصوصی فقط نزد فروشنده)
   • license_sig2 غایب ⇒ مسیر HMAC قبلی (سازگاری کامل — فایل‌های فعلی بایت‌به‌بایت معتبر می‌مانند)
   • license_sig2 موجود ولی نامعتبر ⇒ لایسنس پایه (ضد دستکاری) */
const LIC_ED_PUB_EMBEDDED_27 = 'MCowBQYDK2VwAyEAGAgTWhsg6AGqDDMf25ZHQfQZ8WiaiVTHZP5jdDzxKpY='; /* عیناً با tools/license.js و tools/license-doctor.js یکی است */
let licEdWarned18J = false;
function loadLicEdPub18J() {
    const b64 = String(process.env.SANATIFY_LIC_ED_PUB || '').trim() || LIC_ED_PUB_EMBEDDED_27;
    try { return crypto.createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' }); }
    catch (e) { return null; }
}
function licVerifyEd18J(cfg) {
    try {
        const pub18j = loadLicEdPub18J();
        const sig18j = String((cfg && cfg.license_sig2) || '').trim();
        if (!pub18j || !sig18j) return null; /* مسیر HMAC */
        return crypto.verify(null, Buffer.from(licCanonical24(cfg)), pub18j, Buffer.from(sig18j, 'base64'));
    } catch (e) { return false; }
}
function applyLicenseSigGuard24(cfg, srcMtime) {
    if (!cfg) return cfg;
    const hasSig2_18j = String((cfg && cfg.license_sig2) || '').trim() !== '';
    const ed18j = licVerifyEd18J(cfg);
    if (ed18j === true) { cfg.__lic_invalid_24 = false; cfg.__lic_method_18j = 'ed25519'; cfg.__lic_reason_27 = ''; return cfg; }
    if (ed18j === false) {
        /* امضای Ed25519 موجود ولی نامعتبر — دستکاری/کلید اشتباه ⇒ لایسنس پایه */
        cfg.__lic_invalid_24 = true;
        cfg.__lic_reason_27 = 'امضای Ed25519 (license_sig2) نامعتبر است — دستکاری یا کلید خصوصی متفاوت';
        cfg.active_modules = LIC_BASE_MODULES_24.slice();
        cfg.max_users = 0; cfg.max_records = 0; cfg.expires_at = '';
        const fp18j = 'ed18j:' + (srcMtime != null ? String(Math.round(srcMtime)) : 'boot');
        if (licGuardLogged24 !== fp18j) {
            licGuardLogged24 = fp18j;
            console.warn('[HARDEN-18J] امضای Ed25519 لایسنس نامعتبر است ⇒ لایسنس پایه — با SANATIFY_LIC_ED_PRIV و tools/license.js --sign-ed دوباره امضا کنید.');
            const t18j = setTimeout(() => { try { writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: 'license.ed25519_invalid', endpoint: 'tenant.json', status: 200, user_agent: 'HARDEN-18J', payload_hash: '', ms: 0 }); } catch (e) { /* بی‌ضرر */ } }, 100);
            if (t18j.unref) t18j.unref();
        }
        return cfg;
    }
    if (hasSig2_18j && !licEdWarned18J) {
        licEdWarned18J = true;
        console.warn('[HARDEN-18J] license_sig2 موجود است ولی کلید عمومی Ed25519 بارگذاری نشد (env SANATIFY_LIC_ED_PUB نامعتبر؟) — فعلاً امضای HMAC ملاک است.');
    }
    const v27 = licVerifyCause27(cfg);
    if (v27.ok) { cfg.__lic_invalid_24 = false; cfg.__lic_method_18j = 'hmac'; cfg.__lic_reason_27 = ''; cfg.__lic_keysource_27 = v27.source; return cfg; }
    /* امضا غایب/نامعتبر/دستکاری‌شده → لایسنس پایه + بنر قرمز در UI + audit */
    cfg.__lic_invalid_24 = true;
    cfg.__lic_reason_27 = v27.cause;
    cfg.active_modules = LIC_BASE_MODULES_24.slice();
    cfg.max_users = 0; cfg.max_records = 0; cfg.expires_at = '';
    const fp24 = srcMtime != null ? String(Math.round(srcMtime)) : 'boot';
    if (licGuardLogged24 !== fp24) {
        licGuardLogged24 = fp24;
        console.warn('[SEC-LIC-24] امضای لایسنس tenant.json غایب/نامعتبر است → لایسنس پایه (summary+production+inventory) اعمال شد — علت: ' + (cfg.__lic_reason_27 || '?') + '\n  اصلاح: SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign  (FIX-LIC-27: license.key کنار server.js ساخته می‌شود تا بوت سرد بدون env هم معتبر بماند) — تشخیص: node tools/license-doctor.js');
        const entry24 = {
            ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-',
            action: 'license.signature_invalid', endpoint: 'tenant.json', status: 200,
            user_agent: 'SEC-LIC-24', payload_hash: '', ms: 0, mtime: srcMtime != null ? Math.round(srcMtime) : null,
        };
        const t24 = setTimeout(() => { try { writeAudit15b(entry24); } catch (e) { /* بی‌ضرر */ } }, 100); /* پس از بارگذاری کامل ماژول */
        if (t24.unref) t24.unref();
    }
    return cfg;
}
/* ===== VENDOR-37 (begin): صاحب سیستم (vendor) جدا از admin ===== */
function vendorRole37(r) { return r === 'vendor' || r === 'owner'; } /* owner = نام قدیمی SEC-LIC-24 */
function vendorExists37() { /* حداقل یک صاحب سیستم فعال — تا وقتی وجود ندارد، admin همان نقش را دارد (سازگاری) */
    try { return auth.loadUsers37().some((u) => u && vendorRole37(u.role) && u.active !== false); } catch (e) { return false; }
}
function ownerExists24() { return vendorExists37(); } /* backward-compat SEC-LIC-24 */
function isOwnerReq24(req) {
    const u24 = req && req.user;
    if (!u24) return false;
    const role24 = String(u24.role || 'viewer');
    return vendorRole37(role24) || (role24 === 'admin' && !vendorExists37());
}
function vendorSigOk37(u) { /* امضای Ed25519 روی vendor — فقط با کلید خصوصی فروشنده (--recover-vendor) قابل ساخت */
    try {
        const sig37 = String((u && u.vendor_sig) || '').trim();
        const created37 = String((u && u.created_at) || '');
        if (!u || !u.username || !sig37 || !created37) return false;
        const pub37 = loadLicEdPub18J();
        if (!pub37) return false;
        return crypto.verify(null, Buffer.from('vendor37|' + String(u.username) + '|' + created37, 'utf8'), pub37, Buffer.from(sig37, 'hex'));
    } catch (e) { return false; }
}
/* ===== VENDOR-37 (end) ===== */
// ===== SEC-LIC-24 (end) =====
// ===== SEC-BIND-19f (begin): قفل سخت‌افزاری — Hardware ID Binding =====
// هدف: نسخهٔ دموی تجاری فقط روی VM مشتریِ دارای لایسنس اجرا شود.
// قواعد:
//  • tenant.json بدون فیلد hwkey (یا خالی) ⇒ بدون قفل — رفتار سابق دست‌نخورده (سازگاری کامل با استقرارهای موجود)
//  • tenant.json با hwkey امضاشده ⇒ عدم تطابق با ماشین فعلی ⇒ توقف بوت (exit 1) با نمایش HWKEY ماشین برای صدور لایسنس
//  • hwkey داخل canonical امضاست ( licCanonical24 ) ⇒ حذف/تغییرش ⇒ امضا نامعتبر ⇒ لایسنس پایه (SEC-LIC-24)
//  • الگوریتم HWKEY عیناً با tools/generate-hwkey.js یکی است — هر تغییری باید هم‌زمان در هر دو اعمال شود
function hwNorm19f(v) { return String(v || '').trim().toUpperCase().replace(/[\s"']/g, ''); }
function hwFactors19f() {
    /* فقط APIهای داخلی node + دستورات سیستمی استاندارد — صفر وابستگی */
    let machineId = '';
    try {
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const o19f = { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true };
            /* ۱) MachineGuid — هنگام نصب ویندوز ساخته می‌شود، در ری‌استارت/کپونینگ پایدار است (سریع‌ترین و مطمئن‌ترین) */
            try {
                const m19f = String(execSync('reg query HKLM\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid', o19f)).match(/REG_SZ\s+([^\r\n\s]+)/);
                machineId = m19f ? m19f[1] : '';
            } catch (e19f) { machineId = ''; }
            /* ۲) UUID مادربورد/BIOS از PowerShell (wmic در ویندوزهای جدید حذف شده) */
            if (!machineId) { try { machineId = String(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', o19f)).trim(); } catch (e19f) { machineId = ''; } }
            /* ۳) wmic — مسیر قدیمی */
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
    /* machine_id پایدار (MachineGuid ویندوز / machine-id لینوکس / IOPlatformUUID مک) تنها ملاک است —
       تغییر IP/MAC/دیسک/حافظه اثری ندارد؛ فقط در نبودِ آن، ترکیب پایدارهای os ملاک می‌شود */
    return f19f.machine_id
        ? JSON.stringify({ mid: f19f.machine_id, salt: 'sanatify-mes-hw-v1' })
        : JSON.stringify({ h: f19f.hostname, p: f19f.platform, c: f19f.cpu_model, n: f19f.cpu_count, m: f19f.mem_total, mac: f19f.mac, salt: 'sanatify-mes-hw-v1' });
}
function computeHwkey19f() {
    const f19f = hwFactors19f();
    const hex19f = crypto.createHash('sha256').update(hwCore19f(f19f)).digest('hex').slice(0, 12).toUpperCase();
    return 'HW-' + hex19f.slice(0, 4) + '-' + hex19f.slice(4, 8) + '-' + hex19f.slice(8, 12);
}
let HWKEY_19F = 'HW-UNKNOWN';
try { HWKEY_19F = computeHwkey19f(); } catch (e19f) { HWKEY_19F = 'HW-UNKNOWN'; }
// ===== SEC-BIND-19f (end) =====
// ===== SEC-ANTI-19g (begin): ضد اشکال‌زدایی + ضد دستکاری + پیکربندی رمزنگاری‌شده — فقط در حالت باینری =====
/* اصل حیاتی: گاردهای حفاظتی فقط وقتی process.pkg هست فعال می‌شوند (باینری SEC-PROTECT-19e).
   در حالت source (node server.js روی لپ‌تاپ فروشنده) هیچ‌کدام فعال نیست — استقرار فعلی بایت‌به‌بایت دست‌نخورده. */
const EXE_MODE_19G = !!process.pkg;
function sha256File19g(p19g) {
    const c19g = crypto.createHash('sha256');
    const fd19g = fs.openSync(p19g, 'r');
    try {
        const buf19g = Buffer.alloc(1024 * 1024);
        let n19g = 0;
        while ((n19g = fs.readSync(fd19g, buf19g, 0, buf19g.length, null)) > 0) c19g.update(buf19g.subarray(0, n19g));
    } finally { try { fs.closeSync(fd19g); } catch (e19c) { /* noop */ } }
    return c19g.digest('hex');
}
function fatal19g(msg19g, auditAction19g) {
    console.error('========================================================');
    console.error('  ✖ SEC-ANTI-19g — ' + msg19g);
    console.error('========================================================');
    if (auditAction19g) {
        /* audit اگر ممکن — گیت در انتهای فایل است؛ همهٔ وابستگی‌ها مقداردهی شده‌اند ⇒ نوشتن همگام امن است
           (نسخهٔ اول setTimeout ناهمگام داشت که با exit(0) همگامِ --print-hwkey رقابت می‌کرد — باگ واقعی T3) */
        try {
            writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: auditAction19g, endpoint: 'boot', status: 403, user_agent: 'SEC-ANTI-19g', payload_hash: '', ms: 0 });
        } catch (e19c) { /* بی‌ضرر — audit هرگز جلوی خروج قطعی را نمی‌گیرد */ }
    }
    process.exit(1); /* همیشه همگام — هیچ مسیر موازی نتواند exit(0) بگذارد */
}
function antiDebug19g() {
    if (!EXE_MODE_19G) return; /* حالت source — همیشه غیرفعال */
    if (String(process.env.SANATIFY_ANTIDBG || '').trim().toLowerCase() === 'off') return; /* escape hatch فروشنده (README-DEPLOY) */
    try {
        const inspector19g = require('inspector');
        if (typeof inspector19g.url === 'function' && inspector19g.url() !== undefined) fatal19g('اشکال‌زدایی (inspector) فعال است — اجرای باینری متوقف شد.', 'antidbg.inspector_active');
    } catch (e19c) { /* بی‌ضرر */ }
    try {
        const dbgArgs19g = (process.execArgv || []).some((a19g) => /^(--inspect|--inspect-brk|--inspect-port|--debug|--debug-brk|--debug-port)/.test(String(a19g)));
        if (dbgArgs19g) fatal19g('پرچم اشکال‌زدایی (--inspect) در آرگومان‌های runtime — اجرا متوقف شد.', 'antidbg.inspect_flag');
    } catch (e19c) { /* بی‌ضرر */ }
    /* فرآیند والد مشکوک — فقط سیاههٔ اشکال‌زدها (سفیدکردن والد شکننده است: NSSM/TaskScheduler/... مجازند) */
    try {
        let pname19g = '';
        if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            const out19g = String(execSync('powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \'ProcessId=' + Number(process.ppid || 0) + '\').Name"', { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }));
            const lines19g = out19g.split(/\r?\n/).filter((l) => l.trim() && l.toLowerCase().indexOf('name') === -1);
            pname19g = (lines19g[0] || '').trim();
        } else {
            const ppid19g = (fs.readFileSync('/proc/self/status', 'utf8').match(/^PPid:\s+(\d+)/m) || [])[1];
            if (ppid19g && fs.existsSync('/proc/' + ppid19g + '/comm')) pname19g = fs.readFileSync('/proc/' + ppid19g + '/comm', 'utf8').trim();
        }
        if (pname19g && /(x64dbg|ollydbg|windbg|ghidra|cheat|procmon|processhacker|fiddler|httpdebug|debugger|\bgdb\b|lldb|\bida)/i.test(pname19g)) fatal19g('فرآیند والد مشکوک به اشکال‌زدایی: ' + pname19g, 'antidbg.suspect_parent');
    } catch (e19c) { /* نبود PowerShell//proc گارد را نمی‌شکند */ }
}
function antiTamper19g() {
    if (!EXE_MODE_19G) return; /* حالت source — همیشه غیرفعال */
    let exePath19g = '';
    try { exePath19g = process.execPath; } catch (e19c) { exePath19g = ''; }
    const manifest19g = path.join(path.dirname(exePath19g || '.'), 'SHA256SUMS.txt');
    if (!fs.existsSync(manifest19g)) fatal19g('مانیفست صحت (SHA256SUMS.txt) کنار باینری یافت نشد — فایل را کنار exe برگردانید.', 'antitamper.manifest_missing');
    let myHash19g = '';
    try { myHash19g = sha256File19g(exePath19g); } catch (e19c) { fatal19g('محاسبهٔ هش باینری ناموفق: ' + ((e19c && e19c.message) || e19c), 'antitamper.hash_error'); }
    let matched19g = false;
    try {
        const lines19g = fs.readFileSync(manifest19g, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines19g.length && !matched19g; i++) {
            const m19g = lines19g[i].match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
            if (m19g && m19g[1].toLowerCase() === myHash19g) matched19g = true;
        }
    } catch (e19c) { fatal19g('خواندن مانیفست صحت ناموفق: ' + ((e19c && e19c.message) || e19c), 'antitamper.manifest_read_error'); }
    if (!matched19g) fatal19g('باینری دستکاری شده است (هش با مانیفست نمی‌خواند).', 'antitamper.hash_mismatch');
}
/* ---- پیکربندی رمزنگاری‌شده (tenant.json.enc / web-users.json.enc) — AES-256-GCM، کلید = scrypt(SANATIFY_LIC_KEY|HWKEY) ----
   قالب فایل .enc عیناً با tools/encrypt-config.js و auth.js یکی است؛ plaintext همچنان پشتیبانی می‌شود (سازگاری کامل) */
const CFG_MAGIC_19G = 'sanatify-cfg-19g';
function cfgDerivedKey19g(salt19g) {
    const secret19g = auth.devBypass40() ? auth.devBypassSecret40() : (String(process.env.SANATIFY_LIC_KEY || 'Sanatify-Lic-Verify::v1::1405') + '|' + HWKEY_19F); /* DEV-BYPASS-40: هم‌گام با auth.js */
    return crypto.scryptSync(secret19g, salt19g, 32, { N: 16384, r: 8, p: 1 });
}
function readMaybeEnc19g(filePath) {
    const encPath19g = filePath + '.enc';
    if (fs.existsSync(encPath19g)) {
        try {
            const box19g = JSON.parse(fs.readFileSync(encPath19g, 'utf8'));
            if (box19g && box19g.enc === CFG_MAGIC_19G && box19g.alg === 'aes-256-gcm') {
                const key19g = cfgDerivedKey19g(Buffer.from(String(box19g.salt), 'base64'));
                const d19g = crypto.createDecipheriv('aes-256-gcm', key19g, Buffer.from(String(box19g.iv), 'base64'));
                d19g.setAuthTag(Buffer.from(String(box19g.tag), 'base64'));
                return Buffer.concat([d19g.update(Buffer.from(String(box19g.data), 'base64')), d19g.final()]).toString('utf8');
            }
        } catch (e19c) {
            console.error('[SEC-ANTI-19g] رمزگشایی ' + path.basename(encPath19g) + ' ناموفق (' + ((e19c && e19c.message) || e19c) + ') ⇒ plaintext (اگر باشد) استفاده می‌شود — کلید/HWKEY عوض شده؟ دوباره: node tools/encrypt-config.js');
        }
    }
    try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null; } catch (e19c) { return null; }
}
function dropEnc19g(filePath) { /* نوشتن plaintext ⇒ .enc کهنه معتبر نیست — حذف با هشدار */
    try {
        if (fs.existsSync(filePath + '.enc')) {
            fs.unlinkSync(filePath + '.enc');
            console.warn('[SEC-ANTI-19g] ' + path.basename(filePath) + ' به‌روزرسانی شد ⇒ ' + path.basename(filePath) + '.enc کهنه حذف شد — برای رمزکردن دوباره: node tools/encrypt-config.js --file=' + path.basename(filePath));
        }
    } catch (e19c) { /* بی‌ضرر */ }
}
// ===== SEC-ANTI-19g (end) =====
function isLicenseExpired15a(cfg) {
    const exp = String((cfg && cfg.expires_at) || '').trim();
    if (!exp) return false;
    const t = Date.parse(exp);
    return !isNaN(t) && Date.now() > t;
}
// آیا ماژول در لایسنس فعال است؟ (انقضا ⇒ هیچ؛ بدون tenant.json ⇒ همه)
function checkModuleAccess15a(moduleId) {
    const cfg = loadTenant15a();
    if (isLicenseExpired15a(cfg)) return false;
    return cfg.active_modules.indexOf(moduleId) !== -1;
}
function countUsers15a() {
    try { const a = JSON.parse(readMaybeEnc19g(path.join(ROOT, 'web-users.json')) || '[]'); return Array.isArray(a) ? a.filter((u) => u && String(u.status || '') !== 'deleted').length : 0; } catch (e) { return 0; } /* SEC-ANTI-19g + USER-MGMT-39b: کاربر حذف‌نرم سقف صندلی لایسنس را اشغال نمی‌کند */
}
function countRecords15a(live) {
    let n = 0;
    TABLES.forEach((k) => { if (live && Array.isArray(live[k])) n += live[k].length; });
    if (live && Array.isArray(live.energy_logs)) n += live.energy_logs.length;
    if (live && Array.isArray(live.fin_docs)) n += live.fin_docs.length;
    return n;
}
// آیا سقف کاربر/رکورد رد نشده؟ (۰ = بی‌سقف)
function checkTenantLimits15a() {
    const cfg = loadTenant15a();
    const users = countUsers15a();
    let records = 0;
    try { records = countRecords15a(readLive()); } catch (e) { records = 0; }
    const maxUsers = Number(cfg.max_users) || 0, maxRecords = Number(cfg.max_records) || 0;
    return { ok: (!maxUsers || users <= maxUsers) && (!maxRecords || records <= maxRecords), users, records, maxUsers, maxRecords };
}
// نگاشت مسیر API → ماژول لایسنس (null = عمومی/مستثنی)
function moduleForPath15a(pathname) {
    if (pathname.indexOf('/api/sales') === 0) return 'sales'; /* FEAT-SALES-21a: گیت لایسنس ماژول فروش */
    if (pathname.indexOf('/api/purchase') === 0) return 'purchase'; /* FEAT-PURCHASE-22a: گیت لایسنس ماژول خرید */
    if (pathname.indexOf('/api/fin') === 0) return 'finance';
    if (pathname.indexOf('/api/energy/') === 0) return 'em';
    if (pathname.indexOf('/api/planning/') === 0) return 'planning';
    if (pathname.indexOf('/api/inventory') === 0) return 'inventory';
    if (pathname.indexOf('/api/quality') === 0) return 'quality';
    if (pathname.indexOf('/api/qcpro') === 0) return 'quality'; /* FEAT-QC-PRO-24a: کنترل کیفیت حرفه‌ای زیر همان ماژول لایسنس کیفیت */
    if (pathname.indexOf('/api/maintenance') === 0 || pathname.indexOf('/api/pm/') === 0) return 'maintenance';
    if (pathname.indexOf('/api/dashboard') === 0 || pathname.indexOf('/api/analytics') === 0) return 'analytics';
    if (pathname === '/api/summary' || pathname.indexOf('/api/summary/') === 0) return 'summary';
    const PROD_15A = ['/api/production', '/api/waste', '/api/bundles', '/api/billets', '/api/downtime', '/api/genealogy', '/api/balance'];
    for (let i = 0; i < PROD_15A.length; i++) if (pathname === PROD_15A[i] || pathname.indexOf(PROD_15A[i] + '/') === 0) return 'production';
    const ENTRY_15A = { '/api/entry/production': 'production', '/api/entry/waste': 'production', '/api/entry/downtime': 'production', '/api/entry/quality': 'quality', '/api/entry/maintenance': 'maintenance' };
    return ENTRY_15A[pathname] || null;
}
// مسیر فایل لوگو فقط داخل PUBLIC_DIR معتبر است (ضد path-traversal)
function resolveTenantLogoFile15a(cfg) {
    const l = String((cfg && cfg.logo) || '');
    if (!l || l.indexOf('data:') === 0) return null;
    const p = path.normalize(path.join(PUBLIC_DATA_DIR_19E, l)); /* SEC-PROTECT-19e */
    if (!p.startsWith(PUBLIC_DATA_DIR_19E)) return null;
    try { return fs.existsSync(p) ? p : null; } catch (e) { return null; }
}
// برندینگ صفحهٔ ورود (در auth.js اعمال می‌شود) — بدون tenant.json: null = بدون تغییر
(function initTenantBrand15a() {
    const c = loadTenant15a();
    auth.setTenantBranding15a(tenantCache15a ? { name: c.name, logo: c.logo || '', colors: c.brand_colors || {} } : null); /* FIX-ORG-16b: + رنگ‌ها */
})();
// ===== SAAS-15a (end) =====
// ===== SEC-15b (begin): هدرهای امنیتی + ریت‌لیمیت + audit خودکار + IP کلاینت =====
// CSP: HARDEN-18G — حذف 'unsafe-inline' با nonce per درخواست (الگوی OWASPnonce) — Chart.js/فونت/چاپ سالم می‌مانند
function buildCSP18G(nonce18g) {
    const n18g = nonce18g ? " 'nonce-" + nonce18g + "'" : '';
    return [
        "default-src 'self'",
        /* HARDEN-18G: حذف کامل unsafe-inline از اسکریپت — nonce per درخواست */
        "script-src 'self'" + n18g + " https://cdn.jsdelivr.net",
        /* نکته: presence-of-nonce سبک 'unsafe-inline' را در همان directive بی‌اثر می‌کند؛
           ویژگی‌های style="" (فراوان در UI) توسط style-src-attr مدیریت می‌شوند و عناصر <style> توسط
           style-src-elem با nonce محکم می‌شوند — بدون شکستن لایه‌بندی در مرورگرهای قدیمی هم (fallback به style-src) */
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src-elem 'self'" + n18g + " https://cdn.jsdelivr.net",
        "style-src-attr 'unsafe-inline'",
        "font-src 'self' data: https://cdn.jsdelivr.net",
        "img-src 'self' data:",
        "connect-src 'self'",
        "manifest-src 'self'",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ].join('; ');
}
function applySecurityHeaders15b(res, req) {
    try {
        /* HARDEN-18G: nonce per درخواست — تزریق به سندهای HTML و هدر CSP */
        const nonce18g = crypto.randomBytes(16).toString('base64');
        if (req) req.__cspNonce18G = nonce18g;
        res.setHeader('Content-Security-Policy', buildCSP18G(nonce18g));
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
        // HSTS فقط در حالت HTTPS (الگوی OWASP — هیچ حالت HTTP نمی‌شکند)
        if (tlsMode === 'HTTPS') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        // SEC-15b/SAAS-15a: تازه‌سازی CORS از tenant (allowed_origins) با mtime-کش — ارزان
        if (req) {
            const tc15b = loadTenant15a();
            auth.setCorsConfig15b(tenantCache15a && tc15b.custom_settings && Array.isArray(tc15b.custom_settings.allowed_origins) ? tc15b.custom_settings.allowed_origins : null);
        }
    } catch (e) { /* بی‌ضرر */ }
}
function clientIp15b(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) { const first = String(xf).split(',')[0].trim(); if (first) return first; }
    return (req.socket && req.socket.remoteAddress) || '?';
}
// ریت‌لیمیت عمومی: ۱۰۰ درخواست/دقیقه per-IP برای API (لاگین مسیر اختصاصی دارد)
const RL_WINDOW_MS_15B = 60 * 1000, RL_MAX_15B = 100;
const rlMap15b = new Map();
function rateLimit15b(req, pathname) {
    if (pathname.indexOf('/api/') !== 0) return 0;
    if (pathname === '/api/auth/login') return 0;
    const ip = clientIp15b(req);
    const now = Date.now();
    const arr = (rlMap15b.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS_15B);
    if (arr.length >= RL_MAX_15B) { rlMap15b.set(ip, arr); return Math.ceil((arr[0] + RL_WINDOW_MS_15B - now) / 1000); }
    arr.push(now); rlMap15b.set(ip, arr);
    return 0;
}
var rlSweepTimer15b = setInterval(() => { try { const now = Date.now(); for (const [k, v] of rlMap15b) { const f = v.filter((t) => now - t < RL_WINDOW_MS_15B); if (f.length) rlMap15b.set(k, f); else rlMap15b.delete(k); } } catch (e) { /* noop */ } }, 5 * 60 * 1000);
if (rlSweepTimer15b.unref) rlSweepTimer15b.unref();
// ===== HARDEN-18F (begin): ریت‌لیمیت اختصاصی endpointهای سنگین (گزارش/اکسل/تراز/ارزیابی) — ضد DoS؛ ریت‌لیمiter عمومی 15b دست‌نخورده =====
const RLH_WINDOW_18F = 60 * 1000;
const RLH_MAX_18F = Math.max(5, Number(process.env.HARDEN_HEAVY_RL_18F) || 30); /* درخواست سنگین per دقیقه per IP */
const HEAVY_RE_18F = [/^\/api\/fin\/reports\//, /^\/api\/fin\/(valuation|costing|overview)/, /^\/api\/qcpro\/reports/, /^\/api\/(genealogy|balance)\//];
const rlhMap18f = new Map();
function rateLimitHeavy18F(req, pathname) {
    if (req.method !== 'GET') return 0;
    if (!HEAVY_RE_18F.some((re) => re.test(pathname))) return 0;
    const ip = clientIp15b(req);
    const now = Date.now();
    const arr = (rlhMap18f.get(ip) || []).filter((t) => now - t < RLH_WINDOW_18F);
    if (arr.length >= RLH_MAX_18F) { rlhMap18f.set(ip, arr); return Math.ceil((arr[0] + RLH_WINDOW_18F - now) / 1000); }
    arr.push(now); rlhMap18f.set(ip, arr);
    return 0;
}
var rlhSweep18f = setInterval(() => { try { const now = Date.now(); for (const [k, v] of rlhMap18f) { const f = v.filter((t) => now - t < RLH_WINDOW_18F); if (f.length) rlhMap18f.set(k, f); else rlhMap18f.delete(k); } } catch (e) { /* noop */ } }, 5 * 60 * 1000);
if (rlhSweep18f.unref) rlhSweep18f.unref();
// ===== HARDEN-18F (end) =====
// audit خودکار هر POST/PUT/DELETE + چرخش ماهانه (audit-YYYY-MM.json)
const AUDIT_FILE_15B = path.join(ROOT, 'audit.json'); /* SEC-15b: نسخهٔ ماژول‌سطح */
function auditRotate15b() {
    try {
        if (!fs.existsSync(AUDIT_FILE_15B)) return;
        const d = new Date(fs.statSync(AUDIT_FILE_15B).mtimeMs);
        const cur = new Date();
        if (d.getUTCFullYear() !== cur.getUTCFullYear() || d.getUTCMonth() !== cur.getUTCMonth()) {
            const name = 'audit-' + d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.json';
            fs.renameSync(AUDIT_FILE_15B, path.join(ROOT, name));
            console.log('[Audit] SEC-15b: چرخش ماهانه →', name);
        }
    } catch (e) { /* بی‌ضرر */ }
}
function writeAudit15b(entry) {
    try {
        auditRotate15b();
        /* ===== HARDEN-18M (begin): زنجیرهٔ هش ضد دستکاری — هر رکورد هش رکورد قبلی را حمل می‌کند =====
           __pc18m = هش رکورد پیشین (یا GENESIS) · __h18m = SHA-256 نسخهٔ متعارف همان رکورد
           هر تغییر/حذف وسط زنجیره با tools/audit-verify.js کشف می‌شود (بریدن سرِ زنجیره به‌واسطهٔ نگه‌داری ۲۰۰۰تایی طبیعی است) */
        const arr = readJson(AUDIT_FILE_15B) || [];
        if (auditChainLast18m === null) auditChainLast18m = auditTailHash18M(arr);
        entry.__pc18m = auditChainLast18m;
        delete entry.__h18m;
        entry.__h18m = auditHash18M(entry);
        auditChainLast18m = entry.__h18m;
        arr.push(entry);
        writeJson(AUDIT_FILE_15B, arr.slice(-2000));
        /* ===== HARDEN-18M (end) ===== */
    } catch (e) { /* بی‌ضرر */ }
}
/* ===== HARDEN-18M (begin): کمک‌تابع‌های زنجیرهٔ audit ===== */
function auditCanonical18M(obj) { /* stringify پایدار — کلیدها مرتب‌شده بازگشتی تا هش مستقل از ترتیب درج باشد */
    if (obj === null || typeof obj !== 'object') return JSON.stringify(obj === undefined ? null : obj);
    if (Array.isArray(obj)) return '[' + obj.map(auditCanonical18M).join(',') + ']';
    const keys = Object.keys(obj).filter((k) => k !== '__h18m').sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + auditCanonical18M(obj[k])).join(',') + '}';
}
function auditHash18M(obj) { try { return crypto.createHash('sha256').update(auditCanonical18M(obj), 'utf8').digest('hex'); } catch (e) { return 'HASH_ERROR'; } }
function auditTailHash18M(arr) { /* دنبالهٔ زنجیره: آخرین رکورد زنجیردار فایل جاری؛ اگر فایل جاری خالی/بدون زنجیره ⇒ تلاش برای جدیدترین فایل چرخیدهٔ ماه قبل */
    const last = Array.isArray(arr) ? arr[arr.length - 1] : null;
    if (last && typeof last.__h18m === 'string' && last.__h18m.length === 64) return last.__h18m;
    try {
        const files = fs.readdirSync(ROOT).filter((f) => /^audit-\d{4}-\d{2}\.json$/.test(f)).sort().reverse();
        for (const f of files) {
            try {
                const a = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
                if (Array.isArray(a) && a.length) {
                    const l = a[a.length - 1];
                    if (l && typeof l.__h18m === 'string' && l.__h18m.length === 64) return l.__h18m;
                }
            } catch (e) { /* فایل خراب — بعدی */ }
        }
    } catch (e) { /* بدون فایل چرخیده */ }
    return 'GENESIS';
}
let auditChainLast18m = null; /* کش دنبالهٔ زنجیره — null = هنوز مقداردهی نشده */
/* ===== HARDEN-18M (end) ===== */
auth.setAuditWriter15b(writeAudit15b); /* SEC-15b: مسیر واحد audit برای auth.js (لاگین/قفل) */
// ===== SAAS-15c (begin): پنل مدیریت تنانت (admin) + آمار مصرف + میدل‌ویر رسمی ماژول =====
function requireModule15c(req, res, moduleId) {
    if (!checkModuleAccess15a(moduleId)) {
        sendJson(res, { error: 'این ماژول در لایسنس شما فعال نیست — لطفاً با پشتیبانی تماس بگیرید.', code: 'MODULE_DISABLED', module: moduleId }, 403);
        return false;
    }
    return true;
}
function writeTenantFile15c(cfg) {
    const clean24 = Object.assign({}, cfg); delete clean24.__lic_invalid_24; /* SEC-LIC-24: پرچم زمان‌اجر هرگز در فایل ذخیره نمی‌شود */
    const out = JSON.stringify(clean24, null, 2) + String.fromCharCode(10);
    /* ===== HARDEN-18A (begin): fsync پیش از rename — مقاوم به قطع برق ===== */
    const tmp = TENANT_FILE_15A + '.tmp';
    const fd18a = fs.openSync(tmp, 'w');
    try { fs.writeFileSync(fd18a, out, 'utf8'); fs.fsyncSync(fd18a); } finally { try { fs.closeSync(fd18a); } catch (e18a) { /* noop */ } }
    fs.renameSync(tmp, TENANT_FILE_15A);
    /* ===== HARDEN-18A (end) ===== */
    dropEnc19g(TENANT_FILE_15A); /* SEC-ANTI-19g: تغییر plaintext ⇒ .enc کهنه حذف */
}
function tenantPublicShape15c(cfg) {
    return {
        tenant_id: cfg.tenant_id, name: cfg.name, logo: cfg.logo || '',
        brand_colors: cfg.brand_colors || {}, active_modules: cfg.active_modules.slice(),
        max_users: Number(cfg.max_users) || 0, max_records: Number(cfg.max_records) || 0,
        role_caps: cfg.role_caps || {}, /* FEAT-ADMIN-17a */
        hidden_tabs: (Array.isArray(cfg.hidden_tabs) ? cfg.hidden_tabs : []).slice(), /* GO-LIVE-32: حفظ گیت دامنه در پاسخ پنل سازمان — فایل هم حفظ می‌شود (cfg کامل بازنویسی می‌شود) */
        custom_settings: cfg.custom_settings || {},
        license: { expired: isLicenseExpired15a(cfg), expires_at: cfg.expires_at || '', invalid: !!(cfg && cfg.__lic_invalid_24) }, /* SEC-LIC-24 */
    };
}
// ===== FEAT-ADMIN-17a (begin): ثابت‌های نقش + خوانندهٔ فایل کاربران =====
const ROLES_17A = ['admin', 'manager', 'operator', 'supervisor', 'planner', 'warehouse', 'quality', 'qc', 'engineering', 'finance', 'viewer', 'sales', 'purchase', 'owner', 'vendor']; /* همان کلیدهای ROLE_VIEW — + FEAT-SALES-21a/FEAT-PURCHASE-22a + SEC-LIC-24: مالک + VENDOR-37: صاحب سیستم (canonical؛ owner = نام قدیمی) */
const ROLE_FA_17A = { admin: 'مدیر سامانه', manager: 'مدیر (فقط مشاهده)', operator: 'اپراتور', supervisor: 'سرپرست', planner: 'برنامه‌ریز', warehouse: 'انباردار', quality: 'کنترل کیفیت (سابقه)', qc: 'کنترل کیفیت', engineering: 'مهندسی/تعمیرات', finance: 'مالی', viewer: 'فقط مشاهده', sales: 'واحد فروش', purchase: 'واحد خرید', owner: 'مالک سیستم (فروشنده)', vendor: 'صاحب سیستم (فروشنده)' }; /* SEC-LIC-24: مالک + VENDOR-37: صاحب سیستم */
function readUsers17a() {
    /* VENDOR-37: مسیر واحد بارگذاری — سخت‌گیرانه (.enc فقط) + مهاجرت یک‌باره + نرمال‌سازی owner→vendor */
    return auth.loadUsers37();
}
// ===== FEAT-ADMIN-17a (end) =====
// ===== SAAS-15c (end) =====
// ===== SEC-15b (end) =====
// ===== FEAT-HTTPS-11c (begin): هندلر به تابع نام‌دار استخراج شد تا بین HTTP و HTTPS مشترک باشد =====
function appRequestHandler(req, res) {
    res.__req15b = req; /* SEC-15b: برای CORS دقیق در sendJson/jsonRes */
    // ===== SEC-15b: preflight OPTIONS با هدرهای صحیح — فقط originهای مجاز =====
    if (req.method === 'OPTIONS') {
        const origin15b = String(req.headers.origin || '');
        const h15b = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600', 'Vary': 'Origin' };
        if (origin15b && auth.isOriginAllowed15b(origin15b)) { h15b['Access-Control-Allow-Origin'] = origin15b; h15b['Access-Control-Allow-Credentials'] = 'true'; }
        res.writeHead(204, h15b);
        res.end(); return;
    }
    // ===== SEC-15b: هدرهای امنیتی روی همهٔ پاسخ‌ها =====
    applySecurityHeaders15b(res, req);
    let parsed;
    try { parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch (e) { res.writeHead(400); res.end('Bad Request'); return; }
    const pathname = decodeURIComponent(parsed.pathname);
    // ===== SEC-15b: سقف حجم بدنه ۱MB (۴۱۳) =====
    const cl15b = Number(req.headers['content-length'] || 0);
    if (cl15b > 1024 * 1024) {
        return sendJson(res, { error: 'حجم درخواست بیش از حد مجاز است (سقف ۱ مگابایت).', code: 'PAYLOAD_TOO_LARGE' }, 413);
    }
    /* ===== HARDEN-18Q (begin): گارد CSRF مبتنی بر Origin برای درخواست‌های تغییردهنده =====
       مرورگرها روی هر POST/PUT/DELETE/PATCH هم‌مبدأ و غیرهم‌مبدأ هدر Origin می‌فرستند؛
       اگر Origin آمد و نه هم‌مبدأِ Host بود و نه در فهرست مجاز تنانت ⇒ ۴۰۳ (کوکی SameSite=Lax لایهٔ اول است؛ این لایهٔ دوم سرورساید است).
       کلاینت‌های بدون Origin (curl / اپ موبایل / ابزارها) دست‌نخورده می‌مانند — رفتار قدیمی صفر تغییر. */
    if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE' || req.method === 'PATCH') && pathname.indexOf('/api/') === 0) {
        const org18q = String(req.headers.origin || '');
        if (org18q) {
            let sameOrigin18q = false;
            try { sameOrigin18q = (new URL(org18q).host === String(req.headers.host || '')); } catch (e) { sameOrigin18q = false; }
            if (!sameOrigin18q && !auth.isOriginAllowed15b(org18q)) {
                try { writeAudit15b({ ts: new Date().toISOString(), user: (req.user && req.user.username) || '-', role: (req.user && req.user.role) || '-', ip: clientIp15b(req), action: 'security.csrf_blocked', endpoint: pathname, status: 403, user_agent: String(req.headers['user-agent'] || '').slice(0, 200), payload_hash: '', ms: 0, detail: 'origin=' + org18q.slice(0, 100) }); } catch (e) { /* noop */ }
                return sendJson(res, { error: 'درخواست از مبدأ غیرمجاز رد شد (CSRF).', code: 'CSRF_ORIGIN' }, 403);
            }
        }
    }

    /* ===== FIX-UI-19d (begin): گیت سرورساید حالت دمو — ماژول‌های مالی/فروش/خرید کاملاً بسته (نه فقط مخفی در UI)
       سناریو: دموی ۲-۳ هفته‌ای روی VM مشتری فولاد؛ مشتری مالی/فروش/خرید را در سپیدار اجرا می‌کند.
       حتی فراخوانی مستقیم API هم ۴۰۳ می‌گیرد؛ ماژول‌های فنی (تولید/QC/انبار/PM/برنامه‌ریزی) صفر تغییر. */
    if (pathname.indexOf('/api/') === 0) {
        const t19d = loadTenant15a();
        if (t19d && t19d.demo_mode) {
            const DEMO_BLOCK_19D = ['/api/sales', '/api/finance', '/api/purchase', '/api/gl'];
            const hit19d = DEMO_BLOCK_19D.find((p19d) => pathname === p19d || pathname.indexOf(p19d + '/') === 0);
            if (hit19d) {
                try { writeAudit15b({ ts: new Date().toISOString(), user: (req.user && req.user.username) || '-', role: (req.user && req.user.role) || '-', ip: clientIp15b(req), action: 'demo.blocked_19d', endpoint: pathname, status: 403, user_agent: String(req.headers['user-agent'] || '').slice(0, 200), payload_hash: '', ms: 0 }); } catch (e19d) { /* noop */ }
                return sendJson(res, { error: 'حالت دمو فعال است — ماژول‌های مالی/فروش/خرید غیرفعال‌اند (مالی مشتری در سپیدار است).', code: 'DEMO_MODE' }, 403);
            }
        }
    }
    /* ===== FIX-UI-19d (end) ===== */
    /* ===== HARDEN-18Q (end) ===== */
    // ===== SEC-15b: ریت‌لیمیت عمومی — ۱۰۰/دقیقه per-IP با Retry-After =====
    const rl15b = rateLimit15b(req, pathname);
    if (rl15b > 0) {
        res.setHeader('Retry-After', String(rl15b));
        return sendJson(res, { error: 'تعداد درخواست‌ها بیش از حد مجاز است — لطفاً کمی صبر کنید.', code: 'RATE_LIMITED' }, 429);
    }
    /* HARDEN-18F: سقف اختصاصی گزارش‌های سنگین (۳۰/دقیقه per IP — ضد DoS گزارش/اکسل) */
    const rlh18f = rateLimitHeavy18F(req, pathname);
    if (rlh18f > 0) {
        res.setHeader('Retry-After', String(rlh18f));
        return sendJson(res, { error: 'حجم درخواست‌های گزارش سنگین بیش از حد مجاز است — لطفاً کمی صبر کنید.', code: 'RATE_LIMITED_HEAVY' }, 429);
    }
    // ===== SEC-15b: audit خودکار هر POST/PUT/DELETE (ip/ua/status/payload_hash) — از طریق res finish =====
    if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
        try {
            const h15b = crypto.createHash('sha256');
            const t015b = Date.now();
            req.on('data', (c) => { try { h15b.update(c); } catch (e) { /* noop */ } });
            res.on('finish', () => {
                try {
                    writeAudit15b({
                        ts: new Date().toISOString(),
                        user: req.user ? req.user.username : '-', role: req.user ? req.user.role : '-',
                        ip: clientIp15b(req), action: 'http.' + req.method.toLowerCase(), endpoint: pathname,
                        status: res.statusCode, user_agent: String(req.headers['user-agent'] || '').slice(0, 200),
                        payload_hash: h15b.digest('hex').slice(0, 32), ms: Date.now() - t015b,
                    });
                } catch (e) { /* بی‌ضرر */ }
            });
        } catch (e) { /* بی‌ضرر */ }
    }

    // ===== S1 AUTH: public auth routes (login page + /api/auth/*) =====
    // ===== SAAS-15a: تازه‌سازی برندینگ لاگین با mtime کش — تغییر tenant.json بدون ری‌استارت اعمال می‌شود =====
    if (req.method === 'GET' && pathname === '/login') {
        const c15aLogin = loadTenant15a();
        auth.setTenantBranding15a(tenantCache15a ? { name: c15aLogin.name, logo: c15aLogin.logo || '', colors: c15aLogin.brand_colors || {} } : null); /* FIX-ORG-16b: + رنگ‌ها */
    }
    if (auth.handlePublic(req, res, pathname)) return;
    // ===== SAAS-15a (begin): مسیرهای عمومی تنانت — برندینگ بدون احراز هویت (بدون دادهٔ حساس) =====
    if (req.method === 'GET' && pathname === '/api/tenant/config') {
        // بدون tenant.json → tenant:null (کلاینت هیچ تغییری نمی‌دهد — برند پیش‌فرض دست‌نخورده)
        if (!tenantCache15a) { loadTenant15a(); }
        if (!tenantCache15a) return sendJson(res, { ok: true, tenant: null });
        const c15a = tenantCache15a;
        return sendJson(res, { ok: true, tenant: {
            tenant_id: c15a.tenant_id, name: c15a.name, logo: c15a.logo || '',
            brand_colors: c15a.brand_colors || {}, active_modules: c15a.active_modules.slice(),
            demo_mode: !!c15a.demo_mode, /* FIX-UI-19d: حالت دمو — مخفیسازی کامل مالی/فروش/خرید در UI + گیت سرورساید */
            hidden_tabs: (Array.isArray(c15a.hidden_tabs) ? c15a.hidden_tabs : []).slice(), /* GO-LIVE-32: گیت دامنهٔ راه‌اندازی — فقط UI؛ پاس‌ترو سرراست */
            license: { expired: isLicenseExpired15a(c15a), expires_at: c15a.expires_at || '', invalid: !!(c15a && c15a.__lic_invalid_24) }, /* SEC-LIC-24 */
        } });
    }
    if (req.method === 'GET' && (pathname === '/tenant-logo.png' || pathname === '/tenant-logo.jpg')) {
        const lp15a = path.join(PUBLIC_DATA_DIR_19E, pathname.slice(1)); /* SEC-PROTECT-19e */
        fs.readFile(lp15a, (e15a, d15a) => {
            if (e15a) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
            res.writeHead(200, { 'Content-Type': pathname.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'Cache-Control': 'no-cache' }); res.end(d15a);
        });
        return;
    }
    // ===== SAAS-15a (end) =====
    // ===== FEAT-PWA-8b (begin): دارایی‌های عمومی PWA بدون احراز هویت — فقط مانیفست/سرویس‌ورکر/آیکون برند (بدون هیچ دادهٔ حساس) =====
    /* ===== FIX-PWA-10c: favicon هم به لیست عمومی PWA افزوده شد ===== */
    /* ===== FIX-AN-20a: Chart.js محلی (/vendor/chart.umd.min.js) هم عمومی شد — وگرنه 302 به /login برمی‌گشت و اسکریپت مثل CDNِ قطع parse-error می‌داد؛ کتابخانهٔ عمومی MIT است و هیچ دادهٔ حساسی ندارد ===== */
    if (req.method === 'GET' && (pathname === '/manifest.webmanifest' || pathname === '/sw.js' || pathname === '/icon-192.png' || pathname === '/icon-512.png' || pathname === '/favicon.ico' || pathname === '/vendor/chart.umd.min.js')) {
        // ===== SAAS-15a: مانیفست/فاوآیکون پویا فقط وقتی tenant.json واقعاً موجود است — وگرنه رفتار سابق =====
        loadTenant15a();
        if (tenantCache15a) {
            const tCfg15a = tenantCache15a;
            if (pathname === '/manifest.webmanifest') {
                const logoPath15a = resolveTenantLogoFile15a(tCfg15a);
                const icons15a = logoPath15a
                    ? [{ src: tCfg15a.logo, sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: tCfg15a.logo, sizes: '512x512', type: 'image/png', purpose: 'any' }]
                    : [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }];
                const m15a = {
                    name: tCfg15a.name, short_name: tCfg15a.name, description: tCfg15a.name + ' — ERP/MES',
                    id: '/', lang: 'fa', dir: 'rtl', start_url: '/', scope: '/', display: 'standalone',
                    background_color: '#0b1622', theme_color: (tCfg15a.brand_colors && tCfg15a.brand_colors.primary) || '#0f2a43',
                    icons: icons15a,
                };
                res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-cache' });
                res.end(JSON.stringify(m15a));
                return;
            }
            if (pathname === '/favicon.ico') {
                const lp15a = resolveTenantLogoFile15a(tCfg15a);
                if (lp15a) {
                    fs.readFile(lp15a, (e15a, d15a) => {
                        if (e15a) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
                        res.writeHead(200, { 'Content-Type': lp15a.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'Cache-Control': 'no-cache' }); res.end(d15a);
                    });
                    return;
                }
            }
        }
        const rel2 = pathname === '/manifest.webmanifest' ? 'manifest.webmanifest' : pathname.slice(1);
        const fp2 = path.join(PUBLIC_DIR, rel2);
        const h2 = { 'Cache-Control': 'no-cache' };
        if (pathname === '/manifest.webmanifest') h2['Content-Type'] = 'application/manifest+json; charset=utf-8';
        else if (pathname === '/sw.js') { h2['Content-Type'] = 'text/javascript; charset=utf-8'; h2['Service-Worker-Allowed'] = '/'; }
        else if (pathname === '/vendor/chart.umd.min.js') h2['Content-Type'] = 'text/javascript; charset=utf-8'; /* FIX-AN-20a */
        else h2['Content-Type'] = 'image/png';
        fs.readFile(fp2, (err2, data2) => {
            if (err2) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
            res.writeHead(200, h2); res.end(data2);
        });
        return;
    }
    // ===== FEAT-PWA-8b (end) =====
    // ===== S1 AUTH: guard — block unauthenticated access to /api/* and pages =====
    // (NOTE: /api/ingest and /api/health are whitelisted INSIDE auth.enforce, so the
    //  mobile app sync and monitoring keep working without a web session.)
    if (auth.enforce(req, res, pathname)) return;

    // ===== SAAS-15a: گیت لایسنس/ماژول — پس از احراز هویت، پیش از همهٔ هندلرهای داده =====
    // مستثنی‌ها: health/snapshot/ingest (قرارداد اپ موبایل/مانیتورینگ)، auth، tenant
    if (pathname.indexOf('/api/') === 0 && pathname.indexOf('/api/auth/') !== 0 && pathname.indexOf('/api/tenant/') !== 0
        && pathname !== '/api/health' && pathname !== '/api/snapshot' && pathname !== '/api/ingest') {
        const tGate15a = loadTenant15a();
        if (isLicenseExpired15a(tGate15a)) {
            return sendJson(res, { error: 'لایسنس سامانه منقضی شده است — لطفاً با پشتیبانی تماس بگیرید.', code: 'LICENSE_EXPIRED' }, 403);
        }
        const modGate15a = moduleForPath15a(pathname);
        if (modGate15a && !checkModuleAccess15a(modGate15a)) {
            return sendJson(res, { error: 'این ماژول در لایسنس شما فعال نیست — لطفاً با پشتیبانی تماس بگیرید.', code: 'MODULE_DISABLED', module: modGate15a }, 403);
        }
        if (req.method !== 'GET' && pathname.indexOf('/api/admin/') !== 0) { /* FEAT-ADMIN-17a: مدیریت کاربران هرگز با سقف پر بلوک نمی‌شود (غیرفعال‌سازی باید همیشه ممکن باشد) — سقف‌ها داخل خود endpoint اعمال می‌شوند */
            const limGate15a = checkTenantLimits15a();
            if (!limGate15a.ok) {
                return sendJson(res, { error: 'سقف ظرفیت لایسنس پر شده است (کاربران: ' + limGate15a.users + '/' + (limGate15a.maxUsers || '∞') + ' — رکوردها: ' + limGate15a.records + '/' + (limGate15a.maxRecords || '∞') + ') — لطفاً با پشتیبانی تماس بگیرید.', code: 'LIMIT_REACHED' }, 403);
            }
        }
    }
    // ===== SAAS-15a (گیت — end) =====

    // ===== SAAS-15c (begin): endpointهای پنل سازمان — فقط admin =====
    if (pathname === '/api/tenant/usage' && req.method === 'GET') {
        if (!auth.requireRole(req, [])) return sendJson(res, { error: 'فقط مدیر سامانه مجاز است.' }, 403);
        const cU15c = loadTenant15a();
        const limU15c = checkTenantLimits15a();
        let liveU15c = {};
        try { liveU15c = readLive(); } catch (e) { /* noop */ }
        const cntU15c = (k) => (Array.isArray(liveU15c[k]) ? liveU15c[k].length : 0);
        const perModule15c = {
            production: cntU15c('production_logs') + cntU15c('waste_logs') + cntU15c('downtime_logs') + cntU15c('billets') + cntU15c('furnace_logs') + cntU15c('rebar_bundles'),
            quality: cntU15c('quality_inspections'),
            inventory: cntU15c('inventory_items') + cntU15c('inventory_txns') + cntU15c('warehouse_txns'),
            maintenance: cntU15c('maintenance_logs') + cntU15c('pm_plans'),
            em: cntU15c('energy_logs'),
            planning: cntU15c('production_plans') + cntU15c('plan_scenarios'),
            finance: cntU15c('fin_docs'),
        };
        return sendJson(res, { ok: true, usage: {
            users: limU15c.users, max_users: limU15c.maxUsers, records: limU15c.records, max_records: limU15c.maxRecords,
            sessions_active: auth.activeSessions15c(),
            license: { expired: isLicenseExpired15a(cU15c), expires_at: cU15c.expires_at || '', invalid: !!(cU15c && cU15c.__lic_invalid_24) }, /* SEC-LIC-24 */
            per_module: perModule15c,
        } });
    }
    if (pathname === '/api/tenant/config' && req.method === 'PUT') {
        if (!auth.requireRole(req, [])) return sendJson(res, { error: 'فقط مدیر سامانه مجاز است.' }, 403);
        readBody(req).then((body15c) => {
            try {
                const b15c = JSON.parse(body15c || '{}');
                const cfg15c = JSON.parse(JSON.stringify(loadTenant15a())); /* کپی عمیق — DEFAULT مشترک خراب نشود */
                /* ===== SEC-LIC-24 (begin): فیلدهای لایسنس فقط برای مالک سیستم (فروشنده) — admin مشتری فقط برندینگ/کاربران/آمار ===== */
                const LIC_FIELDS_24 = ['active_modules', 'max_users', 'max_records', 'expires_at'];
                const licTouched24 = LIC_FIELDS_24.some((f24) => b15c[f24] !== undefined);
                if (licTouched24 && !isOwnerReq24(req)) {
                    auditLog(req, 'license.owner_denied', { fields: LIC_FIELDS_24.filter((f24) => b15c[f24] !== undefined) });
                    return sendJson(res, { error: 'ویرایش لایسنس (ماژول‌ها/سقف‌ها/انقضا) فقط توسط مالک سیستم (فروشنده) مجاز است.', code: 'OWNER_ONLY' }, 403);
                }
                /* ===== SEC-LIC-24 (end) ===== */
                if (b15c.name != null) cfg15c.name = (String(b15c.name).slice(0, 80).trim() || 'صنعتی فای');
                if (Array.isArray(b15c.active_modules)) {
                    const mods15c = b15c.active_modules.filter((m) => MODULES_15A.indexOf(m) !== -1);
                    if (!mods15c.length) return sendJson(res, { error: 'حداقل یک ماژول باید فعال بماند.' }, 400);
                    cfg15c.active_modules = mods15c;
                }
                if (b15c.max_users != null) cfg15c.max_users = Math.max(0, Number(b15c.max_users) || 0);
                if (b15c.max_records != null) cfg15c.max_records = Math.max(0, Number(b15c.max_records) || 0);
                if (b15c.expires_at != null) { /* SEC-LIC-24: انقضای لایسنس از پنل مالک (ISO میلادی — خالی = حذف انقضا) */
                    const e24 = String(b15c.expires_at || '').trim();
                    if (e24) { const t24 = Date.parse(e24); if (isNaN(t24)) return sendJson(res, { error: 'تاریخ انقضا نامعتبر است — نمونه: 2027-03-20.' }, 400); cfg15c.expires_at = new Date(t24).toISOString(); }
                    else cfg15c.expires_at = '';
                }
                /* ===== FEAT-ADMIN-17a (begin): سقف نفرات هر نقش (role_caps) — کلیدهای نامعتبر حذف، مقدار ≥۰ ===== */
                if (b15c.role_caps != null) {
                    if (typeof b15c.role_caps !== 'object' || Array.isArray(b15c.role_caps)) return sendJson(res, { error: 'سقف نقش‌ها نامعتبر است.' }, 400);
                    const rc17a = {};
                    Object.keys(b15c.role_caps).forEach((r17a) => {
                        if (ROLES_17A.indexOf(r17a) === -1) return; /* نقش خارج از فهرست — نادیده */
                        rc17a[r17a] = Math.max(0, Math.floor(Number(b15c.role_caps[r17a]) || 0));
                    });
                    cfg15c.role_caps = rc17a;
                }
                /* ===== FEAT-ADMIN-17a (end) ===== */
                /* ===== FIX-ORG-16b (begin): رنگ‌های برند از پنل — فقط HEX شش‌رقمی؛ خالی = برند پیش‌فرض ===== */
                if (b15c.brand_colors != null) {
                    if (typeof b15c.brand_colors !== 'object' || Array.isArray(b15c.brand_colors)) return sendJson(res, { error: 'رنگ‌های برند نامعتبر است.' }, 400);
                    const bc16b = {}, re16b = /^#[0-9a-f]{6}$/;
                    let bcErr16b = '';
                    ['primary', 'accent'].forEach((k16b) => {
                        const v16b = String(b15c.brand_colors[k16b] == null ? '' : b15c.brand_colors[k16b]).trim().toLowerCase();
                        if (v16b && !re16b.test(v16b)) { bcErr16b = 'فرمت رنگ نامعتبر است — باید کد HEX شش‌رقمی باشد (مثلاً #0e7490).'; return; }
                        bc16b[k16b] = v16b;
                    });
                    if (bcErr16b) return sendJson(res, { error: bcErr16b }, 400);
                    cfg15c.brand_colors = bc16b;
                }
                /* ===== FIX-ORG-16b (end) ===== */
                if (b15c.custom_settings && typeof b15c.custom_settings === 'object' && !Array.isArray(b15c.custom_settings)) {
                    cfg15c.custom_settings = Object.assign({}, cfg15c.custom_settings, b15c.custom_settings); /* ادغام سطح‌اول — allowed_origins از دست نرود */
                }
                if (b15c.logo_clear) {
                    try { ['tenant-logo.png', 'tenant-logo.jpg'].forEach((f15c) => { const p15c = path.join(PUBLIC_DATA_DIR_19E, f15c); if (fs.existsSync(p15c)) fs.unlinkSync(p15c); }); } catch (e) { /* noop */ } /* SEC-PROTECT-19e */
                    cfg15c.logo = '';
                }
                const du15c = String(b15c.logo_dataurl || '').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+\/=]+)$/);
                if (du15c) {
                    const buf15c = Buffer.from(du15c[2], 'base64');
                    if (buf15c.length > 300 * 1024) return sendJson(res, { error: 'لوگو بیش از ۳۰۰ کیلوبایت است.' }, 400);
                    const ext15c = du15c[1] === 'png' ? 'png' : 'jpg';
                    fs.writeFileSync(path.join(PUBLIC_DATA_DIR_19E, 'tenant-logo.' + ext15c), buf15c); /* SEC-PROTECT-19e */
                    cfg15c.logo = '/tenant-logo.' + ext15c;
                }
                cfg15c.license_sig = licSign24(cfg15c); /* SEC-LIC-24: هر ذخیرهٔ سرور = امضای تازه (فایل همیشه معتبر می‌ماند) */
                cfg15c.__lic_invalid_24 = false; /* SEC-LIC-24: فایل تازه‌امضاشده حتماً معتبر است — پرچم کهنهٔ خواندن قبلی ریست شود تا بنر فوراً خاموش شود */
                writeTenantFile15c(cfg15c);
                auth.setTenantBranding15a({ name: cfg15c.name, logo: cfg15c.logo || '', colors: cfg15c.brand_colors || {} }); /* FIX-ORG-16b: + رنگ‌ها */
                auditLog(req, 'tenant.update', { active_modules: cfg15c.active_modules, max_users: cfg15c.max_users, max_records: cfg15c.max_records, logo: cfg15c.logo, brand_colors: cfg15c.brand_colors || {} });
                return sendJson(res, { ok: true, tenant: tenantPublicShape15c(cfg15c) });
            } catch (e) {
                return sendJson(res, { error: 'خطا در ذخیرهٔ پیکربندی: ' + String(e && e.message ? e.message : e) }, 500);
            }
        });
        return;
    }
    // ===== SAAS-15c (end) =====

    // ===== FEAT-ADMIN-17a (begin): مدیریت کاربران و نقش‌ها از پنل سازمان — فقط admin، بدون ویرایش فایل =====
    if (pathname === '/api/admin/users' && req.method === 'GET') {
        if (!auth.requireRole(req, [])) return sendJson(res, { error: 'فقط مدیر سامانه مجاز است.' }, 403);
        const users17a = readUsers17a();
        const cfg17a = loadTenant15a();
        const roleCounts17a = {};
        ROLES_17A.forEach((r) => { roleCounts17a[r] = 0; });
        let activeUsers17a = 0;
        const list17a = users17a.map((u) => {
            const act17a = u.active !== false;
            if (act17a) { activeUsers17a++; if (roleCounts17a[u.role] !== undefined) roleCounts17a[u.role]++; }
            return { username: String(u.username || ''), name: String(u.name || ''), role: String(u.role || 'viewer'), active: act17a, status: String(u.status || ''), modules: Array.isArray(u.modules) ? u.modules.slice() : [], modules_override: u.modules_override === true, sessions: auth.activeSessionCount17a(u.username) }; /* USER-MGMT-39a: +وضعیت حذف نرم + ماژول‌ها | MODULE-OVERRIDE-41: +پرچم اجبار */
        });
        return sendJson(res, {
            ok: true,
            users: list17a,
            tenant_modules: (Array.isArray(cfg17a.active_modules) ? cfg17a.active_modules : []).slice(), /* USER-MGMT-39a: ماژول‌های فعال tenant برای مودال چک‌باکس */
            role_counts: roleCounts17a,
            role_caps: cfg17a.role_caps || {},
            total_users: list17a.length,
            active_users: activeUsers17a,
            max_users: Number(cfg17a.max_users) || 0,
        });
    }
    if (pathname === '/api/admin/users' && req.method === 'POST') {
        if (!auth.requireRole(req, [])) return sendJson(res, { error: 'فقط مدیر سامانه مجاز است.' }, 403);
        readBody(req).then((body17a) => {
            try {
                const b17a = JSON.parse(body17a || '{}');
                const username17a = String(b17a.username || '').trim();
                const name17a = String(b17a.name || '').trim().slice(0, 80);
                const role17a = String(b17a.role || '').trim();
                const password17a = b17a.password != null ? String(b17a.password) : '';
                if (!/^[A-Za-z0-9._-]{3,40}$/.test(username17a)) return sendJson(res, { error: 'نام کاربری باید ۳ تا ۴۰ کاراکتر لاتین، عدد، نقطه، زیرخط یا خط تیره باشد.' }, 400);
                if (!name17a) return sendJson(res, { error: 'نام کامل کاربر الزامی است.' }, 400);
                if (ROLES_17A.indexOf(role17a) === -1) return sendJson(res, { error: 'نقش انتخاب‌شده نامعتبر است.' }, 400);
                if (vendorRole37(role17a) && !isOwnerReq24(req)) return sendJson(res, { error: 'ایجاد کاربر «صاحب سیستم» فقط توسط صاحب سیستم (فروشنده) مجاز است.', code: 'OWNER_ONLY' }, 403); /* SEC-LIC-24 + VENDOR-37 */
                if (role17a === 'admin' && !isOwnerReq24(req)) return sendJson(res, { error: 'ایجاد کاربر «admin» فقط توسط صاحب سیستم (vendor) مجاز است — admin نمی‌تواند admin بسازد.', code: 'VENDOR_ONLY' }, 403); /* VENDOR-37: ساخت admin فقط صاحب سیستم */
                const polErr18p = auth.passwordPolicyError18P(password17a, username17a); /* HARDEN-18P: حداقل ۸ + پیچیدگی */
                if (polErr18p) return sendJson(res, { error: polErr18p }, 400);
                const users17a = readUsers17a();
                if (users17a.some((u) => String(u.username || '').toLowerCase() === username17a.toLowerCase())) return sendJson(res, { error: 'این نام کاربری قبلاً ثبت شده است.' }, 400);
                /* سقف سراسری کاربران لایسنس (۰ = بی‌سقف) — همان شمارندهٔ موتور لایسنس */
                const lim17a = checkTenantLimits15a();
                if (lim17a.maxUsers > 0 && lim17a.users >= lim17a.maxUsers) {
                    return sendJson(res, { error: 'سقف کاربران لایسنس پر است (' + lim17a.users + ' از ' + lim17a.maxUsers + ') — ابتدا سقف را در فرم پنل افزایش دهید.', code: 'MAX_USERS' }, 403);
                }
                /* سقف نفرات این نقش (role_caps — ۰ = بی‌سقف)؛ فقط کاربران فعال شمرده می‌شوند */
                const cfg17a = loadTenant15a();
                const cap17a = Number((cfg17a.role_caps || {})[role17a]) || 0;
                if (cap17a > 0) {
                    const inRole17a = users17a.filter((u) => u.role === role17a && u.active !== false).length;
                    if (inRole17a >= cap17a) {
                        return sendJson(res, { error: 'سقف نقش «' + (ROLE_FA_17A[role17a] || role17a) + '» پر است (' + inRole17a + ' نفر از ' + cap17a + ') — ابتدا سقف را افزایش دهید یا کاربری از این بخش را غیرفعال کنید.', code: 'ROLE_CAP' }, 403);
                    }
                }
                /* رمز همین لحظه هش می‌شود — plaintext هرگز ذخیره/لاگ نمی‌شود */
                users17a.push({ username: username17a, name: name17a, role: role17a, active: true, password_hash: auth.hashPassword(password17a), created_at: new Date().toISOString(), created_by: req.user.username });
                if (!auth.writeUsers17a(users17a)) return sendJson(res, { error: 'خطا در نوشتن فایل کاربران — تغییر ذخیره نشد.' }, 500);
                auditLog(req, 'admin.user_add', { username: username17a, role: role17a, users_total: users17a.length });
                return sendJson(res, { ok: true, username: username17a, role: role17a });
            } catch (e) {
                return sendJson(res, { error: 'خطا در افزودن کاربر: ' + String(e && e.message ? e.message : e) }, 500);
            }
        });
        return;
    }
    if (pathname === '/api/admin/users' && req.method === 'PUT') {
        if (!auth.requireRole(req, [])) return sendJson(res, { error: 'فقط مدیر سامانه مجاز است.' }, 403);
        readBody(req).then((body17a) => {
            try {
                const b17a = JSON.parse(body17a || '{}');
                const username17a = String(b17a.username || '').trim();
                if (!username17a) return sendJson(res, { error: 'نام کاربری الزامی است.' }, 400);
                const users17a = readUsers17a();
                const idx17a = users17a.findIndex((u) => String(u.username || '').toLowerCase() === username17a.toLowerCase());
                if (idx17a === -1) return sendJson(res, { error: 'کاربر یافت نشد.' }, 404);
                const u17a = users17a[idx17a];
                const isSelf17a = username17a.toLowerCase() === String(req.user.username || '').toLowerCase();
                const changed17a = {};
                let deactivate17a = false, roleChanged17a = false;
                if (b17a.name != null) {
                    const nm17a = String(b17a.name).trim().slice(0, 80);
                    if (!nm17a) return sendJson(res, { error: 'نام کامل نمی‌تواند خالی باشد.' }, 400);
                    if (nm17a !== String(u17a.name || '')) { u17a.name = nm17a; changed17a.name = nm17a; }
                }
                if (b17a.role != null) {
                    const role17a = String(b17a.role).trim();
                    if (ROLES_17A.indexOf(role17a) === -1) return sendJson(res, { error: 'نقش انتخاب‌شده نامعتبر است.' }, 400);
                    if (role17a !== String(u17a.role || '')) {
                        if (isSelf17a) return sendJson(res, { error: 'تغییر نقش حساب خودتان مجاز نیست — از حساب مدیر دیگری استفاده کنید.' }, 400);
                        /* SEC-LIC-24 (begin): نقش مالک — فقط مالک می‌دهد/می‌گیرد؛ آخرین مالک فعال حفظ می‌شود */
                        if ((vendorRole37(role17a) || vendorRole37(String(u17a.role || ''))) && !isOwnerReq24(req)) return sendJson(res, { error: 'تغییر نقش «صاحب سیستم» فقط توسط صاحب سیستم (فروشنده) مجاز است.', code: 'OWNER_ONLY' }, 403); /* VENDOR-37 */
                        if ((role17a === 'admin' || String(u17a.role || '') === 'admin') && !isOwnerReq24(req)) return sendJson(res, { error: 'تغییر نقش کاربر «admin» فقط توسط صاحب سیستم (vendor) مجاز است.', code: 'VENDOR_ONLY' }, 403); /* VENDOR-37: ساخت/حذف admin فقط صاحب سیستم */
                        if (vendorRole37(String(u17a.role || '')) && !vendorRole37(role17a) && u17a.active !== false) {
                            const ownersLeft24 = users17a.filter((x) => vendorRole37(x.role) && x.active !== false).length;
                            if (ownersLeft24 <= 1) return sendJson(res, { error: 'حداقل یک صاحب سیستم (vendor) فعال باید باقی بماند.' }, 400);
                        }
                        /* SEC-LIC-24 (end) */
                        if (u17a.role === 'admin' && u17a.active !== false) {
                            const admins17a = users17a.filter((x) => x.role === 'admin' && x.active !== false).length;
                            if (admins17a <= 1) return sendJson(res, { error: 'حداقل یک مدیر فعال باید باقی بماند.' }, 400);
                        }
                        /* سقف نقش مقصد (فقط کاربران فعال شمرده می‌شوند) */
                        const capDst17a = Number((loadTenant15a().role_caps || {})[role17a]) || 0;
                        if (capDst17a > 0 && u17a.active !== false) {
                            const inDst17a = users17a.filter((x) => x.role === role17a && x.active !== false).length;
                            if (inDst17a >= capDst17a) return sendJson(res, { error: 'سقف نقش «' + (ROLE_FA_17A[role17a] || role17a) + '» پر است (' + inDst17a + ' نفر از ' + capDst17a + ') — ابتدا سقف را افزایش دهید.', code: 'ROLE_CAP' }, 403);
                        }
                        u17a.role = role17a; changed17a.role = role17a; roleChanged17a = true;
                    }
                }
                if (b17a.active != null) {
                    const act17a = !!b17a.active;
                    if (!act17a && u17a.active !== false) {
                        if (isSelf17a) return sendJson(res, { error: 'غیرفعال‌کردن حساب خودتان مجاز نیست.' }, 400);
                        if (vendorRole37(String(u17a.role || '')) && !isOwnerReq24(req)) return sendJson(res, { error: 'غیرفعال‌سازی «صاحب سیستم» فقط توسط صاحب سیستم (فروشنده) مجاز است.', code: 'OWNER_ONLY' }, 403); /* SEC-LIC-24 + VENDOR-37 */
                        if (u17a.role === 'admin' && !isOwnerReq24(req)) return sendJson(res, { error: 'غیرفعال‌سازی کاربر «admin» فقط توسط صاحب سیستم (vendor) مجاز است.', code: 'VENDOR_ONLY' }, 403); /* VENDOR-37: حذف admin فقط صاحب سیستم */
                        if (vendorRole37(String(u17a.role || ''))) {
                            const ownersAct24 = users17a.filter((x) => vendorRole37(x.role) && x.active !== false).length;
                            if (ownersAct24 <= 1) return sendJson(res, { error: 'حداقل یک صاحب سیستم (vendor) فعال باید باقی بماند.' }, 400); /* SEC-LIC-24 + VENDOR-37 */
                        }
                        if (u17a.role === 'admin') {
                            const admins17a = users17a.filter((x) => x.role === 'admin' && x.active !== false).length;
                            if (admins17a <= 1) return sendJson(res, { error: 'حداقل یک مدیر فعال باید باقی بماند.' }, 400);
                        }
                        u17a.active = false; changed17a.active = false; deactivate17a = true;
                    } else if (act17a && u17a.active === false) {
                        u17a.active = true; changed17a.active = true;
                        if (String(u17a.status || '') === 'deleted') { delete u17a.status; delete u17a.deleted_at; delete u17a.deleted_by; changed17a.restored = true; } /* USER-MGMT-39b: فعال‌سازی مجدد = بازیابی از حذف نرم */
                    }
                }
                if (!Object.keys(changed17a).length) return sendJson(res, { ok: true, message: 'تغییری اعمال نشد — مقادیر همان مقادیر قبلی است.' });
                if (!auth.writeUsers17a(users17a)) return sendJson(res, { error: 'خطا در نوشتن فایل کاربران — تغییر ذخیره نشد.' }, 500);
                /* غیرفعال‌سازی/تغییر نقش ⇒ نشست‌های زندهٔ همان کاربر بسته می‌شود (خروج در درخواست بعدی) */
                let killed17a = 0;
                if (deactivate17a || roleChanged17a) killed17a = auth.killSessionsByUsername17a(u17a.username);
                else if (changed17a.name) auth.refreshSessionUser17a(u17a.username, { name: changed17a.name });
                auditLog(req, deactivate17a ? 'admin.user_deactivate' : 'admin.user_update', { username: u17a.username, changed: changed17a, sessions_killed: killed17a });
                return sendJson(res, { ok: true, changed: changed17a, sessions_killed: killed17a });
            } catch (e) {
                return sendJson(res, { error: 'خطا در ویرایش کاربر: ' + String(e && e.message ? e.message : e) }, 500);
            }
        });
        return;
    }
    if (pathname === '/api/admin/users/password' && req.method === 'POST') {
        if (!auth.requireRole(req, [])) return sendJson(res, { error: 'فقط مدیر سامانه مجاز است.' }, 403);
        readBody(req).then((body17a) => {
            try {
                const b17a = JSON.parse(body17a || '{}');
                const username17a = String(b17a.username || '').trim();
                const pw17a = b17a.new_password != null ? String(b17a.new_password) : '';
                if (!username17a) return sendJson(res, { error: 'نام کاربری الزامی است.' }, 400);
                const polErr18p = auth.passwordPolicyError18P(pw17a, username17a); /* HARDEN-18P: حداقل ۸ + پیچیدگی */
                if (polErr18p) return sendJson(res, { error: polErr18p }, 400);
                const users17a = readUsers17a();
                const u17a = users17a.find((x) => String(x.username || '').toLowerCase() === username17a.toLowerCase());
                if (!u17a) return sendJson(res, { error: 'کاربر یافت نشد.' }, 404);
                if (vendorRole37(String(u17a.role || '')) && !isOwnerReq24(req)) return sendJson(res, { error: 'بازنشانی رمز «صاحب سیستم» فقط توسط صاحب سیستم (فروشنده) مجاز است.', code: 'OWNER_ONLY' }, 403); /* SEC-LIC-24 + VENDOR-37 */
                /* هش فوری + حذف هر باقیماندهٔ plaintext (سازگار با migrate-hashes) */
                delete u17a.password;
                u17a.password_hash = auth.hashPassword(pw17a);
                u17a.password_changed_at = new Date().toISOString();
                u17a.must_change_pw = true; /* HARDEN-18P: رمز موقتِ دستِ مدیر باید در ورود بعدی عوض شود */
                if (!auth.writeUsers17a(users17a)) return sendJson(res, { error: 'خطا در نوشتن فایل کاربران — تغییر ذخیره نشد.' }, 500);
                const killed17a = auth.killSessionsByUsername17a(u17a.username);
                auditLog(req, 'admin.user_reset_password', { username: u17a.username, sessions_killed: killed17a }); /* plaintext هرگز در audit نمی‌آید */
                return sendJson(res, { ok: true, username: u17a.username, sessions_killed: killed17a });
            } catch (e) {
                return sendJson(res, { error: 'خطا در بازنشانی رمز: ' + String(e && e.message ? e.message : e) }, 500);
            }
        });
        return;
    }
    /* ===== USER-MGMT-39a (begin): ویرایش دسترسی‌های ماژولی کاربر — فقط صاحب سیستم (vendor) =====
       PATCH /api/admin/users/modules   بدنه: { username, moduleKeys: [], override?: bool }
       • moduleKeys باید زیرمجموعهٔ ماژول‌های فعال tenant باشد (کلید ناشناس/غیرفعال ⇒ 400).
       • آرایهٔ خالی = «بدون محدودیت» (دسترسی کامل نقش) — ضد قفل‌شدگی صفر-تب.
       • جایگزینی کامل permissions ماژولی؛ audit: چه‌کسی چه‌ماژول‌هایی افزود/حذف کرد.
       • MODULE-OVERRIDE-41: override=true ⇒ حالت «اجبار بر نقش» (اتحاد: نقش ∪ ماژول‌های تیک‌خورده) —
         فقط vendor واقعی؛ بدون اجبار رفتار 39a (اشتراک) دست‌نخورده؛ سقف لایسنس/hidden_tabs مقدم است.
       • بدون خروج اجباری: refreshSessionUser17a ⇒ /api/auth/me درخواست بعدی محدودیت تازه را می‌دهد. */
    if (pathname === '/api/admin/users/modules' && req.method === 'PATCH') {
        if (!isOwnerReq24(req)) return sendJson(res, { error: 'ویرایش دسترسی‌های ماژولی کاربر فقط توسط صاحب سیستم (vendor) مجاز است.', code: 'VENDOR_ONLY' }, 403);
        readBody(req).then((body39a) => {
            try {
                const b39a = JSON.parse(body39a || '{}');
                const username39a = String(b39a.username || '').trim();
                if (!username39a) return sendJson(res, { error: 'نام کاربری الزامی است.' }, 400);
                if (!Array.isArray(b39a.moduleKeys)) return sendJson(res, { error: 'moduleKeys باید آرایه باشد.' }, 400);
                const ov41 = b39a.override === true; /* MODULE-OVERRIDE-41: اجبار بر نقش */
                if (ov41 && !vendorRole37(String(req.user.role || ''))) return sendJson(res, { error: 'سوییچ «اجبار بر نقش» فقط توسط صاحب سیستم (vendor) مجاز است.', code: 'VENDOR_ONLY' }, 403);
                const keys39a = Array.from(new Set(b39a.moduleKeys.map((m) => String(m || '').trim()).filter((m) => m)));
                const unknown39a = keys39a.filter((m) => MODULES_15A.indexOf(m) === -1);
                if (unknown39a.length) return sendJson(res, { error: 'کلید ماژول نامعتبر: ' + unknown39a.join(', ') }, 400);
                const cfg39a = loadTenant15a();
                const active39a = Array.isArray(cfg39a.active_modules) && cfg39a.active_modules.length ? cfg39a.active_modules : MODULES_15A.slice();
                const inactive39a = keys39a.filter((m) => active39a.indexOf(m) === -1);
                if (inactive39a.length) return sendJson(res, { error: 'این ماژول‌ها در لایسنس سازمان فعال نیستند: ' + inactive39a.join(', '), code: 'MODULE_INACTIVE' }, 400);
                const users39a = readUsers17a();
                const u39a = users39a.find((x) => String(x.username || '').toLowerCase() === username39a.toLowerCase());
                if (!u39a) return sendJson(res, { error: 'کاربر یافت نشد.' }, 404);
                if (vendorRole37(String(u39a.role || ''))) return sendJson(res, { error: 'صاحب سیستم (vendor) همیشه دسترسی کامل دارد — محدودیت ماژول قابل اعمال نیست.', code: 'PROTECTED' }, 403);
                if (String(u39a.status || '') === 'deleted') return sendJson(res, { error: 'این کاربر حذف (نرم) شده است — ابتدا از بخش کاربران فعال‌سازی مجدد کنید.', code: 'DELETED' }, 400);
                const before39a = Array.isArray(u39a.modules) ? u39a.modules.slice() : [];
                if (keys39a.length) { u39a.modules = keys39a; if (ov41) u39a.modules_override = true; else delete u39a.modules_override; } /* خالی = بدون محدودیت */
                else { delete u39a.modules; delete u39a.modules_override; }
                if (!auth.writeUsers17a(users39a)) return sendJson(res, { error: 'خطا در نوشتن فایل کاربران — تغییر ذخیره نشد.' }, 500);
                const added39a = keys39a.filter((m) => before39a.indexOf(m) === -1);
                const removed39a = before39a.filter((m) => keys39a.indexOf(m) === -1);
                auth.refreshSessionUser17a(u39a.username, { modules: keys39a.length ? keys39a.slice() : undefined, modules_override: keys39a.length && ov41 ? true : undefined }); /* بدون logout — درخواست بعدی اعمال می‌شود */
                auditLog(req, 'admin.user_modules', { username: u39a.username, added: added39a, removed: removed39a, modules: keys39a.slice(), unrestricted: !keys39a.length, override: ov41 });
                if (ov41) auditLog(req, 'admin.modules_override', { username: u39a.username, added: added39a, modules: keys39a.slice(), note: 'اجبار بر نقش فعال شد — ماژول‌های افزوده‌شده به دسترسی نقش اضافه شدند (اتحاد)؛ سقف لایسنس/تب‌های مخفی مقدم است.' }); /* MODULE-OVERRIDE-41 */
                return sendJson(res, { ok: true, username: u39a.username, modules: keys39a.slice(), unrestricted: !keys39a.length, override: keys39a.length > 0 && ov41, added: added39a, removed: removed39a }); /* override پاسخ = حالت مؤثر ذخیره‌شده */
            } catch (e) {
                return sendJson(res, { error: 'خطا در ویرایش دسترسی‌ها: ' + String(e && e.message ? e.message : e) }, 500);
            }
        });
        return;
    }
    // ===== USER-MGMT-39a (end) =====
    /* ===== MODULE-OVERRIDE-41 (begin): خروج اجباری کاربر — فقط صاحب سیستم (vendor)؛ اختیاری پس از تغییر ماژول‌ها =====
       POST /api/admin/users/force-logout   بدنه: { username }
       • همهٔ نشست‌های زندهٔ کاربر هدف بسته می‌شود (killSessionsByUsername17a) — ورود بعدی با دسترسی‌های تازه.
       • gardo-ha: هدف vendor/صاحب‌سیستم ⇒ 403 PROTECTED؛ خودِ درخواست‌کننده vendor است (گارد بالا) — خود-خروجی ناممکن.
       • audit: admin.user_force_logout { username, sessions_killed }. */
    if (pathname === '/api/admin/users/force-logout' && req.method === 'POST') {
        if (!vendorRole37(String((req.user && req.user.role) || ''))) return sendJson(res, { error: 'اجبار به خروج کاربر فقط توسط صاحب سیستم (vendor) مجاز است.', code: 'VENDOR_ONLY' }, 403);
        readBody(req).then((body41) => {
            try {
                const b41 = JSON.parse(body41 || '{}');
                const username41 = String(b41.username || '').trim();
                if (!username41) return sendJson(res, { error: 'نام کاربری الزامی است.' }, 400);
                const users41 = readUsers17a();
                const u41 = users41.find((x) => String(x.username || '').toLowerCase() === username41.toLowerCase());
                if (!u41) return sendJson(res, { error: 'کاربر یافت نشد.' }, 404);
                if (vendorRole37(String(u41.role || ''))) return sendJson(res, { error: 'صاحب سیستم (vendor) قابل اجبار به خروج نیست.', code: 'PROTECTED' }, 403);
                const killed41 = auth.killSessionsByUsername17a(u41.username);
                auditLog(req, 'admin.user_force_logout', { username: u41.username, sessions_killed: killed41 });
                return sendJson(res, { ok: true, username: u41.username, sessions_killed: killed41 });
            } catch (e) {
                return sendJson(res, { error: 'خطا در اجبار به خروج: ' + String(e && e.message ? e.message : e) }, 500);
            }
        });
        return;
    }
    // ===== MODULE-OVERRIDE-41 force-logout (end) =====
    /* ===== USER-MGMT-39b (begin): حذف کاربر — فقط صاحب سیستم (vendor)؛ حذف نرم پیش‌فرض =====
       DELETE /api/admin/users?username=…[&hard=1]
       • soft: active=false + status='deleted' + deleted_at/by — لاگین مسدود (مسیر موجود 17a)؛ تاریخچهٔ audit حفظ می‌شود؛ بازیابی با فعال‌سازی مجدد.
       • hard: حذف کامل رکورد — فقط توسعه/پاک‌سازی؛ در production (SANATIFY_ENV=production) تنها اگر سرور با --force-hard-delete بوت شده باشد.
       • گاردها: خود-حذفی ✗؛ حذف صاحب سیستم (حداقل یک vendor) ✗؛ آخرین ادمین فعال ✗. */
    if (pathname === '/api/admin/users' && req.method === 'DELETE') {
        if (!isOwnerReq24(req)) return sendJson(res, { error: 'حذف کاربر فقط توسط صاحب سیستم (vendor) مجاز است.', code: 'VENDOR_ONLY' }, 403);
        let q39b = null;
        try { q39b = new URL(req.url, 'http://x').searchParams; } catch (e39bq) { q39b = null; }
        const username39b = q39b ? String(q39b.get('username') || '').trim() : '';
        const hard39b = q39b ? ['1', 'true'].indexOf(String(q39b.get('hard') || '').toLowerCase()) !== -1 : false;
        if (!username39b) return sendJson(res, { error: 'نام کاربری الزامی است (?username=…).' }, 400);
        if (hard39b && String(process.env.SANATIFY_ENV || '').trim().toLowerCase() === 'production' && process.argv.indexOf('--force-hard-delete') === -1) {
            return sendJson(res, { error: 'حذف کامل (hard) در production ممنوع است — فقط با بوت --force-hard-delete (پاک‌سازی توسعه‌دهنده).', code: 'HARD_FORBIDDEN' }, 403);
        }
        const users39b = readUsers17a();
        const idx39b = users39b.findIndex((u) => String(u.username || '').toLowerCase() === username39b.toLowerCase());
        if (idx39b === -1) return sendJson(res, { error: 'کاربر یافت نشد.' }, 404);
        const u39b = users39b[idx39b];
        if (username39b.toLowerCase() === String(req.user.username || '').toLowerCase()) return sendJson(res, { error: 'نمی‌توانید حساب خودتان را حذف کنید.' }, 400);
        if (vendorRole37(String(u39b.role || ''))) return sendJson(res, { error: 'حذف «صاحب سیستم» مجاز نیست — حداقل یک صاحب سیستم (vendor) باید باقی بماند.', code: 'LAST_VENDOR' }, 403);
        if (u39b.role === 'admin' && u39b.active !== false) {
            const admins39b = users39b.filter((x) => x.role === 'admin' && x.active !== false && String(x.status || '') !== 'deleted').length;
            if (admins39b <= 1) return sendJson(res, { error: 'حداقل یک مدیر فعال باید باقی بماند — ابتدا مدیر دیگری بسازید یا نقش او را تغییر دهید.' }, 400);
        }
        if (hard39b) {
            users39b.splice(idx39b, 1);
            if (!auth.writeUsers17a(users39b)) return sendJson(res, { error: 'خطا در نوشتن فایل کاربران — تغییر ذخیره نشد.' }, 500);
            const killed39h = auth.killSessionsByUsername17a(u39b.username);
            auditLog(req, 'admin.user_delete', { username: u39b.username, method: 'hard', role: String(u39b.role || ''), sessions_killed: killed39h });
            return sendJson(res, { ok: true, username: u39b.username, method: 'hard', sessions_killed: killed39h });
        }
        if (String(u39b.status || '') === 'deleted') return sendJson(res, { error: 'این کاربر قبلاً حذف (نرم) شده است — برای پاک‌سازی کامل از hard=1 استفاده کنید.', code: 'ALREADY_DELETED' }, 400);
        u39b.active = false;
        u39b.status = 'deleted';
        u39b.deleted_at = new Date().toISOString();
        u39b.deleted_by = req.user.username;
        if (!auth.writeUsers17a(users39b)) return sendJson(res, { error: 'خطا در نوشتن فایل کاربران — تغییر ذخیره نشد.' }, 500);
        const killed39s = auth.killSessionsByUsername17a(u39b.username);
        auditLog(req, 'admin.user_delete', { username: u39b.username, method: 'soft', role: String(u39b.role || ''), sessions_killed: killed39s });
        return sendJson(res, { ok: true, username: u39b.username, method: 'soft', sessions_killed: killed39s });
    }
    // ===== USER-MGMT-39b (end) =====
    // ===== FEAT-ADMIN-17a (end) =====

    // ===== ✅ ADDITIVE — D3: endpoint اسنپ‌شات برای pull اپ (بدون نشست وب) =====
    if (pathname === '/api/snapshot') {
        const live = readLive();
        return sendJson(res, {
            ok: true,
            generated_at: live.generated_at || null,
            production_logs: live.production_logs || [],
            waste_logs: live.waste_logs || [],
            downtime_logs: live.downtime_logs || [],
            quality_inspections: live.quality_inspections || [],
            billets: live.billets || [],
            furnace_logs: live.furnace_logs || [],
            rebar_bundles: live.rebar_bundles || [],
        });
    }


    // ✅ ADDITIVE — health سریع، قبل از هر fetch ابری
    if (pathname === '/api/health') return handleHealthFast(req, res);

    /* ===== SEC-AUDIT-13c (begin): گاردهای خواندن ماتریس دسترسی — admin همیشه مجاز ===== */
    const R13C_PROD = ['manager', 'planner', 'operator', 'supervisor', 'finance', 'viewer']; /* تولید/ضایعات/بندیل/شمش — خواندن تولید برای برنامه‌ریزی/مالی(خلاصه)/مدیریت */
    const R13C_DOWN = R13C_PROD.concat(['engineering']);
    const R13C_INV = ['manager', 'planner', 'finance', 'warehouse', 'viewer']; /* مالی/مدیریت/برنامه‌ریز خواندن انبار؛ اپراتور/qc/مهندسی خیر */
    const R13C_MNT = ['engineering', 'supervisor'];
    const deny13c = () => sendJson(res, { error: 'دسترسی غیرمجاز: خواندن این داده برای نقش شما مجاز نیست (ماتریس دسترسی).' }, 403);
    if (pathname === '/api/production' || pathname === '/api/waste' || pathname === '/api/bundles' || pathname === '/api/billets') {
        if (!auth.requireRole(req, R13C_PROD)) return deny13c();
    } else if (pathname === '/api/downtime') {
        if (!auth.requireRole(req, R13C_DOWN)) return deny13c();
    } else if (pathname === '/api/inventory') {
        if (!auth.requireRole(req, R13C_INV)) return deny13c();
    } else if (pathname === '/api/quality') {
        if (!auth.requireRole(req, ['quality', 'qc'])) return deny13c();
    } else if (pathname === '/api/maintenance' || pathname === '/api/maintenance-extra') {
        if (!auth.requireRole(req, R13C_MNT)) return deny13c();
    }
    if (/^\/api\/(genealogy|balance)\//.test(pathname) && !auth.requireRole(req, [])) return deny13c(); /* فقط admin */
    /* ===== SEC-AUDIT-13c (end) ===== */

    // ===== POST /api/ingest : دریافت داده از اپ (بدون نیاز به ابر) =====
    if (req.method === 'POST' && pathname === '/api/ingest') {
        readBody(req).then((body) => {
            let payload; try { payload = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'invalid json' }, 400); }
            /* HARDEN-18D: ادغام از صف تک‌نویسنده عبور می‌کند — ترتیب سینک‌های همزمان اپ تضمین می‌شود */
            withLiveWrite18D(() => mergeIntoLive(payload)).then((counts) => {
                const total = Object.values(counts).reduce((s, n) => s + (n || 0), 0);
                return sendJson(res, { ok: true, total, counts, source: 'live' });
            }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }


    // ===== ✅ ADDITIVE — ممیزی: ثبت رویدادهای ورودی وب =====
    const AUDIT_FILE = path.join(RUNTIME_ROOT_19E, 'audit.json'); /* SEC-PROTECT-19e */
    function auditLog(req, action, payload) {
        /* SEC-15b: مسیر واحد audit با ip و چرخش ماهانه */
        writeAudit15b({ ts: new Date().toISOString(), user: req.user ? req.user.username : '?', role: req.user ? req.user.role : '?', ip: clientIp15b(req), action: action, payload: payload });
    }
    // ===== ✅ ADDITIVE — W4: ورود داده از وب «کنترل کیفیت» با کنترل نقش =====
    if (req.method === 'POST' && pathname === '/api/entry/quality') {
        if (!auth.requireRole(req, ['quality', 'qc'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: نقش شما اجازهٔ ثبت QC ندارد.' }, 403);
        }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
        req.on('end', () => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;
                const rec = {
                    id: 'web-q-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    heat_number: String(b.heat_number || '').trim(),
                    rebar_size: Number(b.rebar_size) || 0,
                    yield_strength: Number(b.yield_strength) || 0,
                    tensile_strength: Number(b.tensile_strength) || 0,
                    elongation_percent: Number(b.elongation_percent) || 0,
                    /* ===== FEAT-QC-3 (begin): فیلدهای اختیاری دستگاه تست کشش — سازگار با رکوردهای قدیمی ===== */
                    sample_length_mm: Number(b.sample_length_mm) || 0,
                    sample_weight_g: Number(b.sample_weight_g) || 0,
                    nominal_diameter_mm: Number(b.nominal_diameter_mm) || 0,
                    section_area_mm2: Number(b.section_area_mm2) || 0,
                    yield_kgf: Number(b.yield_kgf) || 0,
                    kg_per_m: Number(b.kg_per_m) || 0,
                    rib_diameter_mm: Number(b.rib_diameter_mm) || 0,
                    rib_height_mm: Number(b.rib_height_mm) || 0,
                    nafi_diameter_mm: Number(b.nafi_diameter_mm) || 0, /* ===== FIX-QC-3b: قطر اندازه‌گیری‌شدهٔ نافی — فیلد اختیاری additive ===== */
                    ratio_rm_reh: Number(b.ratio_rm_reh) || 0,
                    /* ===== FEAT-QC-3 (end) ===== */
                    bend_test_passed: Number(b.bend_test_passed) ? 1 : 0,
                    visual_inspection: Number(b.visual_inspection) ? 1 : 0,
                    operator_id: String(b.operator_id || (req.user && req.user.username) || '').trim(),
                    description: String(b.description || '').slice(0, 500),
                    timestamp: new Date().toISOString(),
                };
                if (!rec.heat_number || rec.rebar_size <= 0 || rec.yield_strength <= 0 || rec.tensile_strength <= 0) {
                    return sendJson(res, { error: 'کد هیت، سایز میلگرد، ReH (تنش تسلیم) و Rm (مقاومت کششی) الزامی است.' }, 400);
                }
                const live = readLive();
                live.quality_inspections = Array.isArray(live.quality_inspections) ? live.quality_inspections : [];
                live.quality_inspections.push(rec);
                live.generated_at = new Date().toISOString();
                writeJson(LIVE_FILE, live);
                cache.data = null; cache.at = 0;
                auditLog(req, 'quality.insert', rec);
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'دادهٔ نامعتبر: ' + (e && e.message ? e.message : e) }, 400);
            }
        });
        return;
    }
    // ================================================================
    // ===== FEAT-PLAN-7 (begin): ماژول برنامه‌ریزی تولید + مشاور AI =====
    /* ===== COLDSTART-35 (begin): شروع سرد برنامه‌ریزی — بدون دادهٔ ۹۰ روزه =====
       اصل «دروغ نگفتن»: وقتی دادهٔ واقعی ثبت‌شده کمتر از آستانه است، موتور صریحاً برچسب «پایهٔ مهندسی»
       می‌زند (نرخ اسمی per سایز/خط، ضایعات استاندارد، پذیرش QC هدف) و اطمینان مونت‌کارلو را سقف‌دار
       پایین نشان می‌دهد؛ با رسیدن دادهٔ واقعی به آستانه، خودکار به حالت عادی برمی‌گردد (بدون تنظیم دستی).
       محدودیت شمش در شروع سرد از انبار خوانده نمی‌شود (انبار پنهان/خالی است) — سناریوها کپ نمی‌شوند و
       پرچم کمبود فقط وقتی زده می‌شود که واقعاً دادهٔ انبار موجود و کمتر از نیاز باشد. */
    const COLD_MIN_DAYS_35 = 7; /* آستانهٔ شروع سرد: کمتر از ۷ روز ثبت تولید واقعی */
    const COLD_RATE_TON_35 = { 'RB-8': 45, 'RB-10': 55, 'RB-12': 65, 'RB-14': 75, 'RB-16': 85, 'RB-18': 95, 'RB-20': 105, 'RB-22': 115, 'RB-25': 125, 'RB-28': 135, 'RB-32': 145, '5SP': 110 }; /* نرخ اسمی مهندسی per سایز (تن/روز) — خط نورد تک‌خطی؛ قابل تنظیم توسط فروشنده */
    const COLD_MIX_35 = { 'RB-14': 0.34, 'RB-16': 0.33, 'RB-22': 0.33 }; /* ترکیب مهندسی سه‌سایز متداول میلگرد A3 */
    const COLD_CONF_CAP_35 = 55; /* سقف اطمینان مونت‌کارلو در حالت شروع سرد — صداقت: اطمینان پایین */
    /* ===== COLDSTART-35 (end) ===== */
    // مدل داده: live.production_plans[] + live.power_outages[] (افزاینده، سازگار با live.json قدیمی)
    // ================================================================
    const PLAN_READ_ROLES = ['admin', 'vendor', 'owner', 'planner', 'manager', 'supervisor']; /* SEC-AUDIT-13c: اپراتور حذف شد + VENDOR-37: صاحب سیستم دسترسی کامل */
    const PLAN_WRITE_ROLES = ['admin', 'vendor', 'owner', 'planner']; /* VENDOR-37: صاحب سیستم مثل admin */
    function planAudit(req, action, payload) { try { auditLog(req, 'plan.' + action, payload); } catch (e) { /* بی‌ضرر */ } }

    function planSeenRequest(list, rid) { return rid ? (list || []).find((x) => x.request_id === rid) || null : null; }

    /* تبدیل جلالی→میلادی (الگوریتم فشردهٔ Borkowski/Bradley — برای پنجرهٔ PM و قطعی برق) */
    function planJalaliToTs(dateStr, hour) {
        const s = String(dateStr || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)).trim();
        const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/); if (!m) return null;
        let jy = Number(m[1]), jm = Number(m[2]), jd = Number(m[3]);
        if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
        jy += 1595;
        let days = -355668 + (365 * jy) + ((jy / 33 | 0) * 8) + (((jy % 33) + 3) / 4 | 0) + jd + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30) + 186);
        let gy = 400 * (days / 146097 | 0);
        days %= 146097;
        if (days > 36524) {
            gy += 100 * ((--days) / 36524 | 0);
            days %= 36524;
            if (days >= 365) days++;
        }
        gy += 4 * (days / 1461 | 0);
        days %= 1461;
        if (days > 365) {
            gy += ((days - 1) / 365 | 0);
            days = (days - 1) % 365;
        }
        let gd = days + 1;
        const leap = (gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0);
        const ml = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let gm = 0;
        while (gm < 12 && gd > ml[gm]) { gd -= ml[gm]; gm++; }
        const d = new Date(Date.UTC(gy, gm, gd, Number(hour) || 6, 0, 0));
        return isNaN(d.getTime()) ? null : d.toISOString();
    }

    /* تناژ واقعی هر برنامه از دادهٔ زندهٔ تولید (production_logs + بندیل‌ها) */
    function planActualTonnage(live, plan) {
        if (!plan || !plan.start_ts) return null;
        const fromMs = Date.parse(plan.start_ts); if (isNaN(fromMs)) return null;
        const days = plan.period === 'week' ? 7 : (plan.period === 'shift' ? 0.5 : 1);
        const toMs = fromMs + days * 86400000;
        const target = String(plan.product_size || '');
        const sizeNum = Number((target.match(/(\d+)/) || [])[1] || NaN);
        let kg = 0;
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((b) => {
            const t = Date.parse(b.produced_at || ''); if (isNaN(t) || t < fromMs || t >= toMs) return;
            if (Number.isFinite(sizeNum) && Number(b.rebar_size) !== sizeNum) return;
            kg += Number(b.net_weight_kg) || 0;
        });
        (Array.isArray(live.production_logs) ? live.production_logs : []).forEach((p) => {
            const t = Date.parse(p.timestamp || ''); if (isNaN(t) || t < fromMs || t >= toMs) return;
            const pid = String(p.product_id || '');
            const pidSize = Number((pid.match(/^RB-(\d+)$/) || [])[1] || NaN);
            if (Number.isFinite(pidSize)) { if (Number.isFinite(sizeNum) && pidSize !== sizeNum) return; kg += (Number(p.good_quantity) || 0) * 0.0061654 * pidSize * pidSize * 12; }
            else if (pid === target) { const s = Number((target.match(/(\d+)/) || [])[1] || 0); kg += (Number(p.good_quantity) || 0) * 0.0061654 * s * s * 12; }
        });
        return Math.round(kg / 10) / 100;
    }

    /* موتور داخلی: هیوریستیک آماری روی دادهٔ زنده — همیشه فعال (فقط سایزهای میلگرد معتبر ۶..۵۰) */
    function planningEngineInternal(live) {
        const now = Date.now();
        const dAgo = (n) => new Date(now - n * 86400000).toISOString();
        const d90 = dAgo(90), d30 = dAgo(30);
        const rounds = (x) => Math.round((Number(x) || 0) * 100) / 100;
        const REBAR_MIN = 6, REBAR_MAX = 50;

        /* ۱) نرخ تولید واقعی per سایز (kg/day فعال) — بندیل‌ها + لاگ تولید (فرمول جرم فقط برای سایز معتبر) */
        const sizes = {};
        const bump = (k) => (sizes[k] = sizes[k] || { kg: 0, bars: 0, daysMap: {} });
        const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((b) => {
            const t = Date.parse(b.produced_at || ''); if (isNaN(t) || t < d90) return;
            const n = Number(b.rebar_size); const g = String(b.rebar_grade || '');
            let k = null;
            if (n >= REBAR_MIN && n <= REBAR_MAX) k = 'RB-' + n;
            else if (g === '5SP') k = '5SP';
            if (!k) return;
            const s = bump(k); s.kg += Number(b.net_weight_kg) || 0; s.daysMap[dayOf(t)] = 1;
        });
        (Array.isArray(live.production_logs) ? live.production_logs : []).forEach((p) => {
            const t = Date.parse(p.timestamp || ''); if (isNaN(t) || t < d90) return;
            const pid = String(p.product_id || ''); if (!pid) return;
            const m = /^RB-(\d+)$/.exec(pid); const n = m ? Number(m[1]) : NaN;
            if (Number.isFinite(n) && n >= REBAR_MIN && n <= REBAR_MAX) {
                const s = bump('RB-' + n); const q = Number(p.good_quantity) || 0;
                s.bars += q; s.kg += q * 0.0061654 * n * n * 12; s.daysMap[dayOf(t)] = 1;
            } else if (pid === '5SP') {
                const s = bump('5SP'); s.bars += Number(p.good_quantity) || 0; s.daysMap[dayOf(t)] = 1;
            }
        });
        /* COLDSTART-35: روزهای واقعی ثبت تولید (اتحاد روزهای همهٔ سایزها) */
        const prodDaysSet35i = {};
        Object.keys(sizes).forEach((k) => { Object.keys(sizes[k].daysMap).forEach((d) => { prodDaysSet35i[d] = 1; }); });
        const prodDays35i = Object.keys(prodDaysSet35i).length;
        Object.keys(sizes).forEach((k) => { const s = sizes[k]; s.days = Math.max(1, Object.keys(s.daysMap).length); s.kgPerDay = s.kg / s.days; delete s.daysMap; });

        /* ۲) ضایعات وزنی ۳۰ روز */
        let wasteKg = 0;
        (Array.isArray(live.waste_logs) ? live.waste_logs : []).forEach((w) => {
            const t = Date.parse(w.timestamp || ''); if (isNaN(t) || t < d30) return;
            wasteKg += wasteKgOf26a(w); /* FIX-WASTE-26a: بر پایهٔ تناژ — رکوردهای legacy (تعداد) حذف از جمع وزنی */
        });
        let prodKg30 = 0;
        Object.keys(sizes).forEach((k) => { prodKg30 += sizes[k].kg; });
        const wastePct = (prodKg30 + wasteKg) > 0 ? wasteKg / (prodKg30 + wasteKg) * 100 : 0;

        /* ۳) الگوی توقفات — سهم برق/برقی */
        let elecMin = 0, allDays = {};
        (Array.isArray(live.downtime_logs) ? live.downtime_logs : []).forEach((r) => {
            const t = Date.parse(r.start_time || ''); if (isNaN(t) || t < d90) return;
            allDays[dayOf(t)] = 1;
            const rid = String(r.reason_id || '').toLowerCase();
            if (rid.indexOf('electr') !== -1 || rid.indexOf('power') !== -1) elecMin += Number(r.duration_minutes) || 0;
        });
        const obsDays = Math.max(1, Object.keys(allDays).length);
        const elecPctDay = Math.min(25, (elecMin / obsDays) / 720 * 100);

        /* ۴) قطعی برق ثبت‌شدهٔ آینده */
        const outages = (Array.isArray(live.power_outages) ? live.power_outages : []).filter((o) => { const t = Date.parse(o.start_ts || ''); return !isNaN(t) && t >= now && t <= now + 7 * 86400000; });
        let outageCut = 0; const outageReasons = [];
        outages.forEach((o) => {
            const h = Number(o.duration_hours) || 0;
            outageCut = Math.max(outageCut, Math.min(50, h / 12 * 100));
            outageReasons.push('قطعی برنامه‌ریزی‌شدهٔ برق (' + toFa(String(o.note || (o.shift_id === 'shift-night-302' ? 'شیفت شب' : 'شیفت صبح')) ) + ' — ' + fa(h) + ' ساعت)');
        });

        /* ۵) PM نزدیک (۷ روز آینده) — بدون تکرار */
        let pmCut = 0; const pmSeen = {}; const pmReasons = [];
        (Array.isArray(live.pm_plans) ? live.pm_plans : []).forEach((p) => {
            const last = p.last_done ? planJalaliToTs(p.last_done, 6) : null; if (!last) return;
            const due = Date.parse(last) + (Number(p.interval_days) || 30) * 86400000;
            const key = String(p.title || p.machine_id || '');
            if (due >= now && due <= now + 7 * 86400000 && !pmSeen[key]) {
                pmSeen[key] = 1;
                pmCut = Math.min(15, pmCut + 5);
                pmReasons.push('PM «' + key + '» در هفتهٔ پیش‌رو سررسید می‌شود');
            }
        });

        /* ۶) موجودی مواد اولیه از انبار (شمش/بیلت) */
        let rawAvail = 0;
        const items = Array.isArray(live.inventory_items) ? live.inventory_items : [];
        const rawIds = {};
        items.forEach((it) => {
            const hay = String((it.name || '') + ' ' + (it.code || '') + ' ' + (it.category || '')).toLowerCase();
            if (hay.indexOf('شمش') !== -1 || hay.indexOf('بیلت') !== -1 || hay.indexOf('billet') !== -1) rawIds[it.id] = 1;
        });
        if (Object.keys(rawIds).length) {
            const sum = (arr, f) => (Array.isArray(arr) ? arr : []).reduce((s, r) => s + (rawIds[r.item_id] ? (Number(f(r)) || 0) : 0), 0);
            rawAvail = Math.max(0, sum(live.inventory_receipts, (r) => r.quantity) - sum(live.inventory_issues, (r) => r.quantity) + sum(live.inventory_adjustments, (r) => r.delta_quantity));
        }
        let billetAvgKg = 0, billetCount = 0;
        (Array.isArray(live.billets) ? live.billets : []).forEach((b) => { const w = Number(b.initial_weight_kg) || 0; if (w > 0) { billetAvgKg += w; billetCount++; } });
        billetAvgKg = billetCount ? Math.round(billetAvgKg / billetCount) : 0;

        const capFactor = Math.max(0.35, 1 - elecPctDay / 100 - outageCut / 100 - pmCut / 100);
        const keyFa = (k) => (k.indexOf('RB-') === 0 ? 'میلگرد سایز ' + k.slice(3) : (k === '5SP' ? 'میلگرد گرید 5SP' : k));

        const ranked = Object.keys(sizes).filter((k) => sizes[k].kg > 0).sort((a, b) => sizes[b].kg - sizes[a].kg).slice(0, 3);
        let suggestions = [];
        ranked.forEach((k, i) => {
            const s = sizes[k];
            let target = (s.kgPerDay / 1000) * capFactor * 0.9; /* تن */
            let capped = null;
            if (rawAvail > 0) { const cap = (rawAvail * 0.8) / 1000; if (target > cap) { capped = cap; target = cap; } }
            target = Math.min(2000, Math.max(0.1, rounds(target)));
            const conf = Math.min(92, Math.max(45, Math.round(40 + s.days * 1.8 - wastePct / 2 + (rawAvail > 0 ? 4 : 0))));
            const reasons = [];
            reasons.push('میانگین تولید واقعی ' + keyFa(k) + ' در ۹۰ روز اخیر: ' + fa(rounds(s.kgPerDay / 1000)) + ' تن در روز');
            if (elecPctDay > 1) reasons.push('کاهش ' + fa(Math.round(elecPctDay)) + '٪ ظرفیت به‌دلیل الگوی قطعی/اختلال برق');
            outageReasons.slice(0, 2).forEach((r) => reasons.push(r));
            pmReasons.slice(0, 2).forEach((r) => reasons.push(r));
            if (wastePct > 0.5) reasons.push('نرخ ضایعات ۳۰ روز اخیر: ' + fa(Math.round(wastePct * 10) / 10) + '٪ لحاظ شد');
            if (capped !== null) reasons.push('سقف موجودی قابل‌مصرف مواد اولیه انبار: ' + fa(rounds(rawAvail / 1000)) + ' تن');
            else if (rawAvail > 0) reasons.push('موجودی قابل‌مصرف مواد اولیه: ' + fa(rounds(rawAvail / 1000)) + ' تن — محدودیتی نیست');
            else reasons.push('موجودی شمش در انبار ثبت نشده؛ بر پایهٔ ورودی اخیر شمش تخمین زده شد');
            reasons.push('ضریب اطمینان بر پایهٔ ' + fa(s.days) + ' روز دادهٔ واقعی');
            suggestions.push({
                title: 'پیشنهاد ' + fa(i + 1) + ' — ' + keyFa(k),
                period: 'day', product_size: k, target_tonnage: target,
                required_billets: billetAvgKg > 200 ? Math.ceil(target * 1000 / billetAvgKg) : null,
                machine: 'st-form', shift_id: i === 1 ? 'shift-night-302' : 'shift-morning-301',
                priority: i === 0 ? 'high' : 'medium', confidence: conf,
                reasons: Array.from(new Set(reasons)).slice(0, 6),
                engine: 'internal', based_on: 'نرخ ۹۰ روزه + ضایعات ۳۰ روزه + توقفات + PM + انبار + قطعی برق'
            });
        });
        if (ranked.length) {
            const best = suggestions[0];
            suggestions.push({
                title: 'گزینهٔ شیفت شب — ' + best.title.replace(/^پیشنهاد \d+ — /, ''),
                period: 'shift', product_size: best.product_size,
                target_tonnage: Math.max(0.1, rounds(best.target_tonnage * 0.45)),
                required_billets: best.required_billets ? Math.max(1, Math.ceil(best.required_billets * 0.45)) : null,
                machine: best.machine, shift_id: 'shift-night-302', priority: 'low',
                confidence: Math.max(40, best.confidence - 12),
                reasons: Array.from(new Set(['نصف ظرفیت روزانه برای شیفت شب (الگوی دو شیفت ۱۲ساعته)'].concat(best.reasons.slice(1, 3)))),
                engine: 'internal', based_on: best.based_on
            });
        }
        /* COLDSTART-35 (begin): در شروع سرد پیشنهاد از پارامتر مهندسی با تناژ منطقی تولید می‌شود (نه ۰٫۱ تن)؛
           با دادهٔ ناقص (۱ تا ۶ روز) پیشنهادهای واقعی نگه داشته می‌شوند ولی اطمینان سقف‌دار و برچسب شروع سرد صادق است */
        const cold35i = prodDays35i < COLD_MIN_DAYS_35;
        if (cold35i && suggestions.length) {
            suggestions.forEach((sg) => {
                sg.confidence = Math.min(Number(sg.confidence) || 0, COLD_CONF_CAP_35);
                sg.reasons = ['🧊 شروع سرد — دادهٔ واقعی ' + fa(prodDays35i) + ' روز است (آستانهٔ ' + fa(COLD_MIN_DAYS_35) + ' روز)؛ بخش مهندسی: نرخ اسمی/ضایعات استاندارد — با ثبت واقعی خودکالیبره می‌شود'].concat(sg.reasons).slice(0, 6);
                sg.based_on = String(sg.based_on || '') + ' — پایهٔ مهندسی (شروع سرد)';
            });
        }
        if (!suggestions.length) {
            if (cold35i) {
                Object.keys(COLD_MIX_35).forEach((k35, i35) => {
                    const target35 = Math.min(2000, Math.max(1, rounds(COLD_RATE_TON_35[k35] * capFactor * 0.9)));
                    suggestions.push({
                        title: 'پیشنهاد ' + fa(i35 + 1) + ' — ' + keyFa(k35),
                        period: 'day', product_size: k35, target_tonnage: target35, required_billets: null,
                        machine: 'st-form', shift_id: i35 === 1 ? 'shift-night-302' : 'shift-morning-301',
                        priority: i35 === 0 ? 'high' : 'medium', confidence: Math.min(45, COLD_CONF_CAP_35 - 10),
                        reasons: ['🧊 شروع سرد — پایهٔ مهندسی: نرخ اسمی ' + keyFa(k35) + ' حدود ' + fa(COLD_RATE_TON_35[k35]) + ' تن در روز', 'با ثبت واقعی تولید، خودکالیبره می‌شود (آستانه: ' + fa(COLD_MIN_DAYS_35) + ' روز)'],
                        engine: 'internal', based_on: 'پایهٔ مهندسی (شروع سرد COLDSTART-35)'
                    });
                });
            } else {
            suggestions.push({
                title: 'دادهٔ کافی برای پیشنهاد تناژ موجود نیست',
                period: 'day', product_size: '', target_tonnage: 1, required_billets: null,
                machine: 'st-form', shift_id: 'shift-morning-301', priority: 'low', confidence: 15,
                reasons: ['تا امروز تولیدی با سایز استاندارد میلگرد (۶ تا ۵۰) یا گرید 5SP ثبت نشده است.', 'می‌توانید برنامه را دستی ثبت کنید؛ با ثبت دادهٔ تولید، موتور پیشنهاد دقیق‌تر می‌شود.'],
                engine: 'internal', based_on: 'بدون دادهٔ کافی'
            });
            }
        }
        /* COLDSTART-35 (end) */
        return { engine: 'internal', ai_configured: !!(process.env.AI_PLANNING_URL && typeof fetch === 'function'), suggestions: suggestions.slice(0, 5), meta: { wastePct: rounds(wastePct), elecPctDay: rounds(elecPctDay), pmCut, outageCut, rawAvailKg: rounds(rawAvail), obsDays, prodDays: prodDays35i, mode: cold35i ? 'cold-start' : 'normal' } }; /* COLDSTART-35: +prodDays/mode */
    }
    function toFa(s) { return String(s == null ? '' : s).replace(/[0-9]/g, (d) => String.fromCharCode(1776 + Number(d))); }
    function fa(x) { return toFa(String(x)); }

    /* لایهٔ AI خارجی (سازگار OpenAI) — اختیاری؛ در هر خطا fallback به داخلی */
    async function planningEngineExternal(live, internal) {
        const url = process.env.AI_PLANNING_URL;
        const key = process.env.AI_PLANNING_KEY || '';
        if (!url || typeof fetch !== 'function') return null;
        const ctrl = new AbortController();
        const timer = setTimeout(() => { try { ctrl.abort(); } catch (e) { } }, 12000);
        try {
            const stats = {
                generated_at: new Date().toISOString(),
                sizes_90d: Object.keys(internal.meta || {}).length ? undefined : undefined,
                internal_suggestions: internal.suggestions,
                meta: internal.meta
            };
            const r = await fetch(url, {
                method: 'POST', signal: ctrl.signal,
                headers: Object.assign({ 'Content-Type': 'application/json' }, key ? { 'Authorization': 'Bearer ' + key } : {}),
                body: JSON.stringify({
                    model: process.env.AI_PLANNING_MODEL || 'gpt-4o-mini',
                    temperature: 0.2,
                    messages: [
                        { role: 'system', content: 'تو مشاور برنامه‌ریزی تولید یک کارخانه نورد میلگرد فولاد ایران هستی. فقط و فقط یک آرایه JSON معتبر برگردان (بدون متن اضافه) با ۳ تا ۵ پیشنهاد. هر آیتم: {"title":"فارسی","period":"day|shift|week","product_size":"RB-8..32 یا 5SP","target_tonnage":عدد تن,"required_billets":عدد یا null,"machine":"st-form","shift_id":"shift-morning-301|shift-night-302","priority":"low|medium|high","confidence":عدد 0..100,"reasons":["دلایل فارسی انسانی‌خوان"]}. بر پایهٔ دادهٔ آماری کارخانه که برایت می‌فرستم.' },
                        { role: 'user', content: JSON.stringify(stats) }
                    ]
                })
            });
            if (!r.ok) return null;
            const j = await r.json();
            const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || '') : '';
            const m = txt.match(/\[[\s\S]*\]/); if (!m) return null;
            let arr; try { arr = JSON.parse(m[0]); } catch (e) { return null; }
            if (!Array.isArray(arr)) return null;
            const out = arr.filter((x) => x && x.product_size && Number(x.target_tonnage) > 0).slice(0, 5).map((x) => ({
                title: String(x.title || 'پیشنهاد هوش مصنوعی').slice(0, 120),
                period: ['day', 'shift', 'week'].indexOf(x.period) !== -1 ? x.period : 'day',
                product_size: String(x.product_size).slice(0, 24),
                target_tonnage: Math.round(Number(x.target_tonnage) * 100) / 100,
                required_billets: Number(x.required_billets) > 0 ? Math.round(Number(x.required_billets)) : null,
                machine: String(x.machine || 'st-form').slice(0, 40),
                shift_id: ['shift-morning-301', 'shift-night-302'].indexOf(x.shift_id) !== -1 ? x.shift_id : 'shift-morning-301',
                priority: ['low', 'medium', 'high'].indexOf(x.priority) !== -1 ? x.priority : 'medium',
                confidence: Math.min(99, Math.max(5, Math.round(Number(x.confidence) || 60))),
                reasons: (Array.isArray(x.reasons) ? x.reasons : []).slice(0, 6).map((s) => String(s).slice(0, 200)),
                engine: 'ai', based_on: 'AI_PLANNING_URL'
            }));
            return out.length ? out : null;
        } catch (e) { return null; } finally { clearTimeout(timer); }
    }

    // ===== FEAT-EM-12b (begin): مدیریت انرژی — energy_logs در live.json + endpoint ثبت/فهرست/آمار با نقش و ممیزی =====
    const EM_READ_ROLES = ['admin', 'engineering', 'planner', 'manager', 'supervisor', 'operator', 'warehouse', 'viewer', 'quality', 'qc'];
    const EM_WRITE_ROLES = ['admin', 'engineering'];
    const EM_LINES = { mill: 'خط نورد گرم', furnace: 'کوره/ذوب', pack: 'بسته‌بندی بندیل', aux: 'تاسیسات و کمپرسور', plant: 'سراسر کارخانه' };
    function emFaToEn(s) { return String(s || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)); }
    function emDayKey(iso) { const t = Date.parse(iso); return isNaN(t) ? '' : new Date(t).toISOString().slice(0, 10); }
    if (req.method === 'GET' && pathname === '/api/energy/logs') {
        if (!auth.requireRole(req, EM_READ_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز: مشاهدهٔ انرژی برای نقش شما مجاز نیست.' }, 403);
        const live = readLive();
        const logs = (Array.isArray(live.energy_logs) ? live.energy_logs : []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        return sendJson(res, { ok: true, logs: logs });
    }
    if (req.method === 'POST' && pathname === '/api/energy/logs') {
        if (!auth.requireRole(req, EM_WRITE_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت انرژی فقط برای نقش مهندسی/مدیر مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر: JSON نادرست است.' }, 400); }
            const dateJ = emFaToEn(String(b.date_jalali || '')).trim();
            if (!/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.test(dateJ)) return sendJson(res, { error: 'تاریخ شمسی نامعتبر است (نمونه: ۱۴۰۵/۰۶/۱۲).' }, 400);
            const tsIso = planJalaliToTs(dateJ, 12);
            if (!tsIso) return sendJson(res, { error: 'تاریخ شمسی نامعتبر است.' }, 400);
            const shiftId = ['shift-morning-301', 'shift-night-302'].indexOf(b.shift_id) !== -1 ? b.shift_id : null;
            if (!shiftId) return sendJson(res, { error: 'شیفت را انتخاب کنید.' }, 400);
            const lineKey = EM_LINES[b.line] ? b.line : null;
            if (!lineKey) return sendJson(res, { error: 'خط را انتخاب کنید.' }, 400);
            const kwh = Math.round((Number(emFaToEn(b.kwh)) || 0) * 10) / 10;
            if (!(kwh > 0) || kwh > 100000000) return sendJson(res, { error: 'مقدار kWh باید عددی بزرگ‌تر از صفر باشد.' }, 400);
            const live = readLive();
            if (!Array.isArray(live.energy_logs)) live.energy_logs = [];
            const rid = String(b.request_id || '').slice(0, 64);
            const dup = rid ? live.energy_logs.find((x) => x && x.request_id === rid) : null;
            if (dup) { auditLog(req, 'energy.duplicate', { id: dup.id }); return sendJson(res, { ok: true, duplicate: true, log: dup }); }
            const rec = {
                id: 'em-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                request_id: rid || null,
                date_jalali: dateJ,
                iso_date: String(tsIso).slice(0, 10),
                shift_id: shiftId,
                line: lineKey,
                line_fa: EM_LINES[lineKey],
                kwh: kwh,
                note: String(b.note || '').trim().slice(0, 200),
                created_by: (req.user && (req.user.name || req.user.username)) || '?',
                created_at: new Date().toISOString(),
            };
            live.energy_logs.push(rec);
            if (writeJson(LIVE_FILE, live)) {
                auditLog(req, 'energy.insert', { id: rec.id, kwh: kwh, date: dateJ, shift: shiftId, line: lineKey });
                return sendJson(res, { ok: true, log: rec });
            }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'GET' && pathname === '/api/energy/stats') {
        if (!auth.requireRole(req, EM_READ_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive();
        const logs = Array.isArray(live.energy_logs) ? live.energy_logs : [];
        const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
        const byDay = {};
        logs.forEach((l) => { if (!l || !l.iso_date || String(l.iso_date) < sinceIso) return; byDay[l.iso_date] = (byDay[l.iso_date] || 0) + (Number(l.kwh) || 0); });
        /* تناژ واقعی روزانه از بندیل‌های تولیدشده */
        const tonByDay = {};
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((r) => {
            const k = r ? emDayKey(r.produced_at) : ''; if (!k || k < sinceIso) return;
            tonByDay[k] = (tonByDay[k] || 0) + (Number(r.net_weight_kg) || 0) / 1000;
        });
        const days = Object.keys(byDay).sort().map((k) => {
            const ton = Math.round((tonByDay[k] || 0) * 100) / 100;
            return { date: k, kwh: Math.round(byDay[k] * 10) / 10, tonnage: ton, kwh_per_ton: ton > 0 ? Math.round(byDay[k] / ton * 100) / 100 : null };
        });
        const vals = days.map((d) => d.kwh_per_ton).filter((v) => v != null && v > 0);
        const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length * 100) / 100 : null;
        const anomalies = [];
        if (avg != null) {
            days.forEach((d) => {
                if (d.kwh_per_ton == null) return;
                const dev = Math.round((d.kwh_per_ton - avg) / avg * 1000) / 10;
                d.deviation_pct = dev;
                if (Math.abs(dev) > 15) {
                    d.anomalous = true;
                    d.dir = dev > 0 ? 'up' : 'down';
                    anomalies.push({ date: d.date, dir: d.dir, dev: dev, reason: 'انرژی/تن روز ' + d.date + ' حدود ' + Math.abs(dev) + '٪ ' + (dev > 0 ? 'بالاتر' : 'پایین‌تر') + ' از میانگین ۳۰روزه (' + d.kwh_per_ton + ' در برابر ' + avg + ' kWh/تن)' + (dev > 0 ? ' — بررسی توقفات/کاهش تولید یا نشتی مصرف' : ' — احتمالاً تولید بالا/رکورد مصرف ناقص') });
                } else { d.anomalous = false; }
            });
        }
        /* پیوند زمینه‌ای: توقفات برقی ۷روز اخیر */
        const elecCut = new Date(Date.now() - 7 * 86400000).toISOString();
        const electrical = (Array.isArray(live.downtime_logs) ? live.downtime_logs : []).filter((r) => {
            if (!r || !r.start_time || String(r.start_time) < elecCut) return false;
            const rid = String(r.reason_id || '').toLowerCase();
            return rid.indexOf('electr') !== -1 || rid.indexOf('power') !== -1;
        }).slice(-10).map((r) => ({ start_time: r.start_time, duration_minutes: Number(r.duration_minutes) || 0, station_id: r.station_id || null }));
        return sendJson(res, {
            ok: true,
            total_kwh_30d: Math.round(days.reduce((s, d) => s + d.kwh, 0) * 10) / 10,
            avg_kwh_per_ton: avg,
            window_days: 30,
            days: days,
            anomalies: anomalies,
            electrical_downtimes: electrical,
            generated_at: new Date().toISOString(),
        });
    }
    // ===== FEAT-EM-12b (end) =====
    // ===== FEAT-FIN-13b (begin): ماژول مالی/حسابداری/بهای تمام‌شده — دفتر کل دوطرفهٔ واقعی (accounts/doc-lines/cost-centers/periods) + موتور سند واحد با متادیتای منبع =====
    const FIN_W = ['finance']; /* ثبت: فقط حسابدار/مدیرمالی — admin همیشه مجاز */
    const FIN_R = ['finance', 'manager']; /* مشاهده: مالی + مدیریت (مدیریت فقط‌خواندن) */
    const FIN_LEVEL_FA = { 1: 'گروه', 2: 'کل', 3: 'معین', 4: 'تفضیلی' };
    const FIN_TYPE_FA = { asset: 'دارایی', liability: 'بدهی', equity: 'سرمایه', income: 'درآمد', expense: 'هزینه' };
    const FIN_MONTH_FA = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
    const finR2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
    const finDigitsEn = (s) => String(s || '').replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776)).trim();

    /* میلادی→جلالی (معکوس planJalaliToTs — برای تاریخ اسناد خودکار از ISO) */
    function finG2J(gy, gm, gd) {
        const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        let gy2 = (gm > 2) ? (gy + 1) : gy;
        let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
        let jy = -1595 + (33 * Math.floor(days / 12053)); days %= 12053;
        jy += 4 * Math.floor(days / 1461); days %= 1461;
        if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
        let jm, jd;
        if (days < 186) { jm = 1 + Math.floor(days / 31); jd = 1 + (days % 31); }
        else { jm = 7 + Math.floor((days - 186) / 30); jd = 1 + ((days - 186) % 30); }
        return { jy: jy, jm: jm, jd: jd };
    }
    function finIsoToJalali(iso) {
        const t = Date.parse(iso || ''); if (isNaN(t)) return null;
        const d = new Date(t + 4.5 * 3600000); /* +03:30 تهران — تاریخ تقویمی تهران از UTC */
        const j = finG2J(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
        return j.jy + '/' + String(j.jm).padStart(2, '0') + '/' + String(j.jd).padStart(2, '0');
    }
    function finPeriodIdOfJalali(jDate) {
        const m = /^(\d{4})\/(\d{1,2})\//.exec(String(jDate || '')); if (!m) return null;
        return m[1] + '-' + String(Number(m[2])).padStart(2, '0');
    }

    /* دادهٔ اولیهٔ ماژول مالی — کدینگ ۴سطحی گروه/کل/معین/تفضیلی با کدینگ پیش‌فرض صنعت فولاد (الگوی ERPهای ایرانی) */
    function finSeed(live) {
        if (live._fin_v1) return false;
        const A = [];
        const acc = (code, title, type, level) => A.push({ id: 'facc-' + code, code: code, title: title, type: type, level: level, parent_id: 'facc-' + (level === 1 ? '' : (level === 2 ? code[0] : code.slice(0, level === 3 ? 3 : 6))), active: true });
        acc('1', 'دارایی‌ها', 'asset', 1); acc('2', 'بدهی‌ها', 'liability', 1); acc('3', 'سرمایه', 'equity', 1); acc('4', 'درآمدها', 'income', 1); acc('5', 'هزینه‌ها', 'expense', 1);
        acc('110', 'موجودی مواد و کالا', 'asset', 2); acc('120', 'دارایی‌های ثابت', 'asset', 2);
        acc('110001', 'موجودی شمش', 'asset', 3); acc('110002', 'کالای در جریان ساخت', 'asset', 3); acc('110003', 'موجودی میلگرد ساخته‌شده', 'asset', 3); acc('110004', 'موجودی ضایعات', 'asset', 3); acc('120001', 'ماشین‌آلات و تجهیزات نورد', 'asset', 3);
        acc('210', 'مالیات و عوارض پرداختنی', 'liability', 2); acc('220', 'حق بیمه پرداختنی', 'liability', 2); acc('230', 'سایر پرداختنی‌ها', 'liability', 2);
        acc('210001', 'مالیات ارزش افزوده خرید', 'liability', 3); acc('210002', 'مالیات ارزش افزوده فروش', 'liability', 3); acc('220001', 'حق بیمه سهم کارفرما ۲۳٪', 'liability', 3); acc('230001', 'پرداختنی انرژی (برق)', 'liability', 3);
        acc('310', 'سرمایه', 'equity', 2); acc('310001', 'سرمایه اولیه', 'equity', 3);
        acc('410', 'فروش', 'income', 2); acc('410001', 'فروش میلگرد', 'income', 3); acc('410002', 'فروش ضایعات', 'income', 3);
        acc('510', 'بهای تمام‌شده تولید', 'expense', 2); acc('520', 'سایر هزینه‌ها', 'expense', 2);
        acc('510001', 'مصرف شمش', 'expense', 3); acc('510002', 'انرژی برق تولید', 'expense', 3); acc('510003', 'دستمزد مستقیم', 'expense', 3); acc('510004', 'سربار تولید', 'expense', 3); acc('510005', 'ریفرکتوری و غلظک', 'expense', 3); acc('520001', 'ضایعات غیرعادی و اسقاط', 'expense', 3);
        live.fin_accounts = A;
        live.fin_cost_centers = [
            { id: 'cc-mill', code: 'CC-01', title: 'خط نورد گرم', kind: 'mill_line', active: true },
            { id: 'cc-furnace', code: 'CC-02', title: 'کوره / ذوب', kind: 'furnace', active: true },
            { id: 'cc-pm', code: 'CC-03', title: 'تعمیرات و نگهداری (PM)', kind: 'pm', active: true },
            { id: 'cc-energy', code: 'CC-04', title: 'انرژی و تاسیسات', kind: 'energy', active: true },
            { id: 'cc-pack', code: 'CC-05', title: 'بسته‌بندی و بارگیری', kind: 'pack', active: true },
            { id: 'cc-admin', code: 'CC-06', title: 'اداری و ستاد', kind: 'admin', active: true }
        ];
        const jNow = finIsoToJalali(new Date().toISOString()) || '1405/01/01';
        const yNow = Number(jNow.slice(0, 4));
        live.fin_periods = [];
        for (let m = 1; m <= 12; m++) {
            const pid = yNow + '-' + String(m).padStart(2, '0');
            live.fin_periods.push({ id: pid, year: yNow, month: m, label: FIN_MONTH_FA[m - 1] + ' ' + yNow, closed: false, closed_at: null, closed_by: null });
        }
        live.fin_config = {
            vat_rate: 10, /* نرخ عمومی ۱۴۰۴/۱۴۰۵ — قابل‌ویرایش (تلفیق ۱۴۰۵: همان ۱۰٪ ماند) */
            corporate_tax_rate: 25, /* ماده ۱۰۵ */
            employer_insurance_rate: 23, /* ماده ۲۸ تأمین اجتماعی: ۲۰٪ کارفرما + ۳٪ بیمه بیکاری */
            quarterly_report_deadline_days: 45, /* ماده ۱۶۹ */
            billet_rial_per_kg: 250000, energy_tariff_rial_per_kwh: 4000, scrap_rial_per_kg: 180000,
            currency: 'ریال', updated_at: null, updated_by: null
        };
        const sizes = [8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32];
        live.fin_bom = sizes.map((s) => ({ id: 'fbom-' + s, size: String(s), billet_t_per_t: 1.035, kwh_per_t: 110, labor_rial_per_t: 2500000, overhead_rial_per_t: 4000000, other_rial_per_t: 350000, sale_price_rial_per_t: 315000000, updated_at: null, updated_by: null }));
        live.fin_docs = []; live.fin_seq = { doc: 0 };
        live._fin_v1 = { at: new Date().toISOString(), note: 'بذر اولیهٔ ماژول مالی — حساب‌ها/مراکز هزینه/دوره‌ها/BOM پیش‌فرض؛ قابل ویرایش از تب مالی' };
        return true;
    }

    /* بهای استاندارد هر تن از BOM مالی (ریال/تن) */
    function finStdCostPerTon(bom, cfg) {
        return Math.round((Number(bom.billet_t_per_t) || 0) * (Number(cfg.billet_rial_per_kg) || 0) * 1000
            + (Number(bom.kwh_per_t) || 0) * (Number(cfg.energy_tariff_rial_per_kwh) || 0)
            + (Number(bom.labor_rial_per_t) || 0) + (Number(bom.overhead_rial_per_t) || 0) + (Number(bom.other_rial_per_t) || 0));
    }

    /* ---- موتور سند واحد: همهٔ ثبت‌ها (خودکار/دستی) فقط از این مسیر عبور می‌کنند ---- */
    function finPostDoc(live, spec) {
        const dJ = finDigitsEn(String(spec.date_jalali || '')).trim();
        if (!/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.test(dJ)) throw new Error('تاریخ شمسی سند نامعتبر است (نمونه: ۱۴۰۵/۰۶/۱۲).');
        const tsIso = planJalaliToTs(dJ, 12); if (!tsIso) throw new Error('تاریخ شمسی سند نامعتبر است.');
        const periodId = finPeriodIdOfJalali(dJ);
        const period = (live.fin_periods || []).find((p) => p.id === periodId);
        if (period && period.closed) throw new Error('دورهٔ «' + period.label + '» بسته شده است؛ ثبت سند در آن مجاز نیست.');
        const linesIn = Array.isArray(spec.lines) ? spec.lines : [];
        if (linesIn.length < 2) throw new Error('سند باید حداقل دو ردیف بدهکار/بستانکار داشته باشد.');
        const accById = {};
        (live.fin_accounts || []).forEach((a) => { accById[a.id] = a; });
        let dSum = 0, cSum = 0;
        const lines = linesIn.map((ln, i) => {
            const a = accById[ln.account_id];
            if (!a) throw new Error('ردیف ' + (i + 1) + ': حساب انتخابی یافت نشد.');
            if (a.active === false) throw new Error('ردیف ' + (i + 1) + ': حساب «' + a.title + '» غیرفعال است.');
            if (Number(a.level) < 3) throw new Error('ردیف ' + (i + 1) + ': ثبت فقط در سطح معین/تفضیلی مجاز است؛ «' + a.title + '» سطح ' + (FIN_LEVEL_FA[a.level] || a.level) + ' است.');
            const d = Math.round(Number(finDigitsEn(ln.debit)) || 0), c = Math.round(Number(finDigitsEn(ln.credit)) || 0);
            if (d < 0 || c < 0 || (d > 0 && c > 0) || (d === 0 && c === 0)) throw new Error('ردیف ' + (i + 1) + ' (' + a.title + '): دقیقاً یکی از بدهکار/بستانکار باید بزرگ‌تر از صفر باشد.');
            dSum += d; cSum += c;
            return { account_id: a.id, account_code: a.code, account_title: a.title, debit: d, credit: c, cost_center_id: ln.cost_center_id || null, ref_module: ln.ref_module || spec.ref_module || null, ref_id: ln.ref_id || spec.ref_id || null, note: String(ln.note || '').slice(0, 140) };
        });
        dSum = Math.round(dSum); cSum = Math.round(cSum);
        if (dSum <= 0 || dSum !== cSum) throw new Error('سند تراز نیست: جمع بدهکار ' + dSum.toLocaleString('fa-IR') + ' و جمع بستانکار ' + cSum.toLocaleString('fa-IR') + ' ریال باید برابر و بزرگ‌تر از صفر باشند.');
        if (spec.ref_id != null) {
            const dup = (live.fin_docs || []).find((x) => x.source === spec.source && String(x.ref_id) === String(spec.ref_id));
            if (dup) return { dup: true, doc: dup };
        }
        live.fin_docs = Array.isArray(live.fin_docs) ? live.fin_docs : [];
        live.fin_seq = live.fin_seq || { doc: 0 };
        live.fin_seq.doc = (Number(live.fin_seq.doc) || 0) + 1;
        const doc = {
            id: 'findoc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            doc_no: live.fin_seq.doc, doc_no_fa: 'F-' + String(live.fin_seq.doc).padStart(5, '0'),
            date_jalali: dJ, iso_date: String(tsIso).slice(0, 10), period_id: periodId,
            desc: String(spec.desc || '').slice(0, 220),
            source: spec.source || 'manual', ref_module: spec.ref_module || null, ref_id: spec.ref_id == null ? null : String(spec.ref_id),
            lines: lines, total: dSum,
            created_by: spec.created_by || ((req.user && (req.user.name || req.user.username)) || '?'),
            created_at: new Date().toISOString(), posted: true
        };
        live.fin_docs.push(doc);
        return { dup: false, doc: doc };
    }

    /* اسناد خودکار از ماژول‌های عملیاتی — همیشه از موتور سند با متادیتای منبع (idempotent per ref_id) */
    function finSyncAuto(live) {
        const cfg = live.fin_config || {};
        const acc = {};
        (live.fin_accounts || []).forEach((a) => { acc[a.code] = a; });
        const out = { created: 0, dup: 0, closed: 0, failed: 0, by_source: {}, errors: [] };
        const bump = (k) => { out.by_source[k] = (out.by_source[k] || 0) + 1; };
        const tryPost = (src, refId, dateJ, desc, lines) => {
            try {
                const r = finPostDoc(live, { source: src, ref_module: src.replace('auto_', ''), ref_id: refId, date_jalali: dateJ, desc: desc, lines: lines, created_by: 'موتور مالی' });
                if (r.dup) { out.dup++; } else { out.created++; bump(src); }
            } catch (e) {
                if (String(e.message || '').indexOf('بسته شده') !== -1) out.closed++;
                else { out.failed++; if (out.errors.length < 6) out.errors.push(src + ' [' + refId + ']: ' + e.message); }
            }
        };
        const A = (code) => acc[code] ? acc[code].id : null;
        if (!A('510001') || !A('110001') || !A('110002') || !A('110003') || !A('110004') || !A('510002') || !A('230001')) {
            out.errors.push('حساب‌های پیش‌فرض ماژول مالی یافت نشدند — کدینگ را بازبینی کنید.');
            return out;
        }
        (Array.isArray(live.billets) ? live.billets : []).forEach((b) => {
            if (!b || !b.id) return; const w = Number(b.initial_weight_kg) || 0; if (w <= 0) return;
            const amount = Math.round(w * (Number(cfg.billet_rial_per_kg) || 0)); if (amount <= 0) return;
            tryPost('auto_billet', b.id, finIsoToJalali(b.received_at) || jDateFallback, 'مصرف شمش بچ ' + (b.heat_number || b.id) + ' — ' + Math.round(w).toLocaleString('fa-IR') + ' kg × بهای شمش (انتقال به کالای در جریان ساخت)', [
                { account_id: A('110002'), debit: amount, cost_center_id: 'cc-furnace' },
                { account_id: A('110001'), credit: amount }
            ]);
        });
        (Array.isArray(live.energy_logs) ? live.energy_logs : []).forEach((l) => {
            if (!l || !l.id) return; const kwh = Number(l.kwh) || 0; if (kwh <= 0) return;
            const amount = Math.round(kwh * (Number(cfg.energy_tariff_rial_per_kwh) || 0)); if (amount <= 0) return;
            tryPost('auto_energy', l.id, l.date_jalali || finIsoToJalali(l.created_at), 'هزینهٔ انرژی برق ' + (l.line_fa || '') + ' — ' + kwh.toLocaleString('fa-IR') + ' kWh × تعرفه', [
                { account_id: A('510002'), debit: amount, cost_center_id: 'cc-energy' },
                { account_id: A('230001'), credit: amount }
            ]);
        });
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((b) => {
            if (!b || !b.id) return;
            if (String(b.quality_status || '').toUpperCase() !== 'APPROVED') return;
            const nn = Number(b.rebar_size); if (!(nn >= 6 && nn <= 50)) return;
            const kg = Number(b.net_weight_kg) || 0; if (kg <= 0) return;
            const ton = kg / 1000;
            const bom = (live.fin_bom || []).find((x) => String(x.size) === String(nn));
            const std = bom ? finStdCostPerTon(bom, cfg) : Math.round((Number(cfg.billet_rial_per_kg) || 0) * 1.035 * 1000 + 110 * (Number(cfg.energy_tariff_rial_per_kwh) || 0) + 2500000 + 4000000 + 350000);
            const amount = Math.round(ton * std); if (amount <= 0) return;
            tryPost('auto_production', b.id, finIsoToJalali(b.produced_at), 'بهره‌برداری میلگرد سایز ' + nn + ' — ' + Math.round(kg).toLocaleString('fa-IR') + ' kg × بهای استاندارد (BOM)', [
                { account_id: A('110003'), debit: amount, cost_center_id: 'cc-mill' },
                { account_id: A('110002'), credit: amount }
            ]);
        });
        (Array.isArray(live.waste_logs) ? live.waste_logs : []).forEach((w) => {
            if (!w || !w.id) return; const kg = Number(w.quantity) || 0; if (kg <= 0) return;
            const amount = Math.round(kg * (Number(cfg.scrap_rial_per_kg) || 0)); if (amount <= 0) return;
            tryPost('auto_waste', w.id, finIsoToJalali(w.timestamp), 'ارزش بازیافتی ضایعات خط — ' + Math.round(kg).toLocaleString('fa-IR') + ' kg × بهای اسقاط', [
                { account_id: A('110004'), debit: amount, cost_center_id: 'cc-mill' },
                { account_id: A('110002'), credit: amount }
            ]);
        });
        return out;
    }
    var jDateFallback = finIsoToJalali(new Date().toISOString());

    function finPendingCounts(live) {
        const posted = new Set((live.fin_docs || []).map((d) => d.source + '|' + String(d.ref_id)));
        const cnt = (arr, src, filter) => (Array.isArray(arr) ? arr : []).filter((r) => r && r.id && (!filter || filter(r)) && !posted.has(src + '|' + String(r.id))).length;
        return {
            billets: cnt(live.billets, 'auto_billet', (b) => (Number(b.initial_weight_kg) || 0) > 0),
            energy: cnt(live.energy_logs, 'auto_energy', (l) => (Number(l.kwh) || 0) > 0),
            bundles: cnt(live.rebar_bundles, 'auto_production', (b) => String(b.quality_status || '').toUpperCase() === 'APPROVED' && Number(b.rebar_size) >= 6 && Number(b.rebar_size) <= 50),
            waste: cnt(live.waste_logs, 'auto_waste', (w) => (Number(w.quantity) || 0) > 0)
        };
    }

    function finAccBalance(docs, accId) { /* مانده: بدهکار−بستانکار (علامت بر اساس نوع حساب در گزارش‌ها تفسیر می‌شود) */
        let d = 0, c = 0;
        docs.forEach((doc) => (doc.lines || []).forEach((ln) => { if (ln.account_id === accId) { d += Number(ln.debit) || 0; c += Number(ln.credit) || 0; } }));
        return { debit: Math.round(d), credit: Math.round(c), balance: Math.round(d - c) };
    }
    function finDocsInRange(live, fromPid, toPid) {
        return (live.fin_docs || []).filter((d) => (!fromPid || String(d.period_id) >= fromPid) && (!toPid || String(d.period_id) <= toPid));
    }

    // ===== FEAT-GL-23a (begin): ابزارهای GL — تراز آزمایشی چندستونی / گردش حساب / دفتر کل / برگشت و تعدیل سند (فقط گزارش و ابزار حسابداری — هیچ endpoint عملیاتی تغییر نمی‌کند) =====
    const GL_LEVEL_LEN_23A = { 1: 1, 2: 3, 3: 6, 4: 9 };
    function glJTs23a(dJ, hour) {
        const iso = planJalaliToTs(String(dJ || ''), hour == null ? 12 : hour);
        if (!iso) return null;
        const t = Date.parse(iso);
        return isNaN(t) ? null : t;
    }
    function glNormRange23a(from, to) {
        const fd = finDigitsEn(String(from || '')).trim();
        const td = finDigitsEn(String(to || '')).trim();
        const fOk = fd && glJTs23a(fd, 0) != null, tOk = td && glJTs23a(td, 23) != null;
        return { from: fOk ? fd : null, to: tOk ? td : null, valid: (!fd || fOk) && (!td || tOk) };
    }
    /* تفکیک اسناد: افتتاحیه (قبل از از تاریخ) + گردش دوره [از..تا] — مبنای ماندهٔ اول/پایان دوره */
    function glSplitDocs23a(live, from, to) {
        const fT = from ? glJTs23a(from, 0) : null;
        const tT = to ? glJTs23a(to, 23) : null;
        const opening = [], turn = [];
        (live.fin_docs || []).forEach((d) => {
            const ts = glJTs23a(d.date_jalali, 12);
            if (ts == null) return;
            if (fT != null && ts < fT) { opening.push(d); return; }
            if (tT == null || ts <= tT) turn.push(d);
        });
        return { opening: opening, turn: turn };
    }
    /* رولاپ کد حساب در سطح خواسته‌شده (گروه/کل/معین/تفضیلی) با پیشوند کد */
    function glKeyOf23a(code, level) {
        const len = GL_LEVEL_LEN_23A[Number(level)] || 6;
        const c = String(code || '');
        return c.length <= len ? c : c.slice(0, len);
    }
    function glAgg23a(docs, level) {
        const m = new Map();
        docs.forEach((d) => (d.lines || []).forEach((ln) => {
            const k = glKeyOf23a(ln.account_code, level);
            if (!k) return;
            let r = m.get(k);
            if (!r) { r = { code: k, debit: 0, credit: 0 }; m.set(k, r); }
            r.debit += Number(ln.debit) || 0;
            r.credit += Number(ln.credit) || 0;
        }));
        return m;
    }
    function glAccTitleMap23a(live) {
        const t = {};
        (live.fin_accounts || []).forEach((a) => { t[String(a.code)] = a; });
        return t;
    }
    /* تراز آزمایشی چندستونی: ماندهٔ اول دوره (بدهکار/بستانکار) + گردش (بدهکار/بستانکار) + ماندهٔ پایان دوره (بدهکار/بستانکار) */
    function glTrialBalance23a(live, from, to, level, includeZero) {
        const split = glSplitDocs23a(live, from, to);
        const aggOb = glAgg23a(split.opening, level), aggTb = glAgg23a(split.turn, level);
        const titles = glAccTitleMap23a(live);
        const codes = new Set([].concat(Array.from(aggOb.keys()), Array.from(aggTb.keys())));
        if (includeZero) (live.fin_accounts || []).forEach((a) => { if (Number(a.level) === Number(level) && a.active !== false) codes.add(String(a.code)); });
        const rows = Array.from(codes).sort().map((code) => {
            const ob = aggOb.get(code) || { debit: 0, credit: 0 }, tb = aggTb.get(code) || { debit: 0, credit: 0 };
            const obBal = Math.round(ob.debit - ob.credit), tBal = Math.round(tb.debit - tb.credit);
            const cbBal = obBal + tBal;
            const acc = titles[code];
            return {
                code: code, title: acc ? acc.title : '—', type: acc ? acc.type : null,
                ob_debit: obBal > 0 ? obBal : 0, ob_credit: obBal < 0 ? -obBal : 0,
                debit: Math.round(tb.debit), credit: Math.round(tb.credit),
                cb_debit: cbBal > 0 ? cbBal : 0, cb_credit: cbBal < 0 ? -cbBal : 0
            };
        });
        /* چک توازن per ردیف: نمایش همزمان ماندهٔ بدهکار و بستانکار در یک ردیف = ناهنجاری (علامت قرمز) */
        rows.forEach((r) => { r.ok = !(r.ob_debit > 0 && r.ob_credit > 0) && !(r.cb_debit > 0 && r.cb_credit > 0); });
        const tot = rows.reduce((a, r) => ({
            ob_debit: a.ob_debit + r.ob_debit, ob_credit: a.ob_credit + r.ob_credit,
            debit: a.debit + r.debit, credit: a.credit + r.credit,
            cb_debit: a.cb_debit + r.cb_debit, cb_credit: a.cb_credit + r.cb_credit
        }), { ob_debit: 0, ob_credit: 0, debit: 0, credit: 0, cb_debit: 0, cb_credit: 0 });
        const balanced = tot.ob_debit === tot.ob_credit && tot.debit === tot.credit && tot.cb_debit === tot.cb_credit;
        const badRows = rows.filter((r) => !r.ok).length;
        return {
            from: from || null, to: to || null, level: Number(level), level_fa: FIN_LEVEL_FA[Number(level)] || String(level),
            rows: rows, totals: tot, balanced: balanced && badRows === 0,
            unbalanced_rows: badRows,
            check_note: balanced ? 'توازن کامل: در هر سه بخش جمع بدهکار = جمع بستانکار است.' : '⚠ عدم توازن — دادهٔ دفتر با دستکاری خارجی تغییر کرده است؛ با پشتیبانی تماس بگیرید.',
            opening_docs: split.opening.length, turnover_docs: split.turn.length
        };
    }
    /* گردش حساب یک حساب (با تطبیق پیشوندی در سطوح پایین‌تر) + ماندهٔ تجمعی per ردیف */
    function glStatementOf23a(live, acc, from, to, docsOverride) {
        const level = Number(acc.level) || 3;
        const match = (code) => level >= 4 ? String(code) === String(acc.code) : glKeyOf23a(code, level) === String(acc.code);
        const split = docsOverride || glSplitDocs23a(live, from, to);
        const accLineSum = (doc) => { let d = 0, c = 0; (doc.lines || []).forEach((ln) => { if (match(ln.account_code)) { d += Number(ln.debit) || 0; c += Number(ln.credit) || 0; } }); return { debit: d, credit: c }; };
        const ob = accLineSumAll(split.opening, accLineSum);
        const rows = [];
        let run = ob.balance;
        split.turn.slice().sort((a, b) => (glJTs23a(a.date_jalali, 12) - glJTs23a(b.date_jalali, 12)) || ((a.doc_no || 0) - (b.doc_no || 0))).forEach((d) => {
            const s = accLineSum(d);
            if (!s.debit && !s.credit) return;
            run = Math.round(run + s.debit - s.credit);
            rows.push({
                doc_no: d.doc_no, doc_no_fa: d.doc_no_fa, date_jalali: d.date_jalali, desc: d.desc || '',
                source: d.source, debit: Math.round(s.debit), credit: Math.round(s.credit),
                running: run, running_side: run >= 0 ? 'بدهکار' : 'بستانکار', locked: !!d.locked
            });
        });
        const totD = rows.reduce((s, r) => s + r.debit, 0), totC = rows.reduce((s, r) => s + r.credit, 0);
        const closing = Math.round(ob.balance + totD - totC);
        return {
            account: { id: acc.id, code: acc.code, title: acc.title, level: level, level_fa: FIN_LEVEL_FA[level] || level, type: acc.type, type_fa: FIN_TYPE_FA[acc.type] || acc.type },
            opening: { debit: ob.debit, credit: ob.credit, balance: ob.balance, side: ob.balance >= 0 ? 'بدهکار' : 'بستانکار' },
            rows: rows, totals: { debit: Math.round(totD), credit: Math.round(totC) },
            closing: { balance: closing, side: closing >= 0 ? 'بدهکار' : 'بستانکار' }
        };
    }
    function accLineSumAll(docs, fn) {
        let d = 0, c = 0;
        docs.forEach((doc) => { const s = fn(doc); d += s.debit; c += s.credit; });
        d = Math.round(d); c = Math.round(c);
        return { debit: d, credit: c, balance: Math.round(d - c) };
    }
    /* دفتر کل: همان ساختار گردش حساب برای همهٔ حساب‌های فعال دارای گردش/مانده در بازه */
    function glGeneralLedger23a(live, from, to, level, includeZero) {
        const split = glSplitDocs23a(live, from, to);
        const titles = glAccTitleMap23a(live);
        const codes = new Set();
        const collect = (docs) => docs.forEach((d) => (d.lines || []).forEach((ln) => { const k = glKeyOf23a(ln.account_code, level); if (k) codes.add(k); }));
        collect(split.opening); collect(split.turn);
        if (includeZero) (live.fin_accounts || []).forEach((a) => { if (Number(a.level) === Number(level) && a.active !== false) codes.add(String(a.code)); });
        const accounts = Array.from(codes).sort().map((code) => {
            const acc = titles[code] || { id: null, code: code, title: '—', level: Number(level), type: null };
            return glStatementOf23a(live, acc, from, to, split);
        }).filter((a) => a.rows.length || a.opening.balance !== 0 || includeZero);
        const totD = accounts.reduce((s, a) => s + a.totals.debit, 0), totC = accounts.reduce((s, a) => s + a.totals.credit, 0);
        return { from: from || null, to: to || null, level: Number(level), level_fa: FIN_LEVEL_FA[Number(level)] || String(level), accounts: accounts, totals: { debit: totD, credit: totC, balanced: totD === totC }, account_count: accounts.length };
    }
    /* هش سبک برای ref_id تعدیل — تلاش دوباره با همان اقلام = همان سند (idempotent) */
    function glCorrHash23a(s) {
        let h = 5381;
        for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }
    // ===== FEAT-GL-23a (end) =====

    if (req.method === 'GET' && pathname === '/api/fin/overview') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز: ماژول مالی برای نقش شما فعال نیست.' }, 403);
        const live = readLive();
        if (finSeed(live)) writeJson(LIVE_FILE, live);
        const jNow = finIsoToJalali(new Date().toISOString());
        return sendJson(res, {
            ok: true, config: live.fin_config, periods: live.fin_periods, cost_centers: live.fin_cost_centers,
            bom: live.fin_bom || [],
            counts: { docs: (live.fin_docs || []).length, accounts: (live.fin_accounts || []).length },
            pending: finPendingCounts(live),
            month_now: String(jNow || '').slice(0, 7).replace('/', '-'),
            today_jalali: jNow, roles: { read: FIN_R, write: FIN_W },
            generated_at: new Date().toISOString()
        });
    }
    if (req.method === 'GET' && pathname === '/api/fin/accounts') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const accounts = (live.fin_accounts || []).slice().sort((a, b) => String(a.code).localeCompare(String(b.code)));
        return sendJson(res, { ok: true, accounts: accounts, cost_centers: live.fin_cost_centers || [], level_fa: FIN_LEVEL_FA, type_fa: FIN_TYPE_FA });
    }
    if (req.method === 'POST' && pathname === '/api/fin/accounts') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز به تغییر کدینگ است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const code = finDigitsEn(String(b.code || '')).trim();
            const title = String(b.title || '').trim().slice(0, 80);
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            if (!/^\d{1,9}$/.test(code)) return sendJson(res, { error: 'کد حساب باید عددی و تا ۹ رقم باشد (گروه ۱ رقم، کل ۳ رقم، معین ۶ رقم، تفضیلی ۹ رقم).' }, 400);
            if (!title) return sendJson(res, { error: 'عنوان حساب الزامی است.' }, 400);
            if ((live.fin_accounts || []).some((a) => a.code === code)) return sendJson(res, { error: 'این کد قبلاً استفاده شده است.' }, 400);
            const level = code.length === 1 ? 1 : (code.length === 3 ? 2 : (code.length === 6 ? 3 : 4));
            const pCode = level === 2 ? code.slice(0, 1) : (level === 3 ? code.slice(0, 3) : code.slice(0, 6));
            const parent = (live.fin_accounts || []).find((a) => a.code === pCode);
            if (level > 1 && !parent) return sendJson(res, { error: 'حساب والد با کد ' + pCode + ' یافت نشد — ابتدا والد را تعریف کنید.' }, 400);
            let type = String(b.type || '');
            if (parent) type = parent.type; else if (FIN_TYPE_FA.indexOf && ['asset', 'liability', 'equity', 'income', 'expense'].indexOf(type) === -1) return sendJson(res, { error: 'نوع حساب برای گروه باید یکی از دارایی/بدهی/سرمایه/درآمد/هزینه باشد.' }, 400);
            const rec = { id: 'facc-' + code + '-' + Date.now().toString(36), code: code, title: title, type: type, level: level, parent_id: parent ? parent.id : null, active: true };
            live.fin_accounts.push(rec);
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.account.add', { code: code, title: title, level: level }); return sendJson(res, { ok: true, account: rec }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'PUT' && pathname === '/api/fin/accounts') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive();
            const a = (live.fin_accounts || []).find((x) => x.id === String(b.id || ''));
            if (!a) return sendJson(res, { error: 'حساب یافت نشد.' }, 404);
            if (b.title != null) a.title = String(b.title).trim().slice(0, 80) || a.title;
            if (b.active != null) a.active = !!b.active;
            a.updated_at = new Date().toISOString();
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.account.edit', { id: a.id, title: a.title, active: a.active }); return sendJson(res, { ok: true, account: a }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'POST' && pathname === '/api/fin/cost-centers') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const title = String(b.title || '').trim().slice(0, 80);
            if (!title) return sendJson(res, { error: 'عنوان مرکز هزینه الزامی است.' }, 400);
            const live = readLive();
            live.fin_cost_centers = Array.isArray(live.fin_cost_centers) ? live.fin_cost_centers : [];
            const code = String(b.code || '').trim().slice(0, 16) || ('CC-' + String(live.fin_cost_centers.length + 1).padStart(2, '0'));
            const rec = { id: 'cc-' + Date.now().toString(36), code: code, title: title, kind: String(b.kind || 'admin'), active: true };
            live.fin_cost_centers.push(rec);
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.costcenter.add', { code: code, title: title }); return sendJson(res, { ok: true, cost_center: rec }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'PUT' && pathname === '/api/fin/config') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            const c = live.fin_config;
            const num = (v, lo, hi) => { const x = Number(finDigitsEn(v)); return isFinite(x) && x >= lo && x <= hi ? x : null; };
            const vat = num(b.vat_rate, 0, 50); if (vat == null) return sendJson(res, { error: 'نرخ مالیات بر ارزش افزوده باید عددی ۰ تا ۵۰ باشد.' }, 400);
            const tax = num(b.corporate_tax_rate, 0, 60); if (tax == null) return sendJson(res, { error: 'نرخ مالیات بر درآمد باید عددی ۰ تا ۶۰ باشد.' }, 400);
            const ins = num(b.employer_insurance_rate, 0, 40); if (ins == null) return sendJson(res, { error: 'نرخ بیمه سهم کارفرما باید عددی ۰ تا ۴۰ باشد.' }, 400);
            const bp = num(b.billet_rial_per_kg, 0, 1e9); const et = num(b.energy_tariff_rial_per_kwh, 0, 1e7);
            const sp = num(b.scrap_rial_per_kg, 0, 1e9); const dl = num(b.quarterly_report_deadline_days, 1, 120);
            if (bp == null || et == null || sp == null || dl == null) return sendJson(res, { error: 'بهای شمش/تعرفهٔ برق/بهای اسقاط/مهلت گزارش فصلی نامعتبر است.' }, 400);
            c.vat_rate = vat; c.corporate_tax_rate = tax; c.employer_insurance_rate = ins;
            c.billet_rial_per_kg = bp; c.energy_tariff_rial_per_kwh = et; c.scrap_rial_per_kg = sp; c.quarterly_report_deadline_days = Math.round(dl);
            c.updated_at = new Date().toISOString(); c.updated_by = (req.user && (req.user.name || req.user.username)) || '?';
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.config.update', { vat: vat, tax: tax, ins: ins }); return sendJson(res, { ok: true, config: c }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'PUT' && pathname === '/api/fin/bom') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const rows = Array.isArray(b.rows) ? b.rows : null;
            if (!rows || !rows.length) return sendJson(res, { error: 'هیچ ردیف BOM ارسال نشده است.' }, 400);
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            live.fin_bom = Array.isArray(live.fin_bom) ? live.fin_bom : [];
            const by = {}; live.fin_bom.forEach((r) => { by[String(r.size)] = r; });
            const num = (v, lo, hi) => { const x = Number(finDigitsEn(v)); return isFinite(x) && x >= lo && x <= hi ? x : null; };
            for (const r of rows) {
                const size = finDigitsEn(String(r.size || '')).trim();
                if (!(size === '5SP' || (Number(size) >= 6 && Number(size) <= 50))) return sendJson(res, { error: 'سایز ' + size + ' نامعتبر است (۶ تا ۵۰ یا 5SP).' }, 400);
                const vals = { billet_t_per_t: num(r.billet_t_per_t, 0.5, 3), kwh_per_t: num(r.kwh_per_t, 0, 5000), labor_rial_per_t: num(r.labor_rial_per_t, 0, 1e10), overhead_rial_per_t: num(r.overhead_rial_per_t, 0, 1e10), other_rial_per_t: num(r.other_rial_per_t, 0, 1e10), sale_price_rial_per_t: num(r.sale_price_rial_per_t, 0, 1e11) };
                for (const k of Object.keys(vals)) if (vals[k] == null) return sendJson(res, { error: 'مقدار «' + k + '» سایز ' + size + ' نامعتبر است.' }, 400);
                const cur = by[size];
                if (cur) { Object.keys(vals).forEach((k) => { cur[k] = vals[k]; }); cur.updated_at = new Date().toISOString(); cur.updated_by = (req.user && (req.user.name || req.user.username)) || '?'; }
                else { const rec = Object.assign({ id: 'fbom-' + size + '-' + Date.now().toString(36), size: size, updated_at: new Date().toISOString(), updated_by: (req.user && (req.user.name || req.user.username)) || '?' }, vals); live.fin_bom.push(rec); by[size] = rec; }
            }
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.bom.update', { sizes: rows.map((r) => String(r.size)) }); return sendJson(res, { ok: true, bom: live.fin_bom }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'POST' && pathname === '/api/fin/bom/calibrate') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const d90 = new Date(Date.now() - 90 * 86400000).toISOString();
        let billetKg = 0, bundleKg = 0;
        (Array.isArray(live.billets) ? live.billets : []).forEach((b) => { const t = Date.parse(b.received_at || ''); if (!isNaN(t) && t >= d90) billetKg += Number(b.initial_weight_kg) || 0; });
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((b) => { const t = Date.parse(b.produced_at || ''); const nn = Number(b.rebar_size); if (!isNaN(t) && t >= d90 && String(b.quality_status || '').toUpperCase() === 'APPROVED' && nn >= 6 && nn <= 50) bundleKg += Number(b.net_weight_kg) || 0; });
        const ratio = bundleKg > 0 ? Math.round((billetKg / bundleKg) * 1000) / 1000 : null;
        /* میانگین kWh/تن از ماژول انرژی (۹۰روزه از کنتور واقعی) */
        let kwh90 = 0;
        (Array.isArray(live.energy_logs) ? live.energy_logs : []).forEach((l) => { const t = Date.parse(l.created_at || ''); if (!isNaN(t) && t >= d90) kwh90 += Number(l.kwh) || 0; });
        const kwhPerT = bundleKg > 0 && kwh90 > 0 ? Math.round(kwh90 / (bundleKg / 1000) * 10) / 10 : null;
        let updated = 0;
        if (ratio != null) (live.fin_bom || []).forEach((r) => { r.billet_t_per_t = ratio; updated++; });
        if (kwhPerT != null) (live.fin_bom || []).forEach((r) => { r.kwh_per_t = kwhPerT; });
        if (updated && writeJson(LIVE_FILE, live)) auditLog(req, 'fin.bom.calibrate', { ratio: ratio, kwh_per_t: kwhPerT });
        return sendJson(res, { ok: true, ratio: ratio, kwh_per_t: kwhPerT, updated: updated, basis: { billet_kg_90d: Math.round(billetKg), approved_kg_90d: Math.round(bundleKg), kwh_90d: Math.round(kwh90) }, note: (ratio == null ? 'دادهٔ شمش/تولید ۹۰روزه کافی نیست؛ ضریب شمش تغییر نکرد.' : 'ضریب شمش per تن از نسبت واقعی ۹۰روزه کالیبره شد.') + (kwhPerT == null ? ' میانگین انرژی از EM موجود نیست.' : ' kWh/تن از میانگین کنتور EM به‌روز شد.') });
    }
    if (req.method === 'GET' && pathname === '/api/fin/docs') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const lim = Math.min(200, Math.max(5, Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 50));
        const docs = (live.fin_docs || []).slice().sort((a, b) => (b.doc_no || 0) - (a.doc_no || 0)).slice(0, lim);
        const totalD = (live.fin_docs || []).reduce((s, d) => s + (Number(d.total) || 0), 0);
        return sendJson(res, { ok: true, docs: docs, total_docs: (live.fin_docs || []).length, total_debit_all: totalD, pending: finPendingCounts(live) });
    }
    if (req.method === 'POST' && pathname === '/api/fin/docs') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت سند فقط برای واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            /* HARDEN-18D: همزمانی خوش‌بینانه — X-Base-Ver کهنه ⇒ 409 VER_CONFLICT (انتخابی؛ بدون هدر = رفتار قدیمی) */
            const vc18d = assertFreshVer18D(req, live);
            if (vc18d) return verConflict18D(res, vc18d);
            try {
                const r = finPostDoc(live, { source: 'manual', date_jalali: b.date_jalali, desc: b.desc, lines: b.lines });
                if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.doc.manual', { doc_no: r.doc.doc_no, total: r.doc.total }); return sendJson(res, { ok: true, doc: r.doc }); }
                return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
            } catch (e) { return sendJson(res, { error: e.message }, 400); }
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'POST' && pathname === '/api/fin/docs/sync') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const out = finSyncAuto(live);
        if (out.created > 0 && !writeJson(LIVE_FILE, live)) return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        auditLog(req, 'fin.doc.sync', { created: out.created, dup: out.dup, closed: out.closed, failed: out.failed });
        return sendJson(res, Object.assign({ ok: true }, out, { pending: finPendingCounts(live) }));
    }
    if (req.method === 'GET' && pathname === '/api/fin/costing') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const cfg = live.fin_config;
        let per = finDigitsEn(new URL(req.url, 'http://x').searchParams.get('month') || '').trim();
        if (!/^\d{4}-\d{2}$/.test(per)) per = String(finIsoToJalali(new Date().toISOString())).slice(0, 7).replace('/', '-');
        const mm = per.split('-'); const jy = Number(mm[0]), jm = Number(mm[1]);
        if (jm < 1 || jm > 12) return sendJson(res, { error: 'ماه نامعتبر است.' }, 400);
        const t0 = Date.parse(planJalaliToTs(jy + '/' + jm + '/1', 0) || '') || 0; /* FIX-13b: planJalaliToTs خروجی ISO رشته‌ای دارد — به ms تبدیل شود */
        let ny = jy, nm = jm + 1; if (nm > 12) { nm = 1; ny++; }
        const t1 = Date.parse(planJalaliToTs(ny + '/' + nm + '/1', 0) || '') || 0;
        const inRange = (iso) => { const t = Date.parse(iso || ''); return !isNaN(t) && t >= t0 && t < t1; };
        const bySize = {}; let totalKg = 0;
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((b) => {
            if (!b || !inRange(b.produced_at) || String(b.quality_status || '').toUpperCase() !== 'APPROVED') return;
            const nn = Number(b.rebar_size); if (!(nn >= 6 && nn <= 50)) return;
            const k = String(nn); bySize[k] = (bySize[k] || 0) + (Number(b.net_weight_kg) || 0);
        });
        Object.keys(bySize).forEach((k) => { totalKg += bySize[k]; });
        let matKg = 0;
        (Array.isArray(live.billets) ? live.billets : []).forEach((b) => { if (inRange(b.received_at)) matKg += Number(b.initial_weight_kg) || 0; });
        const matCost = matKg * (Number(cfg.billet_rial_per_kg) || 0);
        let kwh = 0;
        (Array.isArray(live.energy_logs) ? live.energy_logs : []).forEach((l) => { if (l && l.iso_date && inRange(l.iso_date + 'T12:00:00Z')) kwh += Number(l.kwh) || 0; });
        const energyCost = kwh * (Number(cfg.energy_tariff_rial_per_kwh) || 0);
        const rows = Object.keys(bySize).sort((a, b) => Number(a) - Number(b)).map((k) => {
            const kg = bySize[k], ton = kg / 1000, share = totalKg > 0 ? kg / totalKg : 0;
            const bom = (live.fin_bom || []).find((x) => String(x.size) === k) || { size: k, billet_t_per_t: 1.035, kwh_per_t: 110, labor_rial_per_t: 2500000, overhead_rial_per_t: 4000000, other_rial_per_t: 350000, sale_price_rial_per_t: 315000000 };
            const mat = matCost * share, en = energyCost * share;
            const lab = (Number(bom.labor_rial_per_t) || 0) * ton, ovh = (Number(bom.overhead_rial_per_t) || 0) * ton, oth = (Number(bom.other_rial_per_t) || 0) * ton;
            const total = mat + en + lab + ovh + oth;
            const perT = ton > 0 ? Math.round(total / ton) : 0;
            const std = finStdCostPerTon(bom, cfg);
            const variancePerT = perT - std;
            const sale = Number(bom.sale_price_rial_per_t) || 0;
            const margin = sale - perT;
            return { size: k, tonnage: Math.round(ton * 1000) / 1000, elements: { material: Math.round(mat), energy: Math.round(en), labor: Math.round(lab), overhead: Math.round(ovh), other: Math.round(oth) }, per_t: { material: ton > 0 ? Math.round(mat / ton) : 0, energy: ton > 0 ? Math.round(en / ton) : 0, labor: ton > 0 ? Math.round(lab / ton) : 0, overhead: ton > 0 ? Math.round(ovh / ton) : 0, other: ton > 0 ? Math.round(oth / ton) : 0, total: perT }, std_per_t: std, variance_per_t: variancePerT, variance_pct: std > 0 ? Math.round(variancePerT / std * 1000) / 10 : null, sale_price_per_t: sale, margin_per_t: margin, margin_pct: perT > 0 ? Math.round(margin / perT * 1000) / 10 : null };
        });
        const totT = rows.reduce((s, r) => s + r.tonnage, 0);
        const totCost = rows.reduce((s, r) => s + (r.elements.material + r.elements.energy + r.elements.labor + r.elements.overhead + r.elements.other), 0);
        return sendJson(res, {
            ok: true, month: per, label: FIN_MONTH_FA[jm - 1] + ' ' + jy,
            basis: { billet_kg: Math.round(matKg), kwh: Math.round(kwh), total_tonnage: Math.round(totT * 1000) / 1000, total_cost: Math.round(totCost) },
            rows: rows, empty: rows.length === 0,
            hint_empty: 'در این ماه تولید تأییدشدهٔ سایز استاندارد (۶..۵۰) ثبت نشده است.',
            generated_at: new Date().toISOString()
        });
    }
    if (req.method === 'GET' && pathname === '/api/fin/reports/pnl') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const cfg = live.fin_config;
        const q = new URL(req.url, 'http://x').searchParams;
        const from = finDigitsEn(q.get('from') || '').trim() || null, to = finDigitsEn(q.get('to') || '').trim() || null;
        const docs = finDocsInRange(live, from, to);
        const accs = live.fin_accounts || [];
        const inc = [], exp = [];
        accs.forEach((a) => {
            if (Number(a.level) < 3) return;
            const b = finAccBalance(docs, a.id);
            if (!b.debit && !b.credit) return;
            if (a.type === 'income') inc.push({ code: a.code, title: a.title, amount: Math.max(0, b.credit - b.debit) });
            if (a.type === 'expense') exp.push({ code: a.code, title: a.title, amount: Math.max(0, b.debit - b.credit) });
        });
        const totInc = inc.reduce((s, r) => s + r.amount, 0), totExp = exp.reduce((s, r) => s + r.amount, 0);
        const profit = totInc - totExp;
        const tax = profit > 0 ? Math.round(profit * (Number(cfg.corporate_tax_rate) || 0) / 100) : 0;
        return sendJson(res, { ok: true, from: from, to: to, incomes: inc, expenses: exp, total_income: totInc, total_expense: totExp, profit: profit, tax_rate: cfg.corporate_tax_rate, tax: tax, net_profit: profit - tax, doc_count: docs.length, generated_at: new Date().toISOString() });
    }
    if (req.method === 'GET' && pathname === '/api/fin/reports/balance') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const docs = live.fin_docs || [];
        const accs = live.fin_accounts || [];
        const assets = [], liabs = [], eqs = [];
        let incTot = 0, expTot = 0;
        accs.forEach((a) => {
            if (Number(a.level) < 3) return;
            const b = finAccBalance(docs, a.id);
            if (!b.debit && !b.credit) return;
            if (a.type === 'asset') assets.push({ code: a.code, title: a.title, amount: b.balance });
            else if (a.type === 'liability') liabs.push({ code: a.code, title: a.title, amount: -b.balance });
            else if (a.type === 'equity') eqs.push({ code: a.code, title: a.title, amount: -b.balance });
            else if (a.type === 'income') incTot += b.credit - b.debit;
            else if (a.type === 'expense') expTot += b.debit - b.credit;
        });
        const profit = incTot - expTot;
        const totA = assets.reduce((s, r) => s + r.amount, 0), totL = liabs.reduce((s, r) => s + r.amount, 0), totE = eqs.reduce((s, r) => s + r.amount, 0);
        /* ===== FEAT-GL-23b (begin): کارت «موجودی ریالی» ترازنامه از ارزیابی میانگین موزون (افزاینده — فقط دادهٔ گزارش؛ اسناد/حساب‌ها دست نمی‌خورند) ===== */
        const invVal23b = gl23bValuation(live);
        const glInvRial23b = assets.filter((a) => /^110/.test(String(a.code))).reduce((s, a) => s + a.amount, 0);
        /* ===== FEAT-GL-23b (end) ===== */
        return sendJson(res, { ok: true, assets: assets, liabilities: liabs, equity: eqs, total_assets: totA, total_liabilities: totL, total_equity: totE, period_profit: profit, balanced: totA === totL + totE + profit,
            inventory_valuation: { method: 'میانگین موزون متحرک — استاندارد ۸', total_value_rial: invVal23b.totals.value_rial, carrying_rial: invVal23b.totals.carrying_rial, write_down_rial: invVal23b.totals.write_down_rial, nrv_applied: invVal23b.totals.write_down_rial > 0, items_with_stock: invVal23b.totals.items_with_stock, gl_inventory_rial: glInvRial23b, diff_gl_rial: invVal23b.totals.value_rial - glInvRial23b },
            generated_at: new Date().toISOString() });
    }
    if (req.method === 'GET' && pathname === '/api/fin/reports/vat') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const cfg = live.fin_config;
        const q = new URL(req.url, 'http://x').searchParams;
        const year = Number(finDigitsEn(q.get('year'))) || Number(String(finIsoToJalali(new Date().toISOString())).slice(0, 4));
        const quarter = Math.min(4, Math.max(1, Number(finDigitsEn(q.get('quarter'))) || Math.ceil(Number(String(finIsoToJalali(new Date().toISOString())).slice(5, 7)) / 3)));
        const m0 = (quarter - 1) * 3 + 1;
        const from = year + '-' + String(m0).padStart(2, '0');
        const to = year + '-' + String(m0 + 2).padStart(2, '0');
        const docs = finDocsInRange(live, from, to);
        const accs = live.fin_accounts || [];
        const find = (code) => accs.find((a) => a.code === code);
        let salesBase = 0, purchaseBase = 0, vatBuyPosted = 0, vatSalePosted = 0;
        docs.forEach((d) => (d.lines || []).forEach((ln) => {
            const a = accs.find((x) => x.id === ln.account_id); if (!a) return;
            if (a.type === 'income') salesBase += Number(ln.credit) || 0;
            if (a.type === 'expense' || a.code === '110001') purchaseBase += Number(ln.debit) || 0;
            if (a.code === '210001') vatBuyPosted += Number(ln.debit) || 0;
            if (a.code === '210002') vatSalePosted += Number(ln.credit) || 0;
        }));
        const rate = Number(cfg.vat_rate) || 0;
        const vatSales = Math.round(salesBase * rate / 100), vatBuy = Math.round(purchaseBase * rate / 100);
        const endTs = Date.parse(planJalaliToTs(year + '/' + (m0 + 2) + '/30', 12) || '') || Date.now(); /* FIX-13b: تبدیل به ms */
        const deadline = finIsoToJalali(new Date(endTs + (Number(cfg.quarterly_report_deadline_days) || 45) * 86400000));
        return sendJson(res, {
            ok: true, year: year, quarter: quarter, label: 'فصل ' + ['بهار', 'تابستان', 'پاییز', 'زمستان'][quarter - 1] + ' ' + year,
            vat_rate: rate, sales_base: salesBase, purchase_base: purchaseBase,
            vat_sales_est: vatSales, vat_purchase_est: vatBuy, vat_net_est: vatSales - vatBuy,
            vat_buy_posted: vatBuyPosted, vat_sale_posted: vatSalePosted,
            quarterly169: { doc_count: docs.length, purchase_total: purchaseBase, sales_total: salesBase, deadline_days: cfg.quarterly_report_deadline_days, deadline_jalali: deadline, note: 'گزارش معاملات فصلی مادهٔ ۱۶۹ — ارسال الکترونیکی حداکثر ' + (cfg.quarterly_report_deadline_days) + ' روز پس از پایان فصل (تا ' + deadline + ')' },
            generated_at: new Date().toISOString()
        });
    }
    if (req.method === 'POST' && pathname === '/api/fin/periods') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: فقط واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive();
            const p = (live.fin_periods || []).find((x) => x.id === finDigitsEn(String(b.period_id || '')));
            if (!p) return sendJson(res, { error: 'دوره یافت نشد.' }, 404);
            p.closed = !!b.closed; p.closed_at = p.closed ? new Date().toISOString() : null; p.closed_by = p.closed ? ((req.user && (req.user.name || req.user.username)) || '?') : null;
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.period.' + (p.closed ? 'close' : 'open'), { period: p.id }); return sendJson(res, { ok: true, period: p }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }

    // ===== FEAT-GL-23a (begin): endpointهای گزارش GL + برگشت/تعدیل سند (گزارش‌گیری فقط — اسناد عملیاتی دست نمی‌خورند) =====
    if (req.method === 'GET' && pathname === '/api/fin/reports/trial-balance') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const q = new URL(req.url, 'http://x').searchParams;
        const rng = glNormRange23a(q.get('from'), q.get('to'));
        if (!rng.valid) return sendJson(res, { error: 'بازهٔ شمسی نامعتبر است (نمونه درست: ۱۴۰۵/۰۱/۰۱).' }, 400);
        const level = Math.min(4, Math.max(1, Number(finDigitsEn(q.get('level'))) || 3));
        const includeZero = q.get('include_zero') === '1' || q.get('include_zero') === 'true';
        const out = glTrialBalance23a(live, rng.from, rng.to, level, includeZero);
        return sendJson(res, Object.assign({ ok: true, generated_at: new Date().toISOString() }, out));
    }
    if (req.method === 'GET' && pathname === '/api/fin/reports/statement') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const q = new URL(req.url, 'http://x').searchParams;
        const rng = glNormRange23a(q.get('from'), q.get('to'));
        if (!rng.valid) return sendJson(res, { error: 'بازهٔ شمسی نامعتبر است (نمونه درست: ۱۴۰۵/۰۱/۰۱).' }, 400);
        const sel = finDigitsEn(String(q.get('account') || '')).trim();
        if (!sel) return sendJson(res, { error: 'انتخاب حساب الزامی است.' }, 400);
        const acc = (live.fin_accounts || []).find((a) => a.id === sel || String(a.code) === sel);
        if (!acc) return sendJson(res, { error: 'حساب یافت نشد.' }, 404);
        if (Number(acc.level) < 2) return sendJson(res, { error: 'گردش حساب در سطح گروه معنا ندارد — سطح کل/معین/تفضیلی را انتخاب کنید.' }, 400);
        const out = glStatementOf23a(live, acc, rng.from, rng.to);
        return sendJson(res, Object.assign({ ok: true, from: rng.from, to: rng.to, generated_at: new Date().toISOString() }, out));
    }
    if (req.method === 'GET' && pathname === '/api/fin/reports/generalledger') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const q = new URL(req.url, 'http://x').searchParams;
        const rng = glNormRange23a(q.get('from'), q.get('to'));
        if (!rng.valid) return sendJson(res, { error: 'بازهٔ شمسی نامعتبر است (نمونه درست: ۱۴۰۵/۰۱/۰۱).' }, 400);
        const level = Math.min(4, Math.max(2, Number(finDigitsEn(q.get('level'))) || 3));
        const includeZero = q.get('include_zero') === '1' || q.get('include_zero') === 'true';
        const out = glGeneralLedger23a(live, rng.from, rng.to, level, includeZero);
        return sendJson(res, Object.assign({ ok: true, generated_at: new Date().toISOString() }, out));
    }
    /* resolve سند برای برگشت/تعدیل — با doc_id یا doc_no (فارسی/لاتین) */
    const glFindDoc23a = (live, b) => {
        const id = String(b.doc_id || '').trim();
        const no = Number(finDigitsEn(String(b.doc_no || ''))) || 0;
        const noFa = String(b.doc_no || '').trim();
        return (live.fin_docs || []).find((d) => (id && d.id === id) || (no && d.doc_no === no) || (noFa && d.doc_no_fa === noFa)) || null;
    };
    if (req.method === 'POST' && pathname === '/api/fin/docs/reverse') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: برگشت سند فقط برای واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            const orig = glFindDoc23a(live, b);
            if (!orig) return sendJson(res, { error: 'سند یافت نشد.' }, 404);
            if (orig.source === 'gl_correction') return sendJson(res, { error: 'برگشتِ سند اصلاحی/برگشتی مجاز نیست — سند اصلی را برگشت بزنید.' }, 409);
            if (orig.reversed_by) return sendJson(res, { error: 'این سند قبلاً برگشت خورده است (سند برگشت: ' + orig.reversed_by + ').' }, 409);
            if (orig.locked) return sendJson(res, { error: 'این سند قفل شده است و قابل برگشت مجدد نیست.' }, 409);
            const dateJ = finDigitsEn(String(b.date_jalali || '')).trim() || finIsoToJalali(new Date().toISOString());
            const desc = ('برگشت سند ' + orig.doc_no_fa + (orig.desc ? ' — ' + orig.desc : '')).slice(0, 220);
            const lines = (orig.lines || []).map((ln) => ({ account_id: ln.account_id, debit: Number(ln.credit) || 0, credit: Number(ln.debit) || 0, cost_center_id: ln.cost_center_id || null, note: ('برگشت — ' + (ln.note || '')).slice(0, 140) }));
            try {
                const r = finPostDoc(live, { source: 'gl_correction', ref_module: 'gl', ref_id: 'reverse:' + orig.id, date_jalali: dateJ, desc: desc, lines: lines, created_by: String((req.user && (req.user.name || req.user.username)) || '') });
                if (r.dup) return sendJson(res, { error: 'این سند قبلاً برگشت خورده است (سند برگشت: ' + r.doc.doc_no_fa + ').' }, 409);
                orig.locked = true; orig.reversed_by = r.doc.doc_no_fa; orig.reversed_at = new Date().toISOString();
                if (!writeJson(LIVE_FILE, live)) return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
                auditLog(req, 'fin.doc.reverse', { original: orig.doc_no_fa, reversal: r.doc.doc_no_fa, total: r.doc.total });
                return sendJson(res, { ok: true, doc: r.doc, original: { doc_no_fa: orig.doc_no_fa, locked: true, reversed_by: orig.reversed_by } });
            } catch (e) { return sendJson(res, { error: e.message }, 400); }
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'POST' && pathname === '/api/fin/docs/correct') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: تعدیل سند فقط برای واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            const orig = glFindDoc23a(live, b);
            if (!orig) return sendJson(res, { error: 'سند یافت نشد.' }, 404);
            if (orig.source === 'gl_correction') return sendJson(res, { error: 'تعدیلِ سند اصلاحی مجاز نیست — سند اصلی را تعدیل کنید.' }, 409);
            if (orig.locked || orig.reversed_by) return sendJson(res, { error: 'این سند برگشت خورده و قفل است (سند برگشت: ' + (orig.reversed_by || '—') + ') — تعدیل مجاز نیست.' }, 409);
            if (!Array.isArray(b.lines) || !b.lines.length) return sendJson(res, { error: 'ردیف‌های تعدیل ارسال نشده است.' }, 400);
            const dateJ = finDigitsEn(String(b.date_jalali || '')).trim() || finIsoToJalali(new Date().toISOString());
            const canon = JSON.stringify(b.lines.map((ln) => ({ a: ln.account_id, d: Math.round(Number(finDigitsEn(ln.debit)) || 0), c: Math.round(Number(finDigitsEn(ln.credit)) || 0) })));
            const desc = ('تعدیل سند ' + orig.doc_no_fa + (b.desc ? ' — ' + String(b.desc).slice(0, 120) : '')).slice(0, 220);
            try {
                const r = finPostDoc(live, { source: 'gl_correction', ref_module: 'gl', ref_id: 'correct:' + orig.id + ':' + glCorrHash23a(canon), date_jalali: dateJ, desc: desc, lines: b.lines, created_by: String((req.user && (req.user.name || req.user.username)) || '') });
                if (r.dup) return sendJson(res, { ok: true, duplicate: true, doc: r.doc, note: 'این تعدیل قبلاً ثبت شده است (سند ' + r.doc.doc_no_fa + ') — تکرار سند جدید نساخت.' });
                orig.corrected_by = Array.isArray(orig.corrected_by) ? orig.corrected_by.concat([r.doc.doc_no_fa]) : [r.doc.doc_no_fa];
                if (!writeJson(LIVE_FILE, live)) return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
                auditLog(req, 'fin.doc.correct', { original: orig.doc_no_fa, correction: r.doc.doc_no_fa, total: r.doc.total });
                return sendJson(res, { ok: true, doc: r.doc, original: { doc_no_fa: orig.doc_no_fa, corrected_by: orig.corrected_by } });
            } catch (e) { return sendJson(res, { error: e.message }, 400); }
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    // ===== FEAT-GL-23a (end) =====

    // ===== FEAT-GL-23b (begin): ارزیابی موجودی — میانگین موزون متحرک + NRV (استاندارد ۸ ایران — اقل بهای تمام‌شده و خالص ارزش فروش؛ LIFO ممنوع) — فقط گزارش/ابزار، هیچ حرکت انباری تغییر نمی‌کند =====
    function gl23bEnsureNrv(live) {
        if (!live.inv_valuation_23b || typeof live.inv_valuation_23b !== 'object') live.inv_valuation_23b = { nrv: {} };
        if (!live.inv_valuation_23b.nrv || typeof live.inv_valuation_23b.nrv !== 'object') live.inv_valuation_23b.nrv = {};
        return live.inv_valuation_23b;
    }
    /* بهای استاندارد برای مقایسهٔ نمایش (زیرساخت FIFO/Standard — FIFO فعلاً null) */
    function gl23bStdOf(live, item) {
        const code = String(item.code || '').toUpperCase();
        const cfg = live.fin_config || {};
        if (code === 'BILLET') { const p = Number(cfg.billet_rial_per_kg) || 0; return String(item.unit || '').indexOf('تن') !== -1 ? Math.round(p * 1000) : p; }
        const m = /^RB-(\d+)$/.exec(code);
        if (!m && code !== '5SP') return null;
        const bom = (live.fin_bom || []).find((x) => String(x.size) === String(code === '5SP' ? '5SP' : m[1]));
        return bom ? finStdCostPerTon(bom, cfg) : null;
    }
    /* resolve بهای ورود: خرید (پیوند با رسید ماژول خرید) ← بهای شمش fin_config ← BOM استاندارد محصول ← null (میانگین بدون تغییر) */
    function gl23bEntryCost(live, item, r) {
        const cfg = live.fin_config || {};
        const code = String(item.code || '').toUpperCase();
        const perTon = String(item.unit || '').indexOf('تن') !== -1;
        if (String(r.receipt_type || '') === 'purchase' && r.source_ref) {
            const pr = (live.purchase_receipts || []).find((x) => x && x.receipt_no === r.source_ref);
            if (pr) {
                const ln = (pr.lines || []).find((l) => l && l.item_id === item.id) || (pr.lines || [])[0];
                if (ln && Number(ln.unit_price_rial) > 0) return { cost: Number(ln.unit_price_rial), basis: 'خرید (' + pr.receipt_no + ')' };
            }
        }
        if (code === 'BILLET') { const p = Number(cfg.billet_rial_per_kg) || 0; if (p > 0) return { cost: perTon ? Math.round(p * 1000) : p, basis: 'بهای شمش fin_config' }; }
        const m = /^RB-(\d+)$/.exec(code);
        if (m || code === '5SP') {
            const bom = (live.fin_bom || []).find((x) => String(x.size) === String(code === '5SP' ? '5SP' : m[1]));
            if (bom) return { cost: finStdCostPerTon(bom, cfg), basis: 'بهای استاندارد BOM سایز ' + (code === '5SP' ? '5SP' : m[1]) };
        }
        return null;
    }
    /* موتور میانگین موزون متحرک — بازپخش زمانی همهٔ حرکات انبار per کالا */
    function gl23bValuation(live) {
        finSeed(live);
        const items = (Array.isArray(live.inventory_items) ? live.inventory_items : []).filter((x) => x && x.id && x.active !== false);
        const moves = [];
        (Array.isArray(live.inventory_receipts) ? live.inventory_receipts : []).forEach((r) => { if (r && r.item_id) moves.push({ ts: Date.parse(r.timestamp || '') || 0, item_id: r.item_id, dir: 1, qty: Number(r.quantity) || 0, r: r }); });
        (Array.isArray(live.inventory_issues) ? live.inventory_issues : []).forEach((r) => { if (r && r.item_id) moves.push({ ts: Date.parse(r.timestamp || '') || 0, item_id: r.item_id, dir: -1, qty: Number(r.quantity) || 0, r: r }); });
        (Array.isArray(live.inventory_adjustments) ? live.inventory_adjustments : []).forEach((r) => { if (r && r.item_id) moves.push({ ts: Date.parse(r.timestamp || '') || 0, item_id: r.item_id, dir: (Number(r.delta_quantity) || 0) >= 0 ? 1 : -1, qty: Math.abs(Number(r.delta_quantity) || 0), adj: true, r: r }); });
        moves.sort((a, b) => (a.ts - b.ts) || String((a.r && a.r.id) || '').localeCompare(String((b.r && b.r.id) || '')));
        const nrvStore = gl23bEnsureNrv(live);
        const byItem = new Map();
        moves.forEach((mv) => { if (!byItem.has(mv.item_id)) byItem.set(mv.item_id, []); byItem.get(mv.item_id).push(mv); });
        const rows = items.map((item) => {
            let q = 0, avg = 0, inQty = 0, inVal = 0, outQty = 0, outVal = 0, noCost = 0;
            const bases = [];
            (byItem.get(item.id) || []).forEach((mv) => {
                if (mv.dir > 0 && mv.qty > 0) {
                    let cost = null, basis = null;
                    if (!mv.adj) { const rc = gl23bEntryCost(live, item, mv.r); if (rc) { cost = rc.cost; basis = rc.basis; } }
                    if (cost == null) { cost = avg; noCost++; if (!mv.adj && bases.length < 4 && bases.indexOf('بدون بهای صریح — میانگین جاری حفظ شد') === -1) bases.push('بدون بهای صریح — میانگین جاری حفظ شد'); }
                    const val = mv.qty * cost;
                    avg = (q + mv.qty) > 0 ? (q * avg + val) / (q + mv.qty) : cost;
                    q += mv.qty; inQty += mv.qty; inVal += val;
                    if (basis && bases.length < 4 && bases.indexOf(basis) === -1) bases.push(basis);
                } else if (mv.dir < 0 && mv.qty > 0) {
                    const take = Math.min(mv.qty, Math.max(0, q));
                    outQty += take; outVal += take * avg;
                    q = Math.max(0, q - mv.qty); /* خروج: بهای میانگین جاری — میانگین تغییر نمی‌کند */
                }
            });
            const avgR = Math.round(avg);
            const nrvRec = nrvStore.nrv[item.id] || null;
            const nrvPrice = nrvRec ? (Number(nrvRec.price_rial_per_unit) || 0) : null;
            const carryUnit = (nrvPrice != null && nrvPrice > 0 && nrvPrice < avgR) ? nrvPrice : avgR;
            const value = Math.round(q * avgR);
            const carrying = Math.round(q * carryUnit);
            const writeDown = value - carrying;
            const std = gl23bStdOf(live, item);
            return {
                item_id: item.id, code: item.code, name: item.name, unit: item.unit, category: item.category || '—',
                qty: Math.round(q * 1000) / 1000, avg_cost_rial_per_unit: avgR, value_rial: value,
                in_qty: Math.round(inQty * 1000) / 1000, in_value_rial: Math.round(inVal), out_qty: Math.round(outQty * 1000) / 1000, out_value_rial: Math.round(outVal),
                no_cost_entries: noCost, cost_basis: bases,
                nrv: { price_rial_per_unit: nrvPrice, updated_at: nrvRec ? nrvRec.updated_at : null, updated_by: nrvRec ? nrvRec.updated_by : null },
                carrying_rial: carrying, write_down_rial: writeDown, write_down_needed: writeDown > 0,
                suggestion: writeDown > 0 ? {
                    desc: 'کاهش ارزش موجودی ' + item.name + ' به اقل NRV (استاندارد ۸)',
                    lines: [{ account: '520002', title: 'زیان کاهش ارزش موجودی‌ها', debit: writeDown, credit: 0 }, { account: '110007', title: 'ذخیره کاهش ارزش موجودی‌ها', debit: 0, credit: writeDown }],
                    note: 'اجرای خودکار ممنوع — ثبت فقط با تأیید حسابدار از فرم سند دستی'
                } : null,
                alt: { fifo_rial_per_unit: null, std_rial_per_unit: std }
            };
        });
        const active = rows.filter((r) => r.qty !== 0 || r.in_qty > 0 || r.out_qty > 0);
        const totals = {
            value_rial: active.reduce((s, r) => s + r.value_rial, 0),
            carrying_rial: active.reduce((s, r) => s + r.carrying_rial, 0),
            write_down_rial: active.reduce((s, r) => s + r.write_down_rial, 0),
            items_with_stock: active.filter((r) => r.qty !== 0).length,
            nrv_flags: active.filter((r) => r.write_down_needed).length
        };
        return { rows: active, totals: totals };
    }
    /* گزارش ارزش موجودی per انبار / گروه کالا */
    function gl23bByWarehouse(live, val) {
        const avgBy = {}; val.rows.forEach((r) => { avgBy[r.item_id] = r.avg_cost_rial_per_unit; });
        const items = {}; (Array.isArray(live.inventory_items) ? live.inventory_items : []).forEach((i) => { if (i && i.id) items[i.id] = i; });
        const whAgg = {}, catAgg = {};
        invBuildStock(live).forEach((s) => {
            const item = items[s.item_id]; if (!item) return;
            const qty = Number(s.quantity) || 0;
            const valR = Math.round(qty * (avgBy[s.item_id] || 0));
            const wh = s.warehouse || '—';
            if (!whAgg[wh]) whAgg[wh] = { warehouse: wh, warehouse_fa: ({ raw: 'مواد اولیه', product: 'محصول', spare: 'قطعات', quarantine: 'قرنطینه' })[wh] || wh, qty: 0, value_rial: 0 };
            whAgg[wh].qty = Math.round((whAgg[wh].qty + qty) * 1000) / 1000; whAgg[wh].value_rial += valR;
            const cat = item.category || '—';
            if (!catAgg[cat]) catAgg[cat] = { category: cat, qty: 0, value_rial: 0 };
            catAgg[cat].qty = Math.round((catAgg[cat].qty + qty) * 1000) / 1000; catAgg[cat].value_rial += valR;
        });
        return { warehouses: Object.values(whAgg), categories: Object.values(catAgg) };
    }
    /* حساب‌های پیشنهادی کاهش ارزش — افزاینده idempotent (فقط هنگام ذخیرهٔ NRV) */
    function gl23bEnsureAccounts(live) {
        let changed = false;
        const add = (code, title, type) => {
            if ((live.fin_accounts || []).some((a) => a.code === code)) return;
            /* FIX: والد حساب معین (۶رقم) = حساب کل (۳رقم) — نه پیشوند ۶رقمی خود کد */
            const parent = (live.fin_accounts || []).find((a) => a.code === code.slice(0, 3));
            if (!parent) return;
            live.fin_accounts.push({ id: 'facc-' + code + '-23b', code: code, title: title, type: type, level: 3, parent_id: parent.id, active: true });
            changed = true;
        };
        add('110007', 'ذخیره کاهش ارزش موجودی‌ها', 'asset');
        add('520002', 'زیان کاهش ارزش موجودی‌ها', 'expense');
        return changed;
    }
    if (req.method === 'GET' && pathname === '/api/fin/valuation') {
        if (!auth.requireRole(req, FIN_R)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
        const val = gl23bValuation(live);
        const byWh = gl23bByWarehouse(live, val);
        return sendJson(res, {
            ok: true,
            method: 'میانگین موزون متحرک (Weighted Average) — استاندارد ۸ ایران؛ LIFO مجاز نیست؛ ارزیابی نهایی = اقل بهای تمام‌شده و خالص ارزش فروش (NRV)',
            rows: val.rows, totals: val.totals, by_warehouse: byWh.warehouses, by_category: byWh.categories,
            alt_note: 'FIFO فعلاً محاسبه نمی‌شود (فقط زیرساخت نمایش) — بهای استاندارد برای مقایسه از BOM/fin_config.',
            write_down_accounts: { debit: '520002 زیان کاهش ارزش موجودی‌ها', credit: '110007 ذخیره کاهش ارزش موجودی‌ها' },
            generated_at: new Date().toISOString()
        });
    }
    if (req.method === 'PUT' && pathname === '/api/fin/valuation/nrv') {
        if (!auth.requireRole(req, FIN_W)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت NRV فقط برای واحد مالی مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400); }
            const live = readLive(); if (finSeed(live)) writeJson(LIVE_FILE, live);
            const item = (live.inventory_items || []).find((x) => x && x.id === String(b.item_id || ''));
            if (!item) return sendJson(res, { error: 'کالا یافت نشد.' }, 404);
            const store = gl23bEnsureNrv(live);
            if (b.price_rial_per_unit == null || b.price_rial_per_unit === '') {
                delete store.nrv[item.id];
                if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.valuation.nrv.clear', { item: item.code }); return sendJson(res, { ok: true, cleared: true, item: item.code }); }
                return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
            }
            const p = Number(finDigitsEn(String(b.price_rial_per_unit)));
            if (!isFinite(p) || p < 0 || p > 1e12) return sendJson(res, { error: 'قیمت خالص فروش (NRV) باید عددی بین ۰ و ۱۰۱۲ ریال باشد.' }, 400);
            store.nrv[item.id] = { price_rial_per_unit: Math.round(p), updated_at: new Date().toISOString(), updated_by: String((req.user && (req.user.name || req.user.username)) || '') };
            const accAdded = gl23bEnsureAccounts(live);
            if (writeJson(LIVE_FILE, live)) { auditLog(req, 'fin.valuation.nrv.set', { item: item.code, nrv: Math.round(p) }); return sendJson(res, { ok: true, item: item.code, nrv: store.nrv[item.id], accounts_added: accAdded }); }
            return sendJson(res, { error: 'خطا در ذخیره‌سازی.' }, 500);
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }
    // ===== FEAT-GL-23b (end) =====
    // ===== FEAT-FIN-13b (end) =====

    /* ===== endpointهای برنامه‌ریزی ===== */
    if (req.method === 'GET' && pathname === '/api/planning/plans') {
        if (!auth.requireRole(req, PLAN_READ_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز: مشاهدهٔ برنامه‌ریزی برای نقش شما مجاز نیست.' }, 403);
        const live = readLive();
        const plans = (Array.isArray(live.production_plans) ? live.production_plans : []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        plans.forEach((p) => { p.actual_tonnage = planActualTonnage(live, p); });
        return sendJson(res, { ok: true, plans });
    }
    if (req.method === 'POST' && pathname === '/api/planning/plans') {
        if (!auth.requireRole(req, PLAN_WRITE_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت برنامه فقط برای برنامه‌ریز/مدیر مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر: JSON نادرست است.' }, 400); }
            const live = readLive();
            const rid = String(b.request_id || '').slice(0, 64);
            const dup = planSeenRequest(live.production_plans, rid);
            if (dup) { planAudit(req, 'duplicate', { id: dup.id }); return sendJson(res, { ok: true, duplicate: true, plan: dup }); }
            const plan = {
                id: 'plan-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                request_id: rid || null,
                period: ['day', 'shift', 'week'].indexOf(b.period) !== -1 ? b.period : 'day',
                product_size: String(b.product_size || '').trim().slice(0, 24),
                target_tonnage: Math.round((Number(b.target_tonnage) || 0) * 100) / 100,
                required_billets: Number(b.required_billets) > 0 ? Math.round(Number(b.required_billets)) : null,
                machine: String(b.machine || 'st-form').slice(0, 40),
                shift_id: ['shift-morning-301', 'shift-night-302'].indexOf(b.shift_id) !== -1 ? b.shift_id : null,
                start_date_j: String(b.start_date_j || '').trim().slice(0, 10),
                start_ts: String(b.start_ts || '').trim(),
                status: 'draft',
                priority: ['low', 'medium', 'high'].indexOf(b.priority) !== -1 ? b.priority : 'medium',
                source: ['manual', 'smart', 'ai'].indexOf(b.source) !== -1 ? b.source : 'manual',
                smart_meta: b.smart_meta && typeof b.smart_meta === 'object' ? { confidence: Number(b.smart_meta.confidence) || null, reasons: Array.isArray(b.smart_meta.reasons) ? b.smart_meta.reasons.slice(0, 8) : [], based_on: String(b.smart_meta.based_on || '').slice(0, 200), engine: String(b.smart_meta.engine || '').slice(0, 40) } : null,
                notes: String(b.notes || '').slice(0, 400),
                created_by: (req.user && (req.user.name || req.user.username)) || '?',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            if (!plan.product_size || !(plan.target_tonnage > 0)) return sendJson(res, { error: 'سایز محصول و تناژ هدف (بزرگ‌تر از صفر) الزامی است.' }, 400);
            live.production_plans = Array.isArray(live.production_plans) ? live.production_plans : [];
            live.production_plans.push(plan);
            live.generated_at = new Date().toISOString();
            writeJson(LIVE_FILE, live);
            cache.data = null; cache.at = 0;
            planAudit(req, 'create', { id: plan.id, size: plan.product_size, target: plan.target_tonnage, source: plan.source });
            return sendJson(res, { ok: true, plan }, 201);
        }).catch((e) => sendJson(res, { error: 'خطا در ثبت برنامه: ' + (e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'PUT' && pathname === '/api/planning/plans') {
        if (!auth.requireRole(req, Array.from(new Set(PLAN_WRITE_ROLES.concat(['supervisor']))))) return sendJson(res, { error: 'دسترسی غیرمجاز: ویرایش برنامه مجاز نیست.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر: JSON نادرست است.' }, 400); }
            const live = readLive();
            live.production_plans = Array.isArray(live.production_plans) ? live.production_plans : [];
            const p = live.production_plans.find((x) => x.id === String(b.id || '')); if (!p) return sendJson(res, { error: 'برنامهٔ موردنظر یافت نشد.' }, 404);
            const role = String((req.user && req.user.role) || 'viewer');
            const action = String(b.action || 'update');
            const canWrite = PLAN_WRITE_ROLES.indexOf(role) !== -1;
            if (action === 'start') {
                if (!(canWrite || role === 'supervisor')) return sendJson(res, { error: 'فقط سرپرست/برنامه‌ریز/مدیر می‌تواند برنامه را «در حال اجرا» کند.' }, 403);
                if (p.status !== 'approved') return sendJson(res, { error: 'فقط برنامهٔ «تأییدشده» قابل شروع است.' }, 400);
                p.status = 'in_progress';
            } else if (action === 'approve') {
                if (!canWrite) return sendJson(res, { error: 'تأیید برنامه فقط برای برنامه‌ریز/مدیر مجاز است.' }, 403);
                if (p.status !== 'draft') return sendJson(res, { error: 'فقط برنامهٔ پیش‌نویس قابل تأیید است.' }, 400);
                p.status = 'approved';
            } else if (action === 'complete') {
                if (!canWrite) return sendJson(res, { error: 'تکمیل برنامه فقط برای برنامه‌ریز/مدیر مجاز است.' }, 403);
                if (p.status !== 'in_progress') return sendJson(res, { error: 'فقط برنامهٔ «در حال اجرا» قابل تکمیل است.' }, 400);
                p.status = 'done';
            } else if (action === 'cancel') {
                if (!canWrite) return sendJson(res, { error: 'لغو برنامه فقط برای برنامه‌ریز/مدیر مجاز است.' }, 403);
                if (p.status === 'done') return sendJson(res, { error: 'برنامهٔ تکمیل‌شده قابل لغو نیست.' }, 400);
                p.status = 'cancelled';
            } else {
                if (!canWrite) return sendJson(res, { error: 'ویرایش برنامه فقط برای برنامه‌ریز/مدیر مجاز است.' }, 403);
                if (p.status !== 'draft') return sendJson(res, { error: 'فقط برنامهٔ پیش‌نویس قابل ویرایش است.' }, 400);
                if (b.target_tonnage !== undefined) p.target_tonnage = Math.round((Number(b.target_tonnage) || 0) * 100) / 100;
                if (b.required_billets !== undefined) p.required_billets = Number(b.required_billets) > 0 ? Math.round(Number(b.required_billets)) : null;
                if (b.priority !== undefined && ['low', 'medium', 'high'].indexOf(b.priority) !== -1) p.priority = b.priority;
                if (b.shift_id !== undefined && ['shift-morning-301', 'shift-night-302'].indexOf(b.shift_id) !== -1) p.shift_id = b.shift_id;
                if (b.notes !== undefined) p.notes = String(b.notes).slice(0, 400);
                if (!(p.target_tonnage > 0)) return sendJson(res, { error: 'تناژ هدف باید بزرگ‌تر از صفر باشد.' }, 400);
            }
            p.updated_at = new Date().toISOString();
            live.generated_at = new Date().toISOString();
            writeJson(LIVE_FILE, live);
            cache.data = null; cache.at = 0;
            planAudit(req, action, { id: p.id, by: role });
            return sendJson(res, { ok: true, plan: p });
        }).catch((e) => sendJson(res, { error: 'خطا در ویرایش برنامه: ' + (e && e.message ? e.message : e) }, 500));
        return;
    }
    if (req.method === 'GET' && pathname === '/api/planning/suggest') {
        if (!auth.requireRole(req, PLAN_READ_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز: پیشنهاد هوشمند برای نقش شما مجاز نیست.' }, 403);
        const live = readLive();
        const internal = planningEngineInternal(live);
        planningEngineExternal(live, internal).then((ai) => {
            const used = ai && ai.length ? { engine: 'ai', suggestions: ai } : { engine: (process.env.AI_PLANNING_URL ? 'internal (fallback)' : 'internal'), suggestions: internal.suggestions };
            return sendJson(res, { ok: true, generated_at: new Date().toISOString(), ai_configured: !!(process.env.AI_PLANNING_URL && typeof fetch === 'function'), engine: used.engine, suggestions: used.suggestions, meta: internal.meta });
        }).catch(() => sendJson(res, { ok: true, generated_at: new Date().toISOString(), ai_configured: !!(process.env.AI_PLANNING_URL && typeof fetch === 'function'), engine: 'internal', suggestions: internal.suggestions, meta: internal.meta }));
        return;
    }
    /* ===== FEAT-PLAN-9c (begin): موتور APS سناریو-محور — افزاینده، مستقل از موتور قبلی ===== */
    function planApsStats(live) {
        const now = Date.now();
        const dAgo = (n) => new Date(now - n * 86400000).toISOString();
        const d90 = dAgo(90), d30 = dAgo(30);
        const rounds = (x) => Math.round((Number(x) || 0) * 100) / 100;
        const RE_MIN = 6, RE_MAX = 50;
        /* نرخ واقعی ۹۰ روزه per سایز */
        const sizes = {};
        const bump = (k) => (sizes[k] = sizes[k] || { kg: 0, bars: 0, daysMap: {} });
        const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
        (Array.isArray(live.rebar_bundles) ? live.rebar_bundles : []).forEach((b) => {
            const t = Date.parse(b.produced_at || ''); if (isNaN(t) || t < d90) return;
            const nn = Number(b.rebar_size); const g = String(b.rebar_grade || '');
            let k = null;
            if (nn >= RE_MIN && nn <= RE_MAX) k = 'RB-' + nn; else if (g === '5SP') k = '5SP';
            if (!k) return;
            const s = bump(k); s.kg += Number(b.net_weight_kg) || 0; s.daysMap[dayOf(t)] = 1;
        });
        (Array.isArray(live.production_logs) ? live.production_logs : []).forEach((p) => {
            const t = Date.parse(p.timestamp || ''); if (isNaN(t) || t < d90) return;
            const pid = String(p.product_id || ''); if (!pid) return;
            const m = /^RB-(\d+)$/.exec(pid); const nn = m ? Number(m[1]) : NaN;
            if (Number.isFinite(nn) && nn >= RE_MIN && nn <= RE_MAX) {
                const s = bump('RB-' + nn); const q = Number(p.good_quantity) || 0;
                s.bars += q; s.kg += q * 0.0061654 * nn * nn * 12; s.daysMap[dayOf(t)] = 1;
            } else if (pid === '5SP') { const s = bump('5SP'); s.bars += Number(p.good_quantity) || 0; s.daysMap[dayOf(t)] = 1; }
        });
        /* COLDSTART-35: روزهای واقعی ثبت تولید (اتحاد روزهای همهٔ سایزها) — معیار آستانهٔ شروع سرد */
        const prodDaysSet35 = {};
        Object.keys(sizes).forEach((k) => { Object.keys(sizes[k].daysMap).forEach((d) => { prodDaysSet35[d] = 1; }); });
        Object.keys(sizes).forEach((k) => { const s = sizes[k]; s.days = Math.max(1, Object.keys(s.daysMap).length); s.kgPerDay = s.kg / s.days; delete s.daysMap; });
        /* ضایعات ۳۰ روزه */
        let wasteKg = 0;
        (Array.isArray(live.waste_logs) ? live.waste_logs : []).forEach((w) => { const t = Date.parse(w.timestamp || ''); if (isNaN(t) || t < d30) return; wasteKg += wasteKgOf26a(w); }); /* FIX-WASTE-26a: تناژ وزنی — legacy حذف از جمع */
        let prodKg = 0; Object.keys(sizes).forEach((k) => { prodKg += sizes[k].kg; });
        const wastePct = (prodKg + wasteKg) > 0 ? Math.min(20, wasteKg / (prodKg + wasteKg) * 100) : 3;
        /* پذیرش QC (آستانه‌های A3: ReH≥400 / Rm≥600 / A≥14) */
        let qcPass = 0, qcAll = 0;
        (Array.isArray(live.quality_inspections) ? live.quality_inspections : []).forEach((q) => {
            const t = Date.parse(q.timestamp || ''); if (isNaN(t) || t < d90) return;
            qcAll++;
            const reh = Number(q.yield_strength) || 0, rm = Number(q.tensile_strength) || 0, a = Number(q.elongation_percent) || 0;
            if (reh >= 400 && rm >= 600 && a >= 14) qcPass++;
        });
        const qcPassPct = qcAll ? qcPass / qcAll : 0.95;
        /* الگوی اختلال برق */
        let elecMin = 0; const daysSeen = {};
        (Array.isArray(live.downtime_logs) ? live.downtime_logs : []).forEach((r) => {
            const t = Date.parse(r.start_time || ''); if (isNaN(t) || t < d90) return;
            daysSeen[dayOf(t)] = 1;
            const rid = String(r.reason_id || '').toLowerCase();
            if (rid.indexOf('electr') !== -1 || rid.indexOf('power') !== -1) elecMin += Number(r.duration_minutes) || 0;
        });
        const elecPctDay = Math.min(25, (elecMin / Math.max(1, Object.keys(daysSeen).length)) / 720 * 100);
        /* قطعی برق ثبت‌شدهٔ ۷ روز آینده per شیفت */
        const outageByShift = { any: 0, 'shift-morning-301': 0, 'shift-night-302': 0 };
        const outageNotes = [];
        (Array.isArray(live.power_outages) ? live.power_outages : []).forEach((o) => {
            const t = Date.parse(o.start_ts || ''); if (isNaN(t) || t < now || t > now + 7 * 86400000) return;
            const h = Number(o.duration_hours) || 0;
            const k = outageByShift[o.shift_id] !== undefined ? o.shift_id : 'any';
            outageByShift[k] += h; if (k === 'any') { outageByShift['shift-morning-301'] += h; outageByShift['shift-night-302'] += h; }
            outageNotes.push((o.shift_id === 'shift-night-302' ? 'شیفت شب' : 'شیفت صبح') + ' — ' + fa(h) + ' ساعت' + (o.note ? ' (' + String(o.note).slice(0, 24) + ')' : ''));
        });
        /* PM هفتهٔ پیش‌رو */
        let pmCut = 0; const pmSeen = {}; const pmNotes = [];
        (Array.isArray(live.pm_plans) ? live.pm_plans : []).forEach((p) => {
            const last = p.last_done ? planJalaliToTs(p.last_done, 6) : null; if (!last) return;
            const due = Date.parse(last) + (Number(p.interval_days) || 30) * 86400000;
            const key = String(p.title || p.machine_id || '');
            if (due >= now && due <= now + 7 * 86400000 && !pmSeen[key]) { pmSeen[key] = 1; pmCut = Math.min(15, pmCut + 4); pmNotes.push(key); }
        });
        /* موجودی شمش انبار */
        let rawAvailKg = 0;
        const items = Array.isArray(live.inventory_items) ? live.inventory_items : [];
        const rawIds = {};
        items.forEach((it) => {
            const hay = String((it.name || '') + ' ' + (it.code || '') + ' ' + (it.category || '')).toLowerCase();
            if (hay.indexOf('شمش') !== -1 || hay.indexOf('بیلت') !== -1 || hay.indexOf('billet') !== -1) rawIds[it.id] = 1;
        });
        if (Object.keys(rawIds).length) {
            const sm = (arr, f) => (Array.isArray(arr) ? arr : []).reduce((s, r) => s + (rawIds[r.item_id] ? (Number(f(r)) || 0) : 0), 0);
            rawAvailKg = Math.max(0, sm(live.inventory_receipts, (r) => r.quantity) - sm(live.inventory_issues, (r) => r.quantity) + sm(live.inventory_adjustments, (r) => r.delta_quantity));
        }
        let bAvg = 0, bN = 0;
        (Array.isArray(live.billets) ? live.billets : []).forEach((b) => { const w = Number(b.initial_weight_kg) || 0; if (w > 0) { bAvg += w; bN++; } });
        const billetAvgKg = bN ? Math.round(bAvg / bN) : 0;
        /* نیروی انسانی شیفت (اپراتورهای متمایز ۳۰ روز اخیر) */
        const opsByShift = { 'shift-morning-301': {}, 'shift-night-302': {} };
        (Array.isArray(live.production_logs) ? live.production_logs : []).forEach((p) => {
            const t = Date.parse(p.timestamp || ''); if (isNaN(t) || t < d30) return;
            const sh = String(p.shift_id || ''); if (!opsByShift[sh]) return;
            const op = String(p.operator_id || '').trim(); if (op) opsByShift[sh][op] = 1;
        });
        const opsMorning = Object.keys(opsByShift['shift-morning-301']).length;
        const opsNight = Object.keys(opsByShift['shift-night-302']).length;
        const opsMax = Math.max(opsMorning, opsNight, 1);
        const manpower = {
            'shift-morning-301': { n: opsMorning, factor: opsMorning ? Math.min(1, 0.7 + 0.3 * opsMorning / opsMax) : 0.85 },
            'shift-night-302': { n: opsNight, factor: opsNight ? Math.min(1, 0.7 + 0.3 * opsNight / opsMax) : 0.85 }
        };
        /* تقاضای باز (برنامه‌های فعال) per سایز */
        const demandKg = {};
        let demandTotalKg = 0;
        (Array.isArray(live.production_plans) ? live.production_plans : []).forEach((p) => {
            if (p.status !== 'approved' && p.status !== 'in_progress') return;
            const k = String(p.product_size || ''); if (!k) return;
            const tg = (Number(p.target_tonnage) || 0) * 1000;
            const ac = (Number(p.actual_tonnage) || 0) * 1000;
            demandKg[k] = (demandKg[k] || 0) + Math.max(0, tg - ac);
            demandTotalKg += Math.max(0, tg - ac);
        });
        return { sizes, wastePct: rounds(wastePct), qcPassPct: rounds(qcPassPct * 100) / 100, elecPctDay: rounds(elecPctDay), outageByShift, outageNotes, pmCut, pmNotes, rawAvailKg: rounds(rawAvailKg), billetAvgKg, manpower, demandKg, demandTotalKg: rounds(demandTotalKg), obsDays: Math.max(1, Object.keys(daysSeen).length), prodDays: Object.keys(prodDaysSet35).length }; /* COLDSTART-35: +prodDays */
    }

    function planApsMulberry32(seed) {
        let a = seed >>> 0;
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function planApsGauss(rnd) { /* Box–Muller ساده */
        let u = 0, v = 0;
        while (u === 0) u = rnd(); while (v === 0) v = rnd();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }

    function planApsScenarios(live) {
        const st = planApsStats(live);
        const rounds = (x) => Math.round((Number(x) || 0) * 100) / 100;
        const keyFa = (k) => (String(k).indexOf('RB-') === 0 ? 'میلگرد سایز ' + k.slice(3) : (k === '5SP' ? 'میلگرد گرید 5SP' : k));
        const cold35 = (Number(st.prodDays) || 0) < COLD_MIN_DAYS_35; /* COLDSTART-35 */
        let sizeKeys = Object.keys(st.sizes).filter((k) => st.sizes[k].kg > 0);
        let totalKg = sizeKeys.reduce((s, k) => s + st.sizes[k].kg, 0);
        /* COLDSTART-35 (begin): شروع سرد — نرخ اسمی مهندسی جایگزین نرخ واقعی؛ سایزهای تقاضای باز هم پوشش داده می‌شوند */
        let engRate35 = null;
        if (cold35) {
            engRate35 = {};
            Object.keys(COLD_MIX_35).forEach((k) => { engRate35[k] = 0; });
            Object.keys(st.demandKg || {}).forEach((k) => { if ((st.demandKg[k] || 0) > 0 && COLD_RATE_TON_35[k]) engRate35[k] = 0; });
            Object.keys(engRate35).forEach((k) => { engRate35[k] = COLD_RATE_TON_35[k] * 1000; }); /* kg/روز اسمی */
            sizeKeys = Object.keys(engRate35);
            totalKg = sizeKeys.reduce((s, k) => s + engRate35[k], 0);
        }
        const sizesEff35 = cold35 ? (function () { const o35 = {}; sizeKeys.forEach((k) => { o35[k] = { kg: engRate35[k], kgPerDay: engRate35[k] }; }); return o35; })() : st.sizes;
        /* COLDSTART-35 (end) */
        if (!sizeKeys.length) {
            return { engine: 'internal-aps', generated_at: new Date().toISOString(), horizon_days: 7, scenarios: [], meta: Object.assign({ empty: true }, st), ai_configured: !!(process.env.AI_PLANNING_URL && typeof fetch === 'function'), ai_note: null, reasons_hint: ['تا امروز تولیدی با سایز استاندارد میلگرد (۶ تا ۵۰) یا گرید 5SP ثبت نشده است؛ با ثبت تولید، سناریوها ساخته می‌شوند.'] };
        }
        /* ظرفیت per شیفت */
        const shiftCap = {};
        ['shift-morning-301', 'shift-night-302'].forEach((sh) => {
            const oc = Math.min(50, (st.outageByShift[sh] || 0) / 12 * 100);
            const mp = st.manpower[sh] || { factor: 0.85, n: 0 };
            const cap = Math.max(0.35, 1 - st.elecPctDay / 100 - oc / 100 - st.pmCut / 100) * mp.factor;
            shiftCap[sh] = { cap, outagePct: rounds(oc), manpowerN: mp.n };
        });
        const capAvg = (shiftCap['shift-morning-301'].cap + shiftCap['shift-night-302'].cap) / 2;
        /* سهم ترکیب per سناریو */
        const shareProp = {}; sizeKeys.forEach((k) => { shareProp[k] = sizesEff35[k].kg / totalKg; }); /* COLDSTART-35: سایز مؤثر */
        const demandKeys = Object.keys(st.demandKg).filter((k) => st.demandKg[k] > 0);
        const demandTotal = demandKeys.reduce((s, k) => s + st.demandKg[k], 0);
        const shareDemand = {}; if (demandTotal > 0) demandKeys.forEach((k) => { shareDemand[k] = st.demandKg[k] / demandTotal; });
        const shareDiverse = {}; sizeKeys.slice().sort((a, b) => sizesEff35[b].kg - sizesEff35[a].kg).slice(0, 3).forEach((k) => { shareDiverse[k] = 1 / Math.min(3, sizeKeys.length); }); /* COLDSTART-35: سایز مؤثر */
        const SCEN = [
            { id: 'aps-conservative', kind: 'conservative', title: 'سناریو محافظه‌کار', util: 0.75, share: shareProp, nightShare: 0.3, riskBase: 15, note: '۷۵٪ ظرفیت عملی — اولویت تحقق مطمئن' },
            { id: 'aps-balanced', kind: 'balanced', title: 'سناریو متعادل', util: 0.9, share: shareProp, nightShare: 0.5, riskBase: 30, note: '۹۰٪ ظرفیت عملی — توازن تناژ و ریسک' },
            { id: 'aps-aggressive', kind: 'aggressive', title: 'سناریو تهاجمی', util: 1.08, share: shareProp, nightShare: 0.55, riskBase: 55, note: '۱۰۸٪ ظرفیت عملی — حداکثر تناژ با ریسک بیشتر' },
            { id: 'aps-demand', kind: 'demand', title: 'سناریو تمرکز بر تقاضا', util: 0.9, share: demandTotal > 0 ? shareDemand : shareProp, nightShare: 0.45, riskBase: 35, note: 'ترکیب سایزها هم‌تراز برنامه‌های فعال/تقاضای باز' },
            { id: 'aps-diversified', kind: 'diversified', title: 'سناریو ترکیب متنوع', util: 0.85, share: shareDiverse, nightShare: 0.5, riskBase: 25, note: 'پراکندگی سایزها برای کاهش ریسک بازار' }
        ];
        const MC_N = 220;
        const scenarios = SCEN.map((sc, idx) => {
            const wCap = (1 - sc.nightShare) * shiftCap['shift-morning-301'].cap + sc.nightShare * shiftCap['shift-night-302'].cap; /* FEAT-PLAN-9c: Ø³ÙÙ Ø´ÛÙØª per Ø³ÙØ§Ø±ÛÙ */
            const shareSum = Object.keys(sc.share).reduce((s, k) => s + sc.share[k], 0) || 1;
            const mix = sizeKeys.map((k) => {
                const share = (sc.share[k] || 0) / shareSum;
                const dailyKg = sizesEff35[k].kgPerDay * sc.util * wCap * share; /* COLDSTART-35: سایز مؤثر */
                return { size: k, share: rounds(share * 100) / 100, daily_tonnage: rounds(dailyKg / 1000) };
            }).filter((m) => m.daily_tonnage > 0.01).sort((a, b) => b.daily_tonnage - a.daily_tonnage);
            const baseDailyKg = mix.reduce((s, m) => s + m.daily_tonnage * 1000, 0);
            const healthyFactor = (1 - st.wastePct / 100) * st.qcPassPct;
            const baseHealthyTon = baseDailyKg * healthyFactor * 7 / 1000;
            /* مونت‌کارلو ۲۲۰ تکرار */
            const rnd = planApsMulberry32(1405 + idx * 977);
            const iters = [];
            for (let i = 0; i < MC_N; i++) {
                const nRate = Math.max(0.55, 1 + planApsGauss(rnd) * 0.08);
                const nWaste = Math.max(0.4, 1 + planApsGauss(rnd) * 0.2);
                const nOut = Math.max(0.6, 1 + planApsGauss(rnd) * 0.3);
                const nQc = Math.max(0.75, 1 + planApsGauss(rnd) * 0.04);
                const outPen = 1 - (Math.min(50, (st.outageByShift['shift-morning-301'] + st.outageByShift['shift-night-302']) / 12 * 100) / 100) * nOut;
                const h = baseDailyKg * nRate * Math.max(0.3, outPen) * (1 - Math.min(20, st.wastePct * nWaste) / 100) * st.qcPassPct * nQc * 7 / 1000;
                iters.push(h);
            }
            iters.sort((a, b) => a - b);
            const q = (p) => iters[Math.min(MC_N - 1, Math.max(0, Math.round(p * (MC_N - 1))))];
            const p10 = q(0.1), p50 = q(0.5), p90 = q(0.9);
            const commit = Math.max(0.1, rounds(baseHealthyTon));
            let conf = Math.round(iters.filter((h) => h >= commit).length / MC_N * 100);
            if (cold35) conf = Math.min(conf, COLD_CONF_CAP_35); /* COLDSTART-35: اطمینان پایین — صداقت با مدیر */
            /* شمش */
            const healthyKg = baseHealthyTon * 1000;
            const reqBillets = st.billetAvgKg > 50 ? Math.ceil(healthyKg / st.billetAvgKg) : null;
            const availBillets = (st.billetAvgKg > 50 && st.rawAvailKg > 0) ? Math.floor(st.rawAvailKg / st.billetAvgKg) : null;
            const shortage = reqBillets != null && availBillets != null && reqBillets > availBillets;
            let healthyCapped = baseHealthyTon;
            if (shortage && availBillets != null && !cold35) healthyCapped = Math.min(baseHealthyTon, availBillets * st.billetAvgKg / 1000); /* COLDSTART-35: شروع سرد — سناریو کپ نمی‌شود؛ پرچم فقط با دادهٔ واقعی انبار */
            /* KPIها */
            const wasteKg = healthyCapped > 0 ? healthyCapped * 1000 * (st.wastePct / 100) / (1 - st.wastePct / 100) : 0;
            const oee = Math.round(capAvg * Math.min(1, sc.util) * st.qcPassPct * 1000) / 10;
            const risk = Math.max(5, Math.min(95, Math.round(sc.riskBase + (shiftCap['shift-night-302'].outagePct * sc.nightShare + shiftCap['shift-morning-301'].outagePct * (1 - sc.nightShare)) * 1.2 + st.pmCut * 1.5 + st.elecPctDay + (shortage ? 20 : 0) + ((shiftCap['shift-morning-301'].manpowerN < 2 || shiftCap['shift-night-302'].manpowerN < 2) ? 10 : 0))));
            const fulfill = st.demandTotalKg > 0 ? Math.round(Math.min(250, healthyCapped * 1000 / st.demandTotalKg * 1000) / 10) : null;
            /* دلایل فارسی قالبی */
            const reasons = [];
            if (cold35) reasons.push('🧊 شروع سرد — دادهٔ واقعی کافی نیست (' + fa(st.prodDays) + ' روز از ' + fa(COLD_MIN_DAYS_35) + ' روز آستانه)؛ بر پایهٔ مهندسی: نرخ اسمی per سایز، ضایعات استاندارد و OEE هدف — با ثبت واقعی خودکالیبره می‌شود'); /* COLDSTART-35 */
            reasons.push((cold35 ? 'پایهٔ مهندسی: نرخ اسمی ' : 'پایه: نرخ واقعی ۹۰ روزهٔ ') + mix.slice(0, 2).map((m) => keyFa(m.size) + ' (' + fa(m.daily_tonnage) + ' تن/روز)').join(' + ')); /* COLDSTART-35: برچسب صادق منبع نرخ */
            reasons.push('ظرفیت شیفت با احتساب اختلال برق (' + fa(st.elecPctDay) + '٪)، قطعی ثبت‌شده و PM: ' + fa(Math.round(capAvg * 100)) + '٪');
            if (st.outageNotes.length) reasons.push('قطعی برنامه‌ریزی‌شدهٔ ۷ روز آینده: ' + st.outageNotes.slice(0, 2).join('، '));
            if (st.pmNotes.length) reasons.push('PM سررسیدی هفتهٔ پیش‌رو: ' + st.pmNotes.slice(0, 2).join('، '));
            reasons.push('ضایعات ۳۰ روزهٔ ' + fa(st.wastePct) + '٪ و پذیرش QC ' + fa(Math.round(st.qcPassPct * 100)) + '٪ در تناژ سالم لحاظ شد');
            if (st.manpower['shift-morning-301'].n || st.manpower['shift-night-302'].n) reasons.push('نیروی انسانی شیفت‌ها: ' + fa(shiftCap['shift-morning-301'].manpowerN) + ' صبح / ' + fa(shiftCap['shift-night-302'].manpowerN) + ' شب');
            if (shortage) reasons.push('پرچم کمبود: شمش لازم ' + fa(reqBillets) + ' در برابر موجودی ' + fa(availBillets) + (cold35 ? ' — شروع سرد: کپ نمی‌شود، فقط هشدار' : ' — تناژ به سقف موجودی کپ شد')); /* COLDSTART-35 */
            else if (st.rawAvailKg > 0) reasons.push('موجودی شمش قابل‌مصرف: ' + fa(rounds(st.rawAvailKg / 1000)) + ' تن — محدودیتی نیست');
            else reasons.push(cold35 ? 'پایهٔ مهندسی: شمش در دسترس فرض شد (انبار پنهان/خالی است) — پرچم کمبود فقط با دادهٔ واقعی انبار زده می‌شود' : 'موجودی شمش در انبار ثبت نشده؛ محدودیت شمش اعمال نشد'); /* COLDSTART-35 */
            reasons.push('مونت‌کارلو ' + fa(MC_N) + ' تکرار: اطمینان ' + fa(conf) + '٪ برای تعهد ' + fa(commit) + ' تن — بازهٔ ' + fa(rounds(p10)) + ' تا ' + fa(rounds(p90)) + ' تن');
            reasons.push(sc.note);
            /* پیش‌نمایش اعمال (دو سایز برتر ترکیب) */
            const apply = mix.slice(0, 2).map((m, i) => ({
                title: sc.title + ' — ' + keyFa(m.size),
                period: 'day', product_size: m.size,
                target_tonnage: Math.max(0.1, rounds(m.daily_tonnage * healthyFactor * (7 / (i === 0 ? 7 : 7)))),
                required_billets: st.billetAvgKg > 50 ? Math.ceil(m.daily_tonnage * 1000 * 7 / st.billetAvgKg) : null,
                machine: 'st-form', shift_id: i === 0 ? 'shift-morning-301' : 'shift-night-302',
                priority: sc.kind === 'aggressive' ? 'high' : (sc.kind === 'conservative' ? 'low' : 'medium'),
                confidence: conf, reasons: reasons.slice(0, 6),
                engine: 'internal', based_on: 'APS: نرخ ۹۰روزه + قطعی برق + PM + شمش + نیروی انسانی + مونت‌کارلو ' + MC_N
            }));
            return {
                id: sc.id, kind: sc.kind, title: sc.title, horizon_days: 7,
                mix: mix, kpis: {
                    healthy_tonnage_p50: rounds(p50), healthy_tonnage_p10: rounds(p10), healthy_tonnage_p90: rounds(p90),
                    committed_tonnage: commit, expected_waste_kg: Math.round(wasteKg), oee_pct: oee,
                    risk: risk, shortage: shortage, required_billets: reqBillets, available_billets: availBillets,
                    fulfillment_pct: fulfill, confidence_mc_pct: conf, basis: cold35 ? 'engineering' : 'observed' /* COLDSTART-35 */
                },
                reasons: reasons.slice(0, 8), apply: apply,
                engine: 'internal', based_on: 'APS ۷روزه — مونت‌کارلو ' + MC_N + ' تکرار' + (cold35 ? ' — پایهٔ مهندسی (شروع سرد)' : '')
            };
        });
        return { engine: 'internal-aps', generated_at: new Date().toISOString(), horizon_days: 7, scenarios: scenarios, meta: st, ai_configured: !!(process.env.AI_PLANNING_URL && typeof fetch === 'function'), ai_note: null, mode: cold35 ? 'cold-start' : 'normal', mode_label: cold35 ? '🧊 شروع سرد — با ثبت واقعی خودکالیبره می‌شود' : '', calibrate: { days: Number(st.prodDays) || 0, threshold: COLD_MIN_DAYS_35 } }; /* COLDSTART-35: حالت + آستانهٔ خودکالیبره */
    }

    /* توضیح اختیاری AI (غیرمسدودکننده) — کش per هش داده */
    let apsAiCache = { hash: '', note: null };
    function planApsDataHash(live) {
        const n = (a) => (Array.isArray(a) ? a.length : 0);
        return [n(live.production_logs), n(live.rebar_bundles), n(live.power_outages), n(live.production_plans), n(live.pm_plans), n(live.waste_logs), Math.round((live.generated_at ? String(live.generated_at).length : 0) / 7)].join(':');
    }
    function planApsAiNoteAsync(live, scenarios) {
        const url = process.env.AI_PLANNING_URL;
        const key = process.env.AI_PLANNING_KEY || '';
        if (!url || typeof fetch !== 'function' || !scenarios.length) return;
        const hash = planApsDataHash(live);
        if (apsAiCache.hash === hash) return;
        const prompt = 'برنامه‌ریز تولید فولاد. خلاصهٔ کوتاه فارسی (حداکثر ۳ جمله) از این سناریوهای APS برای مدیر تولید بنویس: ' + JSON.stringify(scenarios.map((s) => ({ title: s.title, p50: s.kpis.healthy_tonnage_p50, risk: s.kpis.risk, oee: s.kpis.oee_pct, conf: s.kpis.confidence_mc_pct })));
        const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = setTimeout(() => { try { ctrl && ctrl.abort(); } catch (e) { } }, 8000);
        fetch(url, {
            method: 'POST', signal: ctrl ? ctrl.signal : undefined,
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({ model: process.env.AI_PLANNING_MODEL || 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.3 })
        }).then((r) => (r.ok ? r.json() : null)).then((j) => {
            clearTimeout(timer);
            const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || '').slice(0, 600) : null;
            apsAiCache = { hash: hash, note: txt };
        }).catch(() => { clearTimeout(timer); apsAiCache = { hash: hash, note: null }; });
    }

    if (req.method === 'GET' && pathname === '/api/planning/scenarios') {
        if (!auth.requireRole(req, PLAN_READ_ROLES)) return sendJson(res, { error: 'دسترسی مجاز نیست.' }, 403);
        const live = readLive();
        const aps = planApsScenarios(live);
        if (aps.ai_configured && aps.scenarios.length) {
            if (apsAiCache.hash === planApsDataHash(live) && apsAiCache.note) aps.ai_note = apsAiCache.note;
            else planApsAiNoteAsync(live, aps.scenarios);
        }
        planAudit(req, 'scenarios', { count: aps.scenarios.length });
        return sendJson(res, aps);
    }
    /* ===== FEAT-PLAN-9c (end) ===== */

    if (req.method === 'GET' && pathname === '/api/planning/outage') {
        if (!auth.requireRole(req, PLAN_READ_ROLES)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = readLive();
        const manual = (Array.isArray(live.power_outages) ? live.power_outages : []).slice().sort((a, b) => String(b.start_ts || '').localeCompare(String(a.start_ts || ''))).slice(0, 50);
        let elecMin = 0, elecCount = 0;
        (Array.isArray(live.downtime_logs) ? live.downtime_logs : []).forEach((r) => {
            const rid = String(r.reason_id || '').toLowerCase();
            if (rid.indexOf('electr') !== -1 || rid.indexOf('power') !== -1) { elecMin += Number(r.duration_minutes) || 0; elecCount++; }
        });
        return sendJson(res, { ok: true, manual, pattern: { count: elecCount, minutes: elecMin } });
    }
    if (req.method === 'POST' && pathname === '/api/planning/outage') {
        if (!auth.requireRole(req, PLAN_WRITE_ROLES)) return sendJson(res, { error: 'ثبت قطعی برق فقط برای برنامه‌ریز/مدیر مجاز است.' }, 403);
        readBody(req).then((body) => {
            let b = {}; try { b = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'دادهٔ نامعتبر: JSON نادرست است.' }, 400); }
            const live = readLive();
            live.power_outages = Array.isArray(live.power_outages) ? live.power_outages : [];
            const rid = String(b.request_id || '').slice(0, 64);
            const dup = planSeenRequest(live.power_outages, rid);
            if (dup) { planAudit(req, 'outage-duplicate', { id: dup.id }); return sendJson(res, { ok: true, duplicate: true, outage: dup }); }
            const ts = Date.parse(String(b.start_ts || ''));
            if (isNaN(ts)) return sendJson(res, { error: 'تاریخ و ساعت شروع قطعی نامعتبر است.' }, 400);
            const o = {
                id: 'out-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                request_id: rid || null,
                start_ts: new Date(ts).toISOString(),
                duration_hours: Math.min(24, Math.max(0.5, Number(b.duration_hours) || 1)),
                shift_id: ['shift-morning-301', 'shift-night-302'].indexOf(b.shift_id) !== -1 ? b.shift_id : null,
                scope: 'shift',
                note: String(b.note || '').slice(0, 200),
                created_by: (req.user && (req.user.name || req.user.username)) || '?',
                created_at: new Date().toISOString()
            };
            live.power_outages.push(o);
            live.generated_at = new Date().toISOString();
            writeJson(LIVE_FILE, live);
            cache.data = null; cache.at = 0;
            planAudit(req, 'outage-create', { id: o.id, hours: o.duration_hours });
            return sendJson(res, { ok: true, outage: o }, 201);
        }).catch((e) => sendJson(res, { error: 'خطا در ثبت قطعی: ' + (e && e.message ? e.message : e) }, 500));
        return;
    }
    // ===== FEAT-PLAN-7 (end) =====

    // ===== FIX-INV-0-HARDENING: حذف endpoint تکراری مرده (نسخهٔ دوم POST /api/entry/quality) =====

    // ===== ✅ ADDITIVE — W5: ثبت تعمیرات/PM + برنامهٔ PM =====
    // ================================================================
    // INDUSTRIALFY — Maintenance / PM v2
    // تعمیرات، PM، اولویت، هزینه، علت ریشه‌ای و اتصال به برنامه PM
    // ================================================================

    function validJalaliDate(v) {
        const s = String(v || '')
            .trim()
            .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));

        const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
        if (!m) return false;

        const y = Number(m[1]);
        const mo = Number(m[2]);
        const d = Number(m[3]);

        if (y < 1300 || y > 1500) return false;
        if (mo < 1 || mo > 12) return false;
        if (d < 1) return false;

        const maxDay = mo <= 6 ? 31 : (mo <= 11 ? 30 : 30);

        return d <= maxDay;
    }

    const MAINT_WORK_TYPES = [
        'breakdown',
        'repair',
        'pm'
    ];

    const MAINT_PRIORITIES = [
        'low',
        'medium',
        'high',
        'critical'
    ];

    // ================================================================
    // ثبت تعمیر / PM
    // ================================================================
    if (req.method === 'POST' && pathname === '/api/entry/maintenance') {

        if (!auth.requireRole(req, ['engineering'])) { /* SEC-AUDIT-13c: سرپرست حذف شد — خواندن تولید + شروع اجرا */
            return sendJson(res, {
                error: 'دسترسی غیرمجاز: نقش شما اجازهٔ ثبت تعمیرات ندارد.'
            }, 403);
        }

        let raw = '';

        req.on('data', (c) => {
            raw += c;

            if (raw.length > 100000) {
                req.destroy();
            }
        });

        req.on('end', () => {

            try {

                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;

                const workType = String(
                    b.work_type || 'repair'
                ).trim();

                const priority = String(
                    b.priority || 'medium'
                ).trim();

                const duration = Number(b.duration_minutes);
                const cost = Number(b.cost);

                const rec = {

                    id:
                        'web-m-' +
                        Date.now().toString(36) +
                        Math.random().toString(36).slice(2, 6),

                    machine_id:
                        String(b.machine_id || '').trim(),

                    work_type:
                        workType,

                    work_date:
                        String(b.work_date || '').trim(),

                    duration_minutes:
                        Number.isFinite(duration)
                            ? Math.max(0, Math.round(duration))
                            : 0,

                    technician:
                        String(
                            b.technician ||
                            (req.user && req.user.username) ||
                            ''
                        )
                            .trim()
                            .slice(0, 120),

                    priority:
                        MAINT_PRIORITIES.indexOf(priority) !== -1
                            ? priority
                            : 'medium',

                    parts:
                        String(b.parts || '')
                            .slice(0, 500),

                    cost:
                        Number.isFinite(cost)
                            ? Math.max(0, Math.round(cost))
                            : 0,

                    root_cause:
                        String(b.root_cause || '')
                            .slice(0, 500),

                    action_taken:
                        String(b.action_taken || '')
                            .slice(0, 500),

                    description:
                        String(b.description || '')
                            .slice(0, 500),

                    plan_id:
                        String(b.plan_id || '').trim(),

                    downtime_id:
                        String(b.downtime_id || '').trim(),

                    operator_id:
                        String(
                            (req.user && req.user.username) || ''
                        ).trim(),

                    status:
                        'completed',

                    timestamp:
                        new Date().toISOString()
                };

                // ----------------------------------------------------
                // Validation
                // ----------------------------------------------------

                if (
                    !rec.machine_id ||
                    !validJalaliDate(rec.work_date)
                ) {
                    return sendJson(res, {
                        error:
                            'ایستگاه و تاریخ شمسی معتبر الزامی است.'
                    }, 400);
                }

                if (
                    MAINT_WORK_TYPES.indexOf(workType) === -1
                ) {
                    return sendJson(res, {
                        error:
                            'نوع کار تعمیرات معتبر نیست.'
                    }, 400);
                }

                if (
                    workType === 'pm' &&
                    !rec.plan_id
                ) {
                    return sendJson(res, {
                        error:
                            'برای ثبت PM باید برنامه PM انتخاب شود.'
                    }, 400);
                }

                // ----------------------------------------------------
                // Load live data
                // ----------------------------------------------------

                const live = readLive();

                live.maintenance_logs =
                    Array.isArray(live.maintenance_logs)
                        ? live.maintenance_logs
                        : [];

                live.pm_plans =
                    Array.isArray(live.pm_plans)
                        ? live.pm_plans
                        : [];

                // ----------------------------------------------------
                // اگر به PM متصل است، برنامه باید وجود داشته باشد
                // و ایستگاه آن با تعمیر یکی باشد.
                // ----------------------------------------------------

                if (rec.plan_id) {

                    const plan =
                        live.pm_plans.find(
                            (p) =>
                                String(p.id) === rec.plan_id
                        );

                    if (!plan) {
                        return sendJson(res, {
                            error:
                                'برنامه PM انتخاب‌شده یافت نشد.'
                        }, 400);
                    }

                    if (
                        String(plan.machine_id) !==
                        rec.machine_id
                    ) {
                        return sendJson(res, {
                            error:
                                'ایستگاه تعمیر با ایستگاه برنامه PM یکسان نیست.'
                        }, 400);
                    }

                    // فقط وقتی واقعاً PM انجام شده،
                    // آخرین انجام برنامه را به‌روزرسانی کن.
                    if (workType === 'pm') {
                        plan.last_done = rec.work_date;
                    }
                }

                // ----------------------------------------------------
                // ثبت لاگ تعمیر
                // ----------------------------------------------------

                live.maintenance_logs.push(rec);

                live.generated_at =
                    new Date().toISOString();

                if (!writeJson(LIVE_FILE, live)) {
                    return sendJson(res, {
                        error:
                            'ذخیره اطلاعات تعمیرات ناموفق بود.'
                    }, 500);
                }

                // invalidate cache
                cache.data = null;
                cache.at = 0;

                // Audit
                auditLog(
                    req,
                    'maintenance.insert',
                    rec
                );

                return sendJson(
                    res,
                    {
                        ok: true,
                        record: rec
                    },
                    201
                );

            } catch (e) {

                return sendJson(res, {
                    error:
                        'دادهٔ نامعتبر: ' +
                        (e && e.message
                            ? e.message
                            : e)
                }, 400);
            }
        });

        return;
    }

    // ================================================================
    // تعریف برنامه PM
    // ================================================================
    if (req.method === 'POST' && pathname === '/api/pm/plan') {

        if (!auth.requireRole(req, ['engineering'])) { /* SEC-AUDIT-13c: سرپرست حذف شد — خواندن تولید + شروع اجرا */
            return sendJson(res, {
                error:
                    'دسترسی غیرمجاز: نقش شما اجازهٔ تعریف برنامهٔ PM ندارد.'
            }, 403);
        }

        let raw = '';

        req.on('data', (c) => {
            raw += c;

            if (raw.length > 100000) {
                req.destroy();
            }
        });

        req.on('end', () => {

            try {

                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;

                const interval =
                    Number(b.interval_days);

                const priority =
                    String(
                        b.priority || 'medium'
                    ).trim();

                const rec = {

                    id:
                        'pm-' +
                        Date.now().toString(36) +
                        Math.random().toString(36).slice(2, 6),

                    machine_id:
                        String(b.machine_id || '').trim(),

                    title:
                        String(b.title || '')
                            .trim()
                            .slice(0, 200),

                    interval_days:
                        Number.isFinite(interval)
                            ? Math.max(
                                1,
                                Math.round(interval)
                            )
                            : 0,

                    last_done:
                        String(
                            b.last_done || ''
                        ).trim(),

                    responsible:
                        String(
                            b.responsible || ''
                        )
                            .trim()
                            .slice(0, 120),

                    priority:
                        MAINT_PRIORITIES.indexOf(priority) !== -1
                            ? priority
                            : 'medium',

                    notes:
                        String(
                            b.notes || ''
                        ).slice(0, 500),

                    active:
                        1,

                    created_by:
                        String(
                            (req.user &&
                                req.user.username) ||
                            ''
                        ).trim(),

                    created_at:
                        new Date().toISOString()
                };

                // ----------------------------------------------------
                // Validation
                // ----------------------------------------------------

                if (
                    !rec.machine_id ||
                    !rec.title ||
                    !rec.interval_days ||
                    !validJalaliDate(rec.last_done)
                ) {
                    return sendJson(res, {
                        error:
                            'ایستگاه، عنوان، دوره و آخرین انجام معتبر الزامی است.'
                    }, 400);
                }

                const live = readLive();

                live.pm_plans =
                    Array.isArray(live.pm_plans)
                        ? live.pm_plans
                        : [];

                // جلوگیری از PM تکراری برای همان ایستگاه
                const duplicate =
                    live.pm_plans.some(
                        (p) =>
                            p.active !== 0 &&
                            String(p.machine_id) ===
                            rec.machine_id &&
                            String(p.title)
                                .trim()
                                .toLowerCase() ===
                            rec.title
                                .toLowerCase()
                    );

                if (duplicate) {
                    return sendJson(res, {
                        error:
                            'برای این ایستگاه، برنامه‌ای با همین عنوان از قبل وجود دارد.'
                    }, 409);
                }

                live.pm_plans.push(rec);

                live.generated_at =
                    new Date().toISOString();

                if (!writeJson(LIVE_FILE, live)) {
                    return sendJson(res, {
                        error:
                            'ذخیره برنامه PM ناموفق بود.'
                    }, 500);
                }

                cache.data = null;
                cache.at = 0;

                auditLog(
                    req,
                    'pm.plan',
                    rec
                );

                return sendJson(
                    res,
                    {
                        ok: true,
                        record: rec
                    },
                    201
                );

            } catch (e) {

                return sendJson(res, {
                    error:
                        'دادهٔ نامعتبر: ' +
                        (e && e.message
                            ? e.message
                            : e)
                }, 400);
            }
        });

        return;
    }

    // ================================================================
    // دریافت اطلاعات تعمیرات + PM
    // ================================================================
    if (
        req.method === 'GET' &&
        pathname === '/api/maintenance-extra'
    ) {

        const live = readLive();

        return sendJson(res, {

            ok: true,

            logs:
                Array.isArray(
                    live.maintenance_logs
                )
                    ? live.maintenance_logs
                    : [],

            plans:
                Array.isArray(
                    live.pm_plans
                )
                    ? live.pm_plans
                    : []
        });
    }
    // ===== ✅ ADDITIVE-NEW — ورودی‌های وب نسخهٔ ۲ (ایستگاه‌محور + سنسور) =====
    if (req.method === 'POST' && pathname === '/api/entry/production') {
        if (!auth.requireRole(req, ['operator'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: نقش شما اجازهٔ ثبت تولید ندارد.' }, 403);
        }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
        req.on('end', () => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;
                const good = Number(b.good_quantity);
                const rec = {
                    id: 'web-p-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    operator_id: String(b.operator_id || (req.user && req.user.username) || '').trim(),
                    product_id: String(b.product_id || '').trim(),
                    shift_id: String(b.shift_id || '').trim(),
                    good_quantity: good,
                    pallet_count: Math.max(0, Number(b.pallet_count) || 0),
                    machine_id: String(b.machine_id || 'st-pack').trim(), heat_number: String(b.heat_number || '').trim(),
                    description: String(b.description || '').slice(0, 500),
                    source: 'manual',
                    timestamp: new Date().toISOString(),
                };
                if (!rec.operator_id || !rec.product_id || !rec.shift_id || !Number.isFinite(good) || good <= 0) {
                    return sendJson(res, { error: 'محصول، شیفت و «تعداد سالم» الزامی است.' }, 400);
                }
                const live = readLive();
                live.production_logs = Array.isArray(live.production_logs) ? live.production_logs : [];
                live.production_logs.push(rec);
                live.generated_at = new Date().toISOString();
                writeJson(LIVE_FILE, live);
                cache.data = null; cache.at = 0;
                auditLog(req, 'production.insert', rec);
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'دادهٔ نامعتبر: ' + (e && e.message ? e.message : e) }, 400);
            }
        });
        return;
    }
    if (req.method === 'POST' && pathname === '/api/entry/waste') {
        if (!auth.requireRole(req, ['operator'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: نقش شما اجازهٔ ثبت ضایعات ندارد.' }, 403);
        }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
        req.on('end', () => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;
                /* FIX-WASTE-26a: ثبت وزنی — «تناژ (تن)» جای «تعداد»؛ اعشاری (۵ یا ۲٫۵ یا ۰٫۱۹۶)، سقف منطقی ۵۰۰ تن.
                    سازگاری کامل: اگر فرستندهٔ قدیمی quantity بفرستد همان مسیر legacy حفظ می‌شود. */
                const ton26a = Number(b.tonnage_ton);
                const qty = Number(b.quantity);
                const rec = {
                    id: 'web-w-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    operator_id: String(b.operator_id || (req.user && req.user.username) || '').trim(),
                    shift_id: String(b.shift_id || '').trim(),
                    reason_id: String(b.reason_id || '').trim(),
                    quantity: qty,
                    machine_id: String(b.machine_id || '').trim(),
                    waste_type: String(b.waste_type || '').trim(),
                    description: String(b.description || '').slice(0, 500),
                    timestamp: new Date().toISOString(),
                };
                const hasTon26a = Number.isFinite(ton26a) && ton26a > 0 && ton26a <= 500; /* FIX-WASTE-26a: سقف منطقی */
                const hasQty26a = Number.isFinite(qty) && qty > 0;
                if (hasTon26a) {
                    rec.tonnage_ton = Math.round(ton26a * 1000) / 1000; /* FIX-WASTE-26a: فیلد وزنی جدید */
                    delete rec.quantity; /* رکورد وزنی — تعداد ندارد */
                    const ps26a = String(b.product_size || '').trim().slice(0, 24);
                    if (ps26a) rec.product_size = ps26a; /* FIX-WASTE-26a: سایز محصول (اختیاری) — ضایعات پایان شیفت per سایز اعلام می‌شود */
                }
                if (Number.isFinite(ton26a) && ton26a > 0 && !hasTon26a) {
                    return sendJson(res, { error: 'تناژ باید عددی بزرگ‌تر از صفر و حداکثر ۵۰۰ تن باشد.' }, 400);
                }
                if (!rec.reason_id || !rec.shift_id || !rec.machine_id || (!hasTon26a && !hasQty26a)) {
                    return sendJson(res, { error: 'ایستگاه کشف، علت، شیفت و «تناژ (تن)» الزامی است — مثال: ۵ یا ۲٫۵ (حداکثر ۵۰۰).' }, 400);
                }
                const live = readLive();
                live.waste_logs = Array.isArray(live.waste_logs) ? live.waste_logs : [];
                live.waste_logs.push(rec);
                live.generated_at = new Date().toISOString();
                writeJson(LIVE_FILE, live);
                cache.data = null; cache.at = 0;
                auditLog(req, 'waste.insert', rec);
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'دادهٔ نامعتبر: ' + (e && e.message ? e.message : e) }, 400);
            }
        });
        return;
    }
    if (req.method === 'POST' && pathname === '/api/entry/downtime') {
        if (!auth.requireRole(req, ['operator', 'engineering'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: نقش شما اجازهٔ ثبت توقف ندارد.' }, 403);
        }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
        req.on('end', () => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;
                const start = new Date(b.start_time);
                const end = new Date(b.end_time);
                if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
                    return sendJson(res, { error: 'زمان شروع و پایان معتبر نیست؛ «پایان» باید بعد از «شروع» باشد.' }, 400);
                }
                const rec = {
                    id: 'web-d-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    shift_id: String(b.shift_id || '').trim(),
                    reason_id: String(b.reason_id || '').trim(),
                    start_time: start.toISOString(),
                    end_time: end.toISOString(),
                    duration_minutes: Math.round((end - start) / 60000),
                    is_unplanned: Number(b.is_unplanned) ? 1 : 0,
                    machine_id: String(b.machine_id || '').trim(),
                    description: String(b.description || '').slice(0, 500),
                    timestamp: start.toISOString(),
                };
                if (!rec.reason_id || !rec.shift_id || !rec.machine_id) {
                    return sendJson(res, { error: 'علت توقف، شیفت و ایستگاه الزامی است.' }, 400);
                }
                const live = readLive();
                live.downtime_logs = Array.isArray(live.downtime_logs) ? live.downtime_logs : [];
                live.downtime_logs.push(rec);
                live.generated_at = new Date().toISOString();
                writeJson(LIVE_FILE, live);
                cache.data = null; cache.at = 0;
                auditLog(req, 'downtime.insert', rec);
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'دادهٔ نامعتبر: ' + (e && e.message ? e.message : e) }, 400);
            }
        });
        return;
    }
    const SENSOR_KEY = 'sanatify-sensor-1405';
    if (req.method === 'POST' && pathname === '/api/sensor/count') {
        if (String(req.headers['x-sensor-key'] || '') !== SENSOR_KEY) {
            return sendJson(res, { error: 'کلید سنسور معتبر نیست.' }, 403);
        }
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 100000) req.destroy(); });
        req.on('end', () => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}')) /* SEC-15b */;
                const cnt = Number(b.count);
                if (!Number.isFinite(cnt) || cnt <= 0) return sendJson(res, { error: 'count معتبر نیست.' }, 400);
                const rec = { id: 'sen-' + Date.now().toString(36), station_id: String(b.station_id || 'st-pack'), count: cnt, source: 'sensor', timestamp: b.timestamp ? new Date(b.timestamp).toISOString() : new Date().toISOString() };
                const live = readLive();
                live.sensor_events = Array.isArray(live.sensor_events) ? live.sensor_events : [];
                live.sensor_events.push(rec);
                live.generated_at = new Date().toISOString();
                writeJson(LIVE_FILE, live);
                cache.data = null; cache.at = 0;
                auditLog(req, 'sensor.count', rec);
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'دادهٔ نامعتبر.' }, 400);
            }
        });
        return;
    }
    // ===== ✅ END-ADDITIVE-NEW =====

    // ===== FIX-INV-0-HARDENING: حذف endpoint تکراری مرده (نسخهٔ دوم POST /api/entry/production) =====

    // ===== FIX-INV-0-HARDENING: حذف endpoint تکراری مرده (نسخهٔ دوم POST /api/entry/waste) =====

    // ===== FIX-INV-0-HARDENING: حذف endpoint تکراری مرده (نسخهٔ دوم POST /api/entry/downtime) =====

    // ================================================================
    // INDUSTRIAL FAY MES
    // INVENTORY MODULE
    // دفتر گردش انبار — رسید / حواله / انتقال / اصلاح
    // Offline First — live.json
    // ================================================================

    function invEnsure(live) {
        live.inventory_items = Array.isArray(live.inventory_items) ? live.inventory_items : [];
        live.inventory_receipts = Array.isArray(live.inventory_receipts) ? live.inventory_receipts : [];
        live.inventory_issues = Array.isArray(live.inventory_issues) ? live.inventory_issues : [];
        live.inventory_transfers = Array.isArray(live.inventory_transfers) ? live.inventory_transfers : [];
        live.inventory_adjustments = Array.isArray(live.inventory_adjustments) ? live.inventory_adjustments : [];
        live.inventory_reservations = Array.isArray(live.inventory_reservations) ? live.inventory_reservations : [];
        return live;
    }


    function invFindItem(live, id) {

        return live.inventory_items.find(
            x => x.id === id
        );
    }


    function invStockKey(
        itemId,
        warehouse,
        location,
        lot,
        status
    ) {

        return [
            itemId,
            warehouse,
            location,
            lot || '',
            status || 'available'
        ].join('|');
    }


    function invBuildStock(live) {

        invEnsure(live);

        const map = new Map();

        function add(
            itemId,
            warehouse,
            location,
            lot,
            status,
            delta
        ) {

            const key = invStockKey(
                itemId,
                warehouse,
                location,
                lot,
                status
            );

            const row =
                map.get(key) ||
                {
                    item_id: itemId,
                    warehouse,
                    location,
                    lot_no: lot || '',
                    stock_status:
                        status || 'available',
                    quantity: 0
                };

            row.quantity += delta;

            map.set(key, row);
        }


        // رسید
        live.inventory_receipts.forEach(r => {

            add(
                r.item_id,
                r.warehouse,
                r.location,
                r.lot_no,
                r.stock_status,
                Number(r.quantity) || 0
            );

        });


        // حواله خروج
        live.inventory_issues.forEach(r => {

            add(
                r.item_id,
                r.warehouse,
                r.location,
                r.lot_no,
                'available',
                -(Number(r.quantity) || 0)
            );

        });


        // انتقال
        live.inventory_transfers.forEach(r => {

            add(
                r.item_id,
                r.from_warehouse,
                r.from_location,
                r.lot_no,
                'available',
                -(Number(r.quantity) || 0)
            );

            add(
                r.item_id,
                r.to_warehouse,
                r.to_location,
                r.lot_no,
                'available',
                Number(r.quantity) || 0
            );

        });


        // اصلاح موجودی
        live.inventory_adjustments.forEach(r => {

            add(
                r.item_id,
                r.warehouse,
                r.location,
                r.lot_no,
                r.stock_status,
                Number(r.delta_quantity) || 0
            );

        });


        return [...map.values()]
            .filter(x => Math.abs(x.quantity) > 0.000001);
    }


    // ================================================================
    // موجودی سه‌سطحی (استاندارد WMS)
    // Physical  = ردیف‌های available + quarantine
    // Blocked   = quarantine
    // Reserved  = رزروهای باز (inventory_reservations)
    // Available = onhand(available) - Reserved
    // ================================================================
    function invAggWarehouse(live, itemId, warehouse) {
        const rows = invBuildStock(live).filter(x => x.item_id === itemId && (!warehouse || x.warehouse === warehouse));
        const physical = round2(rows.filter(x => x.stock_status === 'available' || x.stock_status === 'quarantine').reduce((s, x) => s + Number(x.quantity || 0), 0));
        const blocked = round2(rows.filter(x => x.stock_status === 'quarantine').reduce((s, x) => s + Number(x.quantity || 0), 0));
        const reserved = round2((live.inventory_reservations || []).filter(r => r.item_id === itemId && (!warehouse || r.warehouse === warehouse) && r.status === 'open').reduce((s, r) => s + Number(r.quantity || 0), 0));
        const onhand = rows.filter(x => x.stock_status === 'available').reduce((s, x) => s + Number(x.quantity || 0), 0);
        const available = round2(Math.max(0, onhand - reserved));
        return { physical, blocked, reserved, available, rows };
    }
    function invAvailable(live, itemId, warehouse, location, lot) {
        // ✅ FIX: بررسی در سطح انبار؛ mismatch محل/لات دیگر موجب ردِ اشتباه نمی‌شود
        return invAggWarehouse(live, itemId, warehouse).available;
    }
    function invPickSources(live, itemId, warehouse, location, lot, qty) {
        const agg = invAggWarehouse(live, itemId, warehouse);
        if (agg.available < qty - 1e-9) return null;
        const availRows = agg.rows.filter(x => x.stock_status === 'available' && Number(x.quantity) > 0);
        const ordered = [];
        const exact = availRows.find(x => (x.location || '') === (location || '') && (x.lot_no || '') === (lot || ''));
        if (exact) ordered.push(exact);
        availRows.filter(x => x !== exact).sort((a, b) => Number(b.quantity) - Number(a.quantity)).forEach(x => ordered.push(x));
        const sources = [];
        let remain = round2(qty);
        for (const row of ordered) {
            if (remain <= 1e-9) break;
            const take = round2(Math.min(Number(row.quantity), remain));
            if (take <= 1e-9) continue;
            sources.push({ location: row.location, lot_no: row.lot_no, qty: take });
            remain = round2(remain - take);
        }
        if (remain > 1e-9) return null;
        return sources;
    }


    function invDuplicate(
        live,
        requestId
    ) {

        if (!requestId)
            return null;

        const all = [

            ...live.inventory_receipts,
            ...live.inventory_issues,
            ...live.inventory_transfers,
            ...live.inventory_adjustments

        ];

        return all.find(
            x => x.request_id === requestId
        ) || null;
    }


    function invSave(
        live,
        req,
        action,
        record
    ) {

        live.generated_at =
            new Date().toISOString();

        if (!writeJson(
            LIVE_FILE,
            live
        )) {

            throw new Error(
                'ذخیره اطلاعات انبار انجام نشد.'
            );
        }

        cache.data = null;
        cache.at = 0;

        auditLog(
            req,
            action,
            record
        );
    }


    // ================================================================
    // GET INVENTORY
    // ================================================================

    if (req.method === 'GET' && pathname === '/api/inventory') {
        const live = invEnsure(readLive());
        const stock = invBuildStock(live);
        const items = live.inventory_items.filter(x => x.active !== false);
        const stockview = [];
        items.forEach(item => {
            Object.keys({ raw: 1, product: 1, spare: 1, quarantine: 1 }).forEach(wh => {
                const agg = invAggWarehouse(live, item.id, wh);
                if (agg.physical === 0 && agg.reserved === 0 && agg.available === 0) return;
                const min = Number(item.min_stock || 0);
                const rop = Number(item.reorder_point || 0);
                let status = 'ok';
                if (agg.available < min) status = 'low';
                else if (rop > 0 && agg.available <= rop) status = 'warn';
                stockview.push({ item_id: item.id, code: item.code, name: item.name, category: item.category, unit: item.unit, warehouse: wh, physical: agg.physical, reserved: agg.reserved, blocked: agg.blocked, available: agg.available, min_stock: min, max_stock: Number(item.max_stock || 0), reorder_point: rop, status });
            });
        });
        // ===== FIX-INV-3 (Phase 1.5 / Option B) =====
        items.forEach(item => {
            if (!stockview.some(v => v.item_id === item.id)) {
                stockview.push({ item_id: item.id, code: item.code, name: item.name, category: item.category, unit: item.unit, warehouse: '', physical: 0, reserved: 0, blocked: 0, available: 0, min_stock: Number(item.min_stock || 0), max_stock: Number(item.max_stock || 0), reorder_point: Number(item.reorder_point || 0), status: 'none' });
            }
        });
        // ===== END FIX-INV-3 =====
        // ===== FIX-INV-3S (Phase 1.5 / Option B) =====
        items.forEach(function (item) { var has = false; for (var v = 0; v < stockview.length; v++) { if (stockview[v].item_id === item.id) { has = true; break; } } if (!has) stockview.push({ item_id: item.id, code: item.code, name: item.name, category: item.category, unit: item.unit, warehouse: '', physical: 0, reserved: 0, blocked: 0, available: 0, min_stock: Number(item.min_stock || 0), max_stock: Number(item.max_stock || 0), reorder_point: Number(item.reorder_point || 0), status: 'none' }); });
        // ===== END FIX-INV-3S =====
        const totalAvailable = stock.filter(x => x.stock_status === 'available').reduce((s, x) => s + Number(x.quantity || 0), 0);
        const quarantine = stock.filter(x => x.stock_status === 'quarantine').reduce((s, x) => s + Number(x.quantity || 0), 0);
        const lowStock = items.filter(item => {
            const q = stock.filter(x => x.item_id === item.id && x.stock_status === 'available').reduce((s, x) => s + Number(x.quantity || 0), 0);
            return (Number(item.reorder_point || 0) > 0 && q <= Number(item.reorder_point));
        }).length;
        const transactions = [
            ...live.inventory_receipts.map(x => ({ ...x, tx_type: 'receipt' })),
            ...live.inventory_issues.map(x => ({ ...x, tx_type: 'issue' })),
            ...live.inventory_transfers.map(x => ({ ...x, tx_type: 'transfer' })),
            ...live.inventory_adjustments.map(x => ({ ...x, tx_type: 'adjustment' }))
        ].concat(live.inventory_reservation_logs || []).sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 200);
        return sendJson(res, {
            ok: true,
            items,
            stock,
            stockview,
            receipts: live.inventory_receipts,
            issues: live.inventory_issues,
            transfers: live.inventory_transfers,
            adjustments: live.inventory_adjustments,
            transactions,
            reservations: live.inventory_reservations || [],
            summary: { item_count: items.length, available_quantity: totalAvailable, quarantine_quantity: quarantine, low_stock_count: lowStock }
        });
    }


    // ================================================================
    // ITEM MASTER
    // ================================================================

    if (
        req.method === 'POST' &&
        pathname === '/api/inventory/item'
    ) {

        if (
            !auth.requireRole(
                req,
                ['warehouse']
            )
        ) {

            return sendJson(
                res,
                {
                    error:
                        'دسترسی غیرمجاز: فقط انباردار یا مدیر سیستم می‌تواند اقلام انبار را مدیریت کند.'
                },
                403
            );
        }


        readBody(req)
            .then(body => {

                try {

                    const b =
                        JSON.parse(body || '{}');

                    const live =
                        invEnsure(readLive());


                    const code =
                        String(
                            b.code || ''
                        )
                            .trim()
                            .toUpperCase();


                    const name =
                        String(
                            b.name || ''
                        )
                            .trim();


                    const unit =
                        String(
                            b.unit || ''
                        )
                            .trim();


                    if (
                        !code ||
                        !name ||
                        !unit
                    ) {

                        return sendJson(
                            res,
                            {
                                error:
                                    'کد کالا، نام کالا و واحد الزامی است.'
                            },
                            400
                        );
                    }


                    const duplicate =
                        live.inventory_items
                            .find(
                                x =>
                                    x.code === code &&
                                    x.id !== b.id
                            );


                    if (duplicate) {

                        return sendJson(
                            res,
                            {
                                error:
                                    'کد کالا تکراری است.'
                            },
                            409
                        );
                    }


                    const rec = {

                        id:
                            String(
                                b.id ||
                                (
                                    'itm-' +
                                    Date.now()
                                        .toString(36) +
                                    Math.random()
                                        .toString(36)
                                        .slice(2, 6)
                                )
                            ),

                        code,

                        name,

                        category:
                            String(
                                b.category ||
                                'سایر'
                            ).trim(),

                        unit,

                        reorder_point:
                            Math.max(
                                0,
                                Number(
                                    b.reorder_point
                                ) || 0
                            ),

                        min_stock:
                            Math.max(
                                0,
                                Number(
                                    b.min_stock
                                ) || 0
                            ),

                        max_stock:
                            Math.max(
                                0,
                                Number(
                                    b.max_stock
                                ) || 0
                            ),

                        batch_tracking:
                            !!b.batch_tracking,

                        active:
                            b.active !== false,

                        description:
                            String(
                                b.description || ''
                            ).slice(0, 500),

                        created_at:
                            new Date()
                                .toISOString(),

                        created_by:
                            String(
                                (
                                    req.user &&
                                    req.user.username
                                ) || ''
                            )
                    };


                    const index =
                        live.inventory_items
                            .findIndex(
                                x =>
                                    x.id === rec.id
                            );


                    if (index >= 0) {

                        rec.created_at =
                            live.inventory_items[
                                index
                            ].created_at ||
                            rec.created_at;

                        live.inventory_items[
                            index
                        ] = {
                            ...live.inventory_items[
                            index
                            ],
                            ...rec
                        };

                    } else {

                        live.inventory_items.push(
                            rec
                        );
                    }


                    invSave(
                        live,
                        req,
                        index >= 0
                            ? 'inventory.item.update'
                            : 'inventory.item.insert',
                        rec
                    );


                    return sendJson(
                        res,
                        {
                            ok: true,
                            record: rec
                        },
                        index >= 0
                            ? 200
                            : 201
                    );


                } catch (e) {

                    return sendJson(
                        res,
                        {
                            error:
                                'داده نامعتبر: ' +
                                e.message
                        },
                        400
                    );
                }

            })
            .catch(e =>
                sendJson(
                    res,
                    {
                        error: e.message
                    },
                    500
                )
            );

        return;
    }


    // ================================================================
    // RECEIPT
    // ================================================================

    if (
        req.method === 'POST' &&
        pathname === '/api/inventory/receipt'
    ) {

        if (
            !auth.requireRole(
                req,
                ['warehouse']
            )
        ) {

            return sendJson(
                res,
                {
                    error:
                        'دسترسی غیرمجاز: ثبت رسید فقط برای انباردار یا مدیر سیستم است.'
                },
                403
            );
        }


        readBody(req)
            .then(body => {

                try {

                    const b =
                        JSON.parse(body || '{}');

                    const live =
                        invEnsure(readLive());


                    const duplicate =
                        invDuplicate(
                            live,
                            b.request_id
                        );


                    if (duplicate) {

                        return sendJson(
                            res,
                            {
                                ok: true,
                                duplicate: true,
                                record: duplicate
                            }
                        );
                    }


                    const item =
                        invFindItem(
                            live,
                            String(
                                b.item_id || ''
                            )
                        );


                    const qty =
                        Number(b.quantity);


                    const lot =
                        String(
                            b.lot_no || ''
                        ).trim();


                    if (!item)
                        return sendJson(
                            res,
                            {
                                error:
                                    'کالای انتخاب‌شده یافت نشد.'
                            },
                            400
                        );


                    if (
                        !Number.isFinite(qty) ||
                        qty <= 0
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'مقدار رسید باید بیشتر از صفر باشد.'
                            },
                            400
                        );


                    if (
                        item.batch_tracking &&
                        !lot
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'برای این کالا شماره بچ/لات الزامی است.'
                            },
                            400
                        );


                    const rec = {

                        id:
                            'grn-' +
                            Date.now()
                                .toString(36) +
                            Math.random()
                                .toString(36)
                                .slice(2, 6),

                        request_id:
                            String(
                                b.request_id || ''
                            ),

                        receipt_no:
                            'GRN-' +
                            Date.now(),

                        item_id:
                            item.id,

                        quantity:
                            qty,

                        unit:
                            item.unit,

                        lot_no:
                            lot,

                        warehouse:
                            String(
                                b.warehouse || ''
                            ).trim(),

                        location:
                            String(
                                b.location || ''
                            ).trim(),

                        stock_status:
                            String(
                                b.stock_status ||
                                'available'
                            ),

                        receipt_type:
                            String(
                                b.receipt_type ||
                                'purchase'
                            ),

                        supplier:
                            String(
                                b.supplier || ''
                            ).trim(),

                        document_no:
                            String(
                                b.document_no || ''
                            ).trim(),

                        source_ref:
                            String(
                                b.source_ref || ''
                            ).trim(),

                        heat_number:
                            String(
                                b.heat_number || ''
                            ).trim(),

                        description:
                            String(
                                b.description || ''
                            ).slice(0, 500),

                        timestamp:
                            new Date()
                                .toISOString(),

                        operator_id:
                            String(
                                (
                                    req.user &&
                                    req.user.username
                                ) || ''
                            )
                    };


                    if (
                        !rec.warehouse ||
                        !rec.location
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'انبار و محل نگهداری الزامی است.'
                            },
                            400
                        );


                    if (
                        ![
                            'available',
                            'quarantine',
                            'rejected'
                        ].includes(
                            rec.stock_status
                        )
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'وضعیت موجودی نامعتبر است.'
                            },
                            400
                        );


                    live.inventory_receipts
                        .push(rec);


                    invSave(
                        live,
                        req,
                        'inventory.receipt.insert',
                        rec
                    );


                    return sendJson(
                        res,
                        {
                            ok: true,
                            record: rec
                        },
                        201
                    );


                } catch (e) {

                    return sendJson(
                        res,
                        {
                            error:
                                'داده نامعتبر: ' +
                                e.message
                        },
                        400
                    );
                }

            })
            .catch(e =>
                sendJson(
                    res,
                    {
                        error: e.message
                    },
                    500
                )
            );

        return;
    }


    // ================================================================
    // ISSUE
    // ================================================================

    if (req.method === 'POST' && pathname === '/api/inventory/issue') {
        if (!auth.requireRole(req, ['warehouse'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت حواله فقط برای انباردار یا مدیر سیستم است.' }, 403);
        }
        readBody(req).then(body => {
            try {
                const b = JSON.parse(body || '{}');
                const live = invEnsure(readLive());
                /* HARDEN-18D: همزمانی خوش‌بینانه — X-Base-Ver کهنه ⇒ 409 VER_CONFLICT (انتخابی؛ بدون هدر = رفتار قدیمی) */
                const vc18d = assertFreshVer18D(req, live);
                if (vc18d) return verConflict18D(res, vc18d);
                const qty = Number(b.quantity);
                const item = invFindItem(live, String(b.item_id || ''));
                const lot = String(b.lot_no || '').trim();
                const duplicate = invDuplicate(live, b.request_id);
                if (duplicate) return sendJson(res, { ok: true, duplicate: true, record: duplicate });
                if (!item) return sendJson(res, { error: 'کالای انتخاب‌شده یافت نشد.' }, 400);
                if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, { error: 'مقدار حواله باید بیشتر از صفر باشد.' }, 400);
                if (item.batch_tracking && !lot) return sendJson(res, { error: 'برای این کالا شماره بچ/لات الزامی است.' }, 400);
                const warehouse = String(b.warehouse || '').trim();
                const location = String(b.location || '').trim();
                if (!warehouse || !location || !String(b.destination || '').trim()) return sendJson(res, { error: 'انبار، محل و مقصد حواله الزامی است.' }, 400);
                const agg = invAggWarehouse(live, item.id, warehouse);
                if (agg.available < qty - 1e-9) {
                    console.log('[INV-ISSUE-REJECT]', JSON.stringify({ item: item.code, warehouse, physical: agg.physical, reserved: agg.reserved, blocked: agg.blocked, available: agg.available, requested: qty }));
                    return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست. (قابل مصرف: ' + agg.available + ' | درخواست: ' + qty + ')', available: agg.available, physical: agg.physical, reserved: agg.reserved }, 409);
                }
                const sources = invPickSources(live, item.id, warehouse, location, lot, qty);
                if (!sources) return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست.', available: agg.available }, 409);
                const baseNo = 'GIN-' + Date.now();
                let mainRec = null;
                sources.forEach((src, idx) => {
                    const rec = {
                        id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        request_id: String(b.request_id || '') + (idx > 0 ? '-' + (idx + 1) : ''),
                        issue_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''),
                        item_id: item.id,
                        quantity: src.qty,
                        unit: item.unit,
                        lot_no: src.lot_no,
                        warehouse,
                        location: src.location,
                        destination: String(b.destination || '').trim(),
                        destination_ref: String(b.destination_ref || '').trim(),
                        work_order: String(b.work_order || '').trim(),
                        description: String(b.description || '').slice(0, 500),
                        timestamp: new Date().toISOString(),
                        operator_id: String((req.user && req.user.username) || '')
                    };
                    live.inventory_issues.push(rec);
                    if (!mainRec) mainRec = rec;
                });
                invSave(live, req, 'inventory.issue.insert', mainRec);
                return sendJson(res, { ok: true, record: mainRec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400);
            }
        }).catch(e => sendJson(res, { error: e.message }, 500));
        return;
    }


    // ================================================================
    // TRANSFER
    // ================================================================

    if (req.method === 'POST' && pathname === '/api/inventory/transfer') {
        if (!auth.requireRole(req, ['warehouse'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت انتقال فقط برای انباردار یا مدیر سیستم است.' }, 403);
        }
        readBody(req).then(body => {
            try {
                const b = JSON.parse(body || '{}');
                const live = invEnsure(readLive());
                /* HARDEN-18D: همزمانی خوش‌بینانه — X-Base-Ver کهنه ⇒ 409 VER_CONFLICT (انتخابی؛ بدون هدر = رفتار قدیمی) */
                const vc18d = assertFreshVer18D(req, live);
                if (vc18d) return verConflict18D(res, vc18d);
                const qty = Number(b.quantity);
                const item = invFindItem(live, String(b.item_id || ''));
                const lot = String(b.lot_no || '').trim();
                const duplicate = invDuplicate(live, b.request_id);
                if (duplicate) return sendJson(res, { ok: true, duplicate: true, record: duplicate });
                const fromWarehouse = String(b.from_warehouse || '').trim();
                const fromLocation = String(b.from_location || '').trim();
                const toWarehouse = String(b.to_warehouse || '').trim();
                const toLocation = String(b.to_location || '').trim();
                if (!item) return sendJson(res, { error: 'کالای انتخاب‌شده یافت نشد.' }, 400);
                if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, { error: 'مقدار انتقال باید بیشتر از صفر باشد.' }, 400);
                if (!fromWarehouse || !fromLocation || !toWarehouse || !toLocation) return sendJson(res, { error: 'مبدأ و مقصد کامل الزامی است.' }, 400);
                if (fromWarehouse === toWarehouse && fromLocation === toLocation) return sendJson(res, { error: 'مبدأ و مقصد نمی‌توانند یکسان باشند.' }, 400);
                const agg = invAggWarehouse(live, item.id, fromWarehouse);
                if (agg.available < qty - 1e-9) {
                    console.log('[INV-TRANSFER-REJECT]', JSON.stringify({ item: item.code, fromWarehouse, available: agg.available, requested: qty }));
                    return sendJson(res, { error: 'موجودی قابل انتقال کافی نیست. (قابل مصرف: ' + agg.available + ' | درخواست: ' + qty + ')', available: agg.available }, 409);
                }
                const sources = invPickSources(live, item.id, fromWarehouse, fromLocation, lot, qty);
                if (!sources) return sendJson(res, { error: 'موجودی قابل انتقال کافی نیست.', available: agg.available }, 409);
                const baseNo = 'TRN-' + Date.now();
                let mainRec = null;
                sources.forEach((src, idx) => {
                    const rec = {
                        id: 'trn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                        request_id: String(b.request_id || '') + (idx > 0 ? '-' + (idx + 1) : ''),
                        transfer_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''),
                        item_id: item.id,
                        quantity: src.qty,
                        unit: item.unit,
                        lot_no: src.lot_no,
                        from_warehouse: fromWarehouse,
                        from_location: src.location,
                        to_warehouse: toWarehouse,
                        to_location: toLocation,
                        description: String(b.description || '').slice(0, 500),
                        timestamp: new Date().toISOString(),
                        operator_id: String((req.user && req.user.username) || '')
                    };
                    live.inventory_transfers.push(rec);
                    if (!mainRec) mainRec = rec;
                });
                invSave(live, req, 'inventory.transfer.insert', mainRec);
                return sendJson(res, { ok: true, record: mainRec }, 201);
            } catch (e) {
                return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400);
            }
        }).catch(e => sendJson(res, { error: e.message }, 500));
        return;
    }


    // ================================================================
    // STOCK ADJUSTMENT
    // ================================================================

    if (
        req.method === 'POST' &&
        pathname === '/api/inventory/adjustment'
    ) {

        if (
            !auth.requireRole(
                req,
                ['warehouse']
            )
        ) {

            return sendJson(
                res,
                {
                    error:
                        'دسترسی غیرمجاز: اصلاح موجودی فقط برای انباردار یا مدیر سیستم است.'
                },
                403
            );
        }


        readBody(req)
            .then(body => {

                try {

                    const b =
                        JSON.parse(body || '{}');

                    const live =
                        invEnsure(readLive());

                    const delta =
                        Number(
                            b.delta_quantity
                        );

                    const item =
                        invFindItem(
                            live,
                            String(
                                b.item_id || ''
                            )
                        );


                    const lot =
                        String(
                            b.lot_no || ''
                        ).trim();

                    const warehouse =
                        String(
                            b.warehouse || ''
                        ).trim();

                    const location =
                        String(
                            b.location || ''
                        ).trim();

                    const status =
                        String(
                            b.stock_status ||
                            'available'
                        );


                    const duplicate =
                        invDuplicate(
                            live,
                            b.request_id
                        );


                    if (duplicate) {

                        return sendJson(
                            res,
                            {
                                ok: true,
                                duplicate: true,
                                record: duplicate
                            }
                        );
                    }


                    if (!item)
                        return sendJson(
                            res,
                            {
                                error:
                                    'کالای انتخاب‌شده یافت نشد.'
                            },
                            400
                        );


                    if (
                        !Number.isFinite(delta) ||
                        delta === 0
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'مقدار اصلاح باید غیرصفر باشد.'
                            },
                            400
                        );


                    if (
                        !warehouse ||
                        !location ||
                        !String(
                            b.reason || ''
                        ).trim()
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'انبار، محل و علت اصلاح الزامی است.'
                            },
                            400
                        );


                    if (
                        delta < 0 &&
                        invAvailable(
                            live,
                            item.id,
                            warehouse,
                            location,
                            lot
                        ) < Math.abs(delta)
                    )
                        return sendJson(
                            res,
                            {
                                error:
                                    'موجودی قابل اصلاح کافی نیست.'
                            },
                            409
                        );


                    const rec = {

                        id:
                            'adj-' +
                            Date.now()
                                .toString(36) +
                            Math.random()
                                .toString(36)
                                .slice(2, 6),

                        request_id:
                            String(
                                b.request_id || ''
                            ),

                        adjustment_no:
                            'ADJ-' +
                            Date.now(),

                        item_id:
                            item.id,

                        delta_quantity:
                            delta,

                        unit:
                            item.unit,

                        lot_no:
                            lot,

                        warehouse,

                        location,

                        stock_status:
                            status,

                        reason:
                            String(
                                b.reason || ''
                            ).trim(),

                        description:
                            String(
                                b.description || ''
                            ).slice(0, 500),

                        timestamp:
                            new Date()
                                .toISOString(),

                        operator_id:
                            String(
                                (
                                    req.user &&
                                    req.user.username
                                ) || ''
                            )
                    };


                    live.inventory_adjustments
                        .push(rec);


                    invSave(
                        live,
                        req,
                        'inventory.adjustment.insert',
                        rec
                    );


                    return sendJson(
                        res,
                        {
                            ok: true,
                            record: rec
                        },
                        201
                    );


                } catch (e) {

                    return sendJson(
                        res,
                        {
                            error:
                                'داده نامعتبر: ' +
                                e.message
                        },
                        400
                    );
                }

            })
            .catch(e =>
                sendJson(
                    res,
                    {
                        error: e.message
                    },
                    500
                )
            );

        return;
    }

    // ================================================================
    // FIX-RES-1 — RESERVATION ENGINE (Phase 2 / Step 2.1)
    // رزرو موجودی: ایجاد / آزادسازی / مصرف (بدون تغییر توابع موجود)
    // ================================================================
    if (req.method === 'POST' && pathname === '/api/inventory/reserve') {
        if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز: مدیریت رزرو فقط برای انباردار یا مدیر سیستم است.' }, 403); }
        readBody(req).then(body => {
            try {
                const b = JSON.parse(body || '{}');
                const live = invEnsure(readLive());
                const item = invFindItem(live, String(b.item_id || ''));
                const qty = Number(b.quantity);
                const warehouse = String(b.warehouse || '').trim();
                if (!item) return sendJson(res, { error: 'کالای انتخاب‌شده یافت نشد.' }, 400);
                if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, { error: 'مقدار رزرو باید بیشتر از صفر باشد.' }, 400);
                if (!warehouse) return sendJson(res, { error: 'انبار رزرو الزامی است.' }, 400);
                const agg = invAggWarehouse(live, item.id, warehouse);
                if (agg.available < qty - 1e-9) return sendJson(res, { error: 'موجودی قابل مصرف کافی نیست. (قابل مصرف: ' + agg.available + ' | درخواست: ' + qty + ')', available: agg.available }, 409);
                const rec = { id: 'res-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: String(b.request_id || ''), reservation_no: 'RES-' + Date.now(), item_id: item.id, warehouse: warehouse, quantity: qty, status: 'open', reason: String(b.reason || '').trim(), work_order: String(b.work_order || '').trim(), created_by: String((req.user && req.user.username) || ''), created_at: new Date().toISOString(), closed_at: null };
live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : []; live.inventory_reservation_logs.push({ id: 'rlog-' + rec.id, tx_type: 'reserve', receipt_no: rec.reservation_no, item_id: rec.item_id, quantity: rec.quantity, warehouse: rec.warehouse, lot_no: '', destination: rec.work_order || rec.reason || 'رزرو', timestamp: rec.created_at });
                live.inventory_reservations.push(rec);
                invSave(live, req, 'inventory.reserve.insert', rec);
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch(e => sendJson(res, { error: e.message }, 500));
        return;
    }
    if (req.method === 'POST' && pathname === '/api/inventory/reserve/release') {
        if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403); }
        readBody(req).then(body => {
            try {
                const b = JSON.parse(body || '{}');
                const live = invEnsure(readLive());
                const rec = live.inventory_reservations.find(x => x.id === String(b.reservation_id || '') || x.reservation_no === String(b.reservation_id || ''));
                if (!rec) return sendJson(res, { error: 'رزرو یافت نشد.' }, 404);
                if (rec.status !== 'open') return sendJson(res, { error: 'این رزرو قبلاً بسته شده است.' }, 409);
                rec.status = 'released'; rec.closed_at = new Date().toISOString();
live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : []; live.inventory_reservation_logs.push({ id: 'rlog-rel-' + rec.id, tx_type: 'release', issue_no: 'REL-' + Date.now(), item_id: rec.item_id, quantity: rec.quantity, warehouse: rec.warehouse, lot_no: '', destination: 'بازگشت به موجودی', timestamp: rec.closed_at });
                invSave(live, req, 'inventory.reserve.release', rec);
                return sendJson(res, { ok: true, record: rec });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch(e => sendJson(res, { error: e.message }, 500));
        return;
    }
    if (req.method === 'POST' && pathname === '/api/inventory/reserve/consume') {
if (!auth.requireRole(req, ['warehouse'])) { return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403); }
readBody(req).then(body => {
try {
const b = JSON.parse(body || '{}');
const live = invEnsure(readLive());
const rec = live.inventory_reservations.find(x => x.id === String(b.reservation_id || '') || x.reservation_no === String(b.reservation_id || ''));
if (!rec) return sendJson(res, { error: 'رزرو یافت نشد.' }, 404);
if (rec.status !== 'open') return sendJson(res, { error: 'این رزرو قبلاً بسته شده است.' }, 409);
const qty = Number(b.quantity) > 0 ? Number(b.quantity) : Number(rec.quantity);
if (!Number.isFinite(qty) || qty <= 0) return sendJson(res, { error: 'مقدار مصرف باید بیشتر از صفر باشد.' }, 400);
if (qty > Number(rec.quantity) + 1e-9) return sendJson(res, { error: 'مقدار مصرف نمی‌تواند بیشتر از ماندهٔ رزرو باشد. (مانده رزرو: ' + rec.quantity + ')', max: rec.quantity }, 409);
const dup = invDuplicate(live, b.request_id);
if (dup) return sendJson(res, { ok: true, duplicate: true, record: dup });
const agg = invAggWarehouse(live, rec.item_id, rec.warehouse);
const availRows = agg.rows.filter(x => x.stock_status === 'available' && Number(x.quantity) > 0).sort((a, b) => Number(b.quantity) - Number(a.quantity));
let remain = round2(qty); const sources = [];
for (const row of availRows) { if (remain <= 1e-9) break; const take = round2(Math.min(Number(row.quantity), remain)); if (take <= 1e-9) continue; sources.push({ location: row.location, lot_no: row.lot_no, qty: take }); remain = round2(remain - take); }
if (remain > 1e-9) return sendJson(res, { error: 'موجودی فیزیکی کافی نیست.', physical: agg.physical }, 409);
const baseNo = 'GIN-' + Date.now();
let mainIssue = null;
sources.forEach((src, idx) => {
const iss = { id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: String(b.request_id || '') + (idx > 0 ? '-' + (idx + 1) : ''), issue_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''), item_id: rec.item_id, quantity: src.qty, unit: (invFindItem(live, rec.item_id) || {}).unit || '', lot_no: src.lot_no, warehouse: rec.warehouse, location: src.location, destination: String(b.destination || 'مصرف رزرو').trim(), destination_ref: String(b.destination_ref || rec.work_order || '').trim(), work_order: String(b.work_order || rec.work_order || '').trim(), description: String(b.description || 'مصرف رزرو ' + rec.reservation_no).slice(0, 500), timestamp: new Date().toISOString(), operator_id: String((req.user && req.user.username) || '') };
live.inventory_issues.push(iss);
if (!mainIssue) mainIssue = iss;
});
live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
live.inventory_reservation_logs.push({ id: 'rlog-con-' + rec.id + '-' + Date.now().toString(36), tx_type: 'consume', issue_no: mainIssue ? mainIssue.issue_no : '', item_id: rec.item_id, quantity: qty, warehouse: rec.warehouse, lot_no: '', destination: String(b.work_order || b.destination_ref || 'مصرف رزرو'), timestamp: new Date().toISOString() });
rec.quantity = round2(Number(rec.quantity) - qty);
if (rec.quantity <= 1e-9) { rec.status = 'consumed'; rec.closed_at = new Date().toISOString(); } else { rec.status = 'open'; rec.closed_at = null; }
invSave(live, req, 'inventory.reserve.consume', { reservation: rec, issue: mainIssue });
return sendJson(res, { ok: true, record: rec, issue: mainIssue }, 201);
} catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
}).catch(e => sendJson(res, { error: e.message }, 500));
return;
}
// ===== END FIX-RES-1 =====
    // ===== FIX-INV-0-HARDENING: حذف endpoint تکراری مرده (نسخهٔ دوم POST /api/inventory/reserve — غیرقابل‌دسترس پس از FIX-RES-1) =====

    // ================================================================
    // UNRESERVE (آزادسازی رزرو)
    // ================================================================
    if (req.method === 'POST' && pathname === '/api/inventory/unreserve') {
        // ===== FIX-INV-0-HARDENING: محدودکردن unreserve به نقش انباردار (آزادسازی UI از مسیر reserve/release انجام می‌شود) =====
        if (!auth.requireRole(req, ['warehouse'])) {
            return sendJson(res, { error: 'دسترسی غیرمجاز: آزادسازی مستقیم رزرو فقط برای انباردار است.' }, 403);
        }
        readBody(req).then(body => {
            try {
                const b = JSON.parse(body || '{}');
                const live = invEnsure(readLive());
                const id = String(b.id || '');
                const idx = live.inventory_reservations.findIndex(r => r.id === id);
                if (idx === -1) return sendJson(res, { error: 'رزرو مورد نظر یافت نشد.' }, 404);

                // حذف رزرو از لیست
                const __rel = live.inventory_reservations[idx]; if (__rel) { live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : []; live.inventory_reservation_logs.push({ id: 'rlog-unr-' + __rel.id, tx_type: 'release', issue_no: 'REL-' + Date.now(), item_id: __rel.item_id, quantity: __rel.quantity, warehouse: __rel.warehouse, lot_no: '', destination: 'آزادسازی رزرو', timestamp: new Date().toISOString() }); }
live.inventory_reservations.splice(idx, 1);

                invSave(live, req, 'inventory.unreserve', { id });
                return sendJson(res, { ok: true }, 200);
            } catch (e) {
                return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400);
            }
        }).catch(e => sendJson(res, { error: e.message }, 500));
        return;
    }


    // ================================================================
    // ===== FEAT-SALES-21a (begin): ماژول فروش — مشتریان / لیست قیمت /
    // سفارش فروش / رزرو موجودی (موتور رزرو موجود FIX-RES-1) / حوالهٔ خروج
    // فروش (حرکت خروج انبار با مقصد «فروش») — همهٔ داده‌ها افزاینده در live.json
    // نقش‌ها: sales/admin ثبت و تأیید؛ warehouse فقط ثبت حواله؛
    // manager/finance فقط‌خواندن — گیت لایسنس ماژول «sales» مثل بقیهٔ ماژول‌ها
    // ================================================================
    function salesEnsure21a(live) {
        live.customers = Array.isArray(live.customers) ? live.customers : [];
        live.price_list = Array.isArray(live.price_list) ? live.price_list : [];
        live.sales_orders = Array.isArray(live.sales_orders) ? live.sales_orders : [];
        live.sales_exits = Array.isArray(live.sales_exits) ? live.sales_exits : [];
        live.sales_seq = live.sales_seq && typeof live.sales_seq === 'object' ? live.sales_seq : { order: 0, exit: 0 };
        return live;
    }
    const SALES_SIZES_21A = ['8', '10', '12', '14', '16', '18', '20', '22', '25', '28', '32', '5SP'];
    const SALES_STATUS_FA_21A = { draft: 'پیش‌نویس', reserved: 'تأیید شده (رزروشده)', completed: 'تکمیل', cancelled: 'لغو شده' };
    function salesNextNo21a(live, key, prefix) { live.sales_seq[key] = (Number(live.sales_seq[key]) || 0) + 1; return prefix + '-' + String(live.sales_seq[key]).padStart(5, '0'); }
    function salesFmt21a(n) { return groupFaFa(Number(n) || 0); }
    function groupFaFa(n) { try { return Number(n).toLocaleString('fa-IR', { maximumFractionDigits: 3 }); } catch (e) { return String(n); } }
    /* کالای محصول per سایز — اگر در انبار تعریف نشده باشد، افزاینده ساخته می‌شود (واحد تن، انبار محصول) */
    function salesItemForSize21a(live, size) {
        const want = String(size) === '5SP' ? '5SP' : 'RB-' + String(size);
        let it = (live.inventory_items || []).find((x) => String(x.code || '').toUpperCase() === want.toUpperCase() && x.active !== false);
        if (!it) {
            it = { id: 'itm-sls-' + String(size) + '-' + Date.now().toString(36), code: want, name: String(size) === '5SP' ? 'میلگرد گرید 5SP' : ('میلگرد آجدار سایز ' + String(size)), unit: 'تن', category: 'محصول', active: true, min_stock: 0, reorder_point: 0, batch_tracking: false, _sales21a: true };
            live.inventory_items.push(it);
        }
        return it;
    }
    function salesValidJalali21a(d) { const s = finDigitsEn(String(d || '')).trim(); return /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.test(s) && planJalaliToTs(s, 12) ? s : null; }
    function salesOpenResOf21a(live, orderId, size, itemId) {
        return (live.inventory_reservations || []).filter((r) => r.status === 'open' && r.sales_order_id === orderId && (size == null || String(r.sales_size) === String(size)) && (itemId == null || r.item_id === itemId));
    }
    const SALES_READ_21A = ['sales', 'manager', 'finance', 'warehouse'];
    const SALES_WRITE_21A = ['sales']; /* admin همیشه با requireRole عبور می‌کند */
    const SALES_EXIT_21A = ['warehouse', 'sales'];

    if (req.method === 'GET' && pathname === '/api/sales/overview') {
        if (!auth.requireRole(req, SALES_READ_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: مشاهدهٔ فروش برای نقش شما مجاز نیست.' }, 403);
        const live = salesEnsure21a(invEnsure(readLive()));
        const stockBySize = {};
        SALES_SIZES_21A.forEach((sz) => {
            const want = sz === '5SP' ? '5SP' : 'RB-' + sz;
            const it = (live.inventory_items || []).find((x) => String(x.code || '').toUpperCase() === want.toUpperCase() && x.active !== false);
            if (!it) { stockBySize[sz] = { available: 0, physical: 0, reserved: 0, item_id: null, defined: false }; return; }
            const agg = invAggWarehouse(live, it.id, 'product');
            stockBySize[sz] = { available: agg.available, physical: agg.physical, reserved: agg.reserved, item_id: it.id, defined: true };
        });
        const orders = (live.sales_orders || []).map((o) => {
            const exitsOf = (live.sales_exits || []).filter((e) => e.order_id === o.id);
            const items = (o.items || []).map((it) => {
                const ex = round2(exitsOf.filter((e) => String(e.size) === String(it.size)).reduce((s, e) => s + (Number(e.weight_ton) || 0), 0));
                const res = round2(salesOpenResOf21a(live, o.id, it.size).reduce((s, r) => s + (Number(r.quantity) || 0), 0));
                return Object.assign({}, it, { exited_ton: ex, remaining_ton: round2(Math.max(0, (Number(it.qty_ton) || 0) - ex)), reserved_ton: res, line_total_rial: Math.round((Number(it.qty_ton) || 0) * (Number(it.unit_price_rial) || 0)) });
            });
            const total = items.reduce((s, it) => s + it.line_total_rial, 0);
            return Object.assign({}, o, { items, total_rial: total, status_fa: SALES_STATUS_FA_21A[o.status] || o.status, exits_count: exitsOf.length });
        });
        return sendJson(res, {
            ok: true,
            customers: live.customers || [],
            price_list: (live.price_list || []).slice().sort((a, b) => String(b.effective_date_jalali || '').localeCompare(String(a.effective_date_jalali || ''))),
            orders: orders.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
            exits: (live.sales_exits || []).slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))),
            stock_by_size: stockBySize,
            sizes: SALES_SIZES_21A,
            vat_rate: (live.fin_config && Number(live.fin_config.vat_rate)) || 10,
            today_jalali: finIsoToJalali(new Date().toISOString()),
            status_fa: SALES_STATUS_FA_21A,
        });
    }

    if (req.method === 'POST' && pathname === '/api/sales/customers') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت مشتری فقط برای واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const name = String(b.name || '').trim();
                if (name.length < 2) return sendJson(res, { error: 'نام مشتری الزامی است.' }, 400);
                if (!/^[0-9۰-۹]{10,14}$/.test(finDigitsEn(String(b.national_id || '')).trim())) return sendJson(res, { error: 'شناسهٔ ملی/کد ملی باید ۱۰ تا ۱۴ رقم باشد (اقلام الزامی مؤدیان).' }, 400);
                const rec = {
                    id: 'cust-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    name: name.slice(0, 120),
                    national_id: finDigitsEn(String(b.national_id || '')).trim(),
                    economic_id: finDigitsEn(String(b.economic_id || '')).trim().slice(0, 20),
                    address: String(b.address || '').trim().slice(0, 300),
                    phone: finDigitsEn(String(b.phone || '')).trim().slice(0, 20),
                    credit_limit_rial: Math.max(0, Math.round(Number(finDigitsEn(b.credit_limit_rial)) || 0)),
                    payment_term_days: Math.max(0, Math.round(Number(finDigitsEn(b.payment_term_days)) || 0)),
                    active: b.active === false ? false : true,
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(), updated_at: null,
                };
                live.customers.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ مشتری انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.customer.create', { id: rec.id, name: rec.name });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }
    if (req.method === 'PUT' && pathname === '/api/sales/customers') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ویرایش مشتری فقط برای واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const rec = (live.customers || []).find((x) => x.id === String(b.id || ''));
                if (!rec) return sendJson(res, { error: 'مشتری یافت نشد.' }, 404);
                if (b.name != null) rec.name = String(b.name).trim().slice(0, 120) || rec.name;
                if (b.national_id != null) { const nid = finDigitsEn(String(b.national_id)).trim(); if (!/^[0-9]{10,14}$/.test(nid)) return sendJson(res, { error: 'شناسهٔ ملی/کد ملی باید ۱۰ تا ۱۴ رقم باشد.' }, 400); rec.national_id = nid; }
                if (b.economic_id != null) rec.economic_id = finDigitsEn(String(b.economic_id)).trim().slice(0, 20);
                if (b.address != null) rec.address = String(b.address).trim().slice(0, 300);
                if (b.phone != null) rec.phone = finDigitsEn(String(b.phone)).trim().slice(0, 20);
                if (b.credit_limit_rial != null) rec.credit_limit_rial = Math.max(0, Math.round(Number(finDigitsEn(b.credit_limit_rial)) || 0));
                if (b.payment_term_days != null) rec.payment_term_days = Math.max(0, Math.round(Number(finDigitsEn(b.payment_term_days)) || 0));
                if (b.active != null) rec.active = !!b.active;
                rec.updated_at = new Date().toISOString();
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ مشتری انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.customer.update', { id: rec.id });
                return sendJson(res, { ok: true, record: rec });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/price-list') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت قیمت فقط برای واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const size = String(b.size || '').trim();
                if (SALES_SIZES_21A.indexOf(size) === -1) return sendJson(res, { error: 'سایز نامعتبر است — سایزهای مجاز: ۸ تا ۳۲ و 5SP.' }, 400);
                const price = Math.round(Number(finDigitsEn(b.price_rial_per_ton)) || 0);
                if (price <= 0) return sendJson(res, { error: 'قیمت پایهٔ هر تن باید بزرگ‌تر از صفر باشد (ریال).' }, 400);
                const dj = salesValidJalali21a(b.effective_date_jalali);
                if (!dj) return sendJson(res, { error: 'تاریخ اثر شمسی نامعتبر است (نمونه: ۱۴۰۵/۰۶/۰۱).' }, 400);
                const rec = { id: 'price-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), size: size, grade: String(b.grade || '').trim().slice(0, 20), price_rial_per_ton: price, effective_date_jalali: dj, active: b.active === false ? false : true, created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString() };
                live.price_list.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ قیمت انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.price.create', { id: rec.id, size: size, price: price });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }
    if (req.method === 'PUT' && pathname === '/api/sales/price-list') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const rec = (live.price_list || []).find((x) => x.id === String(b.id || ''));
                if (!rec) return sendJson(res, { error: 'ردیف قیمت یافت نشد.' }, 404);
                if (b.price_rial_per_ton != null) { const p = Math.round(Number(finDigitsEn(b.price_rial_per_ton)) || 0); if (p <= 0) return sendJson(res, { error: 'قیمت باید بزرگ‌تر از صفر باشد.' }, 400); rec.price_rial_per_ton = p; }
                if (b.effective_date_jalali != null) { const dj = salesValidJalali21a(b.effective_date_jalali); if (!dj) return sendJson(res, { error: 'تاریخ اثر شمسی نامعتبر است.' }, 400); rec.effective_date_jalali = dj; }
                if (b.active != null) rec.active = !!b.active;
                if (b.grade != null) rec.grade = String(b.grade).trim().slice(0, 20);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ قیمت انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.price.update', { id: rec.id });
                return sendJson(res, { ok: true, record: rec });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    // ===== FEAT-QC-PRO-24b (begin): ثابت‌ها و توابع NCR/MTC — قبل از هندلرهای فروش تا گارد حواله (qcExitBlock24b) بدون TDZ کار کند =====
    const NCR_TYPE_FA_24B = { chem: 'شیمیایی', mech: 'مکانیکی', dim: 'ابعادی', visual: 'ظاهری' };
    const NCR_SEV_FA_24B = { minor: 'جزئی (Minor)', major: 'عمده (Major)', critical: 'بحرانی (Critical)' };
    const NCR_ACTION_FA_24B = { rework: 'دوباره‌کاری', concession: 'ارفاق استفاده', rejection: 'رد (Rejection)' };
    const QC_MTC_W_24B = ['admin', 'qc'];
    const QC_NCR_W_24B = ['admin', 'qc'];
    /* هیت‌های میلگرد یک سایز از بندیل‌ها — برای گارد حواله */
    function qcHeatsOfSize24b(live, size) {
        const set = new Set();
        (live.rebar_bundles || []).forEach((b) => { if (b && String(b.rebar_size) === String(size) && b.heat_number) set.add(String(b.heat_number)); });
        return set;
    }
    /* آیا برای این سایز NCR بازِ مسدودکننده وجود دارد؟ (Major/Critical یا اقدام رد) */
    function qcExitBlock24b(live, size) {
        const heats = qcHeatsOfSize24b(live, size);
        const blocking = (live.qc_ncr_24 || []).filter((n) => n && n.status === 'open' && (n.severity === 'major' || n.severity === 'critical' || n.action === 'rejection'));
        return blocking.find((n) => (n.heat_number && heats.has(String(n.heat_number))) || (!n.heat_number && n.size && String(n.size) === String(size))) || null;
    }
    /* نتایج آزمون یک هیت برای MTC — اولویت: آزمون ورودی تأییدشده ← QC آزمایشگاه (مکانیکی) ← null */
    function qcTestForHeat24b(live, heat) {
        const inc = (live.qc_incoming_24 || []).find((t) => t.status === 'approved' && String(t.heat_number) === String(heat));
        const lab = (live.quality_inspections || []).filter((q) => String(q.heat_number || '') === String(heat)).slice(-1)[0] || null;
        return {
            chem: inc ? inc.chem : null,
            mech: inc ? inc.mech : (lab ? { ReH: Number(lab.yield_strength) || 0, Rm: Number(lab.tensile_strength) || 0, A: Number(lab.elongation_percent) || 0, bend: !!Number(lab.bend_test_passed) } : null),
            source: inc ? 'آزمون ورودی تأییدشده (اسپکترومتری/کشش)' : (lab ? 'آزمایشگاه QC تولید' : ''),
            inc_test_no: inc ? inc.test_no : '',
        };
    }
    // ===== FEAT-QC-PRO-24b (helpers end) =====
    if (req.method === 'POST' && pathname === '/api/sales/orders') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت سفارش فقط برای واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const cust = (live.customers || []).find((c) => c.id === String(b.customer_id || '') && c.active !== false);
                if (!cust) return sendJson(res, { error: 'مشتری فعال انتخاب نشده است — ابتدا مشتری را ثبت/فعال کنید.' }, 400);
                const dj = salesValidJalali21a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                const ddj = salesValidJalali21a(b.due_date_jalali);
                if (!ddj) return sendJson(res, { error: 'سررسید شمسی نامعتبر است (نمونه: ۱۴۰۵/۰۶/۱۵).' }, 400);
                const itemsIn = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
                const merged = {};
                for (const it of itemsIn) {
                    const size = String((it && it.size) || '').trim();
                    if (SALES_SIZES_21A.indexOf(size) === -1) return sendJson(res, { error: 'سایز اقلام سفارش نامعتبر است: ' + (size || 'خالی') }, 400);
                    const qty = round2(Number(finDigitsEn(it.qty_ton)) || 0);
                    if (!(qty > 0)) return sendJson(res, { error: 'تناژ درخواستی سایز ' + size + ' باید بزرگ‌تر از صفر باشد.' }, 400);
                    const price = Math.round(Number(finDigitsEn(it.unit_price_rial)) || 0);
                    if (price <= 0) return sendJson(res, { error: 'قیمت هر تن برای سایز ' + size + ' الزامی است (از لیست قیمت پیش‌فرض می‌شود).' }, 400);
                    if (merged[size]) merged[size].qty_ton = round2(merged[size].qty_ton + qty);
                    else merged[size] = { size: size, qty_ton: qty, pieces: Math.max(0, Math.round(Number(finDigitsEn(it.pieces)) || 0)), unit_price_rial: price };
                }
                const items = Object.keys(merged).map((k) => merged[k]);
                if (!items.length) return sendJson(res, { error: 'حداقل یک قلم کالا به سفارش اضافه کنید.' }, 400);
                const vatRate = (live.fin_config && Number(live.fin_config.vat_rate)) || 10;
                const orderTotal = items.reduce((s, it) => s + Math.round((Number(it.qty_ton) || 0) * (Number(it.unit_price_rial) || 0)), 0);
                /* سقف اعتبار: مجموع سفارش‌های باز/جاری مشتری + این سفارش (هشدار — مسدودکننده نیست) */
                let exposure = orderTotal;
                (live.sales_orders || []).forEach((o) => { if (o.customer_id === cust.id && (o.status === 'draft' || o.status === 'reserved')) { (o.items || []).forEach((it) => { exposure += Math.round((Number(it.qty_ton) || 0) * (Number(it.unit_price_rial) || 0)); }); } });
                /* FEAT-SALES-21b: ماندهٔ دریافتنی فعلی مشتری هم به تعهدات لحاظ می‌شود */
                exposure += Math.max(0, salesArBalance21b(live, cust.id));
                let credit_warning = '';
                if ((Number(cust.credit_limit_rial) || 0) > 0 && exposure > Number(cust.credit_limit_rial)) {
                    credit_warning = 'هشدار سقف اعتبار: مجموع تعهدات باز مشتری ' + salesFmt21a(exposure) + ' ریال از سقف اعتبار ' + salesFmt21a(cust.credit_limit_rial) + ' ریال عبور می‌کند.';
                }
                const rec = {
                    id: 'so-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    order_no: salesNextNo21a(live, 'order', 'SO'),
                    customer_id: cust.id, customer_name: cust.name,
                    items: items, date_jalali: dj, due_date_jalali: ddj,
                    vat_rate: vatRate, status: 'draft', notes: String(b.notes || '').trim().slice(0, 300),
                    is_export: b.is_export === true, /* FEAT-QC-PRO-24b: سفارش صادراتی — صدور MTC الزامی می‌شود (EN 10204 3.1) */
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(),
                    confirmed_at: null, cancelled_at: null,
                };
                live.sales_orders.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ سفارش انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.order.create', { order_no: rec.order_no, customer: cust.name, items: items.length });
                return sendJson(res, { ok: true, record: rec, credit_warning: credit_warning }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/orders/confirm') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: تأیید سفارش فقط برای واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const order = (live.sales_orders || []).find((o) => o.id === String(b.id || '') || o.order_no === String(b.id || ''));
                if (!order) return sendJson(res, { error: 'سفارش یافت نشد.' }, 404);
                if (order.status !== 'draft') return sendJson(res, { error: 'فقط سفارش پیش‌نویس قابل تأیید است (وضعیت فعلی: ' + (SALES_STATUS_FA_21A[order.status] || order.status) + ').' }, 409);
                /* گام ۱ — بررسی موجودی قابل‌فروش برای همهٔ اقلام (اتمیک: همه پاس شد → رزرو) */
                const plan = [];
                for (const it of (order.items || [])) {
                    const item = salesItemForSize21a(live, it.size);
                    const agg = invAggWarehouse(live, item.id, 'product');
                    if (agg.available < (Number(it.qty_ton) || 0) - 1e-9) {
                        return sendJson(res, { error: 'موجودی قابل‌فروش کافی نیست (موجودی ' + salesFmt21a(agg.physical) + ' / رزرو ' + salesFmt21a(agg.reserved) + ' / قابل‌فروش ' + salesFmt21a(agg.available) + ' تن) — سایز ' + it.size + ' — درخواست ' + salesFmt21a(it.qty_ton) + ' تن', available: agg.available, physical: agg.physical, reserved: agg.reserved }, 409);
                    }
                    plan.push({ it: it, item: item });
                }
                /* گام ۲ — رزرو از موتور رزرو موجود (inventory_reservations — تب انبار ستون «رزرو» را نشان می‌دهد) */
                const nowIso = new Date().toISOString();
                const reservations = [];
                plan.forEach((p) => {
                    const rec = { id: 'res-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: 'sales:' + order.order_no + ':' + p.it.size, reservation_no: 'SRES-' + Date.now() + '-' + p.it.size, item_id: p.item.id, warehouse: 'product', quantity: Number(p.it.qty_ton) || 0, status: 'open', reason: 'فروش — ' + order.order_no, work_order: order.order_no, sales_order_id: order.id, sales_size: String(p.it.size), created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: nowIso, closed_at: null };
                    live.inventory_reservations.push(rec);
                    live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
                    live.inventory_reservation_logs.push({ id: 'rlog-' + rec.id, tx_type: 'reserve', receipt_no: rec.reservation_no, item_id: rec.item_id, quantity: rec.quantity, warehouse: rec.warehouse, lot_no: '', destination: rec.reason, timestamp: rec.created_at });
                    reservations.push(rec);
                });
                order.status = 'reserved'; order.confirmed_at = nowIso;
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ تأیید سفارش انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.order.confirm', { order_no: order.order_no, reservations: reservations.map((r) => r.reservation_no) });
                return sendJson(res, { ok: true, record: order, reservations: reservations });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/orders/cancel') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                const order = (live.sales_orders || []).find((o) => o.id === String(b.id || '') || o.order_no === String(b.id || ''));
                if (!order) return sendJson(res, { error: 'سفارش یافت نشد.' }, 404);
                if (order.status === 'cancelled') return sendJson(res, { error: 'این سفارش قبلاً لغو شده است.' }, 409);
                if (order.status === 'completed') return sendJson(res, { error: 'سفارش تکمیل‌شده قابل لغو نیست.' }, 409);
                const nowIso = new Date().toISOString();
                /* آزادسازی رزروهای باز فروش این سفارش */
                let released = 0;
                salesOpenResOf21a(live, order.id, null, null).forEach((r) => {
                    r.status = 'released'; r.closed_at = nowIso; released += Number(r.quantity) || 0;
                    live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
                    live.inventory_reservation_logs.push({ id: 'rlog-rel-' + r.id + '-' + Date.now().toString(36), tx_type: 'release', issue_no: 'REL-' + Date.now(), item_id: r.item_id, quantity: r.quantity, warehouse: r.warehouse, lot_no: '', destination: 'لغو سفارش فروش ' + order.order_no, timestamp: nowIso });
                });
                order.status = 'cancelled'; order.cancelled_at = nowIso; order.cancel_reason = String(b.reason || '').trim().slice(0, 200);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ لغو سفارش انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.order.cancel', { order_no: order.order_no, released_ton: released });
                return sendJson(res, { ok: true, record: order, released_ton: round2(released) });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/exits') {
        if (!auth.requireRole(req, SALES_EXIT_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت حوالهٔ خروج فقط برای انباردار/واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21a(invEnsure(readLive()));
                /* HARDEN-18D: همزمانی خوش‌بینانه — X-Base-Ver کهنه ⇒ 409 VER_CONFLICT (انتخابی؛ بدون هدر = رفتار قدیمی) */
                const vc18d = assertFreshVer18D(req, live);
                if (vc18d) return verConflict18D(res, vc18d);
                const order = (live.sales_orders || []).find((o) => o.id === String(b.order_id || '') || o.order_no === String(b.order_id || ''));
                if (!order) return sendJson(res, { error: 'سفارش یافت نشد.' }, 404);
                if (order.status !== 'reserved') return sendJson(res, { error: 'حوالهٔ خروج فقط برای سفارش تأیید/رزروشده مجاز است (وضعیت فعلی: ' + (SALES_STATUS_FA_21A[order.status] || order.status) + ').' }, 409);
                const size = String(b.size || '').trim();
                const line = (order.items || []).find((it) => String(it.size) === size);
                if (!line) return sendJson(res, { error: 'سایز «' + size + '» در اقلام این سفارش نیست.' }, 400);
                /* ===== FEAT-QC-PRO-24b (begin): گارد عدم انطباق باز (NCR) — بندیل/هیت دارای NCR باز (Major/Critical یا اقدام رد) حواله نمی‌شود ===== */
                const ncrHit24b = qcExitBlock24b(live, size);
                if (ncrHit24b) return sendJson(res, { error: 'حواله مجاز نیست: عدم انطباق باز (NCR ' + ncrHit24b.ncr_no + ' — ' + (NCR_SEV_FA_24B[ncrHit24b.severity] || ncrHit24b.severity) + ') روی ' + (ncrHit24b.heat_number ? 'هیت ' + ncrHit24b.heat_number : 'سایز ' + (ncrHit24b.size || size)) + ' ثبت شده است — ابتدا در کنترل کیفیت (QC-PRO) بسته شود.', code: 'NCR_OPEN', ncr_no: ncrHit24b.ncr_no }, 409);
                /* ===== FEAT-QC-PRO-24b (end) ===== */
                const weight = round2(Number(finDigitsEn(b.weight_ton)) || 0);
                if (!(weight > 0)) return sendJson(res, { error: 'وزن باسکول باید بزرگ‌تر از صفر باشد (تن).' }, 400);
                const dj = salesValidJalali21a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                /* ماندهٔ رزرو باز همین سفارش/سایز — حواله از رزرو کم می‌کند */
                const openRes = salesOpenResOf21a(live, order.id, size, null).sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)));
                let reserved = round2(openRes.reduce((s, r) => s + (Number(r.quantity) || 0), 0));
                if (weight > reserved + 1e-9) {
                    return sendJson(res, { error: 'حواله بیش از ماندهٔ رزرو این سفارش است (ماندهٔ رزرو: ' + salesFmt21a(reserved) + ' تن — وزن: ' + salesFmt21a(weight) + ' تن).' }, 409);
                }
                const item = salesItemForSize21a(live, size);
                const agg = invAggWarehouse(live, item.id, 'product');
                if (agg.physical < weight - 1e-9) {
                    return sendJson(res, { error: 'موجودی فیزیکی انبار محصول کافی نیست (فیزیکی: ' + salesFmt21a(agg.physical) + ' تن).' }, 409);
                }
                /* انتخاب از ردیف‌های فیزیکی — همان الگوی reserve/consume (FIX-RES-1)؛ رزرو پس از انتخاب کم می‌شود */
                const availRows = agg.rows.filter((x) => x.stock_status === 'available' && Number(x.quantity) > 0).sort((a, b2) => Number(b2.quantity) - Number(a.quantity));
                let pickRemain = weight; const sources = [];
                for (const row of availRows) {
                    if (pickRemain <= 1e-9) break;
                    const take = round2(Math.min(Number(row.quantity), pickRemain));
                    if (take <= 1e-9) continue;
                    sources.push({ location: row.location, lot_no: row.lot_no, qty: take });
                    pickRemain = round2(pickRemain - take);
                }
                if (pickRemain > 1e-9) return sendJson(res, { error: 'موجودی فیزیکی قابل خروج یافت نشد.', physical: agg.physical }, 409);
                const nowIso = new Date().toISOString();
                /* ۱) کم‌کردن رزرو به‌اندازهٔ حواله (الگوی reserve/consume موجود — FIX-RES-1) */
                let remain = weight;
                openRes.forEach((r) => {
                    if (remain <= 1e-9) return;
                    const take = round2(Math.min(Number(r.quantity) || 0, remain));
                    r.quantity = round2((Number(r.quantity) || 0) - take);
                    remain = round2(remain - take);
                    if (r.quantity <= 1e-9) { r.status = 'consumed'; r.closed_at = nowIso; }
                    live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
                    live.inventory_reservation_logs.push({ id: 'rlog-con-' + r.id + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5), tx_type: 'consume', issue_no: '', item_id: r.item_id, quantity: take, warehouse: r.warehouse, lot_no: '', destination: 'حوالهٔ فروش — ' + order.order_no, timestamp: nowIso });
                });
                /* ۲) حرکت خروج انبار با نوع «فروش» + ref به سفارش (همان قالب /api/inventory/issue — بدون تغییر در آن API) */
                const baseNo = 'GIN-' + Date.now();
                let mainIssue = null;
                sources.forEach((src, idx) => {
                    const iss = { id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: 'sales-exit:' + order.order_no + ':' + size + ':' + Date.now() + (idx > 0 ? '-' + (idx + 1) : ''), issue_no: baseNo + (idx > 0 ? '-' + (idx + 1) : ''), item_id: item.id, quantity: src.qty, unit: item.unit || 'تن', lot_no: src.lot_no, warehouse: 'product', location: src.location, destination: 'فروش — ' + order.order_no, destination_ref: order.order_no, work_order: order.order_no, description: ('حوالهٔ خروج فروش ' + order.order_no + ' — سایز ' + size + ' — باسکول ' + weight + ' تن').slice(0, 500), timestamp: nowIso, operator_id: String((req.user && (req.user.name || req.user.username)) || '') };
                    live.inventory_issues.push(iss);
                    if (!mainIssue) mainIssue = iss;
                });
                /* ۳) رکورد حوالهٔ فروش */
                const rec = { id: 'sexit-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), exit_no: salesNextNo21a(live, 'exit', 'EX'), order_id: order.id, order_no: order.order_no, customer_id: order.customer_id, size: size, weight_ton: weight, pieces: Math.max(0, Math.round(Number(finDigitsEn(b.pieces)) || 0)), truck_plate: String(b.truck_plate || '').trim().slice(0, 30), driver: String(b.driver || '').trim().slice(0, 60), date_jalali: dj, issue_no: mainIssue ? mainIssue.issue_no : '', reservation_left: round2(reserved - weight), created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: nowIso };
                live.sales_exits.push(rec);
                /* ۴) تکمیل سفارش اگر همهٔ اقلام کاملاً حواله شد */
                const doneAll = (order.items || []).every((it) => round2((live.sales_exits || []).filter((e) => e.order_id === order.id && String(e.size) === String(it.size)).reduce((s, e) => s + (Number(e.weight_ton) || 0), 0)) >= (Number(it.qty_ton) || 0) - 1e-9);
                if (doneAll) order.status = 'completed';
                /* FEAT-SALES-21b: سند خودکار بهای تمام‌شدهٔ کالای فروش‌رفته — بدهکار 510006 / بستانکار 110003 (بهای استاندارد BOM سایز — همان قرارداد فاز ۸) از موتور سند واحد، idempotent per exit_no */
                salesEnsure21b(live); salesEnsureAccounts21b(live);
                const cfgB21b = live.fin_config || {};
                const accByCode21b = {}; (live.fin_accounts || []).forEach((a) => { accByCode21b[a.code] = a; });
                const bomB21b = (live.fin_bom || []).find((x) => String(x.size) === String(size));
                const stdB21b = bomB21b ? finStdCostPerTon(bomB21b, cfgB21b) : Math.round((Number(cfgB21b.billet_rial_per_kg) || 0) * 1.035 * 1000 + 110 * (Number(cfgB21b.energy_tariff_rial_per_kwh) || 0) + 2500000 + 4000000 + 350000);
                const cogsAmt21b = Math.round(weight * stdB21b);
                if (cogsAmt21b > 0 && accByCode21b['510006'] && accByCode21b['110003']) {
                    finPostDoc(live, { source: 'sales', ref_module: 'sales', ref_id: 'exit:' + rec.exit_no, date_jalali: dj, desc: 'بهای تمام‌شدهٔ کالای فروش‌رفته — حوالهٔ ' + rec.exit_no + ' — سایز ' + size + ' — ' + weight + ' تن × بهای استاندارد BOM', lines: [ { account_id: accByCode21b['510006'].id, debit: cogsAmt21b, cost_center_id: 'cc-mill', ref_id: rec.exit_no }, { account_id: accByCode21b['110003'].id, credit: cogsAmt21b, ref_id: rec.exit_no } ], created_by: String((req.user && (req.user.name || req.user.username)) || '') });
                }
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ حوالهٔ فروش انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.exit.create', { exit_no: rec.exit_no, order_no: order.order_no, size: size, weight_ton: weight, issue_no: rec.issue_no });
                return sendJson(res, { ok: true, record: rec, issue: mainIssue, order_status: order.status }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }
    // ===== FEAT-SALES-21a (end) =====



    // ================================================================
    // ===== FEAT-SALES-21b (begin): فاکتور فروش + VAT (از fin_config) +
    // اسناد خودکار از موتور سند واحد finPostDoc (source «sales» + ref_id یکتا =
    // idempotent) + دریافت وجوه + حساب‌های دریافتنی (AR) + Aging شمسی + گزارش‌ها
    // حساب‌های لازم (بانک/صندوق/دریافتنی/پیش‌دریافت/بهای فروش) فقط اگر نبودند
    // به‌صورت افزاینده ساخته می‌شوند — finSeed/finPostDoc/هستهٔ مالی دست‌نخورده
    // ================================================================
    function salesEnsure21b(live) {
        live.sales_invoices = Array.isArray(live.sales_invoices) ? live.sales_invoices : [];
        live.sales_receipts = Array.isArray(live.sales_receipts) ? live.sales_receipts : [];
        live.sales_seq = live.sales_seq && typeof live.sales_seq === 'object' ? live.sales_seq : {};
        if (live.sales_seq.invoice == null) live.sales_seq.invoice = 0;
        if (live.sales_seq.receipt == null) live.sales_seq.receipt = 0;
        return live;
    }
    function salesEnsureAccounts21b(live) {
        if (!live._fin_v1) finSeed(live); /* اگر ماژول مالی هرگز seed نشده بود — همان مسیر رسمی */
        const have = {};
        (live.fin_accounts || []).forEach((a) => { have[a.code] = a; });
        const add = (code, title, type, level) => {
            if (have[code]) return have[code];
            const parent = 'facc-' + (level === 2 ? code[0] : code.slice(0, level === 3 ? 3 : 6));
            const rec = { id: 'facc-' + code, code: code, title: title, type: type, level: level, parent_id: parent, active: true, _sales21b: true };
            live.fin_accounts.push(rec); have[code] = rec;
            return rec;
        };
        add('130', 'نقد و بانک', 'asset', 2);
        add('130001', 'بانک', 'asset', 3);
        add('130002', 'صندوق', 'asset', 3);
        add('110101', 'حساب‌های دریافتنی (تجاری)', 'asset', 3);
        add('230002', 'پیش دریافت از مشتریان', 'liability', 3);
        add('510006', 'بهای تمام‌شده کالای فروش‌رفته', 'expense', 3);
        return live;
    }
    /* حساب تفضیلی دریافتنی per مشتری — کد ۹ رقمی 110101xxx (الگوی کدینگ مالی) */
    function salesArAccount21b(live, cust) {
        salesEnsureAccounts21b(live);
        if (cust.ar_account_id) {
            const a = (live.fin_accounts || []).find((x) => x.id === cust.ar_account_id);
            if (a) return a;
        }
        let n = 1, code = '';
        do { code = '110101' + String(n).padStart(3, '0'); n++; } while ((live.fin_accounts || []).some((a) => a.code === code));
        const rec = { id: 'facc-' + code, code: code, title: 'دریافتنی — ' + String(cust.name || '').slice(0, 60), type: 'asset', level: 4, parent_id: 'facc-110101', active: true, _sales21b: true };
        live.fin_accounts.push(rec);
        cust.ar_account_id = rec.id; cust.ar_account_code = code;
        return rec;
    }
    /* ماندهٔ دریافتنی مشتری = جمع فاکتورهای صادرشده − تخصیص دریافت‌ها − پیش‌دریافت (برگشتی صفر لحاظ می‌شود) */
    function salesArBalance21b(live, customerId) {
        salesEnsure21b(live);
        let bal = 0;
        (live.sales_invoices || []).forEach((inv) => { if (inv.customer_id === customerId && inv.status === 'issued') bal += Number(inv.total_rial) || 0; });
        (live.sales_receipts || []).forEach((r) => { if (r.customer_id === customerId) bal -= (Number(r.allocated_total_rial) || 0) + (Number(r.on_account_rial) || 0); });
        return Math.round(bal);
    }
    function salesJalaliTs21b(dj) { const t = planJalaliToTs(finDigitsEn(String(dj || '')).trim(), 12); return t ? Date.parse(t) : null; }
    function salesDaysLate21b(todayJ, dueJ) {
        const tT = salesJalaliTs21b(todayJ), tD = salesJalaliTs21b(dueJ);
        if (!tT || !tD) return 0;
        return Math.floor((tT - tD) / 86400000);
    }
    function salesAgingBucket21b(daysLate) {
        if (daysLate <= 0) return 'جاری';
        if (daysLate <= 30) return '۱-۳۰';
        if (daysLate <= 60) return '۳۱-۶۰';
        if (daysLate <= 90) return '۶۱-۹۰';
        return '+۹۰';
    }
    const SALES_INV_STATUS_FA_21B = { issued: 'صادرشده', returned: 'برگشتی', cancelled: 'ابطال' };
    const SALES_METHOD_FA_21B = { cash: 'نقد', bank: 'بانک', check: 'چک' };

    if (req.method === 'POST' && pathname === '/api/sales/invoices') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: صدور فاکتور فقط برای واحد فروش مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21b(salesEnsure21a(invEnsure(readLive())));
                const order = (live.sales_orders || []).find((o) => o.id === String(b.order_id || '') || o.order_no === String(b.order_id || ''));
                if (!order) return sendJson(res, { error: 'سفارش یافت نشد.' }, 404);
                if (order.status !== 'reserved' && order.status !== 'completed') return sendJson(res, { error: 'فاکتور فقط برای سفارش تأییدشده صادر می‌شود (وضعیت فعلی: ' + (SALES_STATUS_FA_21A[order.status] || order.status) + ').' }, 409);
                const cust = (live.customers || []).find((c) => c.id === order.customer_id);
                if (!cust) return sendJson(res, { error: 'مشتری سفارش یافت نشد.' }, 404);
                /* اقلام فاکتور = حواله‌های واقعی فاکتورنشده (وزن باسکول) */
                const openExits = (live.sales_exits || []).filter((e) => e.order_id === order.id && !e.invoice_no);
                if (!openExits.length) return sendJson(res, { error: 'حوالهٔ خروج فاکتورنشده‌ای برای این سفارش نیست — ابتدا حواله ثبت کنید.' }, 409);
                /* ===== FEAT-QC-PRO-24b: الزام MTC برای سفارش صادراتی (EN 10204 3.1) — فاکتور صادرات بدون گواهی کیفیت صادر نمی‌شود ===== */
                if (order.is_export && !(live.qc_mtc_24 || []).some((m) => m.order_id === order.id)) {
                    return sendJson(res, { error: 'سفارش صادراتی است — صدور گواهی کیفیت (MTC) الزامی است. ابتدا از پنل کنترل کیفیت حرفه‌ای، MTC این سفارش/حواله را صادر کنید.', code: 'MTC_REQUIRED' }, 409);
                }
                const bySize = {};
                openExits.forEach((e) => {
                    const k = String(e.size);
                    bySize[k] = bySize[k] || { size: k, weight_ton: 0, exits: [] };
                    bySize[k].weight_ton = round2(bySize[k].weight_ton + (Number(e.weight_ton) || 0));
                    bySize[k].exits.push(e.exit_no);
                });
                const lines = Object.keys(bySize).map((k) => {
                    const it = (order.items || []).find((x) => String(x.size) === k);
                    const price = Number(it && it.unit_price_rial) || 0;
                    return { size: k, weight_ton: bySize[k].weight_ton, unit_price_rial: price, line_total_rial: Math.round(bySize[k].weight_ton * price), exits: bySize[k].exits };
                });
                const vatRate = (live.fin_config && Number(live.fin_config.vat_rate)) || 10;
                const goods = lines.reduce((s, l) => s + l.line_total_rial, 0);
                const vat = Math.round(goods * vatRate / 100);
                const total = goods + vat;
                const rec = {
                    id: 'sinv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    invoice_no: salesNextNo21a(live, 'invoice', 'INV'),
                    order_id: order.id, order_no: order.order_no,
                    customer_id: cust.id, customer_name: cust.name,
                    buyer: { name: cust.name, national_id: cust.national_id || '', economic_id: cust.economic_id || '', address: cust.address || '', phone: cust.phone || '' },
                    lines: lines, goods_rial: goods, vat_rate: vatRate, vat_rial: vat, total_rial: total,
                    date_jalali: salesValidJalali21a(b.date_jalali) || finIsoToJalali(new Date().toISOString()),
                    due_date_jalali: order.due_date_jalali || finIsoToJalali(new Date().toISOString()),
                    status: 'issued', paid_rial: 0, exits: openExits.map((e) => e.exit_no),
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(),
                    returned_at: null, return_reason: '',
                };
                /* سند خودکار صدور فاکتور: بدهکار دریافتنی (تفضیلی مشتری) / بستانکار درآمد فروش + بستانکار VAT فروش */
                const arAcc = salesArAccount21b(live, cust);
                const accByCode = {};
                (live.fin_accounts || []).forEach((a) => { accByCode[a.code] = a; });
                if (!accByCode['410001'] || !accByCode['210002']) return sendJson(res, { error: 'حساب‌های درآمد فروش/VAT در کدینگ مالی یافت نشد — ابتدا تب مالی را باز کنید.' }, 409);
                finPostDoc(live, {
                    source: 'sales', ref_module: 'sales', ref_id: 'inv:' + rec.invoice_no,
                    date_jalali: rec.date_jalali,
                    desc: 'فاکتور فروش ' + rec.invoice_no + ' — ' + cust.name + ' — سفارش ' + order.order_no + ' — ' + round2(lines.reduce((s, l) => s + l.weight_ton, 0)) + ' تن',
                    lines: [
                        { account_id: arAcc.id, debit: total, ref_id: rec.invoice_no, note: 'طلب از ' + cust.name },
                        { account_id: accByCode['410001'].id, credit: goods, note: 'فروش میلگرد' },
                        { account_id: accByCode['210002'].id, credit: vat, note: 'مالیات بر ارزش افزوده فروش ' + vatRate + '٪' },
                    ],
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''),
                });
                openExits.forEach((e) => { e.invoice_no = rec.invoice_no; });
                live.sales_invoices.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ فاکتور انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.invoice.create', { invoice_no: rec.invoice_no, order_no: order.order_no, total: total });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'صدور فاکتور ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/invoices/return') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21b(salesEnsure21a(invEnsure(readLive())));
                const inv = (live.sales_invoices || []).find((x) => x.id === String(b.invoice_id || '') || x.invoice_no === String(b.invoice_id || ''));
                if (!inv) return sendJson(res, { error: 'فاکتور یافت نشد.' }, 404);
                if (inv.status !== 'issued') return sendJson(res, { error: 'فقط فاکتور صادرشده قابل برگشت است (وضعیت فعلی: ' + (SALES_INV_STATUS_FA_21B[inv.status] || inv.status) + ').' }, 409);
                const allocated = (live.sales_receipts || []).reduce((s, r) => s + ((r.allocated || []).filter((a) => a.invoice_no === inv.invoice_no).reduce((x, a) => x + (Number(a.amount_rial) || 0), 0)), 0);
                if (allocated > 0) return sendJson(res, { error: 'فاکتور با دریافت ثبت‌شده قابل برگشت نیست — ' + salesFmt21a(allocated) + ' ریال دریافت روی آن تخصیص یافته است.' }, 409);
                const cust = (live.customers || []).find((c) => c.id === inv.customer_id);
                const arAcc = cust ? salesArAccount21b(live, cust) : null;
                const accByCode = {};
                (live.fin_accounts || []).forEach((a) => { accByCode[a.code] = a; });
                if (!arAcc || !accByCode['410001'] || !accByCode['210002']) return sendJson(res, { error: 'حساب‌های مالی فروش یافت نشد.' }, 409);
                /* سند معکوس */
                finPostDoc(live, {
                    source: 'sales', ref_module: 'sales', ref_id: 'ret:' + inv.invoice_no,
                    date_jalali: salesValidJalali21a(b.date_jalali) || finIsoToJalali(new Date().toISOString()),
                    desc: 'برگشت از فروش ' + inv.invoice_no + ' — ' + String(b.reason || '').slice(0, 80),
                    lines: [
                        { account_id: accByCode['410001'].id, debit: inv.goods_rial, note: 'ابطال درآمد فروش' },
                        { account_id: accByCode['210002'].id, debit: inv.vat_rial, note: 'ابطال VAT فروش' },
                        { account_id: arAcc.id, credit: inv.total_rial, note: 'کاهش طلب از ' + inv.customer_name },
                    ],
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''),
                });
                /* بازگشت موجودی به انبار محصول + بازگشت رزرو سفارش (حتی اگر سفارش تکمیل شده بود — بازگشایی به «رزروشده») */
                const nowIso = new Date().toISOString();
                const order = (live.sales_orders || []).find((o) => o.id === inv.order_id);
                inv.lines.forEach((l) => {
                    const item = salesItemForSize21a(live, l.size);
                    live.inventory_receipts.push({ id: 'grn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: 'sales-ret:' + inv.invoice_no + ':' + l.size, receipt_no: 'GRN-' + Date.now(), item_id: item.id, quantity: l.weight_ton, unit: item.unit || 'تن', lot_no: '', warehouse: 'product', location: 'RETURN', stock_status: 'available', receipt_type: 'return', description: ('برگشت از فروش ' + inv.invoice_no + ' — سایز ' + l.size).slice(0, 500), timestamp: nowIso, operator_id: String((req.user && (req.user.name || req.user.username)) || '') });
                    if (order && (order.status === 'reserved' || order.status === 'completed')) {
                        let resv = salesOpenResOf21a(live, order.id, l.size, null)[0];
                        if (!resv) {
                            resv = { id: 'res-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: 'sales:' + order.order_no + ':' + l.size, reservation_no: 'SRES-' + Date.now() + '-' + l.size, item_id: item.id, warehouse: 'product', quantity: 0, status: 'open', reason: 'فروش — ' + order.order_no + ' (برگشت)', work_order: order.order_no, sales_order_id: order.id, sales_size: String(l.size), created_by: 'sales-return', created_at: nowIso, closed_at: null };
                            live.inventory_reservations.push(resv);
                        }
                        resv.quantity = round2((Number(resv.quantity) || 0) + l.weight_ton);
                        if (resv.status !== 'open') { resv.status = 'open'; resv.closed_at = null; }
                        live.inventory_reservation_logs = Array.isArray(live.inventory_reservation_logs) ? live.inventory_reservation_logs : [];
                        live.inventory_reservation_logs.push({ id: 'rlog-ret-' + resv.id + '-' + Date.now().toString(36), tx_type: 'reserve', receipt_no: resv.reservation_no, item_id: resv.item_id, quantity: l.weight_ton, warehouse: resv.warehouse, lot_no: '', destination: 'بازگشت از فروش ' + inv.invoice_no, timestamp: nowIso });
                    }
                });
                if (order && order.status === 'completed') order.status = 'reserved';
                inv.status = 'returned'; inv.returned_at = nowIso; inv.return_reason = String(b.reason || '').trim().slice(0, 200);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ برگشت فروش انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.invoice.return', { invoice_no: inv.invoice_no, total: inv.total_rial });
                return sendJson(res, { ok: true, record: inv });
            } catch (e) { return sendJson(res, { error: 'برگشت فاکتور ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/sales/receipts') {
        if (!auth.requireRole(req, SALES_WRITE_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت دریافت فقط برای واحد فروش/مالی مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = salesEnsure21b(salesEnsure21a(invEnsure(readLive())));
                const cust = (live.customers || []).find((c) => c.id === String(b.customer_id || ''));
                if (!cust) return sendJson(res, { error: 'مشتری یافت نشد.' }, 404);
                const amount = Math.round(Number(finDigitsEn(b.amount_rial)) || 0);
                if (!(amount > 0)) return sendJson(res, { error: 'مبلغ دریافت باید بزرگ‌تر از صفر باشد (ریال).' }, 400);
                const method = ['cash', 'bank', 'check'].indexOf(String(b.method || '')) !== -1 ? String(b.method) : '';
                if (!method) return sendJson(res, { error: 'روش دریافت باید نقد، بانک یا چک باشد.' }, 400);
                const checkNo = finDigitsEn(String(b.check_no || '')).trim();
                if (method === 'check' && !checkNo) return sendJson(res, { error: 'شمارهٔ چک الزامی است.' }, 400);
                const checkDue = method === 'check' ? salesValidJalali21a(b.check_due_jalali) : '';
                if (method === 'check' && !checkDue) return sendJson(res, { error: 'سررسید چک شمسی نامعتبر است.' }, 400);
                const dj = salesValidJalali21a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                /* تخصیص به فاکتورها */
                const allocs = Array.isArray(b.allocations) ? b.allocations.slice(0, 40) : [];
                const allocated = [];
                let allocatedTotal = 0;
                for (const al of allocs) {
                    const amt = Math.round(Number(finDigitsEn(al.amount_rial)) || 0);
                    if (!(amt > 0)) continue;
                    const inv = (live.sales_invoices || []).find((x) => (x.id === String(al.invoice_id || '') || x.invoice_no === String(al.invoice_id || '')) && x.customer_id === cust.id);
                    if (!inv) return sendJson(res, { error: 'فاکتور برای تخصیص یافت نشد.' }, 404);
                    if (inv.status !== 'issued') return sendJson(res, { error: 'تخصیص فقط به فاکتور صادرشده مجاز است (' + inv.invoice_no + ').' }, 409);
                    const prevPaid = Number(inv.paid_rial) || 0;
                    if (amt > (inv.total_rial - prevPaid) + 1e-6) return sendJson(res, { error: 'مبلغ تخصیص به ' + inv.invoice_no + ' بیش از ماندهٔ فاکتور است (مانده: ' + salesFmt21a(inv.total_rial - prevPaid) + ' ریال).' }, 409);
                    allocated.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, amount_rial: amt });
                    allocatedTotal += amt;
                }
                if (allocatedTotal > amount + 1e-6) return sendJson(res, { error: 'جمع تخصیص‌ها از مبلغ دریافت بیشتر است.' }, 409);
                const onAccount = Math.round(amount - allocatedTotal);
                const rec = { id: 'srcp-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), receipt_no: salesNextNo21a(live, 'receipt', 'RCP'), customer_id: cust.id, customer_name: cust.name, amount_rial: amount, method: method, method_fa: SALES_METHOD_FA_21B[method], check_no: checkNo, check_due_jalali: checkDue, date_jalali: dj, allocated: allocated, allocated_total_rial: allocatedTotal, on_account_rial: onAccount, created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString() };
                /* سند خودکار دریافت: بدهکار بانک/صندوق / بستانکار دریافتنی (+پیش‌دریاخت برای علی‌الحساب) */
                const arAcc = salesArAccount21b(live, cust);
                const accByCode = {};
                (live.fin_accounts || []).forEach((a) => { accByCode[a.code] = a; });
                const debitAcc = method === 'cash' ? accByCode['130002'] : accByCode['130001'];
                if (!debitAcc) return sendJson(res, { error: 'حساب بانک/صندوق در کدینگ مالی یافت نشد.' }, 409);
                const linesR = [{ account_id: debitAcc.id, debit: amount, note: (SALES_METHOD_FA_21B[method]) + (method === 'check' ? ' شماره ' + checkNo : '') }];
                if (allocatedTotal > 0) linesR.push({ account_id: arAcc.id, credit: allocatedTotal, note: 'تسویه ' + allocated.map((a) => a.invoice_no).join('، ') });
                if (onAccount > 0) linesR.push({ account_id: accByCode['230002'].id, credit: onAccount, note: 'علی‌الحساب ' + cust.name });
                finPostDoc(live, { source: 'sales', ref_module: 'sales', ref_id: 'rcpt:' + rec.receipt_no, date_jalali: dj, desc: 'دریافت وجه ' + rec.receipt_no + ' — ' + cust.name + ' — ' + salesFmt21a(amount) + ' ریال', lines: linesR, created_by: String((req.user && (req.user.name || req.user.username)) || '') });
                allocated.forEach((a) => { const inv = (live.sales_invoices || []).find((x) => x.id === a.invoice_id); if (inv) inv.paid_rial = round2((Number(inv.paid_rial) || 0) + a.amount_rial); });
                live.sales_receipts.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ دریافت انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'sales.receipt.create', { receipt_no: rec.receipt_no, amount: amount, method: method });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت دریافت ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'GET' && pathname === '/api/sales/finance') {
        if (!auth.requireRole(req, SALES_READ_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = salesEnsure21b(salesEnsure21a(invEnsure(readLive())));
        salesEnsureAccounts21b(live);
        const todayJ = finIsoToJalali(new Date().toISOString());
        const invoices = (live.sales_invoices || []).map((inv) => Object.assign({}, inv, {
            remaining_rial: Math.max(0, Math.round((Number(inv.total_rial) || 0) - (Number(inv.paid_rial) || 0))),
            status_fa: SALES_INV_STATUS_FA_21B[inv.status] || inv.status,
            days_late: inv.status === 'issued' ? salesDaysLate21b(todayJ, inv.due_date_jalali) : 0,
            aging_bucket: inv.status === 'issued' ? salesAgingBucket21b(salesDaysLate21b(todayJ, inv.due_date_jalali)) : '',
        })).sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || '')));
        const receipts = (live.sales_receipts || []).slice().sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || '')));
        const ar = (live.customers || []).map((c) => {
            const open = invoices.filter((inv) => inv.customer_id === c.id && inv.status === 'issued' && inv.remaining_rial > 0).map((inv) => ({ invoice_no: inv.invoice_no, total_rial: inv.total_rial, paid_rial: inv.paid_rial, remaining_rial: inv.remaining_rial, due_date_jalali: inv.due_date_jalali, days_late: inv.days_late, bucket: inv.aging_bucket }));
            return { customer_id: c.id, name: c.name, credit_limit_rial: Number(c.credit_limit_rial) || 0, ar_account_code: c.ar_account_code || '', balance_rial: salesArBalance21b(live, c.id), open_count: open.length, open: open };
        });
        const agingTotals = { 'جاری': 0, '۱-۳۰': 0, '۳۱-۶۰': 0, '۶۱-۹۰': 0, '+۹۰': 0 };
        ar.forEach((c) => c.open.forEach((inv) => { agingTotals[inv.bucket] = (agingTotals[inv.bucket] || 0) + inv.remaining_rial; }));
        return sendJson(res, {
            ok: true, invoices: invoices, receipts: receipts, ar: ar, aging_totals: agingTotals,
            vat_rate: (live.fin_config && Number(live.fin_config.vat_rate)) || 10,
            currency: (live.fin_config && live.fin_config.currency) || 'ریال',
            today_jalali: todayJ,
        });
    }

    if (req.method === 'GET' && pathname === '/api/sales/reports') {
        if (!auth.requireRole(req, SALES_READ_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = salesEnsure21b(salesEnsure21a(invEnsure(readLive())));
        const todayJ = finIsoToJalali(new Date().toISOString());
        /* فروش per سایز/ماه (تناژ از حواله‌ها + مبلغ از فاکتورها) */
        const byKey = {};
        (live.sales_exits || []).forEach((e) => {
            const inv = (live.sales_invoices || []).find((x) => x.invoice_no === e.invoice_no && x.status !== 'cancelled');
            const month = String(e.date_jalali || '').slice(0, 7);
            const k = e.size + '|' + month;
            byKey[k] = byKey[k] || { size: String(e.size), month: month, ton: 0, amount_rial: 0 };
            byKey[k].ton = round2(byKey[k].ton + (Number(e.weight_ton) || 0));
            if (inv) byKey[k].amount_rial += Math.round((Number(e.weight_ton) || 0) * (Number((inv.lines || []).find((l) => l.size === String(e.size)) ? ((inv.lines || []).find((l) => l.size === String(e.size)).unit_price_rial) : 0) || 0));
        });
        const by_size_month = Object.keys(byKey).map((k) => byKey[k]).sort((a, b2) => a.month.localeCompare(b2.month) || Number(a.size) - Number(b2.size));
        const issued = (live.sales_invoices || []).filter((x) => x.status === 'issued');
        const vat = {
            rate: (live.fin_config && Number(live.fin_config.vat_rate)) || 10,
            sales_base: issued.reduce((s, x) => s + (Number(x.goods_rial) || 0), 0),
            vat_total: issued.reduce((s, x) => s + (Number(x.vat_rial) || 0), 0),
            invoices_count: issued.length,
            returned_count: (live.sales_invoices || []).filter((x) => x.status === 'returned').length,
        };
        const arRows = (live.customers || []).map((c) => ({ name: c.name, balance_rial: salesArBalance21b(live, c.id), credit_limit_rial: Number(c.credit_limit_rial) || 0 }));
        return sendJson(res, { ok: true, today_jalali: todayJ, by_size_month: by_size_month, vat: vat, ar: arRows, invoices: (live.sales_invoices || []).length, exits: (live.sales_exits || []).length });
    }

    if (req.method === 'GET' && pathname === '/api/sales/kpi') {
        if (!auth.requireRole(req, SALES_READ_21A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = salesEnsure21b(salesEnsure21a(invEnsure(readLive())));
        const month = finIsoToJalali(new Date().toISOString()).slice(0, 7);
        const ton = round2((live.sales_exits || []).filter((e) => String(e.date_jalali || '').slice(0, 7) === month).reduce((s, e) => s + (Number(e.weight_ton) || 0), 0));
        const rial = (live.sales_invoices || []).filter((x) => x.status === 'issued' && String(x.date_jalali || '').slice(0, 7) === month).reduce((s, x) => s + (Number(x.total_rial) || 0), 0);
        return sendJson(res, { ok: true, month: month, month_ton: ton, month_rial: rial });
    }
    // ===== FEAT-SALES-21b (end) =====
    // ================================================================
    // ===== FEAT-PURCHASE-22a (begin): ماژول خرید — تأمین‌کنندگان /
    // درخواست خرید (PR) / استعلام (quote) / سفارش خرید (PO) / رسید خرید
    // (ورود انبار نوع «خرید» + سند خودکار موجودی/پرداختنی از finPostDoc با
    // source «purchase» و ref_id یکتا = idempotent) — همهٔ داده‌ها افزاینده
    // در live.json؛ رسید انبار موجود دست‌نخورده (فقط استفاده/endpoint موازی)
    // نقش‌ها: purchase/admin ثبت و تأیید؛ warehouse فقط ثبت رسید؛
    // manager/finance فقط‌خواندن — گیت لایسنس ماژول «purchase» مثل بقیه
    // ================================================================
    function purEnsure22a(live) {
        live.suppliers = Array.isArray(live.suppliers) ? live.suppliers : [];
        live.purchase_requests = Array.isArray(live.purchase_requests) ? live.purchase_requests : [];
        live.purchase_quotes = Array.isArray(live.purchase_quotes) ? live.purchase_quotes : [];
        live.purchase_orders = Array.isArray(live.purchase_orders) ? live.purchase_orders : [];
        live.purchase_receipts = Array.isArray(live.purchase_receipts) ? live.purchase_receipts : [];
        live.purchase_seq = live.purchase_seq && typeof live.purchase_seq === 'object' ? live.purchase_seq : { pr: 0, po: 0, receipt: 0 };
        return live;
    }
    const PUR_KIND_FA_22A = { billet: 'شمش (بیلت)', material: 'مواد', part: 'قطعه' };
    const PUR_PR_STATUS_FA_22A = { draft: 'پیش‌نویس', approved: 'تأیید', inquired: 'استعلام‌شده', ordered: 'سفارش‌داده‌شده', completed: 'تکمیل', cancelled: 'لغو' };
    const PUR_PO_STATUS_FA_22A = { issued: 'صادرشده', received: 'تحویل‌گرفته', completed: 'تکمیل', cancelled: 'لغو' };
    function purNextNo22a(live, key, prefix) { live.purchase_seq[key] = (Number(live.purchase_seq[key]) || 0) + 1; return prefix + '-' + String(live.purchase_seq[key]).padStart(5, '0'); }
    const PUR_READ_22A = ['purchase', 'manager', 'finance', 'warehouse'];
    const PUR_WRITE_22A = ['purchase']; /* admin همیشه با requireRole عبور می‌کند */
    const PUR_RCPT_22A = ['warehouse', 'purchase'];
    /* کالای شمش — اگر در انبار تعریف نشده باشد، افزاینده ساخته می‌شود (واحد تن، انبار مواد اولیه) */
    function purBilletItem22a(live) {
        let it = (live.inventory_items || []).find((x) => String(x.code || '').toUpperCase() === 'BILLET' && x.active !== false);
        if (!it) {
            it = { id: 'itm-pur-billet-' + Date.now().toString(36), code: 'BILLET', name: 'شمش فولاد (بیلت)', unit: 'تن', category: 'مواد اولیه', active: true, min_stock: 0, reorder_point: 0, batch_tracking: false, _purchase22a: true };
            live.inventory_items.push(it);
        }
        return it;
    }
    /* کالای مواد/قطعه — از میان کالاهای انبار یا ساخت افزایندهٔ جدید */
    function purMaterialItem22a(live, kind, itemId, itemName, qtyUnit) {
        const it = (live.inventory_items || []).find((x) => x.id === String(itemId || '') && x.active !== false);
        if (it) return it;
        const name = String(itemName || '').trim();
        if (name.length < 2) throw new Error('برای قلم «' + (PUR_KIND_FA_22A[kind] || kind) + '» کالای انبار را انتخاب یا نام کالای جدید را وارد کنید.');
        const prefix = kind === 'part' ? 'PRT' : 'MTL';
        let n = 1, code = '';
        do { code = prefix + '-' + String(n).padStart(3, '0'); n++; } while ((live.inventory_items || []).some((x) => String(x.code).toUpperCase() === code));
        const rec = { id: 'itm-pur-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), code: code, name: name.slice(0, 80), unit: (qtyUnit === 'تن' ? 'تن' : 'عدد'), category: kind === 'part' ? 'قطعات' : 'مواد', active: true, min_stock: 0, reorder_point: 0, batch_tracking: false, _purchase22a: true };
        live.inventory_items.push(rec);
        return rec;
    }
    function purWarehouseFor22a(kind) { return kind === 'part' ? 'spare' : 'raw'; }
    /* ماندهٔ دریافت‌شدهٔ هر ردیف PO از رسیدهای قبلی (به‌جز برگشت‌خورده‌ها) */
    function purReceivedOf22a(live, poNo, poLine) {
        return round2((live.purchase_receipts || []).filter((r) => r.po_no === poNo && r.status !== 'returned').reduce((s, r) => s + ((r.lines || []).filter((l) => Number(l.po_line) === Number(poLine)).reduce((x, l) => x + (Number(l.qty) || 0), 0)), 0));
    }
    /* خطای شمسی مشترک — همان قالب فروش */
    function purValidJalali22a(d) { return salesValidJalali21a(d); }
    /* شمارهٔ ردیف امن — صفر هم معتبر است (باگ falsy-صفر) */
    function purIdx22a(v) { const t = String(v == null ? '' : v).trim(); if (t === '') return -1; const n = Math.round(Number(finDigitsEn(t))); return isNaN(n) ? -1 : n; }
    /* حساب‌های لازم خرید — فقط اگر نبودند افزاینده ساخته می‌شوند (finSeed/هستهٔ مالی دست‌نخورده) */
    function purEnsureAccounts22a(live) {
        if (!live._fin_v1) finSeed(live); /* اگر ماژول مالی هرگز seed نشده بود — همان مسیر رسمی فروش */
        const have = {};
        (live.fin_accounts || []).forEach((a) => { have[a.code] = a; });
        const add = (code, title, type, level) => {
            if (have[code]) return have[code];
            const parent = 'facc-' + (level === 2 ? code[0] : code.slice(0, 3));
            const rec = { id: 'facc-' + code, code: code, title: title, type: type, level: level, parent_id: parent, active: true, _purchase22a: true };
            live.fin_accounts.push(rec); have[code] = rec;
            return rec;
        };
        add('130', 'نقد و بانک', 'asset', 2); /* FEAT-PURCHASE-22b: اگر فروش هرگز اجرا نشده بود (همان کد/عنوان فروش — idempotent) */
        add('130001', 'بانک', 'asset', 3);
        add('130002', 'صندوق', 'asset', 3);
        add('240', 'پرداختنی تجاری', 'liability', 2);
        add('240001', 'حساب‌های پرداختنی (تجاری)', 'liability', 3);
        add('230003', 'پیش‌پرداخت به تأمین‌کنندگان', 'liability', 3);
        add('110005', 'موجودی قطعات و مواد (خرید)', 'asset', 3);
        return live;
    }
    /* حساب تفضیلی پرداختنی per تأمین‌کننده — کد ۹ رقمی 240001xxx (الگوی کدینگ مالی، قرینهٔ دریافتنی فروش 110101xxx) */
    function purApAccount22a(live, sup) {
        purEnsureAccounts22a(live);
        if (sup.ap_account_id) {
            const a = (live.fin_accounts || []).find((x) => x.id === sup.ap_account_id);
            if (a) return a;
        }
        let n = 1, code = '';
        do { code = '240001' + String(n).padStart(3, '0'); n++; } while ((live.fin_accounts || []).some((a) => a.code === code));
        const rec = { id: 'facc-' + code, code: code, title: 'پرداختنی — ' + String(sup.name || '').slice(0, 60), type: 'liability', level: 4, parent_id: 'facc-240001', active: true, _purchase22a: true };
        live.fin_accounts.push(rec);
        sup.ap_account_id = rec.id; sup.ap_account_code = code;
        return rec;
    }

    if (req.method === 'GET' && pathname === '/api/purchase/overview') {
        if (!auth.requireRole(req, PUR_READ_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: مشاهدهٔ خرید برای نقش شما مجاز نیست.' }, 403);
        const live = purEnsure22a(invEnsure(readLive()));
        const prs = (live.purchase_requests || []).map((p) => {
            const quotes = (live.purchase_quotes || []).filter((q) => q.pr_id === p.id);
            const pos = (live.purchase_orders || []).filter((o) => o.pr_id === p.id);
            const best = quotes.filter((q) => q.lines && q.lines.length).map((q) => ({ q: q, avg: q.lines.reduce((s, l) => s + (Number(l.unit_price_rial) || 0), 0) / Math.max(1, q.lines.length) })).sort((a, b2) => a.avg - b2.avg)[0];
            return Object.assign({}, p, {
                quotes_count: quotes.length, orders_count: pos.length,
                cheapest_quote_id: best ? best.q.id : '', cheapest_supplier: best ? best.q.supplier_name : '',
                status_fa: PUR_PR_STATUS_FA_22A[p.status] || p.status,
            });
        }).sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || '')));
        const pos = (live.purchase_orders || []).map((o) => {
            const items = (o.items || []).map((it, idx) => {
                const rec = purReceivedOf22a(live, o.po_no, idx);
                return Object.assign({}, it, { received: rec, remaining: round2(Math.max(0, (Number(it.qty) || 0) - rec)), line_total_rial: Math.round((Number(it.qty) || 0) * (Number(it.unit_price_rial) || 0)) });
            });
            const total = items.reduce((s, it) => s + it.line_total_rial, 0);
            return Object.assign({}, o, { items: items, total_rial: total, status_fa: PUR_PO_STATUS_FA_22A[o.status] || o.status, receipts_count: (live.purchase_receipts || []).filter((r) => r.po_id === o.id).length });
        }).sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || '')));
        return sendJson(res, {
            ok: true,
            suppliers: live.suppliers || [],
            requests: prs,
            quotes: (live.purchase_quotes || []).slice().sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || ''))),
            orders: pos,
            receipts: (live.purchase_receipts || []).slice().sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || ''))),
            inventory_items: (live.inventory_items || []).filter((x) => x.active !== false).map((x) => ({ id: x.id, code: x.code, name: x.name, unit: x.unit, category: x.category || '' })),
            vat_rate: (live.fin_config && Number(live.fin_config.vat_rate)) || 10,
            today_jalali: finIsoToJalali(new Date().toISOString()),
            kind_fa: PUR_KIND_FA_22A, pr_status_fa: PUR_PR_STATUS_FA_22A, po_status_fa: PUR_PO_STATUS_FA_22A,
        });
    }

    if ((req.method === 'POST' || req.method === 'PUT') && pathname === '/api/purchase/suppliers') {
        if (!auth.requireRole(req, PUR_WRITE_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت تأمین‌کننده فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22a(invEnsure(readLive()));
                if (req.method === 'PUT') {
                    const rec = (live.suppliers || []).find((x) => x.id === String(b.id || ''));
                    if (!rec) return sendJson(res, { error: 'تأمین‌کننده یافت نشد.' }, 404);
                    if (b.name != null) rec.name = String(b.name).trim().slice(0, 120) || rec.name;
                    if (b.national_id != null) { const nid = finDigitsEn(String(b.national_id)).trim(); if (!/^[0-9]{10,14}$/.test(nid)) return sendJson(res, { error: 'شناسهٔ ملی/کد ملی باید ۱۰ تا ۱۴ رقم باشد (اقلام الزامی مؤدیان).' }, 400); rec.national_id = nid; }
                    if (b.economic_id != null) rec.economic_id = finDigitsEn(String(b.economic_id)).trim().slice(0, 20);
                    if (b.address != null) rec.address = String(b.address).trim().slice(0, 300);
                    if (b.phone != null) rec.phone = finDigitsEn(String(b.phone || '')).trim().slice(0, 20);
                    if (b.payment_term_days != null) rec.payment_term_days = Math.max(0, Math.round(Number(finDigitsEn(b.payment_term_days)) || 0));
                    if (b.active != null) rec.active = !!b.active;
                    rec.updated_at = new Date().toISOString();
                    if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ تأمین‌کننده انجام نشد.');
                    cache.data = null; cache.at = 0;
                    auditLog(req, 'purchase.supplier.update', { id: rec.id });
                    return sendJson(res, { ok: true, record: rec });
                }
                const name = String(b.name || '').trim();
                if (name.length < 2) return sendJson(res, { error: 'نام تأمین‌کننده الزامی است.' }, 400);
                if (!/^[0-9۰-۹]{10,14}$/.test(finDigitsEn(String(b.national_id || '')).trim())) return sendJson(res, { error: 'شناسهٔ ملی/کد ملی باید ۱۰ تا ۱۴ رقم باشد (اقلام الزامی مؤدیان).' }, 400);
                const rec = {
                    id: 'sup-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    name: name.slice(0, 120),
                    national_id: finDigitsEn(String(b.national_id || '')).trim(),
                    economic_id: finDigitsEn(String(b.economic_id || '')).trim().slice(0, 20),
                    address: String(b.address || '').trim().slice(0, 300),
                    phone: finDigitsEn(String(b.phone || '')).trim().slice(0, 20),
                    payment_term_days: Math.max(0, Math.round(Number(finDigitsEn(b.payment_term_days)) || 0)),
                    active: b.active === false ? false : true,
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(), updated_at: null,
                };
                live.suppliers.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ تأمین‌کننده انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.supplier.create', { id: rec.id, name: rec.name });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/requests') {
        if (!auth.requireRole(req, PUR_WRITE_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت درخواست خرید فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22a(invEnsure(readLive()));
                const itemsIn = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
                const items = [];
                for (const it of itemsIn) {
                    const kind = ['billet', 'material', 'part'].indexOf(String((it && it.kind) || '')) !== -1 ? String(it.kind) : '';
                    if (!kind) return sendJson(res, { error: 'نوع هر قلم باید شمش، مواد یا قطعه باشد.' }, 400);
                    const qty = round2(Number(finDigitsEn(it.qty)) || 0);
                    if (!(qty > 0)) return sendJson(res, { error: 'مقدار درخواستی هر قلم باید بزرگ‌تر از صفر باشد.' }, 400);
                    if (kind !== 'billet') {
                        const hasItem = (live.inventory_items || []).some((x) => x.id === String((it && it.item_id) || '') && x.active !== false);
                        if (!hasItem && String((it && it.item_name) || '').trim().length < 2) return sendJson(res, { error: 'برای قلم «' + (PUR_KIND_FA_22A[kind]) + '» کالای انبار را انتخاب یا نام کالای جدید را وارد کنید.' }, 400);
                    }
                    items.push({ kind: kind, item_id: String((it && it.item_id) || ''), item_name: String((it && it.item_name) || '').trim().slice(0, 80), grade: String((it && it.grade) || '').trim().slice(0, 20), qty: qty, qty_unit: kind === 'billet' ? 'تن' : (String((it && it.qty_unit) || '') === 'تن' ? 'تن' : 'عدد'), need_date_jalali: purValidJalali22a(it.need_date_jalali) || '' });
                }
                if (!items.length) return sendJson(res, { error: 'حداقل یک قلم به درخواست خرید اضافه کنید.' }, 400);
                const dj = purValidJalali22a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                const rec = {
                    id: 'pr-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    pr_no: purNextNo22a(live, 'pr', 'PR'),
                    items: items, date_jalali: dj, status: 'draft',
                    notes: String(b.notes || '').trim().slice(0, 300),
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(),
                    approved_at: null, cancelled_at: null,
                };
                live.purchase_requests.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ درخواست خرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.request.create', { pr_no: rec.pr_no, items: items.length });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && (pathname === '/api/purchase/requests/approve' || pathname === '/api/purchase/requests/cancel')) {
        const isApprove = pathname === '/api/purchase/requests/approve';
        if (!auth.requireRole(req, PUR_WRITE_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: تأیید/لغو فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22a(invEnsure(readLive()));
                const pr = (live.purchase_requests || []).find((x) => x.id === String(b.id || '') || x.pr_no === String(b.id || ''));
                if (!pr) return sendJson(res, { error: 'درخواست خرید یافت نشد.' }, 404);
                const nowIso = new Date().toISOString();
                if (isApprove) {
                    if (pr.status !== 'draft') return sendJson(res, { error: 'فقط درخواست پیش‌نویس قابل تأیید است (وضعیت فعلی: ' + (PUR_PR_STATUS_FA_22A[pr.status] || pr.status) + ').' }, 409);
                    pr.status = 'approved'; pr.approved_at = nowIso;
                } else {
                    if (pr.status === 'cancelled') return sendJson(res, { error: 'این درخواست قبلاً لغو شده است.' }, 409);
                    if (pr.status === 'completed') return sendJson(res, { error: 'درخواست تکمیل‌شده قابل لغو نیست.' }, 409);
                    const openPO = (live.purchase_orders || []).some((o) => o.pr_id === pr.id && o.status !== 'cancelled');
                    if (openPO) return sendJson(res, { error: 'برای این درخواست سفارش خرید باز وجود دارد — ابتدا سفارش(ها) را لغو کنید.' }, 409);
                    pr.status = 'cancelled'; pr.cancelled_at = nowIso; pr.cancel_reason = String(b.reason || '').trim().slice(0, 200);
                }
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ تغییر وضعیت درخواست انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, isApprove ? 'purchase.request.approve' : 'purchase.request.cancel', { pr_no: pr.pr_no });
                return sendJson(res, { ok: true, record: pr });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/quotes') {
        if (!auth.requireRole(req, PUR_WRITE_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت استعلام فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22a(invEnsure(readLive()));
                const pr = (live.purchase_requests || []).find((x) => x.id === String(b.pr_id || '') || x.pr_no === String(b.pr_id || ''));
                if (!pr) return sendJson(res, { error: 'درخواست خرید مرجع یافت نشد.' }, 404);
                if (pr.status !== 'approved' && pr.status !== 'inquired' && pr.status !== 'ordered') return sendJson(res, { error: 'استعلام فقط برای درخواست تأییدشده مجاز است (وضعیت فعلی: ' + (PUR_PR_STATUS_FA_22A[pr.status] || pr.status) + ').' }, 409);
                const sup = (live.suppliers || []).find((s) => s.id === String(b.supplier_id || '') && s.active !== false);
                if (!sup) return sendJson(res, { error: 'تأمین‌کنندهٔ فعال انتخاب نشده است — ابتدا تأمین‌کننده را ثبت/فعال کنید.' }, 400);
                const valid = purValidJalali22a(b.valid_until_jalali);
                if (!valid) return sendJson(res, { error: 'مهلت اعتبار پیشنهاد شمسی نامعتبر است (نمونه: ۱۴۰۵/۰۷/۰۱).' }, 400);
                const linesIn = Array.isArray(b.lines) ? b.lines.slice(0, 30) : [];
                const lines = [];
                for (const li of linesIn) {
                    const idx = purIdx22a(li.item_index);
                    const src = (pr.items || [])[idx];
                    if (!src) return sendJson(res, { error: 'ردیف استعلام با درخواست خرید هم‌خوانی ندارد.' }, 400);
                    const price = Math.round(Number(finDigitsEn(li.unit_price_rial)) || 0);
                    if (price <= 0) return sendJson(res, { error: 'قیمت پیشنهادی برای «' + (src.item_name || PUR_KIND_FA_22A[src.kind]) + '» باید بزرگ‌تر از صفر باشد.' }, 400);
                    lines.push({ item_index: idx, kind: src.kind, item_name: src.item_name || PUR_KIND_FA_22A[src.kind], qty: src.qty, qty_unit: src.qty_unit, unit_price_rial: price });
                }
                if (!lines.length) return sendJson(res, { error: 'حداقل قیمت یک ردیف را در استعلام وارد کنید.' }, 400);
                const rec = {
                    id: 'qt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    pr_id: pr.id, pr_no: pr.pr_no,
                    supplier_id: sup.id, supplier_name: sup.name,
                    lines: lines, valid_until_jalali: valid,
                    payment_terms: String(b.payment_terms || '').trim().slice(0, 200),
                    lead_time_days: Math.max(0, Math.round(Number(finDigitsEn(b.lead_time_days)) || 0)),
                    note: String(b.note || '').trim().slice(0, 200),
                    chosen: false,
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(),
                };
                live.purchase_quotes.push(rec);
                if (pr.status === 'approved') pr.status = 'inquired';
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ استعلام انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.quote.create', { pr_no: pr.pr_no, supplier: sup.name, lines: lines.length });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/orders') {
        if (!auth.requireRole(req, PUR_WRITE_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: صدور سفارش خرید فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22a(invEnsure(readLive()));
                let sup = null, pr = null, itemsIn = null, chosenQuote = null;
                if (b.quote_id) {
                    chosenQuote = (live.purchase_quotes || []).find((q) => q.id === String(b.quote_id || ''));
                    if (!chosenQuote) return sendJson(res, { error: 'استعلام انتخاب‌شده یافت نشد.' }, 404);
                    if (chosenQuote.chosen) return sendJson(res, { error: 'از این استعلام قبلاً سفارش صادر شده است.' }, 409);
                    sup = (live.suppliers || []).find((s) => s.id === chosenQuote.supplier_id && s.active !== false);
                    pr = (live.purchase_requests || []).find((x) => x.id === chosenQuote.pr_id);
                    if (!sup) return sendJson(res, { error: 'تأمین‌کنندهٔ استعلام فعال نیست.' }, 409);
                    if (!pr) return sendJson(res, { error: 'درخواست خرید مرجع استعلام یافت نشد.' }, 404);
                    itemsIn = chosenQuote.lines.map((l) => ({ kind: l.kind, item_id: ((pr.items || [])[l.item_index] || {}).item_id || '', item_name: l.item_name, grade: ((pr.items || [])[l.item_index] || {}).grade || '', qty: l.qty, qty_unit: l.qty_unit, unit_price_rial: l.unit_price_rial }));
                } else {
                    sup = (live.suppliers || []).find((s) => s.id === String(b.supplier_id || '') && s.active !== false);
                    if (!sup) return sendJson(res, { error: 'تأمین‌کنندهٔ فعال انتخاب نشده است.' }, 400);
                    if (b.pr_id) {
                        pr = (live.purchase_requests || []).find((x) => x.id === String(b.pr_id || '') || x.pr_no === String(b.pr_id || ''));
                        if (!pr) return sendJson(res, { error: 'درخواست خرید مرجع یافت نشد.' }, 404);
                        if (pr.status !== 'approved' && pr.status !== 'inquired' && pr.status !== 'ordered') return sendJson(res, { error: 'سفارش فقط برای درخواست تأییدشده صادر می‌شود (وضعیت: ' + (PUR_PR_STATUS_FA_22A[pr.status] || pr.status) + ').' }, 409);
                    }
                    itemsIn = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
                }
                const items = [];
                for (const it of itemsIn) {
                    const kind = ['billet', 'material', 'part'].indexOf(String((it && it.kind) || '')) !== -1 ? String(it.kind) : '';
                    if (!kind) return sendJson(res, { error: 'نوع هر قلم سفارش باید شمش، مواد یا قطعه باشد.' }, 400);
                    const qty = round2(Number(finDigitsEn(it.qty)) || 0);
                    if (!(qty > 0)) return sendJson(res, { error: 'مقدار هر قلم سفارش باید بزرگ‌تر از صفر باشد.' }, 400);
                    const price = Math.round(Number(finDigitsEn(it.unit_price_rial)) || 0);
                    if (price <= 0) return sendJson(res, { error: 'قیمت هر ' + (it.qty_unit === 'تن' ? 'تن' : 'عدد') + ' برای قلم «' + (it.item_name || PUR_KIND_FA_22A[kind]) + '» الزامی است.' }, 400);
                    items.push({ kind: kind, item_id: String((it && it.item_id) || ''), item_name: String((it && it.item_name) || '').trim().slice(0, 80) || PUR_KIND_FA_22A[kind], grade: String((it && it.grade) || '').trim().slice(0, 20), qty: qty, qty_unit: kind === 'billet' ? 'تن' : (String((it && it.qty_unit) || '') === 'تن' ? 'تن' : 'عدد'), unit_price_rial: price });
                }
                if (!items.length) return sendJson(res, { error: 'حداقل یک قلم به سفارش خرید اضافه کنید.' }, 400);
                const dj = purValidJalali22a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                /* سررسید تحویل: صریح → از استعلام (امروز + lead_time_days) → از تاریخ نیاز اقلام PR → امروز+۱۴ روز */
                let ddj = purValidJalali22a(b.delivery_due_jalali);
                if (!ddj) {
                    const todayJ22a = finIsoToJalali(new Date().toISOString());
                    const baseTs22a = Date.parse(planJalaliToTs(todayJ22a, 12));
                    const leadDays22a = chosenQuote ? (Number(chosenQuote.lead_time_days) || 14) : 0;
                    const needJ22a = pr ? (pr.items || []).map((x) => x.need_date_jalali).filter(Boolean).sort()[0] : '';
                    const needTs22a = needJ22a ? Date.parse(planJalaliToTs(needJ22a, 12)) : 0;
                    if (!chosenQuote && needTs22a > 0) ddj = finIsoToJalali(new Date(needTs22a).toISOString());
                    else if (baseTs22a) ddj = finIsoToJalali(new Date(baseTs22a + leadDays22a * 86400000).toISOString());
                    else ddj = purValidJalali22a(b.delivery_due_jalali);
                }
                if (!ddj) return sendJson(res, { error: 'سررسید تحویل شمسی نامعتبر است (نمونه: ۱۴۰۵/۰۶/۲۵).' }, 400);
                const vatRate = (live.fin_config && Number(live.fin_config.vat_rate)) || 10;
                const rec = {
                    id: 'po-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    po_no: purNextNo22a(live, 'po', 'PO'),
                    supplier_id: sup.id, supplier_name: sup.name,
                    pr_id: pr ? pr.id : '', pr_no: pr ? pr.pr_no : '',
                    quote_id: chosenQuote ? chosenQuote.id : '',
                    items: items, date_jalali: dj, delivery_due_jalali: ddj,
                    vat_rate: vatRate, status: 'issued',
                    notes: String(b.notes || '').trim().slice(0, 300),
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(),
                    cancelled_at: null,
                };
                live.purchase_orders.push(rec);
                if (pr) { pr.status = 'ordered'; }
                if (chosenQuote) { chosenQuote.chosen = true; }
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ سفارش خرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.order.create', { po_no: rec.po_no, supplier: sup.name, items: items.length, from_quote: chosenQuote ? chosenQuote.id : null });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/orders/cancel') {
        if (!auth.requireRole(req, PUR_WRITE_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22a(invEnsure(readLive()));
                const po = (live.purchase_orders || []).find((o) => o.id === String(b.id || '') || o.po_no === String(b.id || ''));
                if (!po) return sendJson(res, { error: 'سفارش خرید یافت نشد.' }, 404);
                if (po.status === 'cancelled') return sendJson(res, { error: 'این سفارش قبلاً لغو شده است.' }, 409);
                if (po.status === 'completed') return sendJson(res, { error: 'سفارش تکمیل‌شده قابل لغو نیست.' }, 409);
                const got = (live.purchase_receipts || []).some((r) => r.po_id === po.id && r.status !== 'returned');
                if (got) return sendJson(res, { error: 'برای این سفارش رسید خرید ثبت شده است — قابل لغو نیست (برگشت از طریق فاکتور خرید انجام می‌شود).' }, 409);
                po.status = 'cancelled'; po.cancelled_at = new Date().toISOString();
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ لغو سفارش انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.order.cancel', { po_no: po.po_no });
                return sendJson(res, { ok: true, record: po });
            } catch (e) { return sendJson(res, { error: 'داده نامعتبر: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    /* پوشهٔ آپلود گواهی ذوب — در کنار سرور (خارج از public) */
    const PUR_UPLOAD_DIR_22A = path.join(RUNTIME_ROOT_19E, 'uploads', 'purchase'); /* SEC-PROTECT-19e */
    /* ===== HARDEN-18K (begin): قرنطینهٔ آپلود مشکوک — رد پای جرمی بدون اجرا ===== */
    const PUR_QUARANTINE_DIR_18K = path.join(RUNTIME_ROOT_19E, 'uploads', '_quarantine'); /* SEC-PROTECT-19e */
    function hardQuarantine18K(buf, reason) {
        try {
            fs.mkdirSync(PUR_QUARANTINE_DIR_18K, { recursive: true });
            const qname = 'q-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.bin'; /* پسوند بی‌اثر — هرگز اجرا/سرو نمی‌شود */
            fs.writeFileSync(path.join(PUR_QUARANTINE_DIR_18K, qname), buf);
            const entry18k = { ts: new Date().toISOString(), user: (req && req.user && req.user.username) || 'system', role: (req && req.user && req.user.role) || 'system', ip: clientIp15b(req), action: 'upload.quarantine', endpoint: 'purchase/cert', status: 400, user_agent: 'HARDEN-18K', payload_hash: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16), ms: 0, detail: String(reason).slice(0, 120) };
            const t18k = setTimeout(() => { try { writeAudit15b(entry18k); } catch (e) { /* بی‌ضرر */ } }, 0);
            if (t18k.unref) t18k.unref();
            return qname;
        } catch (e) { return ''; }
    }
    /* ===== HARDEN-18K (end) ===== */
    function purSaveCert22a(base64, name, receiptNo, lineIdx) {
        const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
        if (!clean) return null;
        if (!/^[A-Za-z0-9+/=]+$/.test(clean)) throw new Error('فایل گواهی ذوب معتبر نیست (باید base64 باشد).');
        if (clean.length > 3000000) throw new Error('حجم فایل گواهی ذوب بیش از حد مجاز است (حداکثر ~۲ مگابایت).');
        let ext = 'pdf';
        const nm = String(name || '').toLowerCase();
        if (/\.png$/.test(nm)) ext = 'png'; else if (/\.jpe?g$/.test(nm)) ext = 'jpg'; else if (/\.pdf$/.test(nm)) ext = 'pdf'; else ext = '';
        if (!ext) throw new Error('فرمت گواهی ذوب باید PDF یا JPG/PNG باشد.');
        const buf18k = Buffer.from(clean, 'base64'); /* HARDEN-18K: یک‌بار decode — سقف رمزگشایی‌شده هم صریح است */
        if (buf18k.length > 2500000) throw new Error('حجم فایل گواهی ذوب بیش از حد مجاز است (حداکثر ~۲ مگابایت).');
        /* HARDEN-18K: magic-bytes — محتوای واقعی باید با پسوند بخواند؛ تخلف ⇒ قرنطینه + audit (نوشتن در پوشهٔ گواهی ممنوع) */
        if (!hardMagicOk18K(buf18k, ext)) {
            hardQuarantine18K(buf18k, 'magic-bytes mismatch: claimed=' + ext);
            throw new Error('محتوای فایل گواهی با فرمت اعلام‌شده (' + ext.toUpperCase() + ') هم‌خوان نیست — فایل در قرنطینه ثبت و درخواست رد شد.');
        }
        try { fs.mkdirSync(PUR_UPLOAD_DIR_22A, { recursive: true }); } catch (e) { /* موجود */ }
        const fname = 'cert-' + String(receiptNo).replace(/[^A-Za-z0-9-]/g, '') + '-L' + lineIdx + '-' + Date.now() + '.' + ext;
        const dst18k = hardSafeJoin18K(PUR_UPLOAD_DIR_22A, fname); /* HARDEN-18K: ضد path-traversal حتی برای نامِ تولیدی سرور */
        if (!dst18k) throw new Error('نام فایل گواهی نامعتبر است.');
        const tmp18k = dst18k + '.tmp'; /* HARDEN-18K: نوشتن اتمیک — نیمه‌نوشته روی دیسک نمی‌ماند */
        fs.writeFileSync(tmp18k, buf18k);
        try { fs.renameSync(tmp18k, dst18k); } catch (e) { try { fs.unlinkSync(tmp18k); } catch (e2) { /* noop */ } throw e; }
        return { file: fname, name: String(name || '').slice(0, 120), size: buf18k.length };
    }

    if (req.method === 'GET' && pathname === '/api/purchase/cert') {
        if (!auth.requireRole(req, PUR_READ_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const u = new URL(req.url, 'http://localhost');
        const file = String(u.searchParams.get('file') || '');
        const recId = String(u.searchParams.get('receipt') || '');
        const live = purEnsure22a(invEnsure(readLive()));
        const rec = (live.purchase_receipts || []).find((x) => x.id === recId);
        const line = rec && (rec.lines || []).find((l) => l.cert_file === file);
        /* HARDEN-18K: الگوی سخت‌گیرانهٔ نام — فقط خروجی تولیدی سرور پذیرفته است (ضد هرگونه نام دست‌کاری‌شده) */
        const certNameOk18k = /^cert-[A-Za-z0-9-]+-L\d+-\d+\.(pdf|png|jpg)$/.test(file);
        if (!rec || !line || !certNameOk18k || !line.cert_file) return sendJson(res, { error: 'گواهی یافت نشد.' }, 404);
        const full = hardSafeJoin18K(PUR_UPLOAD_DIR_22A, file); /* HARDEN-18K: پیوستن امن مسیر به‌جای چک‌های دستی */
        if (!full || !fs.existsSync(full)) return sendJson(res, { error: 'فایل گواهی روی دیسک یافت نشد.' }, 404);
        const ext = file.slice(file.lastIndexOf('.') + 1);
        const mime = ext === 'pdf' ? 'application/pdf' : (ext === 'png' ? 'image/png' : 'image/jpeg');
        res.writeHead(200, { 'Content-Type': mime, 'Content-Disposition': 'attachment; filename="' + file + '"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); /* HARDEN-18K: nosniff صریح + اجبار دانلود */
        res.end(fs.readFileSync(full));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/receipts') {
        if (!auth.requireRole(req, PUR_RCPT_22A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت رسید خرید فقط برای انباردار/واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                /* گواهی‌های base64 پیش از پاک‌سازی عمومی جدا می‌شوند (سقف رشتهٔ SEC-15b آن‌ها را برش می‌زند) */
                const parsed = JSON.parse(raw || '{}');
                const certMap = {};
                (Array.isArray(parsed.lines) ? parsed.lines : []).forEach((l, i) => {
                    if (l && typeof l.cert_data === 'string' && l.cert_data.length > 0) certMap[i] = { data: l.cert_data, name: String(l.cert_name || '').slice(0, 120) };
                });
                const b = sanitizeInput15b(parsed);
                const live = purEnsure22a(invEnsure(readLive()));
                const po = (live.purchase_orders || []).find((o) => o.id === String(b.po_id || '') || o.po_no === String(b.po_id || ''));
                if (!po) return sendJson(res, { error: 'سفارش خرید یافت نشد.' }, 404);
                if (po.status !== 'issued' && po.status !== 'received') return sendJson(res, { error: 'رسید فقط برای سفارش صادرشده/تحویل‌گرفته مجاز است (وضعیت فعلی: ' + (PUR_PO_STATUS_FA_22A[po.status] || po.status) + ').' }, 409);
                const sup = (live.suppliers || []).find((s) => s.id === po.supplier_id);
                if (!sup) return sendJson(res, { error: 'تأمین‌کنندهٔ سفارش یافت نشد.' }, 404);
                const dj = purValidJalali22a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                const linesIn = Array.isArray(b.lines) ? b.lines.slice(0, 30) : [];
                if (!linesIn.length) return sendJson(res, { error: 'حداقل یک ردیف رسید (انتخاب ردیف سفارش + مقدار) لازم است.' }, 400);
                const nowIso = new Date().toISOString();
                const lines = [];
                const invReceipts = [];
                for (let i = 0; i < linesIn.length; i++) {
                    const li = linesIn[i];
                    const poLine = purIdx22a(li.po_line);
                    const src = (po.items || [])[poLine];
                    if (!src) return sendJson(res, { error: 'ردیف رسید ' + (i + 1) + ' با اقلام سفارش هم‌خوانی ندارد.' }, 400);
                    const qty = round2(Number(finDigitsEn(li.qty)) || 0);
                    if (!(qty > 0)) return sendJson(res, { error: 'مقدار ردیف ' + (i + 1) + ' باید بزرگ‌تر از صفر باشد.' }, 400);
                    const got = purReceivedOf22a(live, po.po_no, poLine);
                    if (got + qty > (Number(src.qty) || 0) * 1.05 + 1e-9) {
                        return sendJson(res, { error: 'جمع رسید ردیف «' + (src.item_name || PUR_KIND_FA_22A[src.kind]) + '» از مقدار سفارش بیشتر است (سفارش: ' + salesFmt21a(src.qty) + ' — قبلاً رسیده: ' + salesFmt21a(got) + ' — این رسید: ' + salesFmt21a(qty) + ').' }, 409);
                    }
                    let item, unit, lotNo = String(li.lot_no || '').trim().slice(0, 60), loc = String(li.location || '').trim().slice(0, 60);
                    let heat = String(li.heat_number || '').trim().slice(0, 40);
                    if (src.kind === 'billet') {
                        if (!heat) return sendJson(res, { error: 'کد هیت (Heat Number) برای شمش ردیف ' + (i + 1) + ' الزامی است — ردگیری ذوب و گواهی آنالیز.' }, 400);
                        item = purBilletItem22a(live); unit = 'تن';
                        if (!lotNo) lotNo = heat;
                    } else {
                        item = purMaterialItem22a(live, src.kind, src.item_id, src.item_name, src.qty_unit);
                        unit = item.unit || 'عدد';
                        if (!lotNo) lotNo = item.code;
                    }
                    let cert = null;
                    if (certMap[i]) cert = purSaveCert22a(certMap[i].data, certMap[i].name, 'R' + Math.floor(Date.now() / 1000) % 100000000, i);
                    lines.push({ po_line: poLine, kind: src.kind, item_id: item.id, item_name: item.name, grade: src.grade || '', qty: qty, qty_unit: src.qty_unit || unit, unit_price_rial: Number(src.unit_price_rial) || 0, heat_number: heat, lot_no: lotNo, location: loc, cert_name: cert ? cert.name : '', cert_file: cert ? cert.file : '', cert_size: cert ? cert.size : 0 });
                    invReceipts.push({ id: 'grn-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: 'purchase:' + po.po_no + ':' + poLine + ':' + Date.now() + (i > 0 ? '-' + (i + 1) : ''), receipt_no: 'GRN-' + Date.now() + (i > 0 ? '-' + (i + 1) : ''), item_id: item.id, quantity: qty, unit: unit, lot_no: lotNo, warehouse: purWarehouseFor22a(src.kind), location: loc || 'PURCHASE', stock_status: 'available', receipt_type: 'purchase', supplier: sup.name, document_no: po.po_no, source_ref: '', heat_number: heat, description: ('رسید خرید — سفارش ' + po.po_no + ' — ' + sup.name).slice(0, 500), timestamp: nowIso, operator_id: String((req.user && (req.user.name || req.user.username)) || '') });
                }
                const receiptNo = purNextNo22a(live, 'receipt', 'GRN');
                invReceipts.forEach((r) => { r.source_ref = receiptNo; });
                /* سند خودکار رسید: بدهکار موجودی (شمش 110001 / مواد و قطعات 110005) / بستانکار پرداختنی تأمین‌کننده */
                purEnsureAccounts22a(live);
                const accByCode22a = {};
                (live.fin_accounts || []).forEach((a) => { accByCode22a[a.code] = a; });
                const apAcc = purApAccount22a(live, sup);
                if (!accByCode22a['110001'] || !accByCode22a['110005']) return sendJson(res, { error: 'حساب‌های موجودی (۱۱۰۰۰۱/۱۱۰۰۰۵) در کدینگ مالی یافت نشد — ابتدا تب مالی را باز کنید.' }, 409);
                if (!apAcc) return sendJson(res, { error: 'حساب پرداختنی تأمین‌کننده ساخته نشد.' }, 409);
                const booked = round2(lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price_rial) || 0), 0));
                if (!(booked > 0)) return sendJson(res, { error: 'بهای اقلام رسید صفر است — قیمت سفارش را بررسی کنید.' }, 409);
                const finLines = [];
                const billetVal = round2(lines.filter((l) => l.kind === 'billet').reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_price_rial) || 0), 0));
                const matVal = round2(booked - billetVal);
                if (billetVal > 0) finLines.push({ account_id: accByCode22a['110001'].id, debit: billetVal, ref_id: receiptNo, note: 'ورود شمش — ' + po.po_no });
                if (matVal > 0) finLines.push({ account_id: accByCode22a['110005'].id, debit: matVal, ref_id: receiptNo, note: 'ورود مواد/قطعات — ' + po.po_no });
                finLines.push({ account_id: apAcc.id, credit: booked, ref_id: receiptNo, note: 'پرداختنی ' + sup.name });
                finPostDoc(live, { source: 'purchase', ref_module: 'purchase', ref_id: 'grn:' + receiptNo, date_jalali: dj, desc: 'رسید خرید ' + receiptNo + ' — ' + sup.name + ' — سفارش ' + po.po_no, lines: finLines, created_by: String((req.user && (req.user.name || req.user.username)) || '') });
                invReceipts.forEach((r) => live.inventory_receipts.push(r));
                const rec = {
                    id: 'prcpt-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    receipt_no: receiptNo, po_id: po.id, po_no: po.po_no,
                    supplier_id: sup.id, supplier_name: sup.name,
                    lines: lines, date_jalali: dj,
                    vehicle_plate: String(b.vehicle_plate || '').trim().slice(0, 30), driver: String(b.driver || '').trim().slice(0, 60),
                    weighbridge_no: String(b.weighbridge_no || '').trim().slice(0, 40),
                    booked_value_rial: Math.round(booked), doc_nos: invReceipts.map((r) => r.receipt_no),
                    status: 'confirmed', invoice_no: '',
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: nowIso,
                };
                live.purchase_receipts.push(rec);
                if (po.status === 'issued') po.status = 'received';
                /* تکمیل با تحمل صنعتی ±۵٪ (رسید جزئی زیر مقدار سفارش هم سفارش را می‌بندد) */
                const allDone = (po.items || []).every((it, idx) => purReceivedOf22a(live, po.po_no, idx) >= (Number(it.qty) || 0) * 0.95 - 1e-9);
                if (allDone) po.status = 'completed';
                const prOf = po.pr_id ? (live.purchase_requests || []).find((x) => x.id === po.pr_id) : null;
                if (prOf && prOf.status === 'ordered') {
                    const related = (live.purchase_orders || []).filter((o) => o.pr_id === prOf.id);
                    if (related.length && related.every((o) => o.status === 'completed' || o.status === 'cancelled')) prOf.status = 'completed';
                }
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ رسید خرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.receipt.create', { receipt_no: receiptNo, po_no: po.po_no, booked: booked, lines: lines.length });
                return sendJson(res, { ok: true, record: rec, receipts: invReceipts, po_status: po.status, booked_value_rial: Math.round(booked) }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت رسید ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }
    // ===== FEAT-PURCHASE-22a (end) =====
    // ================================================================
    // ===== FEAT-PURCHASE-22b (begin): فاکتور خرید + VAT (از fin_config)
    // + اسناد خودکار finPostDoc (source «purchase» — idempotent per ref_id)
    // + پرداخت‌ها + حساب‌های پرداختنی (AP) با Aging شمسی + گزارش‌ها
    // سند رسید در 22a ثبت می‌شود (بدهکار موجودی/بستانکار پرداختنی)؛ اینجا:
    // تأیید فاکتور → سند VAT خرید + سند تعدیل قیمت (اگر تفاوت با رسید)
    // برگشت خرید → سند معکوس + خروج انبار؛ پرداخت → بدهکار پرداختنی/
    // پیش‌پرداخت / بستانکار بانک یا صندوق — حساب‌های لازم فقط اگر نبودند
    // ساخته می‌شوند (purEnsureAccounts22a در 22a) — finPostDoc/هستهٔ مالی صفر تغییر
    // ================================================================
    function purEnsure22b(live) {
        live.purchase_invoices = Array.isArray(live.purchase_invoices) ? live.purchase_invoices : [];
        live.purchase_payments = Array.isArray(live.purchase_payments) ? live.purchase_payments : [];
        live.purchase_seq = live.purchase_seq && typeof live.purchase_seq === 'object' ? live.purchase_seq : {};
        if (live.purchase_seq.invoice == null) live.purchase_seq.invoice = 0;
        if (live.purchase_seq.payment == null) live.purchase_seq.payment = 0;
        return live;
    }
    const PUR_INV_STATUS_FA_22B = { received: 'دریافت‌شده', confirmed: 'تأییدشده', returned: 'برگشتی' };
    const PUR_PAY_METHOD_FA_22B = { cash: 'نقد', bank: 'بانک', check: 'چک' };
    /* ماندهٔ پرداختنی تأمین‌کننده از خود دفتر (روزنامه) — قرینهٔ حساب تفضیلی: Σ بستانکار − Σ بدهکار */
    function purApBalance22b(live, sup) {
        if (!sup || !sup.ap_account_id) return 0;
        let bal = 0;
        (live.fin_docs || []).forEach((d) => (d.lines || []).forEach((ln) => { if (ln.account_id === sup.ap_account_id) bal += (Number(ln.credit) || 0) - (Number(ln.debit) || 0); }));
        return Math.round(bal);
    }
    /* افزودن روز شمسی (سررسید فاکتور = تاریخ + مهلت پرداخت تأمین‌کننده) */
    function purAddDaysJalali22b(dj, days) {
        const t = Date.parse(planJalaliToTs(finDigitsEn(String(dj || '')).trim(), 12));
        if (!t) return '';
        return finIsoToJalali(new Date(t + (Number(days) || 0) * 86400000).toISOString());
    }
    const PUR_READ_22B = ['purchase', 'manager', 'finance', 'warehouse'];
    const PUR_WRITE_22B = ['purchase']; /* admin همیشه با requireRole عبور می‌کند */

    if (req.method === 'POST' && pathname === '/api/purchase/invoices') {
        if (!auth.requireRole(req, PUR_WRITE_22B)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت فاکتور خرید فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22b(purEnsure22a(invEnsure(readLive())));
                const po = (live.purchase_orders || []).find((o) => o.id === String(b.po_id || '') || o.po_no === String(b.po_id || ''));
                if (!po) return sendJson(res, { error: 'سفارش خرید یافت نشد.' }, 404);
                if (po.status !== 'received' && po.status !== 'completed') return sendJson(res, { error: 'فاکتور فقط برای سفارش تحویل‌گرفته/تکمیل صادر می‌شود (وضعیت فعلی: ' + (PUR_PO_STATUS_FA_22A[po.status] || po.status) + ').' }, 409);
                const sup = (live.suppliers || []).find((s) => s.id === po.supplier_id);
                if (!sup) return sendJson(res, { error: 'تأمین‌کنندهٔ سفارش یافت نشد.' }, 404);
                /* اقلام فاکتور = رسیدهای واقعی فاکتورنشدهٔ همین سفارش (وزن باسکول) — قیمت پیش‌فرض از PO، قابل اصلاح per ردیف */
                const openRcpts = (live.purchase_receipts || []).filter((r) => r.po_id === po.id && r.status !== 'returned' && !r.invoice_no);
                if (!openRcpts.length) return sendJson(res, { error: 'رسید فاکتورنشده‌ای برای این سفارش نیست — ابتدا رسید خرید ثبت کنید.' }, 409);
                const byLine = {};
                openRcpts.forEach((r) => (r.lines || []).forEach((l) => {
                    const k = String(l.po_line);
                    byLine[k] = byLine[k] || { po_line: Number(l.po_line), qty: 0, booked: 0, heats: [], receipts: [] };
                    byLine[k].qty = round2(byLine[k].qty + (Number(l.qty) || 0));
                    byLine[k].booked = round2(byLine[k].booked + (Number(l.qty) || 0) * (Number(l.unit_price_rial) || 0));
                    if (l.heat_number) byLine[k].heats.push(l.heat_number);
                    if (byLine[k].receipts.indexOf(r.receipt_no) === -1) byLine[k].receipts.push(r.receipt_no);
                }));
                const overrides = Array.isArray(b.lines) ? b.lines : [];
                const lineSrc = (po.items || []);
                const lines = Object.keys(byLine).map((k) => {
                    const g = byLine[k];
                    const src = lineSrc[g.po_line] || {};
                    const ov = overrides.find((x) => purIdx22a(x.po_line) === g.po_line);
                    const price = ov != null && finDigitsEn(ov.unit_price_rial) !== '' ? Math.round(Number(finDigitsEn(ov.unit_price_rial)) || 0) : Math.round(Number(src.unit_price_rial) || 0);
                    if (!(price > 0)) throw new Error('قیمت هر ' + (src.qty_unit === 'تن' ? 'تن' : 'عدد') + ' برای ردیف «' + (src.item_name || '') + '» باید بزرگ‌تر از صفر باشد.');
                    return { po_line: g.po_line, kind: src.kind || 'billet', item_name: src.item_name || PUR_KIND_FA_22A[src.kind] || 'کالا', grade: src.grade || '', qty: g.qty, qty_unit: src.qty_unit || 'تن', unit_price_rial: price, po_price_rial: Math.round(Number(src.unit_price_rial) || 0), booked_rial: Math.round(g.booked), line_total_rial: Math.round(g.qty * price), heats: g.heats.slice(0, 8), receipts: g.receipts };
                });
                const bookedTotal = lines.reduce((s, l) => s + l.booked_rial, 0);
                const goods = lines.reduce((s, l) => s + l.line_total_rial, 0);
                const adjustment = Math.round(goods - bookedTotal);
                const vatRate = (live.fin_config && Number(live.fin_config.vat_rate)) || 10;
                const vat = Math.round(goods * vatRate / 100);
                const total = goods + vat;
                const dj = purValidJalali22a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                const due = purAddDaysJalali22b(dj, Number(sup.payment_term_days) || 0) || dj;
                const rec = {
                    id: 'pinv-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    invoice_no: purNextNo22a(live, 'invoice', 'PINV'),
                    supplier_invoice_no: String(b.supplier_invoice_no || '').trim().slice(0, 40),
                    po_id: po.id, po_no: po.po_no,
                    supplier_id: sup.id, supplier_name: sup.name,
                    seller: { name: sup.name, national_id: sup.national_id || '', economic_id: sup.economic_id || '', address: sup.address || '', phone: sup.phone || '' },
                    lines: lines, booked_rial: bookedTotal, goods_rial: goods, adjustment_rial: adjustment,
                    vat_rate: vatRate, vat_rial: vat, total_rial: total,
                    date_jalali: dj, due_date_jalali: due,
                    status: 'received', paid_rial: 0, receipts: openRcpts.map((r) => r.receipt_no),
                    created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString(),
                    confirmed_at: null, returned_at: null, return_reason: '',
                };
                openRcpts.forEach((r) => { r.invoice_no = rec.invoice_no; });
                live.purchase_invoices.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ فاکتور خرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.invoice.create', { invoice_no: rec.invoice_no, po_no: po.po_no, total: total, adjustment: adjustment });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت فاکتور خرید ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/invoices/confirm') {
        if (!auth.requireRole(req, PUR_WRITE_22B)) return sendJson(res, { error: 'دسترسی غیرمجاز: تأیید فاکتور فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22b(purEnsure22a(invEnsure(readLive())));
                const inv = (live.purchase_invoices || []).find((x) => x.id === String(b.invoice_id || '') || x.invoice_no === String(b.invoice_id || ''));
                if (!inv) return sendJson(res, { error: 'فاکتور خرید یافت نشد.' }, 404);
                if (inv.status !== 'received') return sendJson(res, { error: 'فقط فاکتور دریافت‌شده قابل تأیید است (وضعیت فعلی: ' + (PUR_INV_STATUS_FA_22B[inv.status] || inv.status) + ').' }, 409);
                const sup = (live.suppliers || []).find((s) => s.id === inv.supplier_id);
                purEnsureAccounts22a(live);
                const apAcc = sup ? purApAccount22a(live, sup) : null;
                const accByCode = {};
                (live.fin_accounts || []).forEach((a) => { accByCode[a.code] = a; });
                if (!apAcc || !accByCode['210001'] || !accByCode['110001'] || !accByCode['110005']) return sendJson(res, { error: 'حساب‌های مالی خرید (VAT خرید ۲۱۰۰۰۱ / موجودی) در کدینگ یافت نشد — ابتدا تب مالی را باز کنید.' }, 409);
                const createdBy = String((req.user && (req.user.name || req.user.username)) || '');
                /* سند ۱ — VAT خرید: بدهکار ۲۱۰۰۰۱ / بستانکار پرداختنی (idempotent per «pinv-vat:PINV-xxxxx») */
                if (inv.vat_rial > 0) {
                    finPostDoc(live, {
                        source: 'purchase', ref_module: 'purchase', ref_id: 'pinv-vat:' + inv.invoice_no,
                        date_jalali: inv.date_jalali,
                        desc: 'مالیات بر ارزش افزوده خرید ' + inv.invoice_no + ' — ' + sup.name + ' — نرخ ' + inv.vat_rate + '٪',
                        lines: [
                            { account_id: accByCode['210001'].id, debit: inv.vat_rial, ref_id: inv.invoice_no, note: 'VAT خرید ' + inv.invoice_no },
                            { account_id: apAcc.id, credit: inv.vat_rial, ref_id: inv.invoice_no, note: 'پرداختنی ' + sup.name },
                        ],
                        created_by: createdBy,
                    });
                }
                /* سند ۲ — تعدیل قیمت نسبت به رسید (اگر تفاوت): مثبت → بدهکار موجودی/بستانکار پرداختنی؛ منفی → برعکس */
                if ((Number(inv.adjustment_rial) || 0) !== 0) {
                    const adj = Math.round(inv.adjustment_rial);
                    const billetAdj = Math.round((inv.lines || []).filter((l) => l.kind === 'billet').reduce((s, l) => s + ((Number(l.line_total_rial) || 0) - (Number(l.booked_rial) || 0)), 0));
                    const matAdj = adj - billetAdj;
                    const linesAdj = [];
                    if (adj > 0) {
                        if (billetAdj > 0) linesAdj.push({ account_id: accByCode['110001'].id, debit: billetAdj, ref_id: inv.invoice_no, note: 'افزایش بهای شمش' });
                        if (matAdj > 0) linesAdj.push({ account_id: accByCode['110005'].id, debit: matAdj, ref_id: inv.invoice_no, note: 'افزایش بهای مواد/قطعات' });
                        linesAdj.push({ account_id: apAcc.id, credit: adj, ref_id: inv.invoice_no, note: 'تعدیل مثبت — ' + sup.name });
                    } else {
                        if (billetAdj < 0) linesAdj.push({ account_id: accByCode['110001'].id, credit: -billetAdj, ref_id: inv.invoice_no, note: 'کاهش بهای شمش' });
                        if (matAdj < 0) linesAdj.push({ account_id: accByCode['110005'].id, credit: -matAdj, ref_id: inv.invoice_no, note: 'کاهش بهای مواد/قطعات' });
                        linesAdj.push({ account_id: apAcc.id, debit: -adj, ref_id: inv.invoice_no, note: 'تعدیل منفی — ' + sup.name });
                    }
                    finPostDoc(live, {
                        source: 'purchase', ref_module: 'purchase', ref_id: 'pinv-adj:' + inv.invoice_no,
                        date_jalali: inv.date_jalali,
                        desc: 'تعدیل قیمت فاکتور خرید ' + inv.invoice_no + ' نسبت به رسید (' + (adj > 0 ? '+' : '') + adj.toLocaleString('fa-IR') + ' ریال) — ' + sup.name,
                        lines: linesAdj, created_by: createdBy,
                    });
                }
                inv.status = 'confirmed'; inv.confirmed_at = new Date().toISOString();
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ تأیید فاکتور انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.invoice.confirm', { invoice_no: inv.invoice_no, vat: inv.vat_rial, adjustment: inv.adjustment_rial });
                return sendJson(res, { ok: true, record: inv });
            } catch (e) { return sendJson(res, { error: 'تأیید فاکتور ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/invoices/return') {
        if (!auth.requireRole(req, PUR_WRITE_22B)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22b(purEnsure22a(invEnsure(readLive())));
                const inv = (live.purchase_invoices || []).find((x) => x.id === String(b.invoice_id || '') || x.invoice_no === String(b.invoice_id || ''));
                if (!inv) return sendJson(res, { error: 'فاکتور خرید یافت نشد.' }, 404);
                if (inv.status !== 'confirmed') return sendJson(res, { error: 'فقط فاکتور تأییدشده قابل برگشت است (وضعیت فعلی: ' + (PUR_INV_STATUS_FA_22B[inv.status] || inv.status) + ').' }, 409);
                const allocated = (live.purchase_payments || []).reduce((s, p) => s + ((p.allocated || []).filter((a) => a.invoice_no === inv.invoice_no).reduce((x, a) => x + (Number(a.amount_rial) || 0), 0)), 0);
                if (allocated > 0) return sendJson(res, { error: 'فاکتور با پرداخت ثبت‌شده قابل برگشت نیست — ' + salesFmt21a(allocated) + ' ریال پرداخت روی آن تخصیص یافته است.' }, 409);
                const sup = (live.suppliers || []).find((s) => s.id === inv.supplier_id);
                purEnsureAccounts22a(live);
                const apAcc = sup ? purApAccount22a(live, sup) : null;
                const accByCode = {};
                (live.fin_accounts || []).forEach((a) => { accByCode[a.code] = a; });
                if (!apAcc || !accByCode['210001'] || !accByCode['110001'] || !accByCode['110005']) return sendJson(res, { error: 'حساب‌های مالی خرید یافت نشد.' }, 409);
                /* سند معکوس: بدهکار پرداختنی کل فاکتور / بستانکار VAT خرید + موجودی (بهای رسید + تعدیل) */
                const goodsRev = Math.round((Number(inv.booked_rial) || 0) + (Number(inv.adjustment_rial) || 0));
                const billetRev = Math.round((inv.lines || []).filter((l) => l.kind === 'billet').reduce((s, l) => s + (Number(l.booked_rial) || 0) + ((Number(l.line_total_rial) || 0) - (Number(l.booked_rial) || 0)), 0));
                const matRev = goodsRev - billetRev;
                const linesRev = [{ account_id: apAcc.id, debit: inv.total_rial, ref_id: inv.invoice_no, note: 'برگشت خرید — ' + sup.name }];
                if (inv.vat_rial > 0) linesRev.push({ account_id: accByCode['210001'].id, credit: inv.vat_rial, ref_id: inv.invoice_no, note: 'ابطال VAT خرید' });
                if (billetRev > 0) linesRev.push({ account_id: accByCode['110001'].id, credit: billetRev, ref_id: inv.invoice_no, note: 'خروج شمش برگشتی' });
                if (matRev > 0) linesRev.push({ account_id: accByCode['110005'].id, credit: matRev, ref_id: inv.invoice_no, note: 'خروج مواد/قطعات برگشتی' });
                finPostDoc(live, {
                    source: 'purchase', ref_module: 'purchase', ref_id: 'pinv-rev:' + inv.invoice_no,
                    date_jalali: purValidJalali22a(b.date_jalali) || finIsoToJalali(new Date().toISOString()),
                    desc: 'برگشت از خرید ' + inv.invoice_no + ' — ' + sup.name + ' — ' + String(b.reason || '').slice(0, 80),
                    lines: linesRev, created_by: String((req.user && (req.user.name || req.user.username)) || ''),
                });
                /* خروج انبار اقلام برگشتی — انتخاب از ردیف‌های فیزیکی (همان الگوی حوالهٔ فروش) */
                const nowIso = new Date().toISOString();
                const issueBase = 'RET-' + Date.now();
                (inv.lines || []).forEach((l, li) => {
                    const it = (live.inventory_items || []).find((x) => (l.kind === 'billet' ? String(x.code).toUpperCase() === 'BILLET' : x.id === l.item_id) && x.active !== false);
                    if (!it) return;
                    const wh = purWarehouseFor22a(l.kind);
                    const agg = invAggWarehouse(live, it.id, wh);
                    let remain = Number(l.qty) || 0;
                    const rows = agg.rows.filter((x) => x.stock_status === 'available' && Number(x.quantity) > 0).sort((x, y) => Number(y.quantity) - Number(x.quantity));
                    let idx = 0;
                    for (const row of rows) {
                        if (remain <= 1e-9) break;
                        const take = round2(Math.min(Number(row.quantity), remain));
                        if (take <= 1e-9) continue;
                        live.inventory_issues.push({ id: 'gin-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), request_id: 'purchase-ret:' + inv.invoice_no + ':' + li + ':' + (idx++), issue_no: issueBase + (idx > 1 ? '-' + idx : ''), item_id: it.id, quantity: take, unit: it.unit || 'عدد', lot_no: row.lot_no, warehouse: wh, location: row.location, destination: 'برگشت به تأمین‌کننده — ' + inv.invoice_no, destination_ref: inv.invoice_no, description: ('برگشت خرید ' + inv.invoice_no + ' — ' + l.item_name).slice(0, 500), timestamp: nowIso, operator_id: String((req.user && (req.user.name || req.user.username)) || '') });
                        remain = round2(remain - take);
                    }
                });
                inv.status = 'returned'; inv.returned_at = nowIso; inv.return_reason = String(b.reason || '').trim().slice(0, 200);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ برگشت خرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.invoice.return', { invoice_no: inv.invoice_no, total: inv.total_rial });
                return sendJson(res, { ok: true, record: inv });
            } catch (e) { return sendJson(res, { error: 'برگشت فاکتور ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/purchase/payments') {
        if (!auth.requireRole(req, PUR_WRITE_22B)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت پرداخت فقط برای واحد خرید مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = purEnsure22b(purEnsure22a(invEnsure(readLive())));
                const sup = (live.suppliers || []).find((s) => s.id === String(b.supplier_id || ''));
                if (!sup) return sendJson(res, { error: 'تأمین‌کننده یافت نشد.' }, 404);
                const amount = Math.round(Number(finDigitsEn(b.amount_rial)) || 0);
                if (!(amount > 0)) return sendJson(res, { error: 'مبلغ پرداخت باید بزرگ‌تر از صفر باشد (ریال).' }, 400);
                const method = ['cash', 'bank', 'check'].indexOf(String(b.method || '')) !== -1 ? String(b.method) : '';
                if (!method) return sendJson(res, { error: 'روش پرداخت باید نقد، بانک یا چک باشد.' }, 400);
                const checkNo = finDigitsEn(String(b.check_no || '')).trim();
                if (method === 'check' && !checkNo) return sendJson(res, { error: 'شمارهٔ چک الزامی است.' }, 400);
                const checkDue = method === 'check' ? purValidJalali22a(b.check_due_jalali) : '';
                if (method === 'check' && !checkDue) return sendJson(res, { error: 'سررسید چک شمسی نامعتبر است.' }, 400);
                const dj = purValidJalali22a(b.date_jalali) || finIsoToJalali(new Date().toISOString());
                /* تخصیص به فاکتورهای تأییدشده */
                const allocs = Array.isArray(b.allocations) ? b.allocations.slice(0, 40) : [];
                const allocated = [];
                let allocatedTotal = 0;
                for (const al of allocs) {
                    const amt = Math.round(Number(finDigitsEn(al.amount_rial)) || 0);
                    if (!(amt > 0)) continue;
                    const inv = (live.purchase_invoices || []).find((x) => (x.id === String(al.invoice_id || '') || x.invoice_no === String(al.invoice_id || '')) && x.supplier_id === sup.id);
                    if (!inv) return sendJson(res, { error: 'فاکتور برای تخصیص یافت نشد.' }, 404);
                    if (inv.status !== 'confirmed') return sendJson(res, { error: 'تخصیص فقط به فاکتور تأییدشده مجاز است (' + inv.invoice_no + ').' }, 409);
                    const prevPaid = Number(inv.paid_rial) || 0;
                    if (amt > (inv.total_rial - prevPaid) + 1e-6) return sendJson(res, { error: 'مبلغ تخصیص به ' + inv.invoice_no + ' بیش از ماندهٔ فاکتور است (مانده: ' + salesFmt21a(inv.total_rial - prevPaid) + ' ریال).' }, 409);
                    allocated.push({ invoice_id: inv.id, invoice_no: inv.invoice_no, amount_rial: amt });
                    allocatedTotal += amt;
                }
                if (allocatedTotal > amount + 1e-6) return sendJson(res, { error: 'جمع تخصیص‌ها از مبلغ پرداخت بیشتر است.' }, 409);
                const onAccount = Math.round(amount - allocatedTotal);
                const rec = { id: 'ppay-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), payment_no: purNextNo22a(live, 'payment', 'PAY'), supplier_id: sup.id, supplier_name: sup.name, amount_rial: amount, method: method, method_fa: PUR_PAY_METHOD_FA_22B[method], check_no: checkNo, check_due_jalali: checkDue, date_jalali: dj, allocated: allocated, allocated_total_rial: allocatedTotal, on_account_rial: onAccount, created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString() };
                /* سند خودکار پرداخت: بدهکار پرداختنی (+پیش‌پرداخت برای علی‌الحساب) / بستانکار بانک یا صندوق */
                purEnsureAccounts22a(live);
                const apAcc = purApAccount22a(live, sup);
                const accByCode = {};
                (live.fin_accounts || []).forEach((a) => { accByCode[a.code] = a; });
                const creditAcc = method === 'cash' ? accByCode['130002'] : accByCode['130001'];
                if (!creditAcc || !accByCode['230003']) return sendJson(res, { error: 'حساب بانک/صندوق یا پیش‌پرداخت تأمین‌کنندگان در کدینگ مالی یافت نشد.' }, 409);
                const linesP = [{ account_id: creditAcc.id, credit: amount, note: PUR_PAY_METHOD_FA_22B[method] + (method === 'check' ? ' شماره ' + checkNo : '') }];
                if (allocatedTotal > 0) linesP.push({ account_id: apAcc.id, debit: allocatedTotal, note: 'تسویه ' + allocated.map((a) => a.invoice_no).join('، ') });
                if (onAccount > 0) linesP.push({ account_id: accByCode['230003'].id, debit: onAccount, note: 'پیش‌پرداخت ' + sup.name });
                finPostDoc(live, { source: 'purchase', ref_module: 'purchase', ref_id: 'pay:' + rec.payment_no, date_jalali: dj, desc: 'پرداخت وجه ' + rec.payment_no + ' — ' + sup.name + ' — ' + salesFmt21a(amount) + ' ریال', lines: linesP, created_by: String((req.user && (req.user.name || req.user.username)) || '') });
                allocated.forEach((a) => { const inv = (live.purchase_invoices || []).find((x) => x.id === a.invoice_id); if (inv) inv.paid_rial = round2((Number(inv.paid_rial) || 0) + a.amount_rial); });
                live.purchase_payments.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ پرداخت انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'purchase.payment.create', { payment_no: rec.payment_no, amount: amount, method: method });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت پرداخت ناموفق: ' + e.message }, 409); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'GET' && pathname === '/api/purchase/finance') {
        if (!auth.requireRole(req, PUR_READ_22B)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = purEnsure22b(purEnsure22a(invEnsure(readLive())));
        const todayJ = finIsoToJalali(new Date().toISOString());
        const invoices = (live.purchase_invoices || []).map((inv) => Object.assign({}, inv, {
            remaining_rial: Math.max(0, Math.round((Number(inv.total_rial) || 0) - (Number(inv.paid_rial) || 0))),
            status_fa: PUR_INV_STATUS_FA_22B[inv.status] || inv.status,
            days_late: inv.status === 'confirmed' ? salesDaysLate21b(todayJ, inv.due_date_jalali) : 0,
            aging_bucket: inv.status === 'confirmed' ? salesAgingBucket21b(salesDaysLate21b(todayJ, inv.due_date_jalali)) : '',
        })).sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || '')));
        const payments = (live.purchase_payments || []).slice().sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || '')));
        const ap = (live.suppliers || []).map((s) => {
            const open = invoices.filter((inv) => inv.supplier_id === s.id && inv.status === 'confirmed' && inv.remaining_rial > 0).map((inv) => ({ invoice_no: inv.invoice_no, total_rial: inv.total_rial, paid_rial: inv.paid_rial, remaining_rial: inv.remaining_rial, due_date_jalali: inv.due_date_jalali, days_late: inv.days_late, bucket: inv.aging_bucket }));
            /* رسید بدون فاکتور (GRNI) — بهای ثبت‌شدهٔ رسیدهایی که هنوز فاکتور نشده‌اند */
            const grni = Math.round((live.purchase_receipts || []).filter((r) => r.supplier_id === s.id && r.status !== 'returned' && !r.invoice_no).reduce((x, r) => x + (Number(r.booked_value_rial) || 0), 0));
            return { supplier_id: s.id, name: s.name, ap_account_code: s.ap_account_code || '', balance_rial: purApBalance22b(live, s), advance_rial: Math.round(payments.filter((p) => p.supplier_id === s.id).reduce((x, p) => x + (Number(p.on_account_rial) || 0), 0)), grni_rial: grni, open_count: open.length, open: open };
        });
        const agingTotals = { 'جاری': 0, '۱-۳۰': 0, '۳۱-۶۰': 0, '۶۱-۹۰': 0, '+۹۰': 0 };
        ap.forEach((s) => s.open.forEach((inv) => { agingTotals[inv.bucket] = (agingTotals[inv.bucket] || 0) + inv.remaining_rial; }));
        return sendJson(res, {
            ok: true, invoices: invoices, payments: payments, ap: ap, aging_totals: agingTotals,
            vat_rate: (live.fin_config && Number(live.fin_config.vat_rate)) || 10,
            currency: (live.fin_config && live.fin_config.currency) || 'ریال',
            today_jalali: todayJ,
        });
    }

    if (req.method === 'GET' && pathname === '/api/purchase/reports') {
        if (!auth.requireRole(req, PUR_READ_22B)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = purEnsure22b(purEnsure22a(invEnsure(readLive())));
        const todayJ = finIsoToJalali(new Date().toISOString());
        /* خرید per تأمین‌کننده/ماه — تناژ و بهای ثبت‌شده از رسیدها (به‌جز برگشتی) */
        const byKey = {};
        (live.purchase_receipts || []).filter((r) => r.status !== 'returned').forEach((r) => {
            const month = String(r.date_jalali || '').slice(0, 7);
            const k = r.supplier_id + '|' + month;
            byKey[k] = byKey[k] || { supplier: r.supplier_name, month: month, ton: 0, amount_rial: 0, receipts: 0 };
            byKey[k].receipts += 1;
            byKey[k].amount_rial += Math.round(Number(r.booked_value_rial) || 0);
            (r.lines || []).forEach((l) => { if (l.kind === 'billet') byKey[k].ton = round2(byKey[k].ton + (Number(l.qty) || 0)); });
        });
        const by_supplier_month = Object.keys(byKey).map((k) => byKey[k]).sort((a, b2) => a.month.localeCompare(b2.month) || String(a.supplier).localeCompare(String(b2.supplier)));
        /* ارزیابی تأمین‌کنندگان — میانگین تأخیر تحویل (رسید − سررسید تحویل PO) + آمار */
        const evaluation = (live.suppliers || []).map((s) => {
            const rows = (live.purchase_receipts || []).filter((r) => r.supplier_id === s.id && r.status !== 'returned');
            let delays = [];
            rows.forEach((r) => {
                const po = (live.purchase_orders || []).find((o) => o.po_no === r.po_no);
                if (!po) return;
                const d = salesDaysLate21b(String(r.date_jalali || ''), String(po.delivery_due_jalali || ''));
                if (po.delivery_due_jalali) delays.push(d);
            });
            const ton = round2(rows.reduce((x, r) => x + (r.lines || []).filter((l) => l.kind === 'billet').reduce((y, l) => y + (Number(l.qty) || 0), 0), 0));
            const avg = delays.length ? Math.round(delays.reduce((x, y) => x + y, 0) / delays.length) : null;
            return { supplier_id: s.id, name: s.name, receipts_count: rows.length, ton_billet: ton, avg_delivery_delay_days: avg, late_count: delays.filter((d) => d > 0).length, purchases_rial: rows.reduce((x, r) => x + (Number(r.booked_value_rial) || 0), 0) };
        });
        const confirmed = (live.purchase_invoices || []).filter((x) => x.status === 'confirmed');
        const vat = {
            rate: (live.fin_config && Number(live.fin_config.vat_rate)) || 10,
            purchase_base: confirmed.reduce((s, x) => s + (Number(x.goods_rial) || 0), 0),
            vat_total: confirmed.reduce((s, x) => s + (Number(x.vat_rial) || 0), 0),
            invoices_count: confirmed.length,
            returned_count: (live.purchase_invoices || []).filter((x) => x.status === 'returned').length,
        };
        return sendJson(res, {
            ok: true, today_jalali: todayJ, by_supplier_month: by_supplier_month, evaluation: evaluation, vat: vat,
            invoices: (live.purchase_invoices || []).length,
            receipts: (live.purchase_receipts || []).length,
            ap_rows: (live.suppliers || []).map((s) => ({ name: s.name, balance_rial: purApBalance22b(live, s) })),
        });
    }
    // ===== FEAT-PURCHASE-22b (end) =====


    // ================================================================
    // ===== FEAT-QC-PRO-24a (begin): کنترل کیفیت حرفه‌ای — مستر گرید +
    // مشخصات فنی محصول + آزمون ورودی مواد. کاملاً parallel به
    // quality_inspections موجود ساخته شده (بدون هیچ تغییری در آن ماژول) و
    // بدون وابستگی npm جدید. گریدهای پیش‌فرض از استانداردهای رسمی سید
    // می‌شوند و همهٔ مقادیر min/max با CRUD قابل ویرایش‌اند:
    //   A3 → ISIRI 3132 (ReH≥400 / Rm≥600 / A≥14٪ / P,S≤0.045)
    //   A4 → ISIRI 8202 (آج500: ReH≥500 / Rm≥650)
    //   5SP → GOST 5781 A-II (ReH≥392 / Rm≥586 / A≥19٪)
    //   B500B → DIN 488/EN 10080 (ReH≥500 / Rm/Re≥1.08 / Agt≥5٪)
    //   A615-Gr60 → ASTM A615 (ReH≥420 / Rm≥620 / C≤0.30 Mn≤1.20)
    // نقش‌ها: qc ثبت+تأیید؛ warehouse فقط ثبت آزمون؛ engineering مشارکت
    // در گرید/مشخصات؛ manager/finance/sales فقط‌خواندن.
    // ================================================================
    function qcEnsure24a(live) {
        live.qc_grades_24 = Array.isArray(live.qc_grades_24) ? live.qc_grades_24 : [];
        live.qc_specs_24 = Array.isArray(live.qc_specs_24) ? live.qc_specs_24 : [];
        live.qc_incoming_24 = Array.isArray(live.qc_incoming_24) ? live.qc_incoming_24 : [];
        live.qc_seq_24 = live.qc_seq_24 && typeof live.qc_seq_24 === 'object' ? live.qc_seq_24 : {};
        if (live.qc_seq_24.incoming == null) live.qc_seq_24.incoming = 0;
        return live;
    }
    function qcNextNo24a(live, key, prefix) { live.qc_seq_24[key] = (Number(live.qc_seq_24[key]) || 0) + 1; return prefix + '-' + String(live.qc_seq_24[key]).padStart(5, '0'); }
    /* گریدهای پیش‌فرض استاندارد — idempotent (فقط بار اول؛ _qc_seed_24a) */
    function qcSeedGrades24a(live) {
        qcEnsure24a(live);
        if (live._qc_seed_24a) return live;
        const mk24a = (name, standard, chem, mech, diameters, notes) => ({ id: 'gr24-' + String(name).toLowerCase().replace(/[^a-z0-9]/g, ''), name, standard, chem, mech, diameters, active: true, notes: notes || '', _seed: true });
        live.qc_grades_24.push(
            mk24a('A3', 'ISIRI 3132',
                { C: { min: null, max: 0.25 }, Mn: { min: 0.6, max: 1.6 }, Si: { min: 0.1, max: 0.6 }, P: { min: null, max: 0.045 }, S: { min: null, max: 0.045 }, Cu: { min: null, max: 0.4 }, N: { min: null, max: 0.012 } },
                { ReH: { min: 400, max: null }, Rm: { min: 600, max: null }, A: { min: 14, max: null }, ratio: { min: 1.25, max: null }, bend: 'خمش 3d بدون ترک' },
                [8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32], 'میلگرد آج‌دار 400 — حداقل تسلیم ۴۰۰ و کشش ۶۰۰ مگاپاسکال (ISIRI 3132)'),
            mk24a('A4', 'ISIRI 8202',
                { C: { min: null, max: 0.22 }, Mn: { min: 0.7, max: 1.6 }, Si: { min: 0.15, max: 0.6 }, P: { min: null, max: 0.04 }, S: { min: null, max: 0.04 }, Cu: { min: null, max: 0.4 }, N: { min: null, max: 0.012 } },
                { ReH: { min: 500, max: null }, Rm: { min: 650, max: null }, A: { min: 12, max: null }, ratio: { min: 1.2, max: null }, bend: 'خمش 3d' },
                [10, 12, 14, 16, 18, 20, 22, 25, 28], 'میلگرد آج 500 (S500) — ISIRI 8202'),
            mk24a('5SP', 'GOST 5781',
                { C: { min: null, max: 0.3 }, Mn: { min: 0.5, max: 1.6 }, Si: { min: 0.15, max: 0.8 }, P: { min: null, max: 0.045 }, S: { min: null, max: 0.05 }, Cu: { min: null, max: 0.3 }, N: { min: null, max: 0.012 } },
                { ReH: { min: 392, max: null }, Rm: { min: 586, max: null }, A: { min: 19, max: null }, ratio: { min: 1.15, max: null }, bend: 'خمش 3d' },
                [8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 32], 'معادل A-II روسی — رایج بازار ایران'),
            mk24a('B500B', 'DIN 488 / EN 10080',
                { C: { min: null, max: 0.22 }, Mn: { min: 0.7, max: 1.6 }, Si: { min: 0.1, max: 0.6 }, P: { min: null, max: 0.04 }, S: { min: null, max: 0.04 }, Cu: { min: null, max: 0.4 }, N: { min: null, max: 0.012 } },
                { ReH: { min: 500, max: null }, Rm: { min: 540, max: null }, A: { min: 8, max: null }, ratio: { min: 1.08, max: null }, bend: 'خمش و بازخم 3d' },
                [8, 10, 12, 14, 16, 20, 25, 32], 'شکل‌پذیری بالا — Agt ≥ ۵٪ و نسبت Rm/ReH ≥ 1.08'),
            mk24a('A615-Gr60', 'ASTM A615',
                { C: { min: null, max: 0.3 }, Mn: { min: null, max: 1.2 }, Si: { min: null, max: 0.4 }, P: { min: null, max: 0.04 }, S: { min: null, max: 0.05 }, Cu: { min: null, max: 0.35 }, N: { min: null, max: 0.014 } },
                { ReH: { min: 420, max: null }, Rm: { min: 620, max: null }, A: { min: 7, max: null }, ratio: { min: 1.15, max: null }, bend: 'bend test per ASTM A615' },
                [10, 12, 14, 16, 18, 20, 22, 25, 28, 32], 'Grade 60 — ReH≥420 MPa (60 ksi)')
        );
        /* مشخصات فنی پیش‌فرض سایزهای رایج A3 — تلرانس جرم طولی ±۴.۵٪ (ISO 6935-2) */
        const W24A = { 8: 0.395, 10: 0.617, 12: 0.888, 14: 1.21, 16: 1.58, 18: 2.0, 20: 2.47, 22: 2.98, 25: 3.85, 28: 4.83, 32: 6.31 };
        [10, 12, 14, 16, 18, 20, 22, 25].forEach((s) => {
            live.qc_specs_24.push({ id: 'ps24-' + s + '-a3', size: s, grade: 'A3', std: 'ISIRI 3132', nominal_weight_kg_m: W24A[s], tol_diameter_mm: { min: -0.4, max: 0.4 }, tol_length_mm: { min: -50, max: 50 }, tol_weight_percent: { min: -4.5, max: 4.5 }, piece_length_m: 12, active: true, _seed: true });
        });
        live._qc_seed_24a = { at: new Date().toISOString() };
        return live;
    }
    /* ارزیابی per عنصر/ویژگی نسبت به مشخصات گرید — pass/fail با دلیل */
    function qcEvalIncoming24a(grade, chem, mech) {
        const rows = [];
        const EL_FA_24A = { C: 'کربن (C)', Mn: 'منگنز (Mn)', Si: 'سیلیس (Si)', P: 'فسفر (P)', S: 'گوگرد (S)', Cu: 'مس (Cu)', N: 'نیتروژن (N)' };
        Object.keys(EL_FA_24A).forEach((el) => {
            const spec = (grade && grade.chem && grade.chem[el]) || null;
            const hasSpec = !!(spec && (spec.min != null || spec.max != null));
            const val = (chem && chem[el] != null && chem[el] !== '') ? Number(chem[el]) : null;
            if (!hasSpec && val == null) return;
            let ok = true, why = '';
            if (val == null) { ok = false; why = 'نتیجهٔ آزمون ثبت نشده'; }
            else if (hasSpec && spec.min != null && val < spec.min - 1e-9) { ok = false; why = 'کمتر از حداقل استاندارد (' + spec.min + ')'; }
            else if (hasSpec && spec.max != null && val > spec.max + 1e-9) { ok = false; why = 'بیشتر از حداکثر استاندارد (' + spec.max + ')'; }
            rows.push({ kind: 'chem', el: el, label: EL_FA_24A[el], val: val, min: hasSpec ? spec.min : null, max: hasSpec ? spec.max : null, ok: ok, why: why });
        });
        const MECH_FA_24A = { ReH: 'تنش تسلیم ReH (MPa)', Rm: 'مقاومت کششی Rm (MPa)', A: 'ازدیاد طول A (٪)' };
        Object.keys(MECH_FA_24A).forEach((k) => {
            const spec = (grade && grade.mech && grade.mech[k]) || null;
            const val = (mech && mech[k] != null && mech[k] !== '') ? Number(mech[k]) : null;
            if (!spec && val == null) return;
            let ok = true, why = '';
            if (val == null) { ok = false; why = 'نتیجهٔ آزمون ثبت نشده'; }
            else if (spec && spec.min != null && val < spec.min - 1e-9) { ok = false; why = 'کمتر از حداقل استاندارد (' + spec.min + ')'; }
            else if (spec && spec.max != null && val > spec.max + 1e-9) { ok = false; why = 'بیشتر از حداکثر استاندارد (' + spec.max + ')'; }
            rows.push({ kind: 'mech', el: k, label: MECH_FA_24A[k], val: val, min: spec ? spec.min : null, max: spec ? spec.max : null, ok: ok, why: why });
        });
        if (mech && mech.bend != null && mech.bend !== '') rows.push({ kind: 'mech', el: 'bend', label: 'تست خمش', val: mech.bend ? 1 : 0, min: null, max: null, ok: !!mech.bend, why: mech.bend ? '' : 'خمش مغایر (ترک/شکست)' });
        const overall = rows.length && rows.every((r) => r.ok) ? 'pass' : 'fail';
        return { rows: rows, overall: overall };
    }
    /* قرنطینهٔ خودکار ردیف‌های فیزیکی یک آزمون ردشده (رد آزمون ورودی) — روی دادهٔ انبار با مارکر، بدون تغییر API انبار */
    function qcQuarantineRows24a(live, receiptNo, heatNumber) {
        let n = 0;
        (live.inventory_receipts || []).forEach((r) => {
            if (!r || r.stock_status !== 'available') return;
            const byReceipt = receiptNo && String(r.source_ref || '') === String(receiptNo);
            const byHeat = heatNumber && String(r.heat_number || '') === String(heatNumber) && String(r.warehouse) === 'raw';
            if (byReceipt || byHeat) { r.stock_status = 'quarantine'; r.qc_note_24 = 'قرنطینه QC ورودی — آزمون ردشده'; n++; }
        });
        return n;
    }
    const QC_READ_24A = ['admin', 'qc', 'quality', 'warehouse', 'engineering', 'manager', 'finance', 'sales'];
    const QC_GRADE_W_24A = ['admin', 'qc', 'engineering'];
    const QC_IN_REG_24A = ['admin', 'qc', 'quality', 'warehouse'];
    const QC_IN_APR_24A = ['admin', 'qc'];
    const QC_IN_STATUS_FA_24A = { draft: 'در انتظار تصمیم QC', approved: 'تأیید QC', rejected: 'رد QC' };

    if (req.method === 'GET' && pathname === '/api/qcpro/overview') {
        if (!auth.requireRole(req, QC_READ_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز: مشاهدهٔ کنترل کیفیت حرفه‌ای برای نقش شما مجاز نیست.' }, 403);
        const live = qcSeedGrades24a(qcEnsure24a(readLive()));
        writeJson(LIVE_FILE, live); /* seed idempotent — فایل همیشه به‌روز */
        const incEval = (live.qc_incoming_24 || []).map((t) => {
            const g = (live.qc_grades_24 || []).find((x) => x.id === t.grade_id);
            const gr = (live.purchase_receipts || []).find((r) => r.receipt_no === t.receipt_no);
            const ev = qcEvalIncoming24a(g, t.chem, t.mech);
            return Object.assign({}, t, { grade_name: g ? g.name : (t.grade || '—'), grade_std: g ? g.standard : '', supplier_name: gr ? gr.supplier_name : (t.supplier_name || '—'), po_no: gr ? gr.po_no : (t.po_no || ''), eval: ev, status_fa: QC_IN_STATUS_FA_24A[t.status] || t.status });
        });
        const kpi24a = {
            grades_active: (live.qc_grades_24 || []).filter((g) => g.active !== false).length,
            specs_active: (live.qc_specs_24 || []).filter((s) => s.active !== false).length,
            tests_total: incEval.length, tests_pending: incEval.filter((t) => t.status === 'draft').length,
            tests_approved: incEval.filter((t) => t.status === 'approved').length, tests_rejected: incEval.filter((t) => t.status === 'rejected').length,
        };
        return sendJson(res, {
            ok: true, today_jalali: finIsoToJalali(new Date().toISOString()),
            grades: live.qc_grades_24, specs: live.qc_specs_24, incoming: incEval.sort((a, b2) => String(b2.created_at || '').localeCompare(String(a.created_at || ''))),
            bom_ref: (live.fin_bom || []).map((b) => ({ size: b.size, std_cost: finStdCostPerTon(b, live.fin_config || {}) })),
            receipts_ref: (live.purchase_receipts || []).slice(0, 80).map((r) => ({ receipt_no: r.receipt_no, po_no: r.po_no, supplier_name: r.supplier_name, status: r.status, lines: (r.lines || []).map((l, i) => ({ i: i, kind: l.kind, item_name: l.item_name, heat_number: l.heat_number || '', qty: l.qty })), has_test: (live.qc_incoming_24 || []).some((t) => t.receipt_no === r.receipt_no) })),
            kpi: kpi24a,
        });
    }

    if (req.method === 'POST' && pathname === '/api/qcpro/grades') {
        if (!auth.requireRole(req, QC_GRADE_W_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز: مدیریت مستر گرید فقط برای qc/مهندسی/مدیر مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcSeedGrades24a(qcEnsure24a(readLive()));
                const name = String(b.name || '').trim().slice(0, 30);
                if (!name) return sendJson(res, { error: 'نام گرید الزامی است (مثال: A3).' }, 400);
                if ((live.qc_grades_24 || []).some((g) => g.name === name)) return sendJson(res, { error: 'گریدی با نام «' + name + '» قبلاً تعریف شده است — برای تغییر از ویرایش استفاده کنید.' }, 409);
                const chem = b.chem && typeof b.chem === 'object' ? b.chem : {};
                const mech = b.mech && typeof b.mech === 'object' ? b.mech : {};
                ['C', 'Mn', 'Si', 'P', 'S', 'Cu', 'N'].forEach((el) => {
                    const sp = chem[el] && typeof chem[el] === 'object' ? chem[el] : {};
                    chem[el] = { min: sp.min == null || sp.min === '' ? null : Number(sp.min), max: sp.max == null || sp.max === '' ? null : Number(sp.max) };
                });
                ['ReH', 'Rm', 'A', 'ratio'].forEach((k) => {
                    const sp = mech[k] && typeof mech[k] === 'object' ? mech[k] : {};
                    mech[k] = { min: sp.min == null || sp.min === '' ? null : Number(sp.min), max: sp.max == null || sp.max === '' ? null : Number(sp.max) };
                });
                mech.bend = String(mech.bend || 'خمش 3d').slice(0, 60);
                const dias = Array.isArray(b.diameters) ? b.diameters.map((d) => Math.round(Number(d) || 0)).filter((d) => d > 0) : [];
                const rec = { id: 'gr24-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: name, standard: String(b.standard || '').trim().slice(0, 60) || 'داخلی', chem: chem, mech: mech, diameters: dias, active: b.active === false ? false : true, notes: String(b.notes || '').slice(0, 300), created_by: String((req.user && (req.user.name || req.user.username)) || ''), created_at: new Date().toISOString() };
                live.qc_grades_24.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ گرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.grade.create', { name: name, standard: rec.standard });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت گرید ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'PUT' && pathname === '/api/qcpro/grades') {
        if (!auth.requireRole(req, QC_GRADE_W_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcSeedGrades24a(qcEnsure24a(readLive()));
                const g = (live.qc_grades_24 || []).find((x) => x.id === String(b.id || ''));
                if (!g) return sendJson(res, { error: 'گرید یافت نشد.' }, 404);
                if (b.standard !== undefined) g.standard = String(b.standard || '').trim().slice(0, 60);
                if (b.chem && typeof b.chem === 'object') {
                    ['C', 'Mn', 'Si', 'P', 'S', 'Cu', 'N'].forEach((el) => {
                        const sp = b.chem[el];
                        if (!sp || typeof sp !== 'object') return;
                        g.chem[el] = g.chem[el] || { min: null, max: null };
                        if (sp.min !== undefined) g.chem[el].min = sp.min == null || sp.min === '' ? null : Number(sp.min);
                        if (sp.max !== undefined) g.chem[el].max = sp.max == null || sp.max === '' ? null : Number(sp.max);
                    });
                }
                if (b.mech && typeof b.mech === 'object') {
                    ['ReH', 'Rm', 'A', 'ratio'].forEach((k) => {
                        const sp = b.mech[k];
                        if (!sp || typeof sp !== 'object') return;
                        g.mech[k] = g.mech[k] || { min: null, max: null };
                        if (sp.min !== undefined) g.mech[k].min = sp.min == null || sp.min === '' ? null : Number(sp.min);
                        if (sp.max !== undefined) g.mech[k].max = sp.max == null || sp.max === '' ? null : Number(sp.max);
                    });
                    if (b.mech.bend !== undefined) g.mech.bend = String(b.mech.bend || '').slice(0, 60);
                }
                if (b.diameters !== undefined) g.diameters = Array.isArray(b.diameters) ? b.diameters.map((d) => Math.round(Number(d) || 0)).filter((d) => d > 0) : [];
                if (b.notes !== undefined) g.notes = String(b.notes || '').slice(0, 300);
                if (b.active !== undefined) g.active = !!b.active;
                g.updated_by = String((req.user && (req.user.name || req.user.username)) || '');
                g.updated_at = new Date().toISOString();
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ گرید انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.grade.update', { id: g.id, name: g.name, active: g.active });
                return sendJson(res, { ok: true, record: g });
            } catch (e) { return sendJson(res, { error: 'ویرایش گرید ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/qcpro/specs') {
        if (!auth.requireRole(req, QC_GRADE_W_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز: مشخصات فنی محصول فقط برای qc/مهندسی/مدیر مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcSeedGrades24a(qcEnsure24a(readLive()));
                const size = Math.round(Number(b.size) || 0);
                if (!(size >= 6 && size <= 50)) return sendJson(res, { error: 'سایز میلگرد باید بین ۶ تا ۵۰ باشد.' }, 400);
                const grade = String(b.grade || '').trim().slice(0, 30);
                if (!grade) return sendJson(res, { error: 'گرید الزامی است.' }, 400);
                const dup = (live.qc_specs_24 || []).find((s) => s.size === size && s.grade === grade && s.active !== false);
                if (dup && !b.id) return sendJson(res, { error: 'مشخصات فنی سایز ' + size + ' گرید ' + grade + ' قبلاً ثبت شده است.' }, 409);
                const tolD = b.tol_diameter_mm || {}, tolL = b.tol_length_mm || {}, tolW = b.tol_weight_percent || {};
                const rec = { id: b.id ? String(b.id) : 'ps24-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), size: size, grade: grade, std: String(b.std || '').trim().slice(0, 60) || 'ISIRI 3132', nominal_weight_kg_m: Number(b.nominal_weight_kg_m) || 0, tol_diameter_mm: { min: Number(tolD.min) || 0, max: Number(tolD.max) || 0 }, tol_length_mm: { min: Number(tolL.min) || 0, max: Number(tolL.max) || 0 }, tol_weight_percent: { min: Number(tolW.min) || 0, max: Number(tolW.max) || 0 }, piece_length_m: Number(b.piece_length_m) || 12, active: b.active === false ? false : true, notes: String(b.notes || '').slice(0, 300), updated_by: String((req.user && (req.user.name || req.user.username)) || ''), updated_at: new Date().toISOString() };
                if (rec.nominal_weight_kg_m <= 0) return sendJson(res, { error: 'وزن نامی بر متر (kg/m) الزامی است.' }, 400);
                if (dup && b.id === dup.id) live.qc_specs_24 = live.qc_specs_24.map((s) => (s.id === rec.id ? rec : s));
                else live.qc_specs_24.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ مشخصات فنی انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.spec.upsert', { size: size, grade: grade });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت مشخصات ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/qcpro/incoming') {
        if (!auth.requireRole(req, QC_IN_REG_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت آزمون ورودی فقط برای qc/کیفیت/انبار مجاز است (تأیید نهایی فقط qc).' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcSeedGrades24a(qcEnsure24a(readLive()));
                const receiptNo = String(b.receipt_no || '').trim().slice(0, 40);
                const gr = (live.purchase_receipts || []).find((r) => r.receipt_no === receiptNo);
                if (!gr) return sendJson(res, { error: 'رسید خرید با شماره «' + (receiptNo || '—') + '» یافت نشد — آزمون ورودی باید به رسید خرید (GRN) ارجاع داشته باشد.' }, 404);
                const lineIdx = b.line_index == null || b.line_index === '' ? 0 : Math.max(0, Math.round(Number(b.line_index) || 0));
                const line = (gr.lines || [])[lineIdx];
                if (!line) return sendJson(res, { error: 'ردیف ' + (lineIdx + 1) + ' در رسید «' + receiptNo + '» وجود ندارد.' }, 400);
                const heat = String(b.heat_number || line.heat_number || '').trim().slice(0, 40);
                if (!heat) return sendJson(res, { error: 'کد هیت (Heat Number) برای آزمون ورودی الزامی است.' }, 400);
                if ((live.qc_incoming_24 || []).some((t) => t.receipt_no === receiptNo && t.heat_number === heat && t.line_index === lineIdx)) return sendJson(res, { error: 'برای رسید ' + receiptNo + ' و هیت ' + heat + ' قبلاً آزمون ورودی ثبت شده است.' }, 409);
                const gradeId = String(b.grade_id || '');
                const grade = (live.qc_grades_24 || []).find((g) => g.id === gradeId);
                if (!grade) return sendJson(res, { error: 'گرید انتخابی در مستر گرید یافت نشد.' }, 400);
                const chem = b.chem && typeof b.chem === 'object' ? b.chem : {};
                const mech = b.mech && typeof b.mech === 'object' ? b.mech : {};
                const c24a = {}, m24a = {};
                ['C', 'Mn', 'Si', 'P', 'S', 'Cu', 'N'].forEach((el) => { if (chem[el] != null && chem[el] !== '') c24a[el] = Number(chem[el]); });
                ['ReH', 'Rm', 'A'].forEach((k) => { if (mech[k] != null && mech[k] !== '') m24a[k] = Number(mech[k]); });
                m24a.bend = mech.bend === true || mech.bend === 1 || mech.bend === '1';
                const rec = {
                    id: 'inc24-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                    test_no: qcNextNo24a(live, 'incoming', 'INC'),
                    date_jalali: finIsoToJalali(new Date().toISOString()),
                    receipt_no: receiptNo, po_no: gr.po_no, supplier_name: gr.supplier_name, line_index: lineIdx,
                    item_name: line.item_name || line.kind, kind: line.kind || '',
                    heat_number: heat, size: line.kind === 'rebar' ? (Number(line.size) || 0) : 0,
                    grade_id: grade.id, grade: grade.name, quantity_ton: Number(line.qty) || 0,
                    chem: c24a, mech: m24a,
                    method_chem: String(b.method_chem || 'اسپکترومتری').slice(0, 60), method_mech: String(b.method_mech || 'کشش — ISO 6892-1').slice(0, 60),
                    status: 'draft', notes: String(b.notes || '').slice(0, 400),
                    registered_by: String((req.user && (req.user.name || req.user.username)) || ''), registered_at: new Date().toISOString(),
                    decided_by: '', decided_at: null, quarantine_count: 0,
                };
                rec.eval = qcEvalIncoming24a(grade, c24a, m24a);
                live.qc_incoming_24.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ آزمون ورودی انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.incoming.register', { test_no: rec.test_no, receipt_no: receiptNo, heat: heat, grade: grade.name, overall: rec.eval.overall });
                return sendJson(res, { ok: true, record: Object.assign({}, rec, { eval: rec.eval }) }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت آزمون ورودی ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/qcpro/incoming/decide') {
        if (!auth.requireRole(req, QC_IN_APR_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز: تأیید/رد آزمون ورودی فقط برای کنترل کیفیت (qc) مجاز است — انبار فقط ثبت می‌کند.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcSeedGrades24a(qcEnsure24a(readLive()));
                const t = (live.qc_incoming_24 || []).find((x) => x.id === String(b.id || '') || x.test_no === String(b.id || ''));
                if (!t) return sendJson(res, { error: 'آزمون ورودی یافت نشد.' }, 404);
                if (t.status !== 'draft') return sendJson(res, { error: 'برای این آزمون قبلاً تصمیم گرفته شده (وضعیت: ' + (QC_IN_STATUS_FA_24A[t.status] || t.status) + ').' }, 409);
                const decision = String(b.decision || '');
                if (['approved', 'rejected'].indexOf(decision) === -1) return sendJson(res, { error: 'تصمیم باید «approved» یا «rejected» باشد.' }, 400);
                t.status = decision;
                t.decided_by = String((req.user && (req.user.name || req.user.username)) || '');
                t.decided_at = new Date().toISOString();
                t.decision_note = String(b.notes || '').slice(0, 300);
                if (decision === 'rejected') {
                    /* ===== FEAT-QC-PRO-24a: سند خودکار رد آزمون — قرنطینهٔ ردیف‌های فیزیکی همان رسید/هیت (کاهش موجودی قابل‌مصرف) ===== */
                    t.quarantine_count = qcQuarantineRows24a(live, t.receipt_no, t.heat_number);
                    if (!t.quarantine_count && t.heat_number) {
                        /* رسید بدون هیت ثبت‌شده — قرنطینه بر اساس هیت در همهٔ انبارها */
                        (live.inventory_receipts || []).forEach((r) => { if (r && r.stock_status === 'available' && String(r.heat_number || '') === String(t.heat_number)) { r.stock_status = 'quarantine'; r.qc_note_24 = 'قرنطینه QC ورودی — آزمون ردشده'; t.quarantine_count++; } });
                    }
                }
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ تصمیم QC انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.incoming.decide', { test_no: t.test_no, decision: decision, quarantine: t.quarantine_count || 0 });
                return sendJson(res, { ok: true, record: t, quarantined: t.quarantine_count || 0 });
            } catch (e) { return sendJson(res, { error: 'تصمیم QC ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }
    // ===== FEAT-QC-PRO-24a (end) =====

    // ================================================================
    // ===== FEAT-QC-PRO-24b (begin): گواهی کیفیت (MTC طبق EN 10204 3.1)
    // + عدم انطباق (NCR) + گزارش‌های QC. کاملاً افزاینده — finPostDoc فقط
    // «فراخوانی» می‌شود (source «qc_ncr» — همان موتور واحد و idempotent).
    // MTC: per حوالهٔ فروش/سفارش — Heat Number + آنالیز شیمیایی + مکانیکی
    // + VID تأیید آنلاین (GET عمومی /api/qcpro/mtc/verify/:vid با حداقل داده).
    // الزام صادرات: سفارش صادراتی بدون MTC → فاکتور ۴۰۹ MTC_REQUIRED.
    // NCR: بندیل/هیت/رسید با NCR باز (Major/Critical یا Rejection) → حواله ۴۰۹.
    // بستن NCR با اقدام رد → قرنطینه + سند زیان ضایعات (۵۲۰۰۰۱/۱۱۰xxx).
    // ================================================================
    function qcEnsure24b(live) {
        live.qc_mtc_24 = Array.isArray(live.qc_mtc_24) ? live.qc_mtc_24 : [];
        live.qc_ncr_24 = Array.isArray(live.qc_ncr_24) ? live.qc_ncr_24 : [];
        if (live.qc_seq_24.mtc == null) live.qc_seq_24.mtc = 0;
        if (live.qc_seq_24.ncr == null) live.qc_seq_24.ncr = 0;
        return live;
    }
    if (req.method === 'POST' && pathname === '/api/qcpro/mtc') {
        if (!auth.requireRole(req, QC_MTC_W_24B)) return sendJson(res, { error: 'دسترسی غیرمجاز: صدور گواهی کیفیت (MTC) فقط برای کنترل کیفیت مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcEnsure24b(qcEnsure24a(invEnsure(readLive())));
                let order = null, exit = null, size = '', weight = 0, pieces = 0, custName = '', cust = null, dj = '';
                const exits = (live.sales_exits || []);
                if (b.exit_id) {
                    exit = exits.find((e) => e.id === String(b.exit_id) || e.exit_no === String(b.exit_id));
                    if (!exit) return sendJson(res, { error: 'حوالهٔ فروش یافت نشد.' }, 404);
                    if ((live.qc_mtc_24 || []).some((m) => m.exit_no === exit.exit_no)) return sendJson(res, { error: 'برای حوالهٔ ' + exit.exit_no + ' قبلاً MTC صادر شده است (شماره: ' + ((live.qc_mtc_24 || []).find((m) => m.exit_no === exit.exit_no) || {}).mtc_no + ').' }, 409);
                    order = (live.sales_orders || []).find((o) => o.id === exit.order_id);
                    size = String(exit.size); weight = Number(exit.weight_ton) || 0; pieces = Number(exit.pieces) || 0; dj = exit.date_jalali || finIsoToJalali(exit.created_at);
                } else if (b.order_id) {
                    order = (live.sales_orders || []).find((o) => o.id === String(b.order_id) || o.order_no === String(b.order_id));
                    if (!order) return sendJson(res, { error: 'سفارش فروش یافت نشد.' }, 404);
                    const covered = (live.qc_mtc_24 || []).filter((m) => m.order_id === order.id);
                    const its = order.items || [];
                    if (covered.length >= its.length) return sendJson(res, { error: 'برای همهٔ سایزهای این سفارش MTC صادر شده است.' }, 409);
                    const done = its.map((i) => String(i.size)).filter((s) => !covered.some((m) => m.size === s));
                    size = done[0]; weight = round2(((order.items || []).find((i) => String(i.size) === size) || {}).qty_ton || 0); dj = order.date_jalali || finIsoToJalali(order.created_at);
                } else return sendJson(res, { error: 'انتخاب حواله (exit_id) یا سفارش (order_id) الزامی است.' }, 400);
                if (!order) return sendJson(res, { error: 'سفارش حواله یافت نشد.' }, 404);
                cust = (live.customers || []).find((c) => c.id === order.customer_id);
                custName = (cust && cust.name) || order.customer_name || '—';
                /* هیت‌های مرجع: بندیل‌های همین سایز + هیت حواله در صورت وجود (اختیاری بدنهٔ درخواست) */
                let heats = b.heat_number ? [String(b.heat_number).trim().slice(0, 40)] : Array.from(qcHeatsOfSize24b(live, size));
                if (!heats.length) return sendJson(res, { error: 'هیت مرجع برای سایز ' + size + ' یافت نشد — بندیل/کد هیت تولید ثبت نشده است.' }, 409);
                if (heats.length > 6) heats = heats.slice(0, 6);
                /* گرید و استاندارد: از بندیل/مشخصات فنی/پیش‌فرض گرید فعال */
                const bundles = (live.rebar_bundles || []).filter((x) => String(x.rebar_size) === String(size));
                const spec24b = (live.qc_specs_24 || []).find((s) => String(s.size) === String(size) && s.active !== false);
                const gradeName = String(b.grade || (bundles[0] && bundles[0].rebar_grade) || (spec24b && spec24b.grade) || 'A3').trim();
                const grade24b = (live.qc_grades_24 || []).find((g) => g.name === gradeName && g.active !== false) || (live.qc_grades_24 || []).find((g) => g.name === gradeName) || (live.qc_grades_24 || []).find((g) => g.active !== false);
                /* نتایج آزمون per هیت — بدون نتیجهٔ واقعی، MTC صادر نمی‌شود (صحت گواهی) */
                const tests = {};
                let missing = [];
                heats.forEach((h) => { const t = qcTestForHeat24b(live, h); tests[h] = t; if (!t.chem || !t.mech) missing.push(h); });
                if (missing.length) return sendJson(res, { error: 'برای هیت ' + missing.join(', ') + ' نتایج آزمون (شیمیایی/مکانیکی) کامل یافت نشد — ابتدا آزمون ورودی را ثبت و از QC تأیید کنید یا آزمایشگاه QC را تکمیل کنید.', missing: missing }, 409);
                const mtcNo = qcNextNo24a(live, 'mtc', 'MTC');
                const vid = 'MTCV' + crypto.createHash('sha1').update(mtcNo + '|' + Date.now() + '|' + Math.random()).digest('hex').slice(0, 10).toUpperCase();
                const rec = {
                    id: 'mtc24-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
                    mtc_no: mtcNo, verify_id: vid, cert_type: 'EN 10204 — Type 3.1',
                    order_id: order.id, order_no: order.order_no, exit_no: exit ? exit.exit_no : '',
                    invoice_no: exit ? (exit.invoice_no || '') : '',
                    customer_id: order.customer_id, customer_name: custName,
                    size: size, grade: gradeName, standard: grade24b ? grade24b.standard : '',
                    weight_ton: weight, pieces: pieces, date_jalali: dj,
                    is_export: order.is_export === true,
                    heat_numbers: heats, tests: tests, test_source: tests[heats[0]] && tests[heats[0]].source,
                    tol_weight_percent: spec24b ? spec24b.tol_weight_percent : null, piece_length_m: spec24b ? spec24b.piece_length_m : null,
                    issued_by: String((req.user && (req.user.name || req.user.username)) || ''), issued_at: new Date().toISOString(),
                    notes: String(b.notes || '').slice(0, 300),
                };
                rec.hash = crypto.createHash('sha256').update(JSON.stringify([mtcNo, vid, order.order_no, exit ? exit.exit_no : '', size, gradeName, weight, heats, rec.issued_by])).digest('hex').slice(0, 32);
                live.qc_mtc_24.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ MTC انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.mtc.issue', { mtc_no: mtcNo, exit_no: rec.exit_no, order_no: rec.order_no, heats: heats });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'صدور MTC ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    /* تأیید آنلاین MTC — عمومی (مشتری/گمر QR را اسکن می‌کند) با حداقل دادهٔ امن */
    let QCV_M;
    if (req.method === 'GET' && (QCV_M = pathname.match(/^\/api\/qcpro\/mtc\/verify\/([A-Za-z0-9]+)$/))) {
        const live = qcEnsure24b(qcEnsure24a(readLive()));
        const m = (live.qc_mtc_24 || []).find((x) => x.verify_id === QCV_M[1]);
        if (!m) return sendJson(res, { ok: true, valid: false, message: 'گواهی یافت نشد — شمارهٔ تأیید نامعتبر است.' });
        return sendJson(res, {
            ok: true, valid: true, mtc_no: m.mtc_no, cert_type: m.cert_type, tenant: (function () { try { return loadTenant15a().name || 'Sanatify'; } catch (e) { return 'Sanatify'; } })(),
            customer: m.customer_name, order_no: m.order_no, exit_no: m.exit_no || '', size: m.size, grade: m.grade, standard: m.standard,
            weight_ton: m.weight_ton, heat_numbers: m.heat_numbers, date_jalali: m.date_jalali, issued_at: m.issued_at, hash: m.hash,
        });
    }

    if (req.method === 'POST' && pathname === '/api/qcpro/ncr') {
        if (!auth.requireRole(req, QC_NCR_W_24B)) return sendJson(res, { error: 'دسترسی غیرمجاز: ثبت عدم انطباق (NCR) فقط برای کنترل کیفیت مجاز است.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcEnsure24b(qcEnsure24a(readLive()));
                const scope = ['bundle', 'heat', 'receipt'].indexOf(b.scope) !== -1 ? b.scope : 'heat';
                const ntype = ['chem', 'mech', 'dim', 'visual'].indexOf(b.ntype) !== -1 ? b.ntype : 'visual';
                const severity = ['minor', 'major', 'critical'].indexOf(b.severity) !== -1 ? b.severity : 'minor';
                const action = ['rework', 'concession', 'rejection'].indexOf(b.action) !== -1 ? b.action : 'rework';
                const desc = String(b.description || '').trim();
                if (desc.length < 5) return sendJson(res, { error: 'شرح عدم انطباق الزامی است (حداقل ۵ نویسه).' }, 400);
                const rec = { id: 'ncr24-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ncr_no: qcNextNo24a(live, 'ncr', 'NCR'), date_jalali: finIsoToJalali(new Date().toISOString()), scope: scope, bundle_code: String(b.bundle_code || '').trim().slice(0, 40), heat_number: String(b.heat_number || '').trim().slice(0, 40), receipt_no: String(b.receipt_no || '').trim().slice(0, 40), size: String(b.size || '').trim().slice(0, 12), ntype: ntype, severity: severity, action: action, quantity_ton: round2(Number(b.quantity_ton) || 0), description: desc.slice(0, 500), status: 'open', opened_by: String((req.user && (req.user.name || req.user.username)) || ''), opened_at: new Date().toISOString(), closed_at: null, closed_by: '', corrective_action: '' };
                if (rec.scope === 'heat' && !rec.heat_number) return sendJson(res, { error: 'برای NCR هیت، کد هیت الزامی است.' }, 400);
                if (rec.scope === 'bundle' && !rec.bundle_code) return sendJson(res, { error: 'برای NCR بندیل، کد بندیل الزامی است.' }, 400);
                if (rec.scope === 'receipt' && !rec.receipt_no) return sendJson(res, { error: 'برای NCR رسید، شمارهٔ رسید خرید الزامی است.' }, 400);
                /* پرکردن خودکار هیت/سایز/تناژ از بندیل یا رسید (برای گارد حواله و سند مالی) */
                if (rec.scope === 'bundle') {
                    const bd = (live.rebar_bundles || []).find((x) => String(x.bundle_code) === rec.bundle_code);
                    if (bd) { rec.heat_number = rec.heat_number || String(bd.heat_number || ''); rec.size = rec.size || String(bd.rebar_size || ''); rec.quantity_ton = rec.quantity_ton || round2((Number(bd.net_weight_kg) || 0) / 1000); }
                }
                if (rec.scope === 'receipt') {
                    const gr = (live.purchase_receipts || []).find((x) => x.receipt_no === rec.receipt_no);
                    if (gr) { rec.quantity_ton = rec.quantity_ton || round2((gr.lines || []).reduce((s, l) => s + (Number(l.qty) || 0), 0)); const hl = (gr.lines || []).find((l) => l.heat_number); rec.heat_number = rec.heat_number || (hl ? hl.heat_number : ''); }
                }
                if (!rec.quantity_ton) rec.quantity_ton = 0;
                live.qc_ncr_24.push(rec);
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ NCR انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.ncr.open', { ncr_no: rec.ncr_no, scope: rec.scope, severity: rec.severity, action: rec.action, heat: rec.heat_number });
                return sendJson(res, { ok: true, record: rec }, 201);
            } catch (e) { return sendJson(res, { error: 'ثبت NCR ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'POST' && pathname === '/api/qcpro/ncr/close') {
        if (!auth.requireRole(req, QC_NCR_W_24B)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        readBody(req).then((raw) => {
            try {
                const b = sanitizeInput15b(JSON.parse(raw || '{}'));
                const live = qcEnsure24b(qcEnsure24a(invEnsure(readLive())));
                const n = (live.qc_ncr_24 || []).find((x) => x.id === String(b.id || '') || x.ncr_no === String(b.id || ''));
                if (!n) return sendJson(res, { error: 'NCR یافت نشد.' }, 404);
                if (n.status !== 'open') return sendJson(res, { error: 'این NCR قبلاً بسته شده است.' }, 409);
                n.corrective_action = String(b.corrective_action || '').trim().slice(0, 400);
                if (n.corrective_action.length < 3) return sendJson(res, { error: 'اقدام اصلاحی الزامی است.' }, 400);
                n.status = 'closed'; n.closed_at = new Date().toISOString(); n.closed_by = String((req.user && (req.user.name || req.user.username)) || '');
                let quarantined = 0, docRef = '';
                if (n.action === 'rejection') {
                    /* ===== FEAT-QC-PRO-24b: اقدام «رد» → قرنطینهٔ فیزیکی + سند زیان ضایعات از موتور واحد finPostDoc (idempotent per ncr_no) ===== */
                    let qrows = [];
                    (live.inventory_receipts || []).forEach((r) => {
                        if (!r || r.stock_status !== 'available') return;
                        const hit = (n.receipt_no && String(r.source_ref || '') === String(n.receipt_no)) ||
                            (n.heat_number && (String(r.heat_number || '') === String(n.heat_number) || String(r.lot_no || '') === String(n.heat_number)) && (n.scope === 'heat' || n.scope === 'bundle'));
                        if (hit) qrows.push(r);
                    });
                    qrows.forEach((r) => { r.stock_status = 'quarantine'; r.qc_note_24 = 'قرنطینه — NCR ' + n.ncr_no + ' (اقدام: رد)'; quarantined++; });
                    n.quarantine_count = quarantined;
                    if (!live._fin_v1) finSeed(live); /* اگر مالی هرگز seed نشده بود — همان مسیر رسمی (حساب‌های ۵۲۰۰۰۱/۱۱۰xxx) */
                    const finCfg24b = live.fin_config || {};
                    const isProduct = n.scope === 'bundle' || (n.size && Number(n.size) > 0 && n.scope !== 'receipt');
                    const invAccCode = isProduct ? '110003' : '110001';
                    const accBy24b = {}; (live.fin_accounts || []).forEach((a) => { accBy24b[a.code] = a; });
                    if (accBy24b['520001'] && accBy24b[invAccCode] && (Number(n.quantity_ton) || 0) > 0) {
                        let cost = 0;
                        if (isProduct) {
                            const bom24b = (live.fin_bom || []).find((x) => String(x.size) === String(n.size));
                            cost = bom24b ? finStdCostPerTon(bom24b, finCfg24b) : Math.round((Number(finCfg24b.billet_rial_per_kg) || 0) * 1.035 * 1000 + 110 * (Number(finCfg24b.energy_tariff_rial_per_kwh) || 0) + 2500000 + 4000000 + 350000);
                        } else cost = Math.round((Number(finCfg24b.billet_rial_per_kg) || 0) * 1000);
                        const amt = Math.round((Number(n.quantity_ton) || 0) * cost);
                        if (amt > 0) {
                            const doc = finPostDoc(live, { source: 'qc_ncr', ref_module: 'quality', ref_id: 'ncr:' + n.ncr_no, date_jalali: n.date_jalali, desc: 'زیان ضایعات عدم انطباق — NCR ' + n.ncr_no + ' (' + NCR_TYPE_FA_24B[n.ntype] + ' / ' + NCR_SEV_FA_24B[n.severity] + ') — ' + n.quantity_ton + ' تن' + (n.heat_number ? ' — هیت ' + n.heat_number : ''), lines: [ { account_id: accBy24b['520001'].id, debit: amt, ref_id: n.ncr_no }, { account_id: accBy24b[invAccCode].id, credit: amt, ref_id: n.ncr_no } ], created_by: n.closed_by });
                            docRef = doc && doc.doc && doc.doc.doc_no ? 'F-' + String(doc.doc.doc_no).padStart(5, '0') : '';
                        }
                    }
                }
                if (!writeJson(LIVE_FILE, live)) throw new Error('ذخیرهٔ بستن NCR انجام نشد.');
                cache.data = null; cache.at = 0;
                auditLog(req, 'qcpro.ncr.close', { ncr_no: n.ncr_no, action: n.action, quarantined: quarantined, doc: docRef });
                return sendJson(res, { ok: true, record: n, quarantined: quarantined, doc_no: docRef });
            } catch (e) { return sendJson(res, { error: 'بستن NCR ناموفق: ' + e.message }, 400); }
        }).catch((e) => sendJson(res, { error: e.message }, 500));
        return;
    }

    if (req.method === 'GET' && pathname === '/api/qcpro/reports') {
        if (!auth.requireRole(req, QC_READ_24A)) return sendJson(res, { error: 'دسترسی غیرمجاز.' }, 403);
        const live = qcEnsure24b(qcEnsure24a(readLive()));
        /* نرخ رد QC ورودی per تأمین‌کننده — اتصال به ارزیابی فاز ۱۴ */
        const supMap24b = {};
        (live.purchase_receipts || []).forEach((r) => { supMap24b[r.receipt_no] = r.supplier_name || '—'; });
        const bySup24b = {};
        (live.qc_incoming_24 || []).forEach((t) => {
            const sup = t.supplier_name || supMap24b[t.receipt_no] || '—';
            bySup24b[sup] = bySup24b[sup] || { supplier: sup, total: 0, rejected: 0, pending: 0 };
            bySup24b[sup].total++;
            if (t.status === 'rejected') bySup24b[sup].rejected++;
            if (t.status === 'draft') bySup24b[sup].pending++;
        });
        const supplier_reject = Object.keys(bySup24b).map((k) => { const r = bySup24b[k]; return Object.assign(r, { rate_percent: r.total ? Math.round(r.rejected * 1000 / r.total) / 10 : 0 }); }).sort((a, b2) => b2.rate_percent - a.rate_percent);
        /* نرخ عدم انطباق per گرید/سایز/ماه */
        const aggNcr24b = (keyFn) => {
            const m = {};
            (live.qc_ncr_24 || []).forEach((n) => { const k = keyFn(n) || '—'; m[k] = m[k] || { key: k, count: 0, open: 0, critical: 0 }; m[k].count++; if (n.status === 'open') m[k].open++; if (n.severity === 'critical') m[k].critical++; });
            return Object.keys(m).map((k) => m[k]).sort((a, b2) => b2.count - a.count);
        };
        const bundlesGrade24b = {};
        (live.rebar_bundles || []).forEach((x) => { bundlesGrade24b[String(x.bundle_code || '')] = x.rebar_grade || '—'; });
        const ncr_by_grade = aggNcr24b((n) => (bundlesGrade24b[String(n.bundle_code || '')] || (n.size ? 'سایز ' + n.size : '—')));
        const ncr_by_size = aggNcr24b((n) => (n.size ? 'سایز ' + n.size : '—'));
        const ncr_by_month = aggNcr24b((n) => String(n.date_jalali || '').slice(0, 7));
        const mtc = (live.qc_mtc_24 || []).slice().sort((a, b2) => String(b2.issued_at || '').localeCompare(String(a.issued_at || '')));
        return sendJson(res, {
            ok: true, today_jalali: finIsoToJalali(new Date().toISOString()),
            supplier_reject: supplier_reject,
            ncr_summary: { total: (live.qc_ncr_24 || []).length, open: (live.qc_ncr_24 || []).filter((n) => n.status === 'open').length, rejection: (live.qc_ncr_24 || []).filter((n) => n.action === 'rejection').length },
            ncr_by_grade: ncr_by_grade, ncr_by_size: ncr_by_size, ncr_by_month: ncr_by_month,
            ncr: (live.qc_ncr_24 || []).slice().sort((a, b2) => String(b2.opened_at || '').localeCompare(String(a.opened_at || ''))).map((n) => Object.assign({}, n, { ntype_fa: NCR_TYPE_FA_24B[n.ntype] || n.ntype, severity_fa: NCR_SEV_FA_24B[n.severity] || n.severity, action_fa: NCR_ACTION_FA_24B[n.action] || n.action })),
            mtc: mtc,
            /* بندیل‌های اخیر برای فرم NCR (نقش qc به /api/bundles دسترسی ندارد — مرجع فقط‌خواندنی همین‌جا) */
            bundles_ref: (live.rebar_bundles || []).slice(-120).reverse().map((b) => ({ bundle_code: String(b.bundle_code || ''), heat_number: String(b.heat_number || ''), rebar_size: String(b.rebar_size || ''), rebar_grade: String(b.rebar_grade || ''), net_weight_kg: Number(b.net_weight_kg) || 0 })),
            /* کاندیدهای صدور MTC — حواله‌های بدون گواهی + آمادگی آزمون (برای دراپ‌داون UI) */
            mtc_candidates: (live.sales_exits || []).filter((e) => !(live.qc_mtc_24 || []).some((m) => m.exit_no === e.exit_no)).map((e) => {
                const ord = (live.sales_orders || []).find((o) => o.id === e.order_id) || {};
                const heatsE = Array.from(qcHeatsOfSize24b(live, String(e.size)));
                const ready = heatsE.length > 0 && heatsE.every((h) => { const t = qcTestForHeat24b(live, h); return t.chem && t.mech; });
                return { exit_id: e.id, exit_no: e.exit_no, order_id: e.order_id, order_no: e.order_no, customer_name: ord.customer_name || '—', size: e.size, weight_ton: e.weight_ton, date_jalali: e.date_jalali, is_export: ord.is_export === true, heats: heatsE.slice(0, 6), tests_ready: ready, has_bundle: heatsE.length > 0 };
            }),
            export_orders_without_mtc: (live.sales_orders || []).filter((o) => o.is_export === true && !(live.qc_mtc_24 || []).some((m) => m.order_id === o.id)).map((o) => ({ order_no: o.order_no, customer_name: o.customer_name, sizes: (o.items || []).map((i) => i.size) })),
            blocked_heats: (function () { const s = new Set(); (live.qc_ncr_24 || []).forEach((n) => { if (n.status === 'open' && (n.severity === 'major' || n.severity === 'critical' || n.action === 'rejection') && n.heat_number) s.add(String(n.heat_number)); }); return Array.from(s); })(),
        });
    }
    // ===== FEAT-QC-PRO-24b (end) =====



   if (pathname.startsWith('/api/')) {
        loadData().then((d) => {
            try {
                // ===== FIX-INV-0-HARDENING: حذف شاخهٔ مردهٔ /api/health (مسیر سریع ابتدای فایل پاسخ می‌دهد) =====
                if (pathname === '/api/summary') return sendJson(res, buildSummary(d));
                if (pathname === '/api/production') return sendJson(res, d.production_logs || []);
                if (pathname === '/api/waste') return sendJson(res, d.waste_logs || []);
                if (pathname === '/api/downtime') return sendJson(res, d.downtime_logs || []);
                if (pathname === '/api/quality') return sendJson(res, d.quality_inspections || []);
                if (pathname === '/api/bundles') return sendJson(res, d.rebar_bundles || []);
                if (pathname === '/api/billets') return sendJson(res, d.billets || []);
                // ===== ✅ ADDITIVE — پنل تعمیرات/نگهداری وب: شاخص‌های قابلیت اطمینان از توقفات =====
                if (pathname === '/api/maintenance') {
                    const down = d.downtime_logs || [];
                    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
                    const wk = down.filter(r => (r.start_time || '') >= weekAgo);
                    const un = wk.filter(r => r.is_unplanned);
                    const dtMin = un.reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0);
                    const failures = un.length;
                    const planned = 7 * 720;
                    const byReason = {};
                    un.forEach(r => {
                        const k = r.reason_id || 'unknown';
                        byReason[k] = byReason[k] || { count: 0, minutes: 0 };
                        byReason[k].count += 1;
                        byReason[k].minutes += Number(r.duration_minutes) || 0;
                    });
                    return sendJson(res, {
                        window_days: 7, failures, downtime_minutes: dtMin,
                        mttr_minutes: failures > 0 ? Math.round(dtMin / failures) : 0,
                        mtbf_minutes: failures > 0 ? Math.max(0, Math.round((planned - dtMin) / failures)) : planned,
                        open_downtimes: down.filter(r => !r.end_time).length, by_reason: byReason,
                        list: [...down].sort((a, b) => String(b.start_time || '').localeCompare(String(a.start_time || ''))).slice(0, 50),
                    });
                }
                const gM = pathname.match(/^\/api\/genealogy\/(.+)$/); if (gM) return sendJson(res, buildGenealogy(d, gM[1]));
                const bM = pathname.match(/^\/api\/balance\/(.+)$/); if (bM) return sendJson(res, buildBalance(d, bM[1]));
                return sendJson(res, { error: 'Unknown API endpoint' }, 404);
            } catch (e) { return sendJson(res, { error: String(e && e.message ? e.message : e) }, 500); }
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }

    // ===== فایل‌های استاتیک وب اپ =====
    let rel = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!safePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
    /* HARDEN-18G: سندهای HTML با nonce per درخواست سرو می‌شوند */
    if (safePath.toLowerCase().endsWith('.html')) { sendHtmlNonce18G(res, safePath, req.__cspNonce18G); return; }
    sendFile(res, safePath);
}
// ===== FEAT-HTTPS-11c (end): هندلر مشترک — نمونهٔ HTTP (حالت fallback بدون گواهی) =====
const server = http.createServer(appRequestHandler);

// ===== REVERT-STEEL-4: اجرای یک‌بارهٔ مهاجرت انبار هنگام راه‌اندازی =====
try { migrateSteelWarehouses(readLive()); } catch (e) { console.warn('[STEEL-WH] startup migration failed:', e.message); }
try { bootValidate18A(); } catch (e18a) { console.warn('[HARDEN-18A] boot validation failed:', (e18a && e18a.message) || e18a); } /* HARDEN-18A: چک اسکیما/فایل‌های حیاتی در بوت */
// ===== FEAT-HTTPS-11c (begin): سرویس HTTPS روی پورت اصلی با گواهی mkcert (cert.pem/key.pem در همین پوشه) =====
// اگر گواهی/کلید موجود نبود، سرویس خودکار روی همان پورت با HTTP بالا می‌آید (سرور کارخانه هرگز نمی‌میرد).
let tlsMode = 'HTTP';
let mainServer = server; // حالت پیش‌فرض: HTTP (بدون گواهی)
let httpsServerRef = null; // ===== FEAT-HTTPS-11d: ارجاع سرور https برای تحویل سوکت‌های TLS =====
try {
    /* ===== HARDEN-18I (begin): محکم‌سازی TLS — فقط TLS1.2/1.3 + cipherهای مدرن (الگوی Mozilla Intermediate) + اولویت سرور ===== */
    const tlsOpts18i = {
        key: fs.readFileSync(path.join(ROOT, 'key.pem')),
        cert: fs.readFileSync(path.join(ROOT, 'cert.pem')),
        minVersion: 'TLSv1.2', /* TLS1.0/1.1 ممنوع */
        honorCipherOrder: true, /* ترتیب cipher را سرور تعیین می‌کند نه کلاینت */
        ecdhCurve: 'auto', /* بهترین منحنی‌های ECDHE (X25519/prime256v1) */
        ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_GCM_SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256',
        sessionTimeout: 300, /* ازسرگیری نشست TLS محدود و کنترل‌شده */
    };
    const httpsServer = https.createServer(tlsOpts18i, appRequestHandler);
    /* ===== HARDEN-18I (end) ===== */
    // کلاینت‌های TLS خراب/ناسازگار هرگز سرور را نمی‌اندازند
    httpsServer.on('tlsClientError', (err) => console.warn('[HTTPS] tlsClientError — سرور سالم ماند:', (err && err.code) || (err && err.message) || err));
    mainServer = httpsServer;
    httpsServerRef = httpsServer;
    tlsMode = 'HTTPS';
} catch (e) {
    console.warn('[HTTPS] cert.pem/key.pem در دسترس نیست — fallback خودکار به HTTP روی همان پورت:', (e && e.code) || (e && e.message) || e);
}
auth.setSecureCookie15b(tlsMode === 'HTTPS'); /* SEC-15b: پرچم Secure کوکی فقط در HTTPS */

// ===== FEAT-HTTPS-11d (begin): تک‌پورت‌سازی 3001 — HTTP برهنهٔ خودکار به HTTPS =====
// مشکل: کاربران آدرس را برهنه تایپ می‌کنند (IP:3001) و مرورگر پیش‌فرض http می‌رود → 503/SSL +
// ERR_SSL_HTTP_REQUEST و لاگین «خطا در ارتباط با سرور»؛ صفحه از کش می‌آید ولی API از شبکه.
// راهکار (Port unification با ماژول‌های داخلی net/tls — صفر وابستگی): در حالت HTTPS به‌جای listen
// مستقیم httpsServer روی پورت اصلی، یک سرور خام net روی همان پورت گوش می‌دهد و اولین بایت هر اتصال
// را peek می‌کند: 0x16 (ClientHello) → سوکت به httpsServer فعلی؛ HTTP ساده → 301 به
// https://<همان Host>:PORT<مسیر+کوئری> و بستن اتصال. در حالت fallback (بدون گواهی) peek غیرفعال
// است و HTTP ساده مثل قبل مستقیم روی همان پورت می‌نشیند (سرور کارخانه هرگز نمی‌میرد).
// هندلر ریدایرکت دمولتی‌پلکسر — هم‌منطق با ریدایرکت پورت 3000 (استخراج هاست از سرآیند، حفظ مسیر+کوئری)؛
// اصلاح 11d: استخراج درست هاست برای IPv6 literal (مثل «[fe80::1]:3001» → «[fe80::1]»)
function hostNoPort11d(rawHost) {
    const h = String(rawHost || '').trim();
    if (h.startsWith('[')) {
        const end = h.indexOf(']');
        return end !== -1 ? h.slice(0, end + 1) : h; // خودِ literal، بدون پورت
    }
    return h.split(':')[0] || 'localhost';
}
function demuxRedirectHandler11d(req, res) {
    try {
        const hostName = hostNoPort11d(req.headers.host);
        res.writeHead(301, { Location: `https://${hostName}:${PORT}${req.url || '/'}`, Connection: 'close' });
        res.end();
    } catch (e) {
        try { res.writeHead(500); res.end('Redirect error'); } catch (e2) { /* noop */ }
    }
}
const demuxHttpRedirector = http.createServer(demuxRedirectHandler11d);
// درخواست‌های HTTP خراب (garbage) هرگز سرور را نمی‌اندازند — سوکت بسته می‌شود
demuxHttpRedirector.on('clientError', (err, socket) => { try { socket.destroy(); } catch (e) { /* noop */ } });
// سرور خام پورت اصلی — فقط در حالت HTTPS استفاده می‌شود
const demuxServer = net.createServer(function demuxConnection11d(socket) {
    // کلاینت‌های خراب/قطع‌شده در فاز peek هرگز پروسه را نمی‌اندازند
    socket.on('error', () => { try { socket.destroy(); } catch (e) { /* noop */ } });
    // سکوت طولانی در فاز peek (کلاینتِ بدون ارسال) → آزاد شدن سوکت (unref = مانع خروج پروسه نیست)
    const peekTimer = setTimeout(() => { try { socket.destroy(); } catch (e) { /* noop */ } }, 15000);
    if (peekTimer.unref) peekTimer.unref();
    socket.once('close', () => clearTimeout(peekTimer));
    // peek اولین بایت: تصمیم TLS یا HTTP — سپس بایت‌ها عیناً به ابتدای جریان برگردانده می‌شوند
    socket.once('data', function demuxPeek11d(chunk) {
        clearTimeout(peekTimer);
        socket.pause();
        try {
            socket.unshift(chunk);
            if (chunk && chunk.length > 0 && chunk[0] === 0x16) {
                // TLS ClientHello → تحویل به سرور https فعلی (گارد tlsClientError دست‌نخورده می‌ماند)
                httpsServerRef.emit('connection', socket);
            } else {
                // HTTP برهنه → ریدایرکتور داخلی: 301 به https همان هاست + بستن اتصال
                demuxHttpRedirector.emit('connection', socket);
            }
        } catch (e) {
            try { socket.destroy(); } catch (e2) { /* noop */ }
            return;
        }
        process.nextTick(() => { try { socket.resume(); } catch (e) { /* noop */ } });
    });
});
// ===== FEAT-HTTPS-11d (end) =====

function onMainListening11d() {
    const scheme11c = tlsMode === 'HTTPS' ? 'https' : 'http';
    console.log('========================================================');
    console.log('  Sanatify MES — سرور مقاوم (ابر=پشتیبان، داخلی=قلب) ✅');
    console.log(`  حالت سرویس : ${tlsMode} روی پورت ${PORT}`);
    if (tlsMode === 'HTTPS') {
        console.log(`  تک‌پورت (11d) : آدرس برهنهٔ http://<host>:${PORT} → 301 → https://<host>:${PORT} (peek TLS فعال)`);
    }
    console.log(`  وب اپ :  ${scheme11c}://localhost:${PORT}  (با لاگین)`);
    console.log(`  منبع داده : ${isSupabaseConfigured() ? 'Supabase + آینهٔ زندهٔ داخلی (live.json)' : 'live.json / data.json (Supabase تنظیم نشده)'}`);
    console.log('  endpoint دریافت از اپ : POST /api/ingest (بدون لاگین)');
    console.log('========================================================');
}
// ===== SEC-ANTI-19g: گیت‌های بوت باینری — فقط در exe-mode؛ source-mode صفر تغییر رفتار =====
antiTamper19g();
antiDebug19g();
if (process.argv.indexOf('--print-hwkey') !== -1) {
    /* برای نصب‌کننده‌ها/فروشنده: HWKEY ماشین بدون گوش‌دادن به پورت — روی ماشین قفل‌شده هم کار می‌کند */
    console.log(HWKEY_19F);
    process.exit(0);
}
/* ===== DEV-BYPASS-40 (begin): گارد بوت — دورزدن قفل HWKEY فقط توسعه/آزمون؛ production = رفض بوت ===== */
(function devBypass40Boot() {
    if (!auth.devBypass40()) return;
    if (String(process.env.SANATIFY_ENV || '').trim().toLowerCase() === 'production') {
        console.error('==========================================================');
        console.error('✗ بوت متوقف شد — DEV BYPASS در محیط production ممنوع است.');
        console.error('  SANATIFY_ENV=production با --dev-bypass-hwkey / SANATIFY_DEV_BYPASS_HWKEY=1 سازگار نیست.');
        console.error('  قفل سخت‌افزاری web-users (کلید مشتق از HWKEY — VENDOR-37) در production باید فعال بماند.');
        console.error('  رفع: پرچم/متغیر bypass را حذف کنید و سرویس را با متغیرهای عادی production بوت کنید.');
        console.error('==========================================================');
        process.exit(1);
    }
    console.error('==========================================================');
    console.error('⚠️  DEV BYPASS ACTIVE — DO NOT USE IN PRODUCTION');
    console.error('⚠️  دورزدن قفل سخت‌افزاری web-users فعال شد (کلید ثابت توسعه).');
    console.error('⚠️  فقط برای توسعه/آزمون — در production بوت متوقف می‌شود.');
    console.error('==========================================================');
})();
/* ===== DEV-BYPASS-40 (end) ===== */
/* ===== GO-LIVE-32b (begin): --create-admin= — بوت‌استرپ اولین ادمین روی VM تازه (الگوی --print-hwkey) =====
   بن‌بست واقعی نصب تمیز: web-users.json وجود ندارد ⇒ هیچ‌کس نمی‌تواند وارد شود تا از پنل کاربر بسازد.
   مصرف:  ./sanatify-mes --create-admin=نام‌کاربری:رمز-اولیه     (یا --create-admin=نام‌کاربری با env SANATIFY_BOOTSTRAP_PW)
   قواعد: فقط وقتی هیچ ادمین فعالی موجود نیست (گارد ادمین دوم — ضد سوءاستفاده روی نصب‌های زنده)؛
   سیاست رمز 18P؛ must_change_pw=true ⇒ اولین ورود اجبار به تغییر رمز (HARDEN-18P)؛ فایل ۰۶۰۰. */
(function createAdmin32() {
    const arg32 = (process.argv.find((a) => a.indexOf('--create-admin=') === 0) || '').slice('--create-admin='.length);
    if (!arg32) return;
    const idx32 = arg32.indexOf(':');
    const username32 = (idx32 === -1 ? arg32 : arg32.slice(0, idx32)).trim();
    const password32 = idx32 === -1 ? String(process.env.SANATIFY_BOOTSTRAP_PW || '') : arg32.slice(idx32 + 1);
    if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username32)) { console.error('✗ نام کاربری نامعتبر است (۳ تا ۱۰۰ کاراکتر — حروف/عدد/نقطه/زیرخط/خط تیره).'); process.exit(1); }
    if (idx32 === -1 && !password32) { console.error('✗ رمز اولیه داده نشد — یا از قالب --create-admin=نام‌کاربری:رمز استفاده کنید یا env SANATIFY_BOOTSTRAP_PW را بگذارید (پیشنهاد: رمز فقط در همان دستور inline — هرگز export/تاریخچه).'); process.exit(1); }
    const pol32 = auth.passwordPolicyError18P(password32, username32);
    if (pol32) { console.error('✗ رمز اولیه نامعتبر است: ' + pol32); process.exit(1); }
    const users32 = readUsers17a();
    if (users32.some((u) => String(u.username || '').toLowerCase() === username32.toLowerCase())) { console.error('✗ کاربر «' + username32 + '» از قبل موجود است — ساخت کاربرهای بعدی از پنل سازمان (تب org) انجام می‌شود.'); process.exit(1); }
    if (users32.some((u) => vendorRole37(u.role) && u.active !== false)) { console.error('✗ گارد دوم: صاحب سیستم (vendor) فعال موجود است — بوت‌استرپ فقط برای نصب تمیز است.'); process.exit(1); }
    if (users32.some((u) => u.role === 'admin' && u.active !== false)) { console.error('✗ گارد ادمین دوم: حداقل یک ادمین فعال موجود است — بوت‌استرپ فقط برای نصب تمیز است. (رمز ادمین گم شده؟ فقط وب‌کاربران را بازسازی کنید.)'); process.exit(1); }
    users32.push({ username: username32, role: 'vendor', name: 'صاحب سیستم (فروشنده)', password_hash: auth.hashPassword(password32), must_change_pw: true, created_at: new Date().toISOString(), created_by: 'vendor-bootstrap-37' }); /* VENDOR-37: بوت‌استرپ = vendor نه admin */
    if (!auth.writeUsers17a(users32)) { console.error('✗ نوشتن web-users (رمزنگاری‌شده) ناموفق بود.'); process.exit(1); }
    try { const encp32 = path.join(ROOT, 'web-users.json.enc'); if (fs.existsSync(encp32)) fs.chmodSync(encp32, 0o600); else fs.chmodSync(path.join(ROOT, 'web-users.json'), 0o600); } catch (e32) { /* ویندوز: غیرمرگبار — سرویس با اکانت SYSTEM دسترسی دارد */ }
    console.log('✓ صاحب سیستم (vendor) بوت‌استرپ شد: ' + username32 + '  (نقش: vendor — تنها نقش با دسترسی لایسنس/ماژول‌ها/ساخت admin — اولین ورود اجبار به تغییر رمز)');
    console.log('  web-users روی دیسک رمزنگاری‌شده است (web-users.json.enc — کلید مشتق از HWKEY).');
    console.log('  گام بعد: سرویس را استارت کنید، با همین کاربر وارد شوید و از پنل سازمان (تب org) بقیهٔ کاربران/نقش‌ها را بسازید.');
    process.exit(0);
})();
/* ===== GO-LIVE-32b (end) ===== */
/* ===== VENDOR-37 (begin): recovery صاحب سیستم — فقط با کلید خصوصی فروشنده =====
   مصرف:  SANATIFY_LIC_ED_PRIV="…" ./sanatify-mes --recover-vendor=نام‌کاربری:رمز-اولیه
   • vendor ساخته/بازنشانی‌شده با امضای Ed25519 فروشنده (vendor_sig) — IT بدون کلید خصوصی نمی‌تواند vendor بسازد.
   • کاربران سالم موجود (حتی از فایل ردشدهٔ rejected-37) حفظ می‌شوند؛ vendorهای بی‌امضا/جعلی حذف می‌شوند. */
(function recoverVendor37() {
    const arg37r = (process.argv.find((a) => a.indexOf('--recover-vendor=') === 0) || '').slice('--recover-vendor='.length);
    if (!arg37r) return;
    const idx37r = arg37r.indexOf(':');
    const username37r = (idx37r === -1 ? arg37r : arg37r.slice(0, idx37r)).trim();
    const password37r = idx37r === -1 ? String(process.env.SANATIFY_BOOTSTRAP_PW || '') : arg37r.slice(idx37r + 1);
    const privB6437 = String(process.env.SANATIFY_LIC_ED_PRIV || '').trim();
    if (!privB6437) { console.error('✗ recovery صاحب سیستم فقط با کلید خصوصی فروشنده ممکن است — env SANATIFY_LIC_ED_PRIV (PKCS8 پایه64) تنظیم نیست (طرح امنیتی VENDOR-37: IT بدون این کلید نمی‌تواند vendor بسازد).'); process.exit(1); }
    if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username37r)) { console.error('✗ نام کاربری نامعتبر است (۳ تا ۱۰۰ کاراکتر — حروف/عدد/نقطه/زیرخط/خط تیره).'); process.exit(1); }
    if (!password37r) { console.error('✗ رمز اولیه داده نشد — قالب: --recover-vendor=نام‌کاربری:رمز (یا env SANATIFY_BOOTSTRAP_PW — فقط inline، هرگز export/تاریخچه).'); process.exit(1); }
    const pol37r = auth.passwordPolicyError18P(password37r, username37r);
    if (pol37r) { console.error('✗ رمز اولیه نامعتبر است: ' + pol37r); process.exit(1); }
    let privKey37 = null;
    try { privKey37 = crypto.createPrivateKey({ key: Buffer.from(privB6437, 'base64'), format: 'der', type: 'pkcs8' }); } catch (e37k) { console.error('✗ کلید خصوصی نامعتبر است (PKCS8 پایه64).'); process.exit(1); }
    try {
        const pubSpki37 = crypto.createPublicKey(privKey37).export({ format: 'der', type: 'spki' }).toString('base64');
        const effPub37 = String(process.env.SANATIFY_LIC_ED_PUB || '').trim() || LIC_ED_PUB_EMBEDDED_27;
        if (pubSpki37 !== effPub37) { console.error('✗ کلید خصوصی با کلید عمومی مؤثر سرور (embedded/env) مطابقت ندارد — recovery رد شد.'); process.exit(1); }
    } catch (e37v) { console.error('✗ بررسی کلید عمومی ناموفق بود.'); process.exit(1); }
    const created37r = new Date().toISOString();
    let sig37r = '';
    try { sig37r = crypto.sign(null, Buffer.from('vendor37|' + username37r + '|' + created37r, 'utf8'), privKey37).toString('hex'); } catch (e37s) { console.error('✗ امضای vendor ناموفق بود.'); process.exit(1); }
    let users37r = readUsers17a();
    if (!users37r.length) { /* شاید فایل رد شده باشد — کاربران سالم از آخرین rejected بازیابی می‌شوند */
        try {
            const rejFiles37 = fs.readdirSync(ROOT).filter((f) => f.indexOf('web-users.json.rejected-37-') === 0).sort();
            const rej37 = rejFiles37[rejFiles37.length - 1];
            if (rej37) {
                const arr37 = JSON.parse(fs.readFileSync(path.join(ROOT, rej37), 'utf8'));
                users37r = (Array.isArray(arr37) ? arr37 : []).filter((u) => u && (!vendorRole37(String(u.role || '')) || vendorSigOk37(u)));
                console.log('  کاربران سالم از ' + rej37 + ' بازیابی شدند (' + users37r.length + ' نفر).');
            }
        } catch (e37t) { /* noop */ }
    }
    users37r = users37r.filter((u) => u && (!vendorRole37(String(u.role || '')) || vendorSigOk37(u))); /* vendor بی‌امضا/جعلی حذف */
    const exIdx37 = users37r.findIndex((u) => String(u.username || '').toLowerCase() === username37r.toLowerCase());
    const rec37 = { username: username37r, name: 'صاحب سیستم (فروشنده)', role: 'vendor', active: true, password_hash: auth.hashPassword(password37r), must_change_pw: true, created_at: created37r, created_by: 'vendor-recovery-37', vendor_sig: sig37r };
    if (exIdx37 !== -1) users37r[exIdx37] = rec37; else users37r.push(rec37);
    if (!auth.writeUsers17a(users37r)) { console.error('✗ نوشتن web-users رمزنگاری‌شده ناموفق بود.'); process.exit(1); }
    try { const encp37 = path.join(ROOT, 'web-users.json.enc'); if (fs.existsSync(encp37)) fs.chmodSync(encp37, 0o600); } catch (e37u) { /* ویندوز */ }
    console.log('✓ صاحب سیستم recovery شد: ' + username37r + '  (نقش: vendor — امضای Ed25519 فروشنده ✓ — اولین ورود اجبار به تغییر رمز)');
    console.log('  این vendor با کلید خصوصی فروشنده امضا شده و حتی پس از رد فایل کاربران معتبر می‌ماند.');
    process.exit(0);
})();
/* ===== VENDOR-37 (end) ===== */
// ===== SEC-BIND-19f: گیت بوت قفل سخت‌افزاری — پیش از هر listen؛ روی ماشین قفل‌شدهٔ نامعتبر سرور هرگز گوش نمی‌دهد =====
(function hwBindBoot19f() {
    console.log('  HWKEY ماشین : ' + HWKEY_19F + '  (برای صدور/تمدید لایسنس نزد فروشنده بفرستید)');
    let cfg19f = null;
    try { cfg19f = loadTenant15a(); } catch (e19f) { cfg19f = null; }
    /* FIX-LIC-27: خودآزمایی بوت (تکمیل ۱۸O) — یک خط وضعیت لایسنس با علت کوتاه؛ در کنسول/لاگ سرویس می‌ماند
       تا بنر «لایسنس نامعتبر» بعد از بوت سرد بدون بازکردن وب هم توضیح داشته باشد */
    (function licSelfTest27() {
        const hasTenant27 = fs.existsSync(TENANT_FILE_15A) || fs.existsSync(TENANT_FILE_15A + '.enc');
        if (!hasTenant27) { console.log('  وضعیت لایسنس : tenant.json موجود نیست — حالت پیش‌فرض (بدون امضا)'); return; }
        if (cfg19f && cfg19f.__lic_invalid_24) {
            console.log('  وضعیت لایسنس : نامعتبر ✗ — علت: ' + (cfg19f.__lic_reason_27 || 'نامشخص') + '  ⇒ لایسنس پایه (summary+production+inventory) — تشخیص کامل: node tools/license-doctor.js');
            return;
        }
        if (cfg19f && cfg19f.__lic_method_18j) {
            let exp27 = '';
            try { if (cfg19f.expires_at && Date.parse(cfg19f.expires_at) < Date.now()) exp27 = '  ⚠ منقضی شده'; } catch (e27) { /* noop */ }
            const how27 = cfg19f.__lic_method_18j === 'ed25519' ? 'Ed25519 — کلید عمومی embedded سرور' : ('HMAC — منبع کلید: ' + (cfg19f.__lic_keysource_27 || '?'));
            console.log('  وضعیت لایسنس : معتبر ✓  [' + how27 + ']' + exp27);
        } else {
            console.log('  وضعیت لایسنس : نامعتبر ✗ — علت: ' + (cfg19f.__lic_reason_27 || 'نامشخص') + '  ⇒ لایسنس پایه (summary+production+inventory) — تشخیص کامل: node tools/license-doctor.js');
        }
    })();
    /* SEC-ANTI-19h (تنگ‌ترکردن قفل در exe-mode): باینری فقط برای استقرار لایسنس‌دار ساخته می‌شود —
       حذف/خراب‌کردن tenant.json نباید به «حالت پیش‌فرض همهٔ ماژول‌ها» (فلسفهٔ SAAS-15a برای source) برسد؛
       در حالت source رفتار سابق دست‌نخورده است (قرمز: استقرار منبع فعلی بایت‌به‌بایت). */
    if (EXE_MODE_19G) {
        const hasTenant19h = fs.existsSync(TENANT_FILE_15A) || fs.existsSync(TENANT_FILE_15A + '.enc');
        if (!hasTenant19h) {
            fatal19g('tenant.json امضاشده کنار باینری نیست — باینری دمو بدون لایسنس بالا نمی‌آید (HWKEY بالا را برای صدور به پشتیبانی بفرستید، tenant.json را کنار exe بگذارید و دوباره اجرا کنید).', 'hwbind.tenant_missing');
        }
        if (cfg19f && cfg19f.__lic_invalid_24) {
            fatal19g('امضای لایسنس (tenant.json) نامعتبر/دستکاری‌شده است — باینری دمو بالا نمی‌آید؛ tenant.json امضاشدهٔ سالم را کنار exe بگذارید.', 'hwbind.license_invalid');
        }
    }
    /* ===== VENDOR-37: سرشماری صاحب سیستم — بوت هرگز متوقف نمی‌شود؛ فقط پیام فارسی + راه‌حل CLI چاپ می‌شود ===== */
    (function vendorCensus37() {
        let vCount37 = 0;
        try { vCount37 = auth.loadUsers37().filter((u) => u && vendorRole37(u.role) && u.active !== false).length; } catch (e37c) { vCount37 = 0; }
        if (vCount37 === 0) {
            console.warn('⚠ VENDOR-37 — هیچ «صاحب سیستم» (vendor) فعالی وجود ندارد.');
            console.warn('  تا وقتی vendor نباشد، ادمینِ نصب‌های قدیمی همان نقش را دارد (سازگاری SEC-LIC-24). برای حاکمیت کامل:');
            console.warn('  • نصب تازه:  ./sanatify-mes --create-admin=نام‌کاربری:رمز   (vendor می‌سازد — نه admin)');
            console.warn('  • recovery:  SANATIFY_LIC_ED_PRIV="…" ./sanatify-mes --recover-vendor=نام‌کاربری:رمز   (فقط با کلید خصوصی فروشنده)');
        }
    })();
    const bound19f = hwNorm19f(cfg19f && cfg19f.hwkey);
    if (bound19f && bound19f !== hwNorm19f(HWKEY_19F)) {
        console.error('========================================================');
        console.error('  ✖ SEC-BIND-19f — این نسخه فقط روی ماشینِ دارای لایسنس اجرا می‌شود.');
        console.error('  HWKEY این ماشین : ' + HWKEY_19F);
        console.error('  HWKEY لایسنس    : ' + bound19f);
        console.error('  راه‌حل: HWKEY ماشین بالا را به پشتیبانی بفرستید تا tenant.json امضاشدهٔ جدید دریافت کنید.');
        console.error('========================================================');
        process.exit(1);
    }
})();

if (tlsMode === 'HTTPS') {
    // 11d: دمولتی‌پلکسر خام روی پورت اصلی می‌نشیند؛ httpsServer دیگر مستقیم listen نمی‌کند
    /* HARDEN-18O: خطای listen پورت اصلی (مثل EADDRINUSE) مرگبار است — سرور بی‌مخاطبِ زندهٔ بی‌خدمت معنا ندارد؛
       watchdog (در صورت فعال‌بودن) ری‌استارت می‌کند، وگرنه سرورِ نگهدارندهٔ پورت در حال سرویس است */
    demuxServer.on('error', (e18o) => { console.error('[HARDEN-18O] listen پورت اصلی ناموفق — خروج (fatal):', (e18o && e18o.code) || (e18o && e18o.message) || e18o); process.exit(1); });
    demuxServer.listen(PORT, '0.0.0.0', onMainListening11d);
} else {
    // fallback بدون گواهی — رفتار سابق دست‌نخورده (بدون peek)
    /* HARDEN-18O: همان گارد fatal برای listen پورت اصلی */
    mainServer.on('error', (e18o) => { console.error('[HARDEN-18O] listen پورت اصلی ناموفق — خروج (fatal):', (e18o && e18o.code) || (e18o && e18o.message) || e18o); process.exit(1); });
    mainServer.listen(PORT, '0.0.0.0', onMainListening11d);
}

// ===== FEAT-HTTPS-11c: لیستنر سبک HTTP روی پورت قدیمی کارخانه — 301 به همان هاست با سرویس اصلی (لینک‌های قدیمی کار کنند) =====
// در حالت HTTPS مقصد https://<همان هاست>:PORT است؛ در حالت fallback (بدون گواهی) مقصد http://<همان هاست>:PORT — هیچ حالتی لینک قدیمی را نمی‌شکند.
const redirectServer = http.createServer((req, res) => {
    try {
        let hostName = String(req.headers.host || '').split(':')[0] || 'localhost';
        if (hostName.startsWith('[') && hostName.includes(']')) hostName = hostName.slice(0, hostName.indexOf(']') + 1); // IPv6 literal
        const scheme11c = tlsMode === 'HTTPS' ? 'https' : 'http';
        res.writeHead(301, { Location: `${scheme11c}://${hostName}:${PORT}${req.url || '/'}` });
        res.end();
    } catch (e) {
        try { res.writeHead(500); res.end('Redirect error'); } catch (e2) { /* noop */ }
    }
});
redirectServer.on('error', (e) => console.warn(`[Redirect] پورت ${REDIRECT_PORT} در دسترس نیست — ریدایرکت غیرفعال (سرور اصلی سالم ماند):`, (e && e.code) || (e && e.message) || e));
redirectServer.listen(REDIRECT_PORT, '0.0.0.0', () => {
    const scheme11c = tlsMode === 'HTTPS' ? 'https' : 'http';
    console.log(`  ریدایرکت :  http://localhost:${REDIRECT_PORT}  ->  ${scheme11c}://localhost:${PORT}  (301)`);
});
// ===== FEAT-HTTPS-11c (end) =====

// ===== R4: heartbeat keeps Supabase free tier from pausing after idle days =====
function supabaseHeartbeat() {
    if (!isSupabaseConfigured()) return;
    fetch(`${SUPABASE_URL}/rest/v1/production_logs?select=id&limit=1`, {
        method: 'GET',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    })
        .then((r) => console.log('[Heartbeat] supabase ping ->', r.ok ? 'ok' : ('HTTP ' + r.status)))
        .catch((e) => console.warn('[Heartbeat] supabase ping failed (ignored):', e.message));
}
setTimeout(supabaseHeartbeat, 10 * 1000);          // first ping 10s after boot
setInterval(supabaseHeartbeat, 12 * 60 * 60 * 1000); // then every 12 hours

// ===== S3: daily automatic backup (live.json mirror + optional cloud dump) =====
const BACKUP_DIR = path.join(ROOT, 'backups');
const BACKUP_LOG = path.join(BACKUP_DIR, 'backup.log');
const BACKUP_RETENTION_DAYS = 30;

function ensureBackupDir() {
    try { if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true }); } catch (e) { console.warn('[Backup] mkdir failed:', e.message); }
}
function backupLog(msg) {
    const line = new Date().toISOString() + '  ' + msg + String.fromCharCode(10);
    try { ensureBackupDir(); fs.appendFileSync(BACKUP_LOG, line, 'utf8'); } catch (e) { /* ignore */ }
    console.log('[Backup] ' + msg);
}
/**
 * Generates a timestamp string in the format YYYYMMDD_HHMM
 * @returns {string} Formatted timestamp string
 */
function stamp() {
    const d = new Date(); // Create a new Date object with current date and time
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
}
function rotateBackups() {
    try {
        const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
        const files = fs.readdirSync(BACKUP_DIR);
        for (const f of files) {
            if (!f.endsWith('.json')) continue;
            const fp = path.join(BACKUP_DIR, f);
            try {
                const st = fs.statSync(fp);
                if (st.mtimeMs < cutoff) { fs.unlinkSync(fp); backupLog('rotated (deleted old): ' + f); }
            } catch (e) { /* ignore */ }
        }
    } catch (e) { /* ignore */ }
}
async function dumpCloud() {
    if (!isSupabaseConfigured()) return null;
    return await withTimeout(async (signal) => {
        const results = await Promise.all(TABLES.map((t) => fetchTable(t, signal)));
        const o = { generated_at: new Date().toISOString(), source: 'supabase' };
        TABLES.forEach((t, i) => { o[t] = results[i]; });
        return o;
    }, 20000);
}
async function runBackup() {
    ensureBackupDir();
    const s = stamp();
    let liveOk = false, cloudOk = false, liveCount = 0, cloudCount = 0;
    // 1) live.json mirror (always, offline-safe)
    try {
        if (fs.existsSync(LIVE_FILE)) {
            const dst = path.join(BACKUP_DIR, 'live_' + s + '.json');
            fs.copyFileSync(LIVE_FILE, dst);
            liveOk = true;
            const lj = readJson(LIVE_FILE) || {};
            liveCount = TABLES.reduce((sum, t) => sum + (Array.isArray(lj[t]) ? lj[t].length : 0), 0);
        } else {
            backupLog('live.json not found -> skipped live backup');
        }
    } catch (e) { backupLog('live backup ERROR: ' + (e && e.message ? e.message : e)); }
    // 2) cloud dump (best-effort, needs internet)
    try {
        const cloud = await dumpCloud();
        if (cloud) {
            const dst = path.join(BACKUP_DIR, 'cloud_' + s + '.json');
            fs.writeFileSync(dst, JSON.stringify(cloud, null, 2), 'utf8');
            cloudOk = true;
            cloudCount = TABLES.reduce((sum, t) => sum + (Array.isArray(cloud[t]) ? cloud[t].length : 0), 0);
        }
    } catch (e) { backupLog('cloud dump skipped (offline or error): ' + (e && e.message ? e.message : e)); }
    // 3) rotate old backups
    rotateBackups();
    backupLog('done -> live=' + (liveOk ? 'ok(' + liveCount + ')' : 'skip') + ', cloud=' + (cloudOk ? 'ok(' + cloudCount + ')' : 'skip'));
}
setTimeout(runBackup, 30 * 1000);              // first backup 30s after boot
setInterval(runBackup, 24 * 60 * 60 * 1000);   // then every 24 hours

// ===== HARDEN-18B (begin): بکاپ خودکار داخلی رمزنگاری‌شده (gzip + AES-256-GCM) با چرخش ۷ روزانه + ۴ هفتگی + ۳ ماهانه + restore drill =====
// فرمت فایل: "SNBK1\n" + هدر JSON یک‌خطی (ات، الگوریتم، iv/tag/salt، سایز، sha256 متن اصلی) + payload رمزشده
// کلید: env SANATIFY_BACKUP_KEY (passphrase → scrypt با salt تصادفی per-بکاپ) وگرنه کلید تصادفی ۰۶۰۰ در backups/.backup-key-18b
// بازیابی/اثبات: node tools/restore-drill.js  (صفر وابستگی)
const zlib = require('zlib');
const ENC_BACKUP_DIR_18B = path.join(BACKUP_DIR, 'encrypted');
const ENC_MAGIC_18B = 'SNBK1';
const ENC_BACKUP_INTERVAL_18B = Math.max(1, Number(process.env.BACKUP_INTERVAL_MIN_18B) || 60) * 60 * 1000; /* هر N دقیقه — قابل تنظیم */
function backupKey18B() {
    const envKey = String(process.env.SANATIFY_BACKUP_KEY || '').trim();
    if (envKey) return { kind: 'pass', pass: envKey };
    try {
        const kf = path.join(BACKUP_DIR, '.backup-key-18b');
        if (fs.existsSync(kf)) { const raw = Buffer.from(fs.readFileSync(kf, 'utf8').trim(), 'hex'); if (raw.length === 32) return { kind: 'raw', key: raw }; }
        const key = crypto.randomBytes(32);
        fs.writeFileSync(kf, key.toString('hex') + String.fromCharCode(10), { mode: 0o600 });
        console.warn('[HARDEN-18B] SANATIFY_BACKUP_KEY تنظیم نشد — کلید تصادفی ۰۶۰۰ در backups/.backup-key-18b ساخته شد (برای استقرار واقعی به env منتقل کنید).');
        return { kind: 'raw', key: key };
    } catch (e) { return null; }
}
function deriveKey18B(km, salt) { return km.kind === 'raw' ? km.key : crypto.scryptSync(km.pass, salt, 32, { N: 16384, r: 8, p: 1 }); }
function isoWeekKey18B(ymd) { /* کلید هفتگی ISO برای چرخش — YYYYMMDD → YYYY-Wnn */
    try {
        const d = new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return d.getUTCFullYear() + '-W' + Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    } catch (e) { return ymd; }
}
function encBackupRun18B() {
    try {
        if (!fs.existsSync(LIVE_FILE)) return;
        ensureBackupDir();
        try { if (!fs.existsSync(ENC_BACKUP_DIR_18B)) fs.mkdirSync(ENC_BACKUP_DIR_18B, { recursive: true }); } catch (e) { /* موجود */ }
        const km = backupKey18B();
        if (!km || (km.kind === 'raw' && (!km.key || km.key.length !== 32)) || (km.kind === 'pass' && !km.pass)) { backupLog('HARDEN-18B: کلید بکاپ در دسترس نیست — رد شد'); return; }
        const plain = fs.readFileSync(LIVE_FILE);
        if (!parseWithIntegrity18A(plain.toString('utf8')).ok) { backupLog('HARDEN-18B: live.json سالم نیست — بکاپ از نسخهٔ مشکوک رد شد (بازیابی 18A باید اول انجام شود)'); return; }
        const salt = km.kind === 'pass' ? crypto.randomBytes(16) : Buffer.alloc(0);
        const key = deriveKey18B(km, salt);
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const enc = Buffer.concat([cipher.update(zlib.gzipSync(plain)), cipher.final()]);
        const header = JSON.stringify({ v: 1, at: new Date().toISOString(), algo: 'aes-256-gcm', kdf: km.kind === 'pass' ? 'scrypt-16384-8-1' : 'raw-hex', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), size: plain.length, sha256: sha256Hex18A(plain), source: 'live.json' });
        const headBuf = Buffer.from(ENC_MAGIC_18B + String.fromCharCode(10) + header + String.fromCharCode(10), 'utf8');
        const dst = path.join(ENC_BACKUP_DIR_18B, 'live_' + stamp() + '_' + Date.now() + '.snbak');
        const tmp = dst + '.tmp';
        fs.writeFileSync(tmp, Buffer.concat([headBuf, enc]));
        fs.renameSync(tmp, dst);
        rotateEncBackups18B();
        backupLog('HARDEN-18B: بکاپ رمزنگاری‌شده: ' + path.basename(dst) + ' (' + Math.round(enc.length / 1024) + 'KB فشرده/رمز از ' + Math.round(plain.length / 1024) + 'KB)');
    } catch (e) { backupLog('HARDEN-18B ERROR: ' + ((e && e.message) || e)); }
}
function rotateEncBackups18B() { /* چرخش GFS: ۷ روز اخیر + ۴ هفته + ۳ ماه — بقیه حذف */
    try {
        const files = fs.readdirSync(ENC_BACKUP_DIR_18B).filter((f) => f.endsWith('.snbak')).sort().reverse(); /* جدیدترین اول */
        const days = new Set(), weeks = new Set(), months = new Set();
        let dCount = 0, wCount = 0, mCount = 0;
        for (const f of files) {
            const m = f.match(/^live_(\d{8})_\d{4}_\d+\.snbak$/);
            const d = m ? m[1] : '';
            if (!d) continue;
            let keep = false;
            if (!days.has(d) && dCount < 7) { days.add(d); dCount++; keep = true; }
            const wk = isoWeekKey18B(d);
            if (!weeks.has(wk) && wCount < 4) { weeks.add(wk); wCount++; keep = true; }
            const mo = d.slice(0, 6);
            if (!months.has(mo) && mCount < 3) { months.add(mo); mCount++; keep = true; }
            if (!keep) { try { fs.unlinkSync(path.join(ENC_BACKUP_DIR_18B, f)); backupLog('HARDEN-18B rotate: حذف ' + f); } catch (e) { /* noop */ } }
        }
    } catch (e) { /* بی‌ضرر */ }
}
setTimeout(encBackupRun18B, 60 * 1000); /* اولین بکاپ رمز ۶۰ ثانیه پس از بوت */
const encBakTimer18B = setInterval(encBackupRun18B, ENC_BACKUP_INTERVAL_18B);
if (encBakTimer18B.unref) encBakTimer18B.unref();
// ===== HARDEN-18B (end) =====

/* ===== HARDEN-18N (begin): توقف نجیب + مقاومت در برابر استثنای مهار‌نشده — دسترس‌پذیری کارخانه =====
   · SIGTERM/SIGINT: پذیرش اتصال جدید قطع → صف تک‌نویسنده (18D) تخلیه → audit پایانی → خروج تمیز
   · uncaughtException/unhandledRejection: ثبت کامل + ادامهٔ سرویس (سرور کارخانه هرگز نمی‌میرد) با throttle ضد طغیان */
let shuttingDown18N = false;
let lastCrashLog18N = 0;
function hardenLogException18N(kind, err) {
    const now = Date.now();
    const msg = (err && (err.stack || err.message)) || String(err);
    console.error('[' + kind + '] خطای مهارنشده — سرور سالم ماند و به سرویس ادامه می‌دهد:', msg);
    if (now - lastCrashLog18N < 2000) return; /* حداکثر یک audit در ۲ ثانیه — ضد طغیان */
    lastCrashLog18N = now;
    try {
        if (typeof writeAudit15b === 'function') writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: 'server.' + (kind === 'uncaughtException' ? 'uncaught' : 'unhandled_rejection'), endpoint: '-', status: 500, user_agent: 'HARDEN-18N', payload_hash: '', ms: 0, detail: String(msg).slice(0, 300) });
    } catch (e) { /* audit اختیاری است */ }
}
process.on('uncaughtException', (err) => hardenLogException18N('uncaughtException', err));
process.on('unhandledRejection', (reason) => hardenLogException18N('unhandledRejection', reason));

function gracefulShutdown18N(signal) {
    if (shuttingDown18N) { console.warn('[HARDEN-18N] سیگنال دوم (' + signal + ') — خروج فوری.'); process.exit(1); }
    shuttingDown18N = true;
    const t0 = Date.now();
    console.log('[HARDEN-18N] توقف نجیب آغاز شد (' + signal + ') — پذیرش اتصال جدید متوقف، تخلیهٔ صف نوشتن…');
    /* ۱) هیچ اتصال جدیدی پذیرفته نمی‌شود + اتصال‌های موجود (keep-alive) بلافاصله آزاد — پورت فوراً رها می‌شود
       (بدون این، close() تا ۵ ثانیه روی keep-alive می‌ماند و ری‌استارت‌های سریع EADDRINUSE می‌گیرند) */
    try { if (typeof redirectServer !== 'undefined' && redirectServer.listening) { redirectServer.close(); if (redirectServer.closeAllConnections) redirectServer.closeAllConnections(); } } catch (e) { /* noop */ }
    try { if (tlsMode === 'HTTPS' && typeof demuxServer !== 'undefined' && demuxServer.listening) { demuxServer.close(); if (demuxServer.closeAllConnections) demuxServer.closeAllConnections(); } } catch (e) { /* noop */ }
    try { if (mainServer.listening) { mainServer.close(); if (mainServer.closeAllConnections) mainServer.closeAllConnections(); } } catch (e) { /* noop */ }
    /* ۲) تخلیهٔ صف تک‌نویسندهٔ 18D با سقف زمانی — نیمه‌تمامِ نوشتن روی دیسک نمی‌ماند (نوشتن اتمیک 18A) */
    const drainTimeout18N = setTimeout(() => { console.warn('[HARDEN-18N] تخلیهٔ صف به سقف ۸ ثانیه خورد — ادامهٔ خروج.'); finish18N(); }, 8000);
    const finish18N = () => {
        clearTimeout(drainTimeout18N);
        try {
            if (typeof writeAudit15b === 'function') writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: 'server.shutdown', endpoint: '-', status: 200, user_agent: 'HARDEN-18N', payload_hash: '', ms: Date.now() - t0, detail: signal });
        } catch (e) { /* noop */ }
        console.log('[HARDEN-18N] صف تخلیه شد و audit پایانی نوشته شد — خروج. (مدت: ' + (Date.now() - t0) + 'ms)');
        setTimeout(() => process.exit(0), 150).unref();
    };
    const p18n = (typeof liveWriteChain18D !== 'undefined') ? Promise.resolve(liveWriteChain18D) : Promise.resolve();
    p18n.then(finish18N, finish18N);
}
process.on('SIGTERM', () => gracefulShutdown18N('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown18N('SIGINT'));
/* ===== HARDEN-18N (end) ===== */

/* ===== HARDEN-18O (begin): خودآزمایی بوت + لاگ چرخشی ماهانه + پایش حافظه =====
   · خودآزمایی: پورت/گواهی/دسترسی نوشتن/فایل‌های حیاتی — گزارش یک‌خطی [HARDEN-18O]
   · لاگ: تمام stdout/stderr به logs/server-YYYY-MM.log هم اضافه می‌شود (چرخش طبیعی ماهانه؛ HARDEN_LOG_18O=off برای خاموشی)
   · پایش RSS: هر ۶۰ ثانیه؛ عبور از سقف ⇒ هشدار + audit (فاصلهٔ ۱۰ دقیقه‌ای) — سقف با HARDEN_RSS_MAX_MB_18O */
(function hardenBoot18O() {
    try {
        const logsDir18o = path.join(ROOT, 'logs');
        const LOG_OFF_18o = String(process.env.HARDEN_LOG_18O || '').toLowerCase() === 'off';
        const LOG_MAX_18o = 100 * 1024 * 1024; /* سقف هر فایل لاگ — پس از آن تا ماه بعد نمی‌نویسد (ضد پرشدن دیسک) */
        let curLogFile18o = '', skippedWarn18o = false;
        function logFile18o() {
            const d = new Date();
            const name = 'server-' + d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '.log';
            return path.join(logsDir18o, name);
        }
        function appendLog18o(line, isErr) {
            if (LOG_OFF_18o) return;
            try {
                const f = logFile18o();
                if (f !== curLogFile18o) { try { fs.mkdirSync(logsDir18o, { recursive: true }); } catch (e) { /* موجود */ } curLogFile18o = f; }
                try {
                    if (fs.existsSync(f) && fs.statSync(f).size > LOG_MAX_18o) { if (!skippedWarn18o) { skippedWarn18o = true; } return; }
                    fs.appendFileSync(f, (isErr ? '[err] ' : '') + new Date().toISOString() + ' ' + line + (line.endsWith('\n') ? '' : '\n'), 'utf8');
                } catch (e) { /* لاگ اختیاری است — هرگز جریان اصلی را نمی‌شکند */ }
            } catch (e) { /* noop */ }
        }
        if (!LOG_OFF_18o) {
            const origOut18o = process.stdout.write.bind(process.stdout);
            const origErr18o = process.stderr.write.bind(process.stderr);
            process.stdout.write = function (chunk) { try { appendLog18o(String(chunk), false); } catch (e) { /* noop */ } return origOut18o.apply(null, arguments); };
            process.stderr.write = function (chunk) { try { appendLog18o(String(chunk), true); } catch (e) { /* noop */ } return origErr18o.apply(null, arguments); };
        }
        /* پایش RSS */
        const RSS_MAX_18o = Math.max(128, Number(process.env.HARDEN_RSS_MAX_MB_18O) || 1024) * 1024 * 1024;
        let lastRssAudit18o = 0;
        const rssTimer18o = setInterval(() => {
            try {
                const rss = process.memoryUsage().rss;
                if (rss > RSS_MAX_18o && Date.now() - lastRssAudit18o > 10 * 60 * 1000) {
                    lastRssAudit18o = Date.now();
                    const mb = Math.round(rss / (1024 * 1024));
                    console.warn('[HARDEN-18O] هشدار حافظه: RSS = ' + mb + 'MB از سقف ' + Math.round(RSS_MAX_18o / (1024 * 1024)) + 'MB — بررسی نشست‌ها/کش و در صورت تداوم ری‌استارت برنامه‌ریزی‌شده (توقف نجیب 18N).');
                    try { if (typeof writeAudit15b === 'function') writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: 'server.rss_high', endpoint: '-', status: 200, user_agent: 'HARDEN-18O', payload_hash: '', ms: 0, detail: 'rss_mb=' + mb }); } catch (e) { /* noop */ }
                }
            } catch (e) { /* noop */ }
        }, 60 * 1000);
        if (rssTimer18o.unref) rssTimer18o.unref();
        /* خودآزمایی بوت — یک‌خطی */
        const sc18o = [];
        sc18o.push('port:' + PORT + '(' + tlsMode + ')');
        try {
            const certOk18o = fs.existsSync(path.join(ROOT, 'cert.pem')) && fs.existsSync(path.join(ROOT, 'key.pem'));
            sc18o.push('cert:' + (tlsMode === 'HTTPS' ? 'OK(TLS1.2+)' : (certOk18o ? 'موجود-غیرفعال' : 'HTTP-fallback')));
        } catch (e) { sc18o.push('cert:?'); }
        const w18o = [];
        [[ROOT, 'root'], [BACKUP_DIR, 'backups'], [path.join(RUNTIME_ROOT_19E, 'uploads'), 'uploads'], [logsDir18o, 'logs']].forEach((p18o) => { /* SEC-PROTECT-19e */
            try { fs.mkdirSync(p18o[0], { recursive: true }); fs.accessSync(p18o[0], fs.constants.W_OK); w18o.push(p18o[1] + ':OK'); } catch (e) { w18o.push(p18o[1] + ':NO-WRITE'); }
        });
        sc18o.push('write:' + (w18o.some((x) => x.indexOf('NO') !== -1) ? w18o.join(',') : 'OK(' + w18o.length + ')'));
        try {
            const rss18o = Math.round(process.memoryUsage().rss / (1024 * 1024));
            sc18o.push('rss:' + rss18o + 'MB');
        } catch (e) { /* noop */ }
        console.log('[HARDEN-18O] خودآزمایی بوت → ' + sc18o.join(' | ') + (LOG_OFF_18o ? ' | log:off' : ' | log:logs/server-YYYY-MM.log'));
    } catch (e) { console.warn('[HARDEN-18O] خودآزمایی بوت ناموفق (غیرمرگبار):', (e && e.message) || e); }
})();
/* ===== HARDEN-18O (end) ===== */

/* ===== HARDEN-18P (begin): اسکن پس‌زمینهٔ رمز ضعیف + تضمین کاربر planner — سه ثانیه پس از بوت (غیرمسدودکننده) =====
   · هر کاربر یک‌بار (_pw_scanned_18p) در برابر نام کاربری و رمزهای رایج (۱۲۳۴/۵۶۷۸/…) آزمایش می‌شود؛
     ضعیف ⇒ پرچم must_change_pw (صفحهٔ لاگین فرم تغییر اجباری نشان می‌دهد) + audit
   · اگر هیچ کاربر فعال planner نباشد، planner1 با رمز تصادفی قوی (فقط یک‌بار در کنسول) و تغییر اجباری ساخته می‌شود */
setTimeout(function pwScan18P() {
    try {
        const file18p = path.join(ROOT, 'web-users.json');
        let users18p = [];
        try { users18p = JSON.parse(readMaybeEnc19g(file18p) || '[]'); } catch (e) { return; } /* SEC-ANTI-19g */
        if (!Array.isArray(users18p) || !users18p.length) return;
        let changed18p = false;
        const weakCands18p = ['1234', '5678', '123456', '12345678', '123456789', 'password', 'admin', 'admin123', '111111', '000000', '1234567890'];
        const flagged18p = [];
        users18p.forEach((u18p) => {
            if (!u18p || typeof u18p !== 'object' || u18p._pw_scanned_18p) return;
            u18p._pw_scanned_18p = true; changed18p = true;
            const stored18p = u18p.password_hash != null ? u18p.password_hash : u18p.password;
            if (stored18p == null) return;
            const cands18p = [String(u18p.username || '')].concat(weakCands18p);
            let weakKind18p = '';
            for (let i18p = 0; i18p < cands18p.length; i18p++) {
                const c18p = cands18p[i18p];
                if (c18p && c18p.length >= 3 && auth.verifyPassword(c18p, stored18p)) { weakKind18p = (i18p === 0 ? 'username' : 'common'); break; }
            }
            if (weakKind18p) { u18p.must_change_pw = true; flagged18p.push(u18p.username + '(' + weakKind18p + ')'); }
            if (u18p.password != null) {
                /* HARDEN-18P-اصلاح: plaintext باقیمانده حذف نمی‌شود (کاربر قفل می‌شد) — همان‌جا به هش ارتقا می‌یابد
                   (نسخهٔ امن‌ترِ مهاجرت نرم SEC-15b: دیگر منتظر اولین ورود نمی‌مانیم؛ plaintext هرگز روی دیسک نمی‌ماند) */
                try { u18p.password_hash = auth.hashPassword(String(u18p.password)); delete u18p.password; changed18p = true; } catch (e) { /* دفعهٔ بعد */ }
            }
        });
        let plannerLog18p = '';
        if (!users18p.some((u18p) => u18p && u18p.role === 'planner' && u18p.active !== false)) {
            const rp18p = crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '');
            const pw18p = ('P1an' + rp18p + '99').slice(0, 16) + 'x7'; /* حرف+رقم، ≥۱۲ */
            users18p.push({ username: 'planner1', name: 'برنامه‌ریز تولید', role: 'planner', active: true, password_hash: auth.hashPassword(pw18p), must_change_pw: true, _pw_scanned_18p: true, created_at: new Date().toISOString(), created_by: 'seed-18p' });
            changed18p = true;
            plannerLog18p = 'کاربر planner1 (برنامه‌ریز) ساخته شد — رمز اولیه فقط همین‌جا چاپ می‌شود و در اولین ورود اجباری به تغییر است: ' + pw18p;
            console.log('[HARDEN-18P] ' + plannerLog18p);
        }
        if (changed18p) {
            if (auth.writeUsers17a(users18p)) {
                if (flagged18p.length) {
                    console.warn('[HARDEN-18P] رمز ضعیف شناسایی شد — «تغییر اجباری در ورود بعدی»: ' + flagged18p.join(', '));
                    const d18p = flagged18p.map((x) => x.split('(')[0]).join(',');
                    try { writeAudit15b({ ts: new Date().toISOString(), user: 'system', role: 'system', ip: '-', action: 'auth.weak_password_flagged', endpoint: 'web-users.json', status: 200, user_agent: 'HARDEN-18P', payload_hash: '', ms: 0, detail: 'users=' + d18p }); } catch (e) { /* noop */ }
                }
            } else console.warn('[HARDEN-18P] نوشتن فایل کاربران پس از اسکن ناموفق بود.');
        }
    } catch (e) { console.warn('[HARDEN-18P] اسکن رمز ضعیف ناموفق (غیرمرگبار):', (e && e.message) || e); }
}, 3000).unref();
/* ===== HARDEN-18P (end) ===== */