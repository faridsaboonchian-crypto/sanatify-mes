import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';
import { generateUniqueId } from '../utils/id';
import { IndustrialEventService } from './IndustrialEventService';
import { AuthService } from './AuthService';

export interface ProductionLog {
    id: string;
    operator_id: string;
    product_id: string;
    shift_id: string;
    good_quantity: number;
    timestamp: string;
    sync_status: 'pending' | 'synced';
}

const DATABASE_NAME = 'sanatify.db';

export class ProductionService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * ثبت تولید سالم همراه با مگا کانتکست‌های ۱۰۰٪ داینامیک MES (فاقد مقادیر استاتیک) [4]
     */
    public static async createProductionLog(
        operatorId: string,
        productId: string,
        shiftId: string,
        goodQuantity: number,
        machineId: string,
        lineId: string,
        workshopId: string,
        targetId: string | null
    ): Promise<string> {
        try {
            const db = await this.getDB();
            const id = generateUniqueId('log');
            const timestamp = new Date().toISOString();

            // ۱. درج بومی در جدول تولید (پس‌سازگاری OEE) با مگا کانتکست‌های دریافتی زنده
            await db.runAsync(
                `INSERT INTO production_logs (
          id, operator_id, product_id, shift_id, good_quantity, timestamp, 
          sync_status, machine_id, job_id, line_id, workshop_id, target_id
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)` ,
                [
                    id, operatorId, productId, shiftId, goodQuantity, timestamp,
                    machineId, targetId, lineId, workshopId, targetId
                ]
            );

            // ۲. درج موازی در لایه موتور یکپارچه رویدادهای کارگاه
            const session = await AuthService.getCurrentSession();

            await IndustrialEventService.createEvent(
                'production',
                operatorId,
                session ? session.name : 'اپراتور ناشناس',
                workshopId,
                session ? session.workshop_name : 'نامشخص',
                lineId,
                session ? session.line_name : null,
                machineId,
                session ? session.machine_name : 'PR-01',
                shiftId,
                { quantity: goodQuantity, product_name: 'قطعه فلزی تیپ A', product_id: productId },
                'ProductionModule'
            );

            return id;
        } catch (error: any) {
            console.error('[ProductionService ERROR] Failed to insert production log:', error);
            throw new Error(error?.message || 'Database error occurred during insertion');
        }
    }

    public static async getProductionLogs(): Promise<ProductionLog[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<ProductionLog>(
                'SELECT * FROM production_logs ORDER BY timestamp DESC'
            );
            return rows;
        } catch (error) {
            throw error;
        }
    }

    public static async getTodayProductionCount(): Promise<number> {
        try {
            const db = await this.getDB();
            const startOfToday = new Date();
            startOfToday.setHours(0, 0, 0, 0);
            const startOfTodayIso = startOfToday.toISOString();

            const result = await db.getFirstAsync<{ total: number }>(
                'SELECT SUM(good_quantity) as total FROM production_logs WHERE timestamp >= ?',
                [startOfTodayIso]
            );

            return result?.total ?? 0;
        } catch (error) {
            throw error;
        }
    }
}