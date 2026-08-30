import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';

export class OperatorProfileService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * به‌روزرسانی امن نام نمایشی پرسنل در تبلت کارگاهی
     */
    public static async updateProfileName(id: string, newName: string): Promise<void> {
        try {
            const db = await this.getDB();
            await db.runAsync(
                `UPDATE operators SET name = ?, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [newName, id]
            );
            console.log(`[OperatorProfileService] Name updated successfully for ID: ${id}`);
        } catch (error: any) {
            console.error('[OperatorProfileService ERROR] Failed to update profile name:', error);
            throw new Error(error?.message || 'Database error during profile name update');
        }
    }
}