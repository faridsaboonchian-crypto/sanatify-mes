import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';

export interface BomAvailability {
    hasEnough: boolean;
    requiredMaterials: {
        productId: string;
        name: string;
        required: number;
        available: number;
    }[];
}

export class BomService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * بررسی پویای بالانس موجودی انبار خط بر اساس فرمولاسیون ساخت قطعه (BOM) [4]
     */
    public static async checkBOMAvailability(
        productId: string,
        targetQuantity: number,
        warehouseId: string
    ): Promise<BomAvailability> {
        try {
            const db = await this.getDB();

            const materials = await db.getAllAsync<{
                child_id: string;
                child_name: string;
                required_per_unit: number;
                available_qty: number;
            }>(
                `SELECT b.child_product_id as child_id, p.name as child_name, 
                b.quantity_required as required_per_unit, COALESCE(i.quantity, 0) as available_qty
         FROM bill_of_materials b
         INNER JOIN products p ON b.child_product_id = p.id
         LEFT JOIN inventory_items i ON b.child_product_id = i.product_id AND i.warehouse_id = ?
         WHERE b.parent_product_id = ?`,
                [warehouseId, productId]
            );

            const requiredMaterials = [];
            let hasEnough = true;

            for (const mat of materials) {
                const requiredTotal = targetQuantity * mat.required_per_unit;
                if (mat.available_qty < requiredTotal) {
                    hasEnough = false;
                }

                requiredMaterials.push({
                    productId: mat.child_id,
                    name: mat.child_name,
                    required: requiredTotal,
                    available: mat.available_qty,
                });
            }

            return { hasEnough, requiredMaterials };
        } catch (e) {
            console.error('[BomService ERROR] Failed to calculate BOM availability:', e);
            return { hasEnough: false, requiredMaterials: [] };
        }
    }
}