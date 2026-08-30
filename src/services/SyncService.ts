import { getDatabase } from '../database/Database';
import { upsertBatch, isSupabaseConfigured, postToInternalServer, isInternalConfigured } from './supabaseClient';

// =====================================================================
//  SyncService — همگام‌سازی چندمقصدیِ مقاوم (ابر + داخلی)
//  ✅ هوشمند: قبل از SELECT، ستون‌های واقعیِ دیتابیس محلی را با PRAGMA
//     می‌خواند و فقط ستون‌های موجود را می‌فرستد (intersection).
//  ✅ قابل‌دیباگ: متن خطای هر جدول در result و لاگ می‌آید.
// =====================================================================

interface TableMap { table: string; cols: string[]; nums: string[]; }

const SYNC_TABLES: TableMap[] = [
    { table: 'production_logs', cols: ['id', 'operator_id', 'product_id', 'shift_id', 'good_quantity', 'machine_id', 'timestamp'], nums: ['good_quantity'] },
    { table: 'waste_logs', cols: ['id', 'shift_id', 'reason_id', 'quantity', 'machine_id', 'operator_id', 'timestamp'], nums: ['quantity'] },
    { table: 'downtime_logs', cols: ['id', 'shift_id', 'reason_id', 'start_time', 'end_time', 'duration_minutes', 'is_unplanned'], nums: ['duration_minutes', 'is_unplanned'] },
    { table: 'quality_inspections', cols: ['id', 'heat_number', 'rebar_size', 'yield_strength', 'tensile_strength', 'elongation_percent', 'bend_test_passed', 'visual_inspection', 'timestamp'], nums: ['rebar_size', 'yield_strength', 'tensile_strength', 'elongation_percent', 'bend_test_passed', 'visual_inspection'] },
    { table: 'billets', cols: ['id', 'heat_number', 'batch_number', 'supplier_name', 'dimensions', 'grade', 'initial_weight_kg', 'status', 'received_at'], nums: ['initial_weight_kg'] },
    { table: 'furnace_logs', cols: ['id', 'billet_id', 'heat_number', 'charge_time', 'discharge_time', 'residence_time_minutes', 'furnace_temperature_celsius'], nums: ['residence_time_minutes', 'furnace_temperature_celsius'] },
    { table: 'rebar_bundles', cols: ['id', 'bundle_code', 'heat_number', 'billet_id', 'rebar_size', 'rebar_grade', 'branch_count', 'net_weight_kg', 'quality_status', 'produced_at'], nums: ['rebar_size', 'branch_count', 'net_weight_kg'] },
];

function toNum(v: any): number | null { if (v === null || v === undefined || v === '') return null; const n = Number(v); return isNaN(n) ? null : n; }
function mapRow(row: any, cols: string[], nums: string[]): any {
    const o: any = {};
    for (const c of cols) { const raw = row[c]; o[c] = nums.includes(c) ? toNum(raw) : (raw === undefined ? null : raw); }
    return o;
}

export interface SyncTableResult { table: string; count: number; ok: boolean; error?: string; }
export interface DestResult { configured: boolean; ok: boolean; count: number; error?: string; }
export interface SyncResult {
    started_at: string; finished_at: string;
    supabase: DestResult; internal: DestResult;
    tables: SyncTableResult[]; total_synced: number;
}

export class SyncService {
    /** خواندن ستون‌های واقعی یک جدول در دیتابیس محلی (برای سازگاری خودکار) */
    private static async getLocalColumns(db: any, table: string): Promise<string[]> {
        try {
            // ✅ FIX: بدون type-argument روی db:any؛ به‌جایش cast می‌کنیم تا ts(2347) و ts(7006) رفع شوند.
            const rows = (await db.getAllAsync(`PRAGMA table_info(${table});`)) as Array<{ name: string }>;
            return (rows || []).map((r) => r.name);
        } catch (e) {
            return [];
        }
    }

