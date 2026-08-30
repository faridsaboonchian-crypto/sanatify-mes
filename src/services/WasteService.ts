import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';
import { generateUniqueId } from '../utils/id';
import { IndustrialEventService } from './IndustrialEventService'; // واکشی سرویس رویداد
import { AuthService } from './AuthService';
import { WorkshopContextService } from './WorkshopContextService';

export interface WasteLog {
    id: string;
    shift_id: string;
    reason_id: string;
    quantity: number;
    timestamp: string;
    sync_status: 'pending' | 'synced';
    operator_id: string | null;
}

const DATABASE_NAME = 'sanatify.db';

export class WasteService {
    private static async getDB() {
        return await getDatabase();
    }

    public static async createWasteLog(
        shiftId: string,
        reasonId: string,
        quantity: number,
        operatorId: string
    ): Promise<string> {
        try {
            const db = await this.getDB();
            const id = generateUniqueId('waste');
            const timestamp = new Date().toISOString();

            const activeMachineId = 'mach-press-01';
            const activeJobId = 'job-mock-01';

            // ۱. درج بومی در جدول ضایعات (پس‌سازگاری OEE)
            await db.runAsync(
                `INSERT INTO waste_logs (id, shift_id, reason_id, quantity, timestamp, sync_status, machine_id, job_id, operator_id)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)` ,
                [id, shiftId, reasonId, quantity, timestamp, activeMachineId, activeJobId, operatorId]
            );

            // ۲. درج موازی در لایه موتور یکپارچه رویدادهای کارخانه
            const session = await AuthService.getCurrentSession();
            const activeCtx = await WorkshopContextService.getActiveContext();

            await IndustrialEventService.createEvent(
                'waste',
                operatorId,
                session ? session.name : 'اپراتور ناشناس',
                activeCtx ? activeCtx.id : null,
                activeCtx ? activeCtx.workshop_name : 'نامشخص',
                activeCtx ? activeCtx.line_name : null,
                activeCtx ? activeCtx.line_name : null,
                activeMachineId,
                activeCtx ? activeCtx.machine_name : 'PR-01',
                shiftId,
                { quantity, reason: reasonId },
                'WasteModule'
            );

            return id;
        } catch (error: any) {
            console.error('[WasteService ERROR] Failed to insert waste log:', error);
            throw new Error(error?.message || 'Database error during waste log insertion');
        }
    }

    public static async getWasteLogs(): Promise<WasteLog[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<WasteLog>(
                'SELECT * FROM waste_logs ORDER BY timestamp DESC'
            );
            return rows;
        } catch (error) {
            throw error;
        }
    }

    public static async getTodayWasteTotal(): Promise<number> {
        try {
            const db = await this.getDB();
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const startOfTodayIso = startOfToday.toISOString();

            const result = await db.getFirstAsync<{ total: number }>(
                'SELECT SUM(quantity) as total FROM waste_logs WHERE timestamp >= ?',
                [startOfTodayIso]
            );

            return result?.total ?? 0;
        } catch (error) {
            throw error;
        }
    }
}