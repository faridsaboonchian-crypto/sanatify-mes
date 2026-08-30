// =====================================================================
//  supabaseClient — ارتباط با ابر + سرور داخلی (fetch خالص، بدون کتابخانه)
//  INTERNAL_SERVER_URL : آدرس سرور node داخلی کارخانه (برای sync بدون اینترنت)
// =====================================================================

export const SUPABASE_URL = 'https://djtrqqknanzrojrcgsca.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqdHJxcWtuYW56cm9qcmNnc2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY2NDM4ODcsImV4cCI6MjA4MjIxOTg4N30.-7O1_wGrD5JQqn2IRv2bFV9gb1PG_ot3Lk0FyxNJuDI'; // ️ از فایل فعلی/Supabase کپی کن

// ⚠️ IP سرور داخلی کارخانه (همان لپ‌تاپ/سروری که node روی آن روشن است)
export const INTERNAL_SERVER_URL = 'http://10.194.147.34:3000';

const TIMEOUT_MS = 7000;

export function isSupabaseConfigured(): boolean {
    return !!SUPABASE_URL && !!SUPABASE_ANON_KEY &&
        !SUPABASE_URL.includes('YOUR-PROJECT-REF') &&
        !SUPABASE_ANON_KEY.includes('YOUR-ANON-PUBLIC-KEY') &&
        !SUPABASE_ANON_KEY.includes('PASTE_YOUR_ANON_KEY');
}

export function isInternalConfigured(): boolean {
    return !!INTERNAL_SERVER_URL && !INTERNAL_SERVER_URL.includes('YOUR-INTERNAL-IP');
}

function authHeaders(): Record<string, string> {
    return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`[timeout] ${label}`)), ms);
        promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
}

// ---------- ابر ----------
export async function isSupabaseReachable(): Promise<boolean> {
    if (!isSupabaseConfigured()) return false;
    try {
        const res = await withTimeout(fetch(`${SUPABASE_URL}/rest/v1/production_logs?select=id&limit=1`, { method: 'GET', headers: authHeaders() }), TIMEOUT_MS, 'supabase-reach');
        return res.ok;
    } catch (e) { return false; }
}

export async function fetchAll(table: string): Promise<any[]> {
    if (!isSupabaseConfigured()) throw new Error('Supabase تنظیم نشده است.');
    const res = await withTimeout(fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*`, { method: 'GET', headers: authHeaders() }), TIMEOUT_MS, `read ${table}`);
    if (!res.ok) throw new Error(`[Supabase] read ${table} -> HTTP ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
}

export async function upsertBatch(table: string, rows: any[]): Promise<void> {
    if (!isSupabaseConfigured()) throw new Error('Supabase تنظیم نشده است.');
    if (!rows || rows.length === 0) return;
    const res = await withTimeout(fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
        method: 'POST', headers: { ...authHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows),
    }), TIMEOUT_MS * 2, `upsert ${table}`);
    if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`[Supabase] upsert ${table} -> HTTP ${res.status} ${txt}`); }
}

// ---------- سرور داخلی (LAN، بدون اینترنت) ----------
export async function isInternalReachable(): Promise<boolean> {
    if (!isInternalConfigured()) return false;
    try {
        const res = await withTimeout(fetch(`${INTERNAL_SERVER_URL}/api/health`, { method: 'GET' }), TIMEOUT_MS, 'internal-reach');
        return res.ok;
    } catch (e) { return false; }
}

export async function postToInternalServer(payload: any): Promise<void> {
    if (!isInternalConfigured()) throw new Error('سرور داخلی تنظیم نشده است.');
    const res = await withTimeout(fetch(`${INTERNAL_SERVER_URL}/api/ingest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }), TIMEOUT_MS * 3, 'ingest-internal');
    if (!res.ok) throw new Error(`[Internal] ingest -> HTTP ${res.status}`);
}
// ✅ ADDITIVE — پاک‌کردن همهٔ رکوردهای یک جدول در ابر (RLS خاموش فرض می‌شود)
// فیلتر id=not.is.null یعنی «هر ردیفی که id دارد» = همهٔ ردیف‌ها.
export async function deleteAllRows(table: string): Promise<void> {
    if (!isSupabaseConfigured()) throw new Error('Supabase تنظیم نشده است.');
    const res = await withTimeout(
        fetch(`${SUPABASE_URL}/rest/v1/${table}?id=not.is.null`, {
            method: 'DELETE',
            headers: { ...authHeaders(), Prefer: 'return=minimal' },
        }),
        TIMEOUT_MS * 2,
        `delete ${table}`
    );
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`[Supabase] delete ${table} -> HTTP ${res.status} ${txt}`);
    }
}

// ✅ ADDITIVE — پاک‌کردن همهٔ جدول‌های عملیاتی در ابر (هر کدام مستقل)
export async function purgeAllOperationalTables(): Promise<void> {
    const tables = [
        'rebar_bundles', 'furnace_logs', 'billets',
        'quality_inspections', 'downtime_logs', 'waste_logs', 'production_logs',
    ];
    for (const t of tables) {
        try { await deleteAllRows(t); }
        catch (e: any) { console.warn(`[purgeAll] ${t}:`, e?.message || e); }
    }
}