    public static async syncAll(): Promise<SyncResult> {
        const started_at = new Date().toISOString();
        const supConfigured = isSupabaseConfigured();
        const intConfigured = isInternalConfigured();
        const results: SyncTableResult[] = [];
        const payload: any = {};
        let total = 0;
        const db = await getDatabase();

        for (const m of SYNC_TABLES) {
            try {
                // ۱) ستون‌های واقعی محلی را بگیر و با لیستِ مورد انتظار تقاطع بگیر
                const localCols = await this.getLocalColumns(db, m.table);
                const effectiveCols = m.cols.filter((c) => localCols.includes(c));

                if (effectiveCols.length === 0) {
                    const msg = localCols.length === 0
                        ? `جدول محلی ${m.table} یافت نشد.`
                        : `هیچ‌یک از ستون‌های مورد انتظار در ${m.table} وجود ندارد.`;
                    console.log(`[SyncService] SKIP ${m.table}: ${msg}`);
                    payload[m.table] = [];
                    results.push({ table: m.table, count: 0, ok: false, error: msg });
                    continue;
                }

                const missing = m.cols.filter((c) => !localCols.includes(c));
                if (missing.length > 0) {
                    console.log(`[SyncService] ${m.table}: ستون‌های نادیده‌گرفته‌شده (در محلی نیستند): ${missing.join(', ')}`);
                }

                // ۲) فقط ستون‌های موجود را SELECT کن
                const rows = await db.getAllAsync<any>(`SELECT ${effectiveCols.join(', ')} FROM ${m.table};`);
                const effectiveNums = m.nums.filter((n) => effectiveCols.includes(n));
                const mapped = (rows || []).map((r) => mapRow(r, effectiveCols, effectiveNums)).filter((r) => r && r.id);
                payload[m.table] = mapped;
                total += mapped.length;

                // ۳) ارسال به ابر (مستقل)
                let ok = false;
                let error: string | undefined;
                if (supConfigured) {
                    try {
                        if (mapped.length > 0) await upsertBatch(m.table, mapped);
                        ok = true;
                    } catch (e: any) {
                        error = e?.message || String(e);
                        console.log(`[SyncService] UPSERT FAIL ${m.table}: ${error}`);
                    }
                } else {
                    error = 'Supabase تنظیم نشده';
                }
                results.push({ table: m.table, count: mapped.length, ok, error });
            } catch (e: any) {
                console.log(`[SyncService] READ FAIL ${m.table}: ${e?.message || String(e)}`);
                payload[m.table] = [];
                results.push({ table: m.table, count: 0, ok: false, error: e?.message || String(e) });
            }
        }

        // ۴) ارسال یک‌جا به سرور داخلی (مستقل از ابر)
        const internal: DestResult = { configured: intConfigured, ok: false, count: total };
        if (intConfigured) {
            try { await postToInternalServer(payload); internal.ok = true; }
            catch (e: any) { internal.error = e?.message || String(e); }
        } else {
            internal.error = 'سرور داخلی تنظیم نشده (INTERNAL_SERVER_URL)';
        }

        const supOk = supConfigured && results.every((r) => r.ok);
        const supabase: DestResult = {
            configured: supConfigured,
            ok: supOk,
            count: total,
            error: supConfigured ? (supOk ? undefined : 'برخی جدول‌ها به ابر نرسیدند (متن خطا را پایینِ هر جدول ببینید)') : 'Supabase تنظیم نشده',
        };

        return { started_at, finished_at: new Date().toISOString(), supabase, internal, tables: results, total_synced: total };
    }
    // ✅ ADDITIVE — D3: دریافت اسنپ‌شات از سرور داخلی و ادغام در SQLite محلی
    public static async pullAndMergeFromServer(): Promise<{ total: number; perTable: Record<string, number> }> {
        if (!isInternalConfigured()) throw new Error('سرور داخلی تنظیم نشده است (INTERNAL_SERVER_URL).');
        const res = await fetch(`${INTERNAL_SERVER_URL}/api/snapshot`, { method: 'GET' });
        if (!res.ok) throw new Error(`[Internal] snapshot -> HTTP ${res.status}`);
        const snap = await res.json();
        const db = await getDatabase();
        const perTable: Record<string, number> = {};
        let total = 0;
        await db.execAsync('PRAGMA foreign_keys = OFF;');
        try {
            for (const m of SYNC_TABLES) {
                const rows = Array.isArray(snap && snap[m.table]) ? snap[m.table] : [];
                let n = 0;
                const localCols = await this.getLocalColumns(db, m.table);
                for (const r of rows) {
                    if (!r || !r.id) continue;
                    const cols = m.cols.filter((c) => localCols.includes(c) && r[c] !== undefined);
                    if (cols.length === 0) continue;
                    const placeholders = cols.map(() => '?').join(', ');
                    const values = cols.map((c) => (m.nums.includes(c) ? toNum(r[c]) : (r[c] === undefined ? null : r[c])));
                    await db.runAsync(`INSERT OR REPLACE INTO ${m.table} (${cols.join(', ')}) VALUES (${placeholders});`, values);
                    n++;
                }
                perTable[m.table] = n;
                total += n;
            }
        } finally {
            await db.execAsync('PRAGMA foreign_keys = ON;');
        }
        return { total, perTable };
    }
}