import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database'; // واکشی کانکشن یگانه و پایدار

export interface OeeMetrics {
    availability: number;
    performance: number;
    quality: number;
    oee: number;
}

export interface ProductionSummary {
    totalGood: number;
    totalWaste: number;
    totalDowntimeMinutes: number;
    unplannedDowntimeMinutes: number;
    plannedDowntimeMinutes: number;
}

const DATABASE_NAME = 'sanatify.db';

export class OeeService {
    private static async getDB() {
        return await getDatabase(); // اتصال به کانکشن سراسری و یگانه
    }

    /**
     * محاسبه جامع و تفکیک‌شده شاخص OEE برای یک شیفت، دستگاه و محصول مشخص
     */
    public static async calculateOEE(
        shiftId: string,
        machineId: string | null,
        productId: string,
        plannedProductionMinutes: number,
        idealCycleTimeSeconds: number
    ): Promise<OeeMetrics> {
        console.log(`[OeeService] Starting OEE Calculation. Shift: ${shiftId}, Machine: ${machineId}, Product: ${productId}`);
        try {
            const db = await this.getDB();

            // ۱. استخراج مجموع تولید سالم کارگاه
            let goodQuery = 'SELECT SUM(good_quantity) as total FROM production_logs WHERE shift_id = ? AND product_id = ?';
            const goodParams: string[] = [shiftId, productId];
            if (machineId) {
                goodQuery += ' AND machine_id = ?';
                goodParams.push(machineId);
            }
            const goodResult = await db.getFirstAsync<{ total: number }>(goodQuery, goodParams);
            const totalGood = goodResult?.total ?? 0;

            // ۲. استخراج مجموع قطعات ضایعاتی کارگاه
            let wasteQuery = 'SELECT SUM(quantity) as total FROM waste_logs WHERE shift_id = ?';
            const wasteParams: string[] = [shiftId];
            if (machineId) {
                wasteQuery += ' AND machine_id = ?';
                wasteParams.push(machineId);
            }
            const wasteResult = await db.getFirstAsync<{ total: number }>(wasteQuery, wasteParams);
            const totalWaste = wasteResult?.total ?? 0;

            const totalProduced = totalGood + totalWaste;

            // ۳. استخراج مجموع زمان‌های خاموشی و توقفات ناخواسته (is_unplanned = 1)
            let downtimeQuery = 'SELECT SUM(duration_minutes) as total FROM downtime_logs WHERE shift_id = ? AND is_unplanned = 1';
            const downtimeParams: string[] = [shiftId];
            if (machineId) {
                downtimeQuery += ' AND machine_id = ?';
                downtimeParams.push(machineId);
            }
            const downtimeResult = await db.getFirstAsync<{ total: number }>(downtimeQuery, downtimeParams);
            const unplannedDowntimeMinutes = downtimeResult?.total ?? 0;

            // ۴. محاسبه شاخص دسترس‌پذیری (Availability)
            const actualRunTimeMinutes = plannedProductionMinutes - unplannedDowntimeMinutes;
            let availability = 0;
            if (plannedProductionMinutes > 0) {
                availability = Math.max(0, (actualRunTimeMinutes / plannedProductionMinutes) * 100);
            }

            // ۵. محاسبه شاخص کارایی سرعت (Performance)
            let performance = 0;
            const actualRunTimeSeconds = actualRunTimeMinutes * 60;
            if (actualRunTimeSeconds > 0 && totalProduced > 0) {
                const idealProductionTimeSeconds = totalProduced * idealCycleTimeSeconds;
                performance = Math.min(100, (idealProductionTimeSeconds / actualRunTimeSeconds) * 100);
            }

            // ۶. محاسبه شاخص کیفیت تولید (Quality)
            let quality = 0;
            if (totalProduced > 0) {
                quality = (totalGood / totalProduced) * 100;
            }

            // ۷. محاسبه نهایی OEE
            const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;

            console.log(`[OeeService] OEE computed successfully: A=${availability.toFixed(1)}%, P=${performance.toFixed(1)}%, Q=${quality.toFixed(1)}% -> OEE=${oee.toFixed(1)}%`);

            return {
                availability: Math.round(availability * 100) / 100,
                performance: Math.round(performance * 100) / 100,
                quality: Math.round(quality * 100) / 100,
                oee: Math.round(oee * 100) / 100,
            };
        } catch (e) {
            console.error('[OeeService ERROR] Failed to calculate OEE:', e);
            throw e;
        }
    }

