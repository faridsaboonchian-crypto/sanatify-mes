import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';
import { generateUniqueId } from '../utils/id';

export interface ActiveTarget {
    jobId: string;
    orderId: string;
    productId: string;
    productName: string;
    targetQuantity: number;
}

export interface TargetHistoryItem {
    id: string;
    order_number: string;
    target_quantity: number;
    status: string;
    priority: number;
    created_at: string;
    product_name: string;
}

const DATABASE_NAME = 'sanatify.db';

export class ProductionTargetService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * ثبت سفارش تولید جدید و تخصیص بومی آن به عنوان دستور کار فعال یک دستگاه (با مهار تداخلات همزمان)
     */
    public static async setTarget(
        orderNumber: string,
        targetQuantity: number,
        productId: string,
        machineId: string,
        priority: number = 3
    ): Promise<string> {
        console.log(`[ProductionTargetService] Setting new target. Order: ${orderNumber}, Qty: ${targetQuantity}, Machine: ${machineId}`);
        try {
            const db = await this.getDB();
            const orderId = generateUniqueId('order');
            const jobId = generateUniqueId('job');
            const timestamp = new Date().toISOString();

            // قانون پایدار کارگاه: متوقف کردن (Pause) تمام دستور کارهای فعالِ قبلیِ این دستگاه برای جلوگیری از تداخل آمار OEE
            await db.runAsync(
                `UPDATE production_jobs SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE machine_id = ? AND status = 'active'`,
                [machineId]
            );

            // ثبت فیزیکی سفارش تولید جدید
            await db.runAsync(
                `INSERT INTO production_orders (id, order_number, target_quantity, status, priority, sync_status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, 'pending', ?, ?)`,
                [orderId, orderNumber, targetQuantity, priority, timestamp, timestamp]
            );

            // ثبت و تخصیص فیزیکی دستور کار فعال روی دستگاه
            await db.runAsync(
                `INSERT INTO production_jobs (id, order_id, product_id, machine_id, status, sync_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', 'pending', ?, ?)`,
                [jobId, orderId, productId, machineId, timestamp, timestamp]
            );

            console.log(`[ProductionTargetService] Target successfully set and dispatched. Job ID: ${jobId}`);
            return orderId;
        } catch (error: any) {
            console.error('[ProductionTargetService ERROR] Set target transaction failed:', error);
            throw new Error(error?.message || 'Failed to dispatch production target');
        }
    }

    public static async getActiveTargetForMachine(machineId: string): Promise<ActiveTarget | null> {
        try {
            const db = await this.getDB();

            const target = await db.getFirstAsync<{
                id: string;
                order_id: string;
                product_id: string;
                product_name: string;
                target_quantity: number;
            }>(
                `SELECT j.id, j.order_id, j.product_id, p.name as product_name, o.target_quantity
         FROM production_jobs j
         INNER JOIN production_orders o ON j.order_id = o.id
         INNER JOIN products p ON j.product_id = p.id
         WHERE j.machine_id = ? AND j.status = 'active' LIMIT 1`,
                [machineId]
            );

            if (!target) {
                return null;
            }

            return {
                jobId: target.id,
                orderId: target.order_id,
                productId: target.product_id,
                productName: target.product_name,
                targetQuantity: target.target_quantity,
            };
        } catch (error) {
            console.error('[ProductionTargetService ERROR] Failed to fetch active target:', error);
            return null;
        }
    }

    /**
     * واکشی تاریخچه زمانی سفارشات تولید صادرشده کارگاه
     */
    public static async getTargetHistory(): Promise<TargetHistoryItem[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<TargetHistoryItem>(
                `SELECT o.id, o.order_number, o.target_quantity, o.status, o.priority, o.created_at, p.name as product_name
         FROM production_orders o
         INNER JOIN production_jobs j ON o.id = j.order_id
         INNER JOIN products p ON j.product_id = p.id
         ORDER BY o.created_at DESC`
            );
            return rows;
        } catch (error) {
            console.error('[ProductionTargetService ERROR] Failed to fetch target history:', error);
            throw error;
        }
    }
}