// =====================================================================
//  Sanatify MES — سرور یکپارچهٔ مقاوم (ابر = پشتیبان، داخلی = قلب)
//  صفر وابستگی خارجی. ترتیب خواندن: Supabase -> live.json -> data.json
//  endpoint /api/ingest : دادهٔ sync‌شده از اپ را در live.json نگه می‌دارد
//  S1: احراز هویت وب (login + session) — /api/ingest و /api/health باز می‌مانند
// =====================================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const auth = require('./auth');

const PORT = process.env.PORT || 3001;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_FILE = path.join(ROOT, 'data.json');  // نمونهٔ اولیه (fallback نهایی)
const LIVE_FILE = path.join(ROOT, 'live.json');  // آینهٔ زنده دادهٔ واقعی

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://djtrqqknanzrojrcgsca.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqdHJxcWtuYW56cm9qcmNnc2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NDM4ODcsImV4cCI6MjA4MjIxOTg4N30.-7O1_wGrD5JQqn2IRv2bFV9gb1PG_ot3Lk0FyxNJuDI';

const CACHE_TTL_MS = 4000;
const FETCH_TIMEOUT_MS = 6000;
const TABLES = ['production_logs', 'waste_logs', 'downtime_logs', 'quality_inspections', 'billets', 'furnace_logs', 'rebar_bundles'];

// ---------- ابزارهای فایل ----------
function emptyDataset() {
    return { generated_at: null, production_logs: [], waste_logs: [], downtime_logs: [], quality_inspections: [], billets: [], furnace_logs: [], rebar_bundles: [] };
}
function isSupabaseConfigured() {
    return !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
        !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
        !SUPABASE_ANON_KEY.includes('YOUR-ANON-PUBLIC-KEY') &&
        !SUPABASE_ANON_KEY.includes('PASTE_YOUR_ANON_KEY');
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } }
function writeJson(file, obj) { try { fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8'); return true; } catch (e) { console.warn('[Server] writeJson failed:', e.message); return false; } }
function readLive() { return readJson(LIVE_FILE) || emptyDataset(); }
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
let cache = { data: null, at: 0, source: 'none' };
// ---------- خواندن داده با ترتیبِ مقاوم (داخلی = قلب، ابر = پشتیبان) ----------
async function loadData() {
    const now = Date.now();
    if (cache.data && (now - cache.at) < CACHE_TTL_MS) return cache.data;
    // ۱) داخلی اول: آینهٔ زنده کارخانه (آفلاین-اول، بدون معطلی)
    const live = readLive();
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
    res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-store',
    });
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
function readBody(req) {
    return new Promise((resolve, reject) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => resolve(d)); req.on('error', reject); });
}

// ---------- محاسبات ----------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (p, t) => (t > 0 ? round2((p / t) * 100) : 0);
function buildSummary(d) {
    const prodQty = (d.production_logs || []).reduce((s, r) => s + (Number(r.good_quantity) || 0), 0);
    const wasteQty = (d.waste_logs || []).reduce((s, r) => s + (Number(r.quantity) || 0), 0);
    const downMin = (d.downtime_logs || []).reduce((s, r) => s + (Number(r.duration_minutes) || 0), 0);
    const bundleWeight = (d.rebar_bundles || []).reduce((s, r) => s + (Number(r.net_weight_kg) || 0), 0);
    const billetWeight = (d.billets || []).reduce((s, r) => s + (Number(r.initial_weight_kg) || 0), 0);
    return {
        generated_at: d.generated_at || null, production_good_quantity: prodQty, production_log_count: (d.production_logs || []).length,
        waste_quantity: wasteQty, waste_log_count: (d.waste_logs || []).length, downtime_minutes: downMin, downtime_count: (d.downtime_logs || []).length,
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
        pid: process.pid,
        uptime_sec: Math.round(process.uptime()),
    });
}

// ---------- سرور ----------
const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end(); return;
    }
    let parsed;
    try { parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch (e) { res.writeHead(400); res.end('Bad Request'); return; }
    const pathname = decodeURIComponent(parsed.pathname);

    // ===== S1 AUTH: public auth routes (login page + /api/auth/*) =====
    if (auth.handlePublic(req, res, pathname)) return;
    // ===== S1 AUTH: guard — block unauthenticated access to /api/* and pages =====
    // (NOTE: /api/ingest and /api/health are whitelisted INSIDE auth.enforce, so the
    //  mobile app sync and monitoring keep working without a web session.)
    if (auth.enforce(req, res, pathname)) return;

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

    // ===== POST /api/ingest : دریافت داده از اپ (بدون نیاز به ابر) =====
    if (req.method === 'POST' && pathname === '/api/ingest') {
        readBody(req).then((body) => {
            let payload; try { payload = JSON.parse(body || '{}'); } catch (e) { return sendJson(res, { error: 'invalid json' }, 400); }
            const counts = mergeIntoLive(payload);
            const total = Object.values(counts).reduce((s, n) => s + (n || 0), 0);
            return sendJson(res, { ok: true, total, counts, source: 'live' });
        }).catch((e) => sendJson(res, { error: String(e && e.message ? e.message : e) }, 500));
        return;
    }


    // ===== ✅ ADDITIVE — ممیزی: ثبت رویدادهای ورودی وب =====
    const AUDIT_FILE = path.join(__dirname, 'audit.json');
    function auditLog(req, action, payload) {
        try {
            const arr = readJson(AUDIT_FILE) || [];
            arr.push({ ts: new Date().toISOString(), user: req.user ? req.user.username : '?', role: req.user ? req.user.role : '?', action: action, payload: payload });
            writeJson(AUDIT_FILE, arr.slice(-2000));
        } catch (e) { /* بی‌ضرر */ }
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
                const b = JSON.parse(raw || '{}');
                const rec = {
                    id: 'web-q-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    heat_number: String(b.heat_number || '').trim(),
                    rebar_size: Number(b.rebar_size) || 0,
                    yield_strength: Number(b.yield_strength) || 0,
                    tensile_strength: Number(b.tensile_strength) || 0,
                    elongation_percent: Number(b.elongation_percent) || 0,
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

        if (!auth.requireRole(req, ['engineering', 'supervisor'])) {
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

                const b = JSON.parse(raw || '{}');

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

        if (!auth.requireRole(req, ['engineering', 'supervisor'])) {
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

                const b = JSON.parse(raw || '{}');

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
                const b = JSON.parse(raw || '{}');
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
                const b = JSON.parse(raw || '{}');
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
                if (!rec.reason_id || !rec.shift_id || !rec.machine_id || !Number.isFinite(qty) || qty <= 0) {
                    return sendJson(res, { error: 'ایستگاه کشف، علت، شیفت و «تعداد» الزامی است.' }, 400);
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
                const b = JSON.parse(raw || '{}');
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
                const b = JSON.parse(raw || '{}');
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
    sendFile(res, safePath);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('========================================================');
    console.log('  Sanatify MES — سرور مقاوم (ابر=پشتیبان، داخلی=قلب) ✅');
    console.log(`  وب اپ :  http://localhost:${PORT}  (با لاگین)`);
    console.log(`  منبع داده : ${isSupabaseConfigured() ? 'Supabase + آینهٔ زنده داخلی (live.json)' : 'live.json / data.json (Supabase تنظیم نشده)'}`);
    console.log('  endpoint دریافت از اپ : POST /api/ingest (بدون لاگین)');
    console.log('========================================================');
});

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