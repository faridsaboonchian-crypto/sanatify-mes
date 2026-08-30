import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';
import { generateUniqueId } from '../utils/id';

export interface WorkshopContext {
    id: string;
    workshop_name: string;
    line_name: string;
    machine_name: string;
    assigned_supervisor: string | null;
}

const DATABASE_NAME = 'sanatify.db';

export class WorkshopContextService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * ایجاد یک کانتکست یا لوکیشن عملیاتی جدید در سالن کارگاه
     */
    public static async createWorkshopContext(
        workshopName: string,
        lineName: string,
        machineName: string,
        supervisor: string
    ): Promise<string> {
        try {
            const db = await this.getDB();
            const id = generateUniqueId('ctx');

            await db.runAsync(
                `INSERT INTO workshop_contexts (id, workshop_name, line_name, machine_name, assigned_supervisor)
         VALUES (?, ?, ?, ?, ?)` ,
                [id, workshopName, lineName, machineName, supervisor]
            );

            return id;
        } catch (e: any) {
            console.error('[WorkshopContextService ERROR] Failed to create context:', e);
            throw new Error(e?.message || 'Database error during context creation');
        }
    }

    /**
     * واکشی تمامی کانتکست‌های تعریف‌شده سالن‌ها و خطوط کارگاه
     */
    public static async getWorkshopContexts(): Promise<WorkshopContext[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<WorkshopContext>(
                'SELECT * FROM workshop_contexts ORDER BY created_at DESC'
            );
            return rows;
        } catch (e) {
            console.error('[WorkshopContextService ERROR] Failed to fetch contexts:', e);
            throw e;
        }
    }

    /**
   * بازیابی لیست تمامی کانتکست‌ها و سالن‌های فعال همزمان کارگاه به صورت آرایه‌ای
   */
    public static async getActiveContexts(): Promise<WorkshopContext[]> {
        try {
            const db = await this.getDB();
            const activeMeta = await db.getFirstAsync<{ value: string }>(
                "SELECT value FROM meta WHERE key = 'active_workshop_context_ids_json'"
            );

            let activeIds: string[] = ['ctx-press-01']; // سالن پرس پیش‌فرض صنعتی
            if (activeMeta && activeMeta.value) {
                try {
                    activeIds = JSON.parse(activeMeta.value);
                } catch {
                    activeIds = ['ctx-press-01'];
                }
            }

            if (activeIds.length === 0) return [];

            const placeholders = activeIds.map(() => '?').join(',');
            const rows = await db.getAllAsync<WorkshopContext>(
                `SELECT * FROM workshop_contexts WHERE id IN (${placeholders})`,
                activeIds
            );
            return rows;
        } catch (e) {
            console.error('[WorkshopContextService ERROR] Failed to fetch active contexts:', e);
            return [];
        }
    }

    /**
     * سوئیچ تعاملی چندگانه (Toggle) وضعیت فعال‌بودن یک سالن بدون قفل ماندن روی تک‌کانتکست
     */
    public static async toggleActiveContext(id: string): Promise<void> {
        try {
            const db = await this.getDB();
            const activeMeta = await db.getFirstAsync<{ value: string }>(
                "SELECT value FROM meta WHERE key = 'active_workshop_context_ids_json'"
            );

            let activeIds: string[] = ['ctx-press-01'];
            if (activeMeta && activeMeta.value) {
                try {
                    activeIds = JSON.parse(activeMeta.value);
                } catch {
                    activeIds = ['ctx-press-01'];
                }
            }

            if (activeIds.includes(id)) {
                activeIds = activeIds.filter(item => item !== id);
            } else {
                activeIds.push(id);
            }

            await db.runAsync(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('active_workshop_context_ids_json', ?)",
                [JSON.stringify(activeIds)]
            );

            const fallbackId = activeIds.length > 0 ? activeIds[0] : '';
            await db.runAsync(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('active_workshop_context_id', ?)",
                [fallbackId]
            );
        } catch (e: any) {
            console.error('[WorkshopContextService ERROR] Failed to toggle active context:', e);
            throw new Error(e?.message || 'Failed to toggle active workshop location');
        }
    }

    /**
     * سوئیچ تک‌مقداری قدیمی (صرفاً جهت حفظ پس‌سازگاری کامل با سایر بخش‌های برنامه)
     */
    public static async setActiveContext(id: string): Promise<void> {
        await this.toggleActiveContext(id);
    }

    /**
     * بازیابی کانتکست فعال اول (صرفاً جهت ممانعت از کراش در صفحاتی که هنوز چندمقداری نشده‌اند)
     */
    public static async getActiveContext(): Promise<WorkshopContext | null> {
        const list = await this.getActiveContexts();
        return list.length > 0 ? list[0] : null;
    }
}