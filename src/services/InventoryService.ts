import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';

export class InventoryService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * واکشی موجودی فیزیکی کالاها در یک انبار مشخص
     */
    public static async getWarehouseStock(warehouseId: string): Promise<any[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<any>(
                `SELECT i.id, i.quantity, p.name as product_name, p.unit
         FROM inventory_items i
         INNER JOIN products p ON i.product_id = p.id
         WHERE i.warehouse_id = ?`,
                [warehouseId]
            );
            return rows;
        } catch (e) {
            console.error('[InventoryService ERROR] Failed to fetch warehouse stock:', e);
            throw e;
        }
    }

}
