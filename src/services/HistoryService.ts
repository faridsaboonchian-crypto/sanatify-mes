import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';

export interface HistoryEventItem {
    id: string;
    type: 'production' | 'waste' | 'downtime';
    title: string;
    description: string;
    timestamp: string;
    sync_status: 'pending' | 'synced';
    quantity?: number;
    reason?: string;
    duration?: number | null;
    operator_name?: string;
    product_name?: string;
    shift_name?: string;
    machine_name?: string;
    line_name?: string;
}

const DATABASE_NAME = 'sanatify.db';

export class HistoryService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * واکشی و تلفیق زمانی هوشمند و رابطه‌ای (JOIN) کل وقایع کارگاه از SQLite
     */
    public static async getUnifiedHistory(): Promise<HistoryEventItem[]> {
        console.log('[HistoryService] Fetching unified enriched shop floor history...');
        try {
            const db = await this.getDB();

            // ۱. واکشی تولیدات به همراه نام قطعه، اپراتور، شیفت و دستگاه
            const prodLogs = await db.getAllAsync<{
                id: string;
                good_quantity: number;
                timestamp: string;
                sync_status: 'pending' | 'synced';
                product_name: string;
                operator_name: string;
                shift_name: string;
                machine_name: string | null;
            }>(
                `SELECT l.id, l.good_quantity, l.timestamp, l.sync_status, 
                p.name as product_name, o.name as operator_name, 
                s.name as shift_name, m.name as machine_name
         FROM production_logs l
         INNER JOIN operators o ON l.operator_id = o.id
         INNER JOIN products p ON l.product_id = p.id
         INNER JOIN shifts s ON l.shift_id = s.id
         LEFT JOIN machines m ON l.machine_id = m.id`
            );

            // ۲. واکشی ضایعات ثبت‌شده به همراه نام اپراتور، نام شیفت و دستگاه [اصلاح‌شده در فاز ۶.۱۰]
            const wasteLogs = await db.getAllAsync<{
                id: string;
                quantity: number;
                reason_id: string;
                timestamp: string;
                sync_status: 'pending' | 'synced';
                shift_name: string;
                machine_name: string | null;
                operator_name: string | null;
            }>(
                `SELECT w.id, w.quantity, w.reason_id, w.timestamp, w.sync_status,
                s.name as shift_name, m.name as machine_name, o.name as operator_name
         FROM waste_logs w
         INNER JOIN shifts s ON w.shift_id = s.id
         LEFT JOIN machines m ON w.machine_id = m.id
         LEFT JOIN operators o ON w.operator_id = o.id`
            );

            // ۳. واکشی توقفات ثبت‌شده به همراه نام شیفت و دستگاه
            const downtimeLogs = await db.getAllAsync<{
                id: string;
                reason_id: string;
                start_time: string;
                end_time: string | null;
                duration_minutes: number | null;
                timestamp: string;
                sync_status: 'pending' | 'synced';
                shift_name: string;
                machine_name: string | null;
            }>(
                `SELECT d.id, d.reason_id, d.start_time, d.end_time, d.duration_minutes, d.timestamp, d.sync_status,
                s.name as shift_name, m.name as machine_name
         FROM downtime_logs d
         INNER JOIN shifts s ON d.shift_id = s.id
         LEFT JOIN machines m ON d.machine_id = m.id`
            );

            const unifiedList: HistoryEventItem[] = [];

            prodLogs.forEach(log => {
                unifiedList.push({
                    id: log.id,
                    type: 'production',
                    title: `ثبت تولید سالم: ${log.good_quantity} عدد`,
                    description: `محصول: ${log.product_name}`,
                    timestamp: log.timestamp,
                    sync_status: log.sync_status,
                    quantity: log.good_quantity,
                    operator_name: log.operator_name,
                    shift_name: log.shift_name,
                    machine_name: log.machine_name || undefined,
                });
            });

            wasteLogs.forEach(log => {
                unifiedList.push({
                    id: log.id,
                    type: 'waste',
                    title: `ثبت ضایعات: ${log.quantity} عدد`,
                    description: `علت ضایعات: ${log.reason_id}`,
                    timestamp: log.timestamp,
                    sync_status: log.sync_status,
                    quantity: log.quantity,
                    reason: log.reason_id,
                    shift_name: log.shift_name,
                    machine_name: log.machine_name || undefined,
                    operator_name: log.operator_name || 'اپراتور ناشناس', // مهار نام اپراتور ضایعات
                });
            });

            downtimeLogs.forEach(log => {
                const durationText = log.duration_minutes
                    ? `${log.duration_minutes} دقیقه`
                    : 'توقف فعال (در حال تعمیر)';

                unifiedList.push({
                    id: log.id,
                    type: 'downtime',
                    title: `توقف خط: ${durationText}`,
                    description: `علت توقف: ${log.reason_id}`,
                    timestamp: log.timestamp,
                    sync_status: log.sync_status,
                    reason: log.reason_id,
                    duration: log.duration_minutes,
                    shift_name: log.shift_name,
                    machine_name: log.machine_name || undefined,
                });
            });

            return unifiedList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        } catch (error) {
            console.error('[HistoryService ERROR] Failed to fetch unified history:', error);
            throw error;
        }
    }
}