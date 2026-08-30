import * as SQLite from 'expo-sqlite';
import { getDatabase, generateUniqueId } from '../database/Database';

export class StockAlertService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * ثبت بومی هشدار کمبود مواد بر روی کاتالوگ دیتابیس لوکال
     */
    public static async createAlert(
        productId: string,
        warehouseId: string | null,
        alertType: 'shortage' | 'low_stock',
        message: string
    ): Promise<void> {
        try {
            const db = await this.getDB();
            const id = generateUniqueId('alt');

            await db.runAsync(
                `INSERT INTO stock_alerts (id, product_id, warehouse_id, alert_type, message, is_resolved)
         VALUES (?, ?, ?, ?, ?, 0)`,
                [id, productId, warehouseId, alertType, message]
            );
        } catch (e) {
            console.error('[StockAlertService ERROR] Failed to create alert:', e);
        }
    }

    /**
     * واکشی هشدارهای فعال و حل‌نشده انبار مجهز به سوپاپ اطمینان خطای دیتابیس [4]
     */
    public static async getLowStockAlerts(): Promise<any[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<any>(
                `SELECT a.id, a.message, a.alert_type, p.name as product_name
         FROM stock_alerts a
         INNER JOIN products p ON a.product_id = p.id
         WHERE a.is_resolved = 0 ORDER BY a.created_at DESC`
            );
            return rows;
        } catch (e) {
            console.warn('[StockAlertService WARNING] stock_alerts table missing, fallback loaded.', e);
            return []; // بازگرداندن آرایه خالی بدون کرش کردن کل پنل لجستیک و انبارداری [4]
        }
    }
}