import { getDatabase, generateUniqueId } from '../database/Database';

// =====================================================================
//  TraceabilityService — فاز ۱ ماژول ردیابی فولاد (Steel Traceability)
//  کلاسِ متدِ ایزوله (الگوی static مطابق AuthService / ProductionService)
//  تمام عملیات بر بستر API ناهمگام expo-sqlite و getDatabase() پروژه
// =====================================================================

// ---------- تایپ‌های ورودی ----------
export interface BilletInput {
    heat_number: string;            // شماره ذوب (الزامی)
    batch_number?: string;          // شماره پارت/بچ
    supplier_name?: string;         // تامین‌کننده
    dimensions?: string;            // ابعاد شمش (مثلاً 125x125)
    length_meters?: number;         // طول شمش
    initial_weight_kg?: number;     // وزن اولیه
    grade?: string;                 // گرید فولاد (3SP, 5SP, ...)
    received_at?: string;           // زمان ورود (ISO) — پیش‌فرض: اکنون
    workshop_id?: string;
    line_id?: string;
    operator_id?: string;
}

export interface ChargeInput {
    furnace_temperature_celsius?: number;
    operator_id?: string;
    shift_id?: string;
    machine_id?: string;
    charge_time?: string;           // زمان ورود به کوره (ISO) — پیش‌فرض: اکنون
    heat_number?: string;           // اختیاری؛ در صورت عدم ارائه از billet خوانده می‌شود
}

export interface BundleInput {
    heat_number: string;            // شماره ذوب مرجع (الزامی)
    rebar_size: number;             // سایز میلگرد (10,12,14,16,20,...)
    rebar_grade: string;            // گرید (A2, A3, A4)
    net_weight_kg: number;          // وزن خالص بندیل از باسکول (الزامی)
    billet_id?: string;             // شمش مرجع — در صورت عدم ارائه، خودکار از heat_number استخراج می‌شود
    branch_count?: number;          // تعداد شاخه
    production_log_id?: string;     // ارجاع به ثبت تولید
    quality_status?: string;        // APPROVED | REJECTED | PENDING — پیش‌فرض: PENDING
    produced_at?: string;           // زمان تولید/گره‌زنی (ISO) — پیش‌فرض: اکنون
    bundle_code?: string;           // کد یکتای بندیل — در صورت عدم ارائه، خودکار تولید می‌شود
    operator_id?: string;
    shift_id?: string;
    line_id?: string;
    workshop_id?: string;
}

// ---------- تایپ‌های خروجی (ردیف‌ها) ----------
export interface BilletRow {
    id: string;
    heat_number: string;
    batch_number: string | null;
    supplier_name: string | null;
    dimensions: string | null;
    length_meters: number | null;
    initial_weight_kg: number | null;
    grade: string | null;
    status: string;
    received_at: string | null;
    workshop_id: string | null;
    line_id: string | null;
    operator_id: string | null;
    created_at: string;
    updated_at: string;
    sync_status: string;
    remote_id: string | null;
    deleted_at: string | null;
}

export interface FurnaceLogRow {
    id: string;
    billet_id: string | null;
    heat_number: string;
    charge_time: string;
    discharge_time: string | null;
    residence_time_minutes: number | null;
    furnace_temperature_celsius: number | null;
    operator_id: string | null;
    shift_id: string | null;
    machine_id: string | null;
    created_at: string;
    updated_at: string;
    sync_status: string;
    remote_id: string | null;
    deleted_at: string | null;
}

export interface RebarBundleRow {
    id: string;
    bundle_code: string;
    heat_number: string;
    billet_id: string | null;
    rebar_size: number;
    rebar_grade: string;
    branch_count: number | null;
    net_weight_kg: number;
    production_log_id: string | null;
    quality_status: string;
    produced_at: string;
    operator_id: string | null;
    shift_id: string | null;
    line_id: string | null;
    workshop_id: string | null;
    created_at: string;
    updated_at: string;
    sync_status: string;
    remote_id: string | null;
    deleted_at: string | null;
}

