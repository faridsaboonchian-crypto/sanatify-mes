import { getDatabase } from '../database/Database';

// =====================================================================
//  MaterialBalanceService — فاز ۵: بالانس مواد و راندمان وزنی فولاد
//  سرویس ایزوله و فقط‌خواندنی (SELECT) بر بستر جداول موجود پروژه.
//  هیچ جدول یا مهاجرتی را تغییر نمی‌دهد.
// =====================================================================

// ثابت صنعتی: وزن تخمینی هر قطعهٔ ضایعاتی (پرت قیچی) وقتی اطلاعات شاخه در دسترس نیست (kg)
const DEFAULT_SCRAP_UNIT_WEIGHT_KG = 2.0;

export interface HeatMaterialBalance {
    heat_number: string;
    input_weight_kg: number;
    output_weight_kg: number;
    scrap_weight_kg: number;
    scale_loss_kg: number;
    yield_rate_percent: number;
    scrap_rate_percent: number;
    scale_loss_percent: number;
    billet_count: number;
    bundle_count: number;
    scrap_piece_count: number;
    estimated_unit_weight_kg: number;
}

export interface ShiftMaterialBalance {
    scope_label: string;
    input_weight_kg: number;
    output_weight_kg: number;
    scrap_weight_kg: number;
    scale_loss_kg: number;
    yield_rate_percent: number;
    scrap_rate_percent: number;
    scale_loss_percent: number;
    bundle_count: number;
    scrap_piece_count: number;
    estimated_unit_weight_kg: number;
}

export interface BalanceBreakdownRow {
    label: string;
    weight_kg: number;
    percent: number;
    kind: 'input' | 'output' | 'scrap' | 'scale';
}

// ---------- ابزارهای داخلی ----------
function round2(n: number): number {
    if (!isFinite(n) || isNaN(n)) return 0;
    return Math.round(n * 100) / 100;
}

function safePercent(part: number, total: number): number {
    if (!total || total <= 0) return 0;
    return round2((part / total) * 100);
}

