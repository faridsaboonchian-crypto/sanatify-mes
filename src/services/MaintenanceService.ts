import * as SQLite from 'expo-sqlite';

export interface MaintenanceEvent {
    id: string;
    machine_id: string;
    operator_id: string;
    description: string;
    start_time: string;
    end_time: string | null;
    cost: number;
}

const DATABASE_NAME = 'sanatify.db';

export class MaintenanceService {
    private static async getDB() {
        return await SQLite.openDatabaseAsync(DATABASE_NAME);
    }

    /**
     * ثبت فیزیکی شروع یک عملیات تعمیراتی یا واقعه نگهداری (Maintenance Event)
     */
    public static async createMaintenanceEvent(
        machineId: string,
        operatorId: string,
        description: string,
        startTime: string
    ): Promise<string> {
        console.log(`[MaintenanceService] Open maintenance event. Machine: ${machineId}, Desc: ${description}`);
        try {
            const db = await this.getDB();
            const id = crypto.randomUUID();

            await db.runAsync(
                `INSERT INTO maintenance_events (id, machine_id, operator_id, description, start_time, end_time, cost, sync_status)
         VALUES (?, ?, ?, ?, ?, NULL, 0.0, 'pending')`,
                [id, machineId, operatorId, description, startTime]
            );

            return id;
        } catch (e: any) {
            console.error('[MaintenanceService ERROR] Failed to open maintenance event:', e);
            throw new Error(e?.message || 'Database error during maintenance event creation');
        }
    }

    /**
     * اتمام موفقیت‌آمیز عملیات تعمیرات دستگاه و ثبت هزینه‌ها
     */
    public static async closeMaintenanceEvent(
        id: string,
        endTime: string,
        cost: number
    ): Promise<void> {
        console.log(`[MaintenanceService] Closing maintenance event: ${id}. Cost: ${cost}`);
        try {
            const db = await this.getDB();
            await db.runAsync(
                `UPDATE maintenance_events SET end_time = ?, cost = ?, sync_status = 'pending' WHERE id = ?`,
                [endTime, cost, id]
            );
        } catch (e: any) {
            console.error('[MaintenanceService ERROR] Failed to close maintenance event:', e);
            throw new Error(e?.message || 'Database error during closing maintenance event');
        }
    }

    /**
     * محاسبه لایو شاخص MTTR (میانگین زمان تعمیر به دقیقه) برای یک ماشین مشخص
     * فرمول: مجموع زمان خرابی‌های ناخواسته تقسیم بر تعداد فرکانس خرابی‌ها
     */
    public static async calculateMTTR(machineId: string): Promise<number> {
        try {
            const db = await this.getDB();

            const result = await db.getFirstAsync<{ total_time: number, count: number }>(
                `SELECT SUM(duration_minutes) as total_time, COUNT(id) as count 
         FROM downtime_logs 
         WHERE machine_id = ? AND is_unplanned = 1 AND duration_minutes IS NOT NULL`,
                [machineId]
            );

            if (!result || result.count === 0) {
                return 0;
            }

            const mttr = result.total_time / result.count;
            console.log(`[MaintenanceService] Computed MTTR for machine ${machineId}: ${mttr.toFixed(1)} minutes`);
            return Math.round(mttr * 100) / 100;
        } catch (e) {
            console.error('[MaintenanceService ERROR] Failed to calculate MTTR:', e);
            return 0;
        }
    }

    /**
     * محاسبه لایو شاخص MTBF (میانگین زمان بین خرابی‌ها به دقیقه) برای یک ماشین مشخص
     * فرمول: زمان کل در حال کار منهای زمان توقفات ناگهانی تقسیم بر تعداد توقفات ناگهانی
     */
    public static async calculateMTBF(machineId: string, totalPlannedMinutes: number): Promise<number> {
        try {
            const db = await this.getDB();

            const result = await db.getFirstAsync<{ total_time: number, count: number }>(
                `SELECT SUM(duration_minutes) as total_time, COUNT(id) as count 
         FROM downtime_logs 
         WHERE machine_id = ? AND is_unplanned = 1 AND duration_minutes IS NOT NULL`,
                [machineId]
            );

            if (!result || result.count === 0) {
                return totalPlannedMinutes; // اگر توقفی نبوده، زمان بین خرابی برابر کل زمان است
            }

            // اصلاح عدد منفی: اگر توقفات بیشتر از زمان برنامه‌ریزی شده باشد، حداقل صفر برگردانده می‌شود
            const runTime = Math.max(0, totalPlannedMinutes - result.total_time);
            const mtbf = runTime / result.count;

            console.log(`[MaintenanceService] Computed MTBF for machine ${machineId}: ${mtbf.toFixed(1)} minutes`);
            return Math.round(mtbf * 100) / 100;
        } catch (e) {
            console.error('[MaintenanceService ERROR] Failed to calculate MTBF:', e);
            return 0;
        }
    }
}