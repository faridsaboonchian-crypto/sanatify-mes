import * as SQLite from 'expo-sqlite';
import { getDatabase } from '../database/Database';
import { generateUniqueId } from '../utils/id';

export interface IndustrialEvent {
    id: string;
    event_type: 'production' | 'waste' | 'downtime' | 'target' | 'maintenance' | 'quality' | 'operator';
    operator_id: string | null;
    operator_name: string | null;
    workshop_id: string | null;
    workshop_name: string | null;
    line_id: string | null;
    line_name: string | null;
    machine_id: string | null;
    machine_name: string | null;
    shift_id: string | null;
    payload_json: string;
    sync_status: 'pending' | 'synced';
    source_module: string;
    created_at: string;
}

const DATABASE_NAME = 'sanatify.db';

export class IndustrialEventService {
    private static async getDB() {
        return await getDatabase();
    }

    /**
     * ساخت فیزیکی رویداد یکپارچه صنعتی کارگاهی در لایه SQLite
     */
    public static async createEvent(
        eventType: 'production' | 'waste' | 'downtime' | 'target' | 'maintenance' | 'quality' | 'operator',
        operatorId: string | null,
        operatorName: string | null,
        workshopId: string | null,
        workshopName: string | null,
        lineId: string | null,
        lineName: string | null,
        machineId: string | null,
        machineName: string | null,
        shiftId: string | null,
        payload: object,
        sourceModule: string
    ): Promise<string> {
        try {
            const db = await this.getDB();
            const id = generateUniqueId('evt');
            const timestamp = new Date().toISOString();
            const payloadJson = JSON.stringify(payload);

            // درج موازی در جدول یکپارچه رویدادهای کارخانه
            await db.runAsync(
                `INSERT INTO industrial_events (
          id, event_type, operator_id, operator_name, workshop_id, workshop_name,
          line_id, line_name, machine_id, machine_name, shift_id, payload_json,
          sync_status, source_module, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)` ,
                [
                    id, eventType, operatorId, operatorName, workshopId, workshopName,
                    lineId, lineName, machineId, machineName, shiftId, payloadJson,
                    sourceModule, timestamp
                ]
            );

            console.log(`[IndustrialEventService] Unified Event logged: ${eventType} (ID: ${id})`);
            return id;
        } catch (e: any) {
            console.error('[IndustrialEventService ERROR] Failed to create unified event:', e);
            throw new Error(e?.message || 'Database error during unified event dispatching');
        }
    }

    /**
     * واکشی و فیلترینگ هوشمند و یکپارچه تایم‌لاین رویدادهای کارخانه
     */
    public static async queryTimeline(filterType: string = 'all'): Promise<any[]> {
        try {
            const db = await this.getDB();
            let query = 'SELECT * FROM industrial_events';
            const params: string[] = [];

            if (filterType !== 'all') {
                query += ' WHERE event_type = ?';
                params.push(filterType);
            }

            query += ' ORDER BY created_at DESC';

            const rows = await db.getAllAsync<any>(query, params);

            return rows.map(row => {
                let payload = {};
                try {
                    payload = JSON.parse(row.payload_json);
                } catch (err) {
                    console.warn('Failed to parse payload_json for event:', row.id);
                }

                return {
                    id: row.id,
                    type: row.event_type,
                    title: this.getEventTitle(row.event_type, payload),
                    description: this.getEventDescription(row.event_type, payload),
                    timestamp: row.created_at,
                    sync_status: row.sync_status,
                    operator_name: row.operator_name || 'سیستم',
                    workshop_name: row.workshop_name,
                    line_name: row.line_name,
                    machine_name: row.machine_name || 'PR-01',
                    shift_id: row.shift_id,
                    payload,
                };
            });
        } catch (e) {
            console.error('[IndustrialEventService ERROR] Failed to query timeline:', e);
            throw e;
        }
    }

    private static getEventTitle(type: string, payload: any): string {
        if (type === 'production') return `ثبت تولید سالم: ${payload.quantity || 0} عدد`;
        if (type === 'waste') return `ثبت ضایعات: ${payload.quantity || 0} عدد`;
        if (type === 'downtime') return `توقف خط: ${payload.duration ? `${payload.duration} دقیقه` : 'در حال تعمیر'}`;
        if (type === 'maintenance') {
            if (payload.action === 'repair_started') return 'شروع تعمیر دستگاه';
            if (payload.action === 'repair_completed') return `پایان تعمیر: ${payload.repair_minutes || 0} دقیقه`;
            return 'رویداد نگهداری دستگاه';
        }
        if (type === 'target') return `به‌روزرسانی هدف تولید: ${payload.target_id || payload.target_quantity || 'نامشخص'}`;
        if (type === 'quality') return `بازبینی کیفیت: ${payload.issue || payload.detail || 'نامشخص'}`;
        if (type === 'operator') return `عملیات اپراتور: ${payload.action || 'ثبت اپراتور'}`;
        return type ? `رویداد صنعتی: ${type}` : 'رویداد صنعتی تعریف‌نشده';
    }

    private static getEventDescription(type: string, payload: any): string {
        if (type === 'production') return `محصول: ${payload.product_name || 'نامشخص'}`;
        if (type === 'waste') return `علت ضایعات: ${payload.reason || 'نامشخص'}`;
        if (type === 'downtime') return `علت توقف: ${payload.reason || 'نامشخص'}`;
        if (type === 'maintenance') return `${payload.description || payload.action || 'بدون توضیحات'}`;
        if (type === 'target') return `هدف: ${payload.target_quantity || payload.target_id || 'نامشخص'}`;
        if (type === 'quality') return `شرح کیفیت: ${payload.details || payload.issue || 'نامشخص'}`;
        if (type === 'operator') return `کاربر: ${payload.operator_name || payload.action || 'نامشخص'}`;
        return '';
    }
}