export interface FurnaceActiveBillet {
    furnace_log_id: string;
    billet_id: string | null;
    heat_number: string;
    charge_time: string;
    current_residence_time_minutes: number;   // محاسبهٔ بلادرنگ
    furnace_temperature_celsius: number | null;
    operator_id: string | null;
    shift_id: string | null;
    machine_id: string | null;
}

export interface GenealogyResult {
    heat_number: string;
    billets: BilletRow[];
    furnace_logs: FurnaceLogRow[];
    rebar_bundles: RebarBundleRow[];
}

// ---------- ابزارهای داخلی ----------
function nowIso(): string {
    return new Date().toISOString();
}

function minutesBetween(fromIso: string, toIso: string): number {
    const fromMs = new Date(fromIso).getTime();
    const toMs = new Date(toIso).getTime();
    if (isNaN(fromMs) || isNaN(toMs)) return 0;
    return Math.max(0, Math.round((toMs - fromMs) / 60000));
}

function buildBundleCode(heatNumber: string): string {
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
    const safeHeat = (heatNumber || 'NA').replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'NA';
    return `BND-${safeHeat}-${ts}-${rnd}`;
}

export class TraceabilityService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * ۱) ثبت یک شمش/پارت جدید در انبار (وضعیت پیش‌فرض IN_YARD)
     */
    public static async registerBilletBatch(data: BilletInput): Promise<string> {
        if (!data.heat_number || !data.heat_number.trim()) {
            throw new Error('شماره ذوب (heat_number) برای ثبت شمش الزامی است.');
        }
        const db = await this.getDB();
        const id = generateUniqueId('billet');
        const receivedAt = data.received_at && data.received_at.trim() ? data.received_at.trim() : nowIso();

        await db.runAsync(
            `INSERT INTO billets (
         id, heat_number, batch_number, supplier_name, dimensions,
         length_meters, initial_weight_kg, grade, status, received_at,
         workshop_id, line_id, operator_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_YARD', ?, ?, ?, ?);`,
            [
                id,
                data.heat_number.trim(),
                data.batch_number ?? null,
                data.supplier_name ?? null,
                data.dimensions ?? null,
                data.length_meters ?? null,
                data.initial_weight_kg ?? null,
                data.grade ?? null,
                receivedAt,
                data.workshop_id ?? null,
                data.line_id ?? null,
                data.operator_id ?? null,
            ]
        );
        console.log(`[Traceability] Billet registered: ${id} | heat=${data.heat_number}`);
        return id;
    }

    /**
     * ۲) شارژ شمش به کوره پیش‌گرم (تغییر وضعیت به IN_FURNACE + ثبت furnace_log)
     */
    public static async chargeBilletToFurnace(
        billetId: string,
        furnaceData: ChargeInput
    ): Promise<string> {
        if (!billetId || !billetId.trim()) {
            throw new Error('شناسه شمش (billetId) برای شارژ کوره الزامی است.');
        }
        const db = await this.getDB();

        // خواندن شمش جهت یکپارچگی heat_number و اعتبارسنجی وجود
        const billet = await db.getFirstAsync<{ id: string; heat_number: string; status: string }>(
            `SELECT id, heat_number, status FROM billets WHERE id = ?;`,
            [billetId]
        );
        if (!billet) {
            throw new Error(`شمش با شناسه ${billetId} یافت نشد.`);
        }

        const heatNumber = (furnaceData.heat_number && furnaceData.heat_number.trim())
            ? furnaceData.heat_number.trim()
            : billet.heat_number;
        const chargeTime = furnaceData.charge_time && furnaceData.charge_time.trim()
            ? furnaceData.charge_time.trim()
            : nowIso();
        const furnaceLogId = generateUniqueId('furnace');

        await db.runAsync(
            `INSERT INTO furnace_logs (
         id, billet_id, heat_number, charge_time, furnace_temperature_celsius,
         operator_id, shift_id, machine_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                furnaceLogId,
                billetId,
                heatNumber,
                chargeTime,
                furnaceData.furnace_temperature_celsius ?? null,
                furnaceData.operator_id ?? null,
                furnaceData.shift_id ?? null,
                furnaceData.machine_id ?? null,
            ]
        );
        await db.runAsync(
            `UPDATE billets SET status = 'IN_FURNACE', updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
            [billetId]
        );

        console.log(`[Traceability] Billet ${billetId} charged to furnace | log=${furnaceLogId}`);
        return furnaceLogId;
    }

    /**
     * ۳) تخلیه شمش از کوره + محاسبهٔ خودکار مدت ماندگاری (residence_time_minutes)
     */
    public static async dischargeBilletFromFurnace(
        furnaceLogId: string,
        dischargeTime?: string
    ): Promise<number> {
        if (!furnaceLogId || !furnaceLogId.trim()) {
            throw new Error('شناسه لاگ کوره (furnaceLogId) برای تخلیه الزامی است.');
        }
        const db = await this.getDB();

        const log = await db.getFirstAsync<{ id: string; charge_time: string; discharge_time: string | null }>(
            `SELECT id, charge_time, discharge_time FROM furnace_logs WHERE id = ?;`,
            [furnaceLogId]
        );
        if (!log) {
            throw new Error(`لاگ کوره با شناسه ${furnaceLogId} یافت نشد.`);
        }
        if (log.discharge_time) {
            // قبلاً تخلیه شده؛ از محاسبهٔ مجدد جلوگیری می‌کنیم (ایدم‌پوتنت)
            const existing = await db.getFirstAsync<{ residence_time_minutes: number | null }>(
                `SELECT residence_time_minutes FROM furnace_logs WHERE id = ?;`,
                [furnaceLogId]
            );
            return existing?.residence_time_minutes ?? 0;
        }

        const dischargeIso = dischargeTime && dischargeTime.trim() ? dischargeTime.trim() : nowIso();
        const residence = minutesBetween(log.charge_time, dischargeIso);

        await db.runAsync(
            `UPDATE furnace_logs
         SET discharge_time = ?, residence_time_minutes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?;`,
            [dischargeIso, residence, furnaceLogId]
        );

        console.log(`[Traceability] Furnace log ${furnaceLogId} discharged | residence=${residence}m`);
        return residence;
    }

    /**
     * ۴) ثبت بندیل میلگرد نهایی + تولید کد یکتا + تکمیل خودکار شجره‌نامهٔ ذوب
     *    - اگر billet_id داده نشود، از آخرین شمشِ همان heat_number استخراج می‌شود
     *    - وضعیت شمشِ مرجع به ROLLED ارتقا می‌یابد
     */
    public static async createRebarBundle(
        bundleData: BundleInput
    ): Promise<{ id: string; bundle_code: string }> {
        if (!bundleData.heat_number || !bundleData.heat_number.trim()) {
            throw new Error('شماره ذوب (heat_number) برای ثبت بندیل الزامی است.');
        }
        if (!bundleData.rebar_grade || !bundleData.rebar_grade.trim()) {
            throw new Error('گرید میلگرد (rebar_grade) الزامی است.');
        }
        if (!bundleData.net_weight_kg || bundleData.net_weight_kg <= 0) {
            throw new Error('وزن خالص بندیل (net_weight_kg) باید عددی مثبت باشد.');
        }

        const db = await this.getDB();
        const heatNumber = bundleData.heat_number.trim();

        // تکمیل خودکار شجره‌نامه: استخراج شمش مرجع در صورت عدم ارائهٔ billet_id
        let billetId: string | null = bundleData.billet_id && bundleData.billet_id.trim()
            ? bundleData.billet_id.trim()
            : null;
        if (!billetId) {
            const inferred = await db.getFirstAsync<{ id: string }>(
                `SELECT id FROM billets
          WHERE heat_number = ? AND status IN ('IN_YARD','IN_FURNACE')
          ORDER BY received_at DESC, created_at DESC
          LIMIT 1;`,
                [heatNumber]
            );
            billetId = inferred?.id ?? null;
        }

        const id = generateUniqueId('bundle');
        const bundleCode = bundleData.bundle_code && bundleData.bundle_code.trim()
            ? bundleData.bundle_code.trim()
            : buildBundleCode(heatNumber);
        const producedAt = bundleData.produced_at && bundleData.produced_at.trim()
            ? bundleData.produced_at.trim()
            : nowIso();
        const qualityStatus = bundleData.quality_status && bundleData.quality_status.trim()
            ? bundleData.quality_status.trim()
            : 'PENDING';

        await db.runAsync(
            `INSERT INTO rebar_bundles (
         id, bundle_code, heat_number, billet_id, rebar_size, rebar_grade,
         branch_count, net_weight_kg, production_log_id, quality_status, produced_at,
         operator_id, shift_id, line_id, workshop_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
            [
                id,
                bundleCode,
                heatNumber,
                billetId,
                bundleData.rebar_size,
                bundleData.rebar_grade.trim(),
                bundleData.branch_count ?? null,
                bundleData.net_weight_kg,
                bundleData.production_log_id ?? null,
                qualityStatus,
                producedAt,
                bundleData.operator_id ?? null,
                bundleData.shift_id ?? null,
                bundleData.line_id ?? null,
                bundleData.workshop_id ?? null,
            ]
        );

        // ارتقای وضعیت شمش مرجع به ROLLED (تکمیل چرخهٔ حیات شمش)
        if (billetId) {
            await db.runAsync(
                `UPDATE billets SET status = 'ROLLED', updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
                [billetId]
            );
        }

        console.log(`[Traceability] Rebar bundle created: ${bundleCode} | heat=${heatNumber} | billet=${billetId ?? 'n/a'}`);
        return { id, bundle_code: bundleCode };
    }

    /**
     * ۵) شجره‌نامهٔ کامل یک شماره ذوب (شمش‌های ورودی + لاگ‌های کوره + بندیل‌های خروجی)
     */
    public static async getBilletGenealogy(heatNumber: string): Promise<GenealogyResult> {
        if (!heatNumber || !heatNumber.trim()) {
            throw new Error('شماره ذوب (heatNumber) برای دریافت شجره‌نامه الزامی است.');
        }
        const db = await this.getDB();
        const heat = heatNumber.trim();

        const [billets, furnace_logs, rebar_bundles] = await Promise.all([
            db.getAllAsync<BilletRow>(
                `SELECT * FROM billets WHERE heat_number = ? ORDER BY received_at DESC, created_at DESC;`,
                [heat]
            ),
            db.getAllAsync<FurnaceLogRow>(
                `SELECT * FROM furnace_logs WHERE heat_number = ? ORDER BY charge_time DESC;`,
                [heat]
            ),
            db.getAllAsync<RebarBundleRow>(
                `SELECT * FROM rebar_bundles WHERE heat_number = ? ORDER BY produced_at DESC;`,
                [heat]
            ),
        ]);

        return { heat_number: heat, billets, furnace_logs, rebar_bundles };
    }

    /**
     * ۶) لیست شمش‌های فعال داخل کوره + محاسبهٔ بلادرنگ زمان ماندگاری جاری
     *    معیار «فعال بودن»: charge_time ثبت شده ولی discharge_time هنوز NULL است
     */
    public static async getFurnaceCurrentStatus(): Promise<FurnaceActiveBillet[]> {
        const db = await this.getDB();
        const rows = await db.getAllAsync<{
            id: string;
            billet_id: string | null;
            heat_number: string;
            charge_time: string;
            furnace_temperature_celsius: number | null;
            operator_id: string | null;
            shift_id: string | null;
            machine_id: string | null;
        }>(
            `SELECT id, billet_id, heat_number, charge_time, furnace_temperature_celsius,
              operator_id, shift_id, machine_id
         FROM furnace_logs
        WHERE discharge_time IS NULL
        ORDER BY charge_time ASC;`
        );

        const now = nowIso();
        return rows.map((r) => ({
            furnace_log_id: r.id,
            billet_id: r.billet_id,
            heat_number: r.heat_number,
            charge_time: r.charge_time,
            current_residence_time_minutes: minutesBetween(r.charge_time, now),
            furnace_temperature_celsius: r.furnace_temperature_celsius,
            operator_id: r.operator_id,
            shift_id: r.shift_id,
            machine_id: r.machine_id,
        }));
    }
}