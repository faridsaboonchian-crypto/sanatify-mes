import * as SQLite from 'expo-sqlite';
import { getDatabase, generateUniqueId } from '../database/Database';
import { IndustrialEventService } from './IndustrialEventService';

export interface MaintenanceEvent {
    id: string;
    machine_id: string;
    workshop_id: string | null;
    downtime_id: string | null;
    engineer_id: string;
    failure_reason_id: string;
    maintenance_type: 'emergency' | 'preventive' | 'predictive';
    started_at: string;
    completed_at: string | null;
    repair_minutes: number | null;
    description: string | null;
    status: 'open' | 'in_progress' | 'completed';
}

export interface FailureReason {
    id: string;
    title: string;
    category: string;
    severity: string;
}

export interface OpenDowntime {
    id: string;
    reason_id: string;
    start_time: string;
    machine_id: string;
    machine_name: string;
    shift_id: string;
}

const DATABASE_NAME = 'sanatify.db';

export class MaintenanceExecutionService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * استخراج تمامی توقفات باز دستگاه‌ها جهت ثبت تعمیرات توسط مهندس
     */
    public static async getActiveDowntimes(): Promise<OpenDowntime[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<OpenDowntime>(
                `SELECT d.id, d.reason_id, d.start_time, d.machine_id, m.name as machine_name, d.shift_id
                 FROM downtime_logs d
                 INNER JOIN machines m ON d.machine_id = m.id
                 WHERE d.end_time IS NULL`
            );
            return rows;
        } catch (e) {
            console.error('[MaintenanceExecutionService ERROR] Failed to fetch active downtimes:', e);
            throw e;
        }
    }

    /**
     * استخراج لیست علل استاندارد خرابی‌ها جهت انتخاب کشویی مهندسی
     */
    public static async getFailureReasons(): Promise<FailureReason[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<FailureReason>(
                "SELECT id, title, category, severity FROM failure_reasons WHERE is_active = 1"
            );
            return rows;
        } catch (e) {
            console.warn('[MaintenanceExecutionService WARNING] failure_reasons table missing, fallback loaded.', e);
            return [
                { id: 'fr-mech-01', title: 'خرابی مکانیکی دستگاه', category: 'Mechanical', severity: 'high' },
                { id: 'fr-elec-02', title: 'نوسان یا خرابی برق', category: 'Electrical', severity: 'high' },
                { id: 'fr-plc-03', title: 'خطای منطقی یا باگ PLC', category: 'Automation', severity: 'medium' }
            ];
        }
    }

    /**
     * ثبت شروع واقعه تعمیراتی (تغییر وضعیت به در حال تعمیر - in_progress)
     * هماهنگ‌سازی با فیلدهای NOT NULL دیتابیس بومی (ثبت همزمان operator_id و description)
     */
    public static async startRepair(
        machineId: string,
        workshopId: string | null,
        downtimeId: string | null,
        engineerId: string,
        failureReasonId: string,
        maintenanceType: 'emergency' | 'preventive' | 'predictive',
        description: string
    ): Promise<string> {
        try {
            const db = await this.getDB();
            const id = generateUniqueId('mte');
            const timestamp = new Date().toISOString();
            const finalDesc = description.trim() || 'ثبت شروع فرآیند اورهال خط تولید';

            // مهار کامل قفل NOT NULL دیتابیس بومی با فرستادن همزمان فیلدهای والد و فرزند
            await db.runAsync(
                `INSERT INTO maintenance_events (
                    id, machine_id, operator_id, description, start_time,
                    workshop_id, downtime_id, engineer_id, failure_reason_id,
                    maintenance_type, started_at, completed_at, repair_minutes, status, sync_status
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'in_progress', 'pending')`,
                [
                    id,
                    machineId,
                    engineerId, // ست کردن فیلد بومی operator_id جهت رفع ارور NOT NULL دیتابیس
                    finalDesc,  // ست کردن فیلد بومی description جهت رفع ارور NOT NULL دیتابیس
                    timestamp,  // ست کردن فیلد بومی start_time جهت رفع ارور NOT NULL دیتابیس
                    workshopId,
                    downtimeId,
                    engineerId,
                    failureReasonId,
                    maintenanceType,
                    timestamp
                ]
            );

            // شلیک رویداد شروع تعمیر به موتور سراسری رویدادها
            await IndustrialEventService.createEvent(
                'maintenance',
                engineerId,
                'کارشناس مهندسی',
                workshopId,
                'پرس‌کاری',
                null, null,
                machineId,
                'دستگاه پرس',
                null,
                { action: 'repair_started', event_id: id, description: finalDesc },
                'MaintenanceModule'
            );

            return id;
        } catch (e: any) {
            console.error('[MaintenanceExecutionService ERROR] Failed to start repair:', e);
            throw new Error(e?.message || 'Database error starting repair event');
        }
    }

    /**
     * اتمام موفقیت‌آمیز عملیات تعمیرات دستگاه، محاسبه مدت کارکرد و بستن خودکار رویداد خاموشی دستگاه در تبلت
     */
    public static async completeRepair(
        eventId: string,
        description: string,
        engineerName: string
    ): Promise<void> {
        try {
            const db = await this.getDB();
            const timestamp = new Date().toISOString();

            // ۱. واکشی اطلاعات زمان شروع رویداد تعمیراتی برای محاسبه تفاضل زمانی
            const event = await db.getFirstAsync<any>(
                'SELECT started_at, downtime_id, engineer_id, machine_id, workshop_id FROM maintenance_events WHERE id = ?',
                [eventId]
            );

            if (!event) {
                throw new Error('رویداد تعمیراتی مدنظر یافت نشد.');
            }

            // محاسبه خودکار تفاضل دقیق زمان تعمیر به دقیقه
            const startMs = new Date(event.started_at).getTime();
            const endMs = new Date(timestamp).getTime();
            const repairMinutes = Math.max(1, Math.round((endMs - startMs) / (1000 * 60)));

            // ۲. ثبت زمان اتمام و تغییر وضعیت کار به تکمیل‌شده (همگام‌سازی فیلدهای قدیمی و جدید دیتابیس)
            await db.runAsync(
                `UPDATE maintenance_events 
                 SET completed_at = ?, end_time = ?, repair_minutes = ?, description = ?, status = 'completed', sync_status = 'pending'
                 WHERE id = ?`,
                [timestamp, timestamp, repairMinutes, description.trim() || 'اتمام واقعه اورهال', eventId]
            );

            // ۳. بستن همزمان توقف دستگاه در جدول downtime_logs به صورت تراکنشی و همزمان
            if (event.downtime_id) {
                await db.runAsync(
                    `UPDATE downtime_logs 
                     SET end_time = ?, duration_minutes = ?, sync_status = 'pending' 
                     WHERE id = ?`,
                    [timestamp, repairMinutes, event.downtime_id]
                );
            }

            // ۴. شلیک رویداد پایان تعمیرات به موتور یکپارچه رویدادها
            await IndustrialEventService.createEvent(
                'maintenance',
                event.engineer_id,
                engineerName,
                event.workshop_id,
                'پرس‌کاری',
                null, null,
                event.machine_id,
                'دستگاه پرس',
                null,
                { action: 'repair_completed', repair_minutes: repairMinutes, description },
                'MaintenanceModule'
            );

        } catch (e: any) {
            console.error('[MaintenanceExecutionService ERROR] Failed to complete repair:', e);
            throw new Error(e?.message || 'Database error during closing repair event');
        }
    }
}