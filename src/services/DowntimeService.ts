import * as SQLite from 'expo-sqlite';

import { getDatabase, generateUniqueId } from '../database/Database'; // واکشی مستقیم متد شناسه بومی کارگاهی جهت رفع ارور crypto
import { IndustrialEventService } from './IndustrialEventService';
import { AuthService } from './AuthService';
import { WorkshopContextService } from './WorkshopContextService';

export interface DowntimeLog {
  id: string;
  shift_id: string;
  reason_id: string;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  timestamp: string;
  sync_status: 'pending' | 'synced';
}

const DATABASE_NAME = 'sanatify.db';

export class DowntimeService {
  private static async getDB() {
    return await getDatabase();
  }

  public static async createDowntimeLog(
    shiftId: string,
    reasonId: string,
    startTime: string
  ): Promise<string> {
    try {
      const db = await this.getDB();
      const id = generateUniqueId('down'); // استفاده از شناسه بدون کراش و بومی
      const timestamp = new Date().toISOString();

      const activeMachineId = 'mach-press-01';

      await db.runAsync(
        `INSERT INTO downtime_logs (id, shift_id, reason_id, start_time, end_time, duration_minutes, timestamp, sync_status, machine_id, is_unplanned)
         VALUES (?, ?, ?, ?, NULL, NULL, ?, 'pending', ?, 1)`,
        [id, shiftId, reasonId, startTime, timestamp, activeMachineId]
      );

      const session = await AuthService.getCurrentSession();
      const activeCtx = await WorkshopContextService.getActiveContext();

      await IndustrialEventService.createEvent(
        'downtime',
        session ? session.id : null,
        session ? session.name : 'اپراتور ناشناس',
        activeCtx ? activeCtx.id : null,
        activeCtx ? activeCtx.workshop_name : 'نامشخص',
        activeCtx ? activeCtx.line_name : null,
        activeCtx ? activeCtx.line_name : null,
        activeMachineId,
        activeCtx ? activeCtx.machine_name : 'PR-01',
        shiftId,
        { reason: reasonId, duration: null, start_time: startTime },
        'DowntimeModule'
      );

      return id;
    } catch (error: any) {
      console.error('[DowntimeService ERROR] Failed to create downtime log:', error);
      throw new Error(error?.message || 'Database error during downtime log creation');
    }
  }

  public static async closeDowntimeLog(
    id: string,
    endTime: string,
    durationMinutes: number
  ): Promise<void> {
    try {
      const db = await this.getDB();
      
      await db.runAsync(
        `UPDATE downtime_logs 
         SET end_time = ?, duration_minutes = ?, sync_status = 'pending' 
         WHERE id = ?`,
        [endTime, durationMinutes, id]
      );

      const session = await AuthService.getCurrentSession();
      const activeCtx = await WorkshopContextService.getActiveContext();

      await IndustrialEventService.createEvent(
        'downtime', 
        session ? session.id : null,
        session ? session.name : 'اپراتور ناشناس',
        activeCtx ? activeCtx.id : null,
        activeCtx ? activeCtx.workshop_name : 'نامشخص',
        activeCtx ? activeCtx.line_name : null,
        activeCtx ? activeCtx.line_name : null,
        'mach-press-01',
        activeCtx ? activeCtx.machine_name : 'PR-01',
        session ? session.active_shift_id : null,
        { reason: 'راه‌اندازی مجدد و رفع توقف', duration: durationMinutes, end_time: endTime },
        'DowntimeModule'
      );

    } catch (error: any) {
      console.error('[DowntimeService ERROR] Failed to close downtime log:', error);
      throw new Error(error?.message || 'Database error during closing downtime log');
    }
  }

  public static async getActiveDowntime(machineId: string): Promise<{ id: string, start_time: string, reason_id: string } | null> {
    try {
      const db = await this.getDB();
      const row = await db.getFirstAsync<{ id: string, start_time: string, reason_id: string }>(
        `SELECT id, start_time, reason_id 
         FROM downtime_logs 
         WHERE machine_id = ? AND end_time IS NULL LIMIT 1`,
        [machineId]
      );
      return row;
    } catch (error) {
      throw error;
    }
  }

  public static async getTodayDowntimeTotal(): Promise<number> {
    try {
      const db = await this.getDB();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const startOfTodayIso = startOfToday.toISOString();

      const result = await db.getFirstAsync<{ total_duration: number }>(
        'SELECT SUM(duration_minutes) as total_duration FROM downtime_logs WHERE timestamp >= ?',
        [startOfTodayIso]
      );

      return result?.total_duration ?? 0;
    } catch (error) {
      throw error;
    }
  }
}