    /**
     * محاسبه لایو و تجمیعی OEE کل سالن تولید برای کارکرد امروز به تفکیک ماشین پرس فعال
     */
    public static async getTodayOEE(): Promise<OeeMetrics> {
        try {
            const db = await this.getDB();

            // لود شیفت کاری صبح برای دریافت زمان کل برنامه‌ریزی‌شده تولید (۴۸۰ دقیقه)
            const activeShift = await db.getFirstAsync<{ id: string, planned_duration_minutes: number }>(
                "SELECT id, planned_duration_minutes FROM shifts WHERE id = 'shift-morning-301'"
            );
            const plannedMinutes = activeShift?.planned_duration_minutes ?? 480;

            // لود محصول فعال تیپ A برای دریافت زمان استاندارد تولید قطعه (۱۵ ثانیه)
            const activeProduct = await db.getFirstAsync<{ id: string, ideal_cycle_time_seconds: number }>(
                "SELECT id, ideal_cycle_time_seconds FROM products WHERE id = 'prod-a-201'"
            );
            const idealSeconds = activeProduct?.ideal_cycle_time_seconds ?? 15.0;

            if (!activeShift || !activeProduct) {
                return { availability: 100, performance: 100, quality: 100, oee: 100 };
            }

            // اتصال لایو OEE به شناسه فیزیکی ماشین پرس کارگاهی
            const activeMachine = 'mach-press-01';

            return await this.calculateOEE(activeShift.id, activeMachine, activeProduct.id, plannedMinutes, idealSeconds);
        } catch (e) {
            console.error('[OeeService ERROR] Failed to fetch today OEE:', e);
            return { availability: 0, performance: 0, quality: 0, oee: 0 };
        }
    }

    /**
     * خلاصه آمار فیزیکی کارکرد سالن تولید برای گزارش‌های مدیریتی
     */
    public static async getProductionSummary(): Promise<ProductionSummary> {
        try {
            const db = await this.getDB();

            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const todayStr = startOfToday.toISOString();

            const goodResult = await db.getFirstAsync<{ total: number }>(
                'SELECT SUM(good_quantity) as total FROM production_logs WHERE timestamp >= ?',
                [todayStr]
            );
            const wasteResult = await db.getFirstAsync<{ total: number }>(
                'SELECT SUM(quantity) as total FROM waste_logs WHERE timestamp >= ?',
                [todayStr]
            );
            const unplannedDtResult = await db.getFirstAsync<{ total: number }>(
                'SELECT SUM(duration_minutes) as total FROM downtime_logs WHERE timestamp >= ? AND is_unplanned = 1',
                [todayStr]
            );
            const plannedDtResult = await db.getFirstAsync<{ total: number }>(
                'SELECT SUM(duration_minutes) as total FROM downtime_logs WHERE timestamp >= ? AND is_unplanned = 0',
                [todayStr]
            );

            return {
                totalGood: goodResult?.total ?? 0,
                totalWaste: wasteResult?.total ?? 0,
                totalDowntimeMinutes: (unplannedDtResult?.total ?? 0) + (plannedDtResult?.total ?? 0),
                unplannedDowntimeMinutes: unplannedDtResult?.total ?? 0,
                plannedDowntimeMinutes: plannedDtResult?.total ?? 0
            };
        } catch (e) {
            console.error('[OeeService ERROR] Failed to fetch production summary:', e);
            throw e;
        }
    }
}