export class MaterialBalanceService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * تخمین وزن واحد هر قطعهٔ ضایعاتی بر اساس میانگین وزن هر شاخهٔ بندیل‌های هم‌محدوده.
     * اگر اطلاعات شاخه موجود نبود، ثابت صنعتی DEFAULT_SCRAP_UNIT_WEIGHT_KG برگردانده می‌شود.
     */
    private static async estimateUnitWeight(
        db: any,
        whereClause: string,
        params: any[]
    ): Promise<number> {
        try {
            const row = await db.getFirstAsync<{ avg_branch_weight: number | null }>(
                `SELECT AVG(CASE WHEN branch_count > 0 THEN net_weight_kg / branch_count ELSE NULL END) AS avg_branch_weight
         FROM rebar_bundles ${whereClause};`,
                params
            );
            const v = row?.avg_branch_weight;
            if (v != null && v > 0) return round2(v);
        } catch (e) {
            console.warn('[MaterialBalance] estimateUnitWeight failed:', e);
        }
        return DEFAULT_SCRAP_UNIT_WEIGHT_KG;
    }

    /**
     * ۱) بالانس مواد یک شماره ذوب: ورودی شمش، خروجی بندیل، ضایعات، افت کوره و درصدها.
     */
    public static async calculateHeatMaterialBalance(
        heatNumber: string
    ): Promise<HeatMaterialBalance> {
        if (!heatNumber || !heatNumber.trim()) {
            throw new Error('شماره ذوب برای محاسبه بالانس الزامی است.');
        }
        const db = await this.getDB();
        const heat = heatNumber.trim();

        // وزن کل شمش ورودی این ذوب
        const inputRow = await db.getFirstAsync<{ total: number | null; cnt: number | null }>(
            `SELECT COALESCE(SUM(initial_weight_kg), 0) AS total, COUNT(*) AS cnt
       FROM billets WHERE heat_number = ?;`,
            [heat]
        );
        const inputWeight = round2(Number(inputRow?.total ?? 0));
        const billetCount = Number(inputRow?.cnt ?? 0);

        // وزن کل بندیل سالم خروجی این ذوب
        const outputRow = await db.getFirstAsync<{ total: number | null; cnt: number | null }>(
            `SELECT COALESCE(SUM(net_weight_kg), 0) AS total, COUNT(*) AS cnt
       FROM rebar_bundles WHERE heat_number = ?;`,
            [heat]
        );
        const outputWeight = round2(Number(outputRow?.total ?? 0));
        const bundleCount = Number(outputRow?.cnt ?? 0);

        // ضایعات: فقط وقتی معنادار است که تولیدی (بندیل) ثبت شده باشد؛
        // و از طریق بازهٔ زمانی تولید همان ذوب به waste_logs نگاشت می‌شود.
        let scrapPieces = 0;
        let unitWeight = DEFAULT_SCRAP_UNIT_WEIGHT_KG;
        if (bundleCount > 0) {
            unitWeight = await this.estimateUnitWeight(db, 'WHERE heat_number = ?', [heat]);
            const scrapRow = await db.getFirstAsync<{ total_qty: number | null }>(
                `SELECT COALESCE(SUM(w.quantity), 0) AS total_qty
         FROM waste_logs w
         WHERE w.timestamp BETWEEN
           (SELECT COALESCE(MIN(produced_at), '1970-01-01') FROM rebar_bundles WHERE heat_number = ?)
           AND
           (SELECT COALESCE(MAX(produced_at), '9999-12-31') FROM rebar_bundles WHERE heat_number = ?);`,
                [heat, heat]
            );
            scrapPieces = Number(scrapRow?.total_qty ?? 0);
        }
        const scrapWeight = round2(scrapPieces * unitWeight);

        let scaleLoss = round2(inputWeight - outputWeight - scrapWeight);
        if (scaleLoss < 0) scaleLoss = 0;

        return {
            heat_number: heat,
            input_weight_kg: inputWeight,
            output_weight_kg: outputWeight,
            scrap_weight_kg: scrapWeight,
            scale_loss_kg: scaleLoss,
            yield_rate_percent: safePercent(outputWeight, inputWeight),
            scrap_rate_percent: safePercent(scrapWeight, inputWeight),
            scale_loss_percent: safePercent(scaleLoss, inputWeight),
            billet_count: billetCount,
            bundle_count: bundleCount,
            scrap_piece_count: scrapPieces,
            estimated_unit_weight_kg: round2(unitWeight),
        };
    }

    /**
     * ۲) بالانس مواد یک شیفت / تاریخ / کل: کارنامه وزنی به همراه راندمان مجموع.
     * ورودی بر اساس ثبت شارژ کوره (furnace_logs) محاسبه می‌شود؛ در نبود آن،
     * برای «تاریخ» از شمش‌های دریافتی همان روز و برای «کل» از همهٔ شمش‌ها استفاده می‌شود.
     */
    public static async getShiftMaterialBalance(
        shiftId?: string,
        date?: string
    ): Promise<ShiftMaterialBalance> {
        const db = await this.getDB();

        let bundleWhere = '1=1';
        let wasteWhere = '1=1';
        let furnaceWhere = '1=1';
        const bParams: any[] = [];
        const wParams: any[] = [];
        const fParams: any[] = [];
        let scopeLabel = 'کل داده‌ها (بدون فیلتر)';

        if (shiftId && shiftId.trim()) {
            bundleWhere = 'shift_id = ?';
            bParams.push(shiftId.trim());
            wasteWhere = 'shift_id = ?';
            wParams.push(shiftId.trim());
            furnaceWhere = 'shift_id = ?';
            fParams.push(shiftId.trim());
            scopeLabel = `شیفت ${shiftId.trim()}`;
        } else if (date && date.trim()) {
            const d = date.trim();
            bundleWhere = "date(produced_at) = ?";
            bParams.push(d);
            wasteWhere = "date(timestamp) = ?";
            wParams.push(d);
            furnaceWhere = "date(charge_time) = ?";
            fParams.push(d);
            scopeLabel = `تاریخ ${d}`;
        }

        // ورودی: شمش‌های شارژشده به کوره در این محدوده (DISTINCT جهت جلوگیری از شمارش مضاعف)
        const inputRow = await db.getFirstAsync<{ total: number | null }>(
            `SELECT COALESCE(SUM(b.initial_weight_kg), 0) AS total
       FROM (SELECT DISTINCT fl.billet_id FROM furnace_logs fl WHERE ${furnaceWhere}) AS charged
       INNER JOIN billets b ON b.id = charged.billet_id;`,
            [...fParams]
        );
        let inputWeight = round2(Number(inputRow?.total ?? 0));

        // fallback ورودی در نبود ثبت شارژ کوره
        if (inputWeight <= 0) {
            if (date && date.trim()) {
                const fb = await db.getFirstAsync<{ total: number | null }>(
                    `SELECT COALESCE(SUM(initial_weight_kg), 0) AS total FROM billets WHERE date(received_at) = ?;`,
                    [date.trim()]
                );
                inputWeight = round2(Number(fb?.total ?? 0));
            } else if (!shiftId || !shiftId.trim()) {
                const fb = await db.getFirstAsync<{ total: number | null }>(
                    `SELECT COALESCE(SUM(initial_weight_kg), 0) AS total FROM billets;`,
                    []
                );
                inputWeight = round2(Number(fb?.total ?? 0));
            }
            // در حالت shift بدون ثبت شارژ، ورودی 0 باقی می‌ماند (گزارش شفاف)
        }

        const outputRow = await db.getFirstAsync<{ total: number | null; cnt: number | null }>(
            `SELECT COALESCE(SUM(net_weight_kg), 0) AS total, COUNT(*) AS cnt
       FROM rebar_bundles WHERE ${bundleWhere};`,
            [...bParams]
        );
        const outputWeight = round2(Number(outputRow?.total ?? 0));
        const bundleCount = Number(outputRow?.cnt ?? 0);

        let scrapPieces = 0;
        let unitWeight = DEFAULT_SCRAP_UNIT_WEIGHT_KG;
        if (bundleCount > 0) {
            unitWeight = await this.estimateUnitWeight(db, `WHERE ${bundleWhere}`, [...bParams]);
            const scrapRow = await db.getFirstAsync<{ total_qty: number | null }>(
                `SELECT COALESCE(SUM(quantity), 0) AS total_qty FROM waste_logs WHERE ${wasteWhere};`,
                [...wParams]
            );
            scrapPieces = Number(scrapRow?.total_qty ?? 0);
        }
        const scrapWeight = round2(scrapPieces * unitWeight);

        let scaleLoss = round2(inputWeight - outputWeight - scrapWeight);
        if (scaleLoss < 0) scaleLoss = 0;

        return {
            scope_label: scopeLabel,
            input_weight_kg: inputWeight,
            output_weight_kg: outputWeight,
            scrap_weight_kg: scrapWeight,
            scale_loss_kg: scaleLoss,
            yield_rate_percent: safePercent(outputWeight, inputWeight),
            scrap_rate_percent: safePercent(scrapWeight, inputWeight),
            scale_loss_percent: safePercent(scaleLoss, inputWeight),
            bundle_count: bundleCount,
            scrap_piece_count: scrapPieces,
            estimated_unit_weight_kg: round2(unitWeight),
        };
    }

    /**
     * ساخت ردیف‌های جدول تفکیکی بالانس (ورودی ۱۰۰٪، خروجی، ضایعات، افت کوره).
     */
    public static buildBreakdown(b: {
        input_weight_kg: number;
        output_weight_kg: number;
        scrap_weight_kg: number;
        scale_loss_kg: number;
        yield_rate_percent: number;
        scrap_rate_percent: number;
        scale_loss_percent: number;
    }): BalanceBreakdownRow[] {
        return [
            { label: 'شمش ورودی (مبنای ۱۰۰٪)', weight_kg: b.input_weight_kg, percent: 100, kind: 'input' },
            { label: 'بندیل سالم خروجی', weight_kg: b.output_weight_kg, percent: b.yield_rate_percent, kind: 'output' },
            { label: 'ضایعات قیچی و پرت خط', weight_kg: b.scrap_weight_kg, percent: b.scrap_rate_percent, kind: 'scrap' },
            { label: 'افت کوره / پوسته اکسیدی', weight_kg: b.scale_loss_kg, percent: b.scale_loss_percent, kind: 'scale' },
        ];
    }
}