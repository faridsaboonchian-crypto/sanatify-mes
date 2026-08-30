import { getDatabase } from '../database/Database';
import { OperatorSession } from './AuthService';

export interface OperatorUser {
    id: string;
    name: string;
    personnel_code: string;
    role: 'operator' | 'engineer' | 'manager';
    active_shift_id: string | null;
    shift_name: string | null;
    is_active: boolean;
}

export class UserManagementService {
    private static async getDB() {
        return await getDatabase();
    }

    public static async getOperators(): Promise<OperatorUser[]> {
        try {
            const db = await this.getDB();
            const rows = await db.getAllAsync<{
                id: string;
                name: string;
                personnel_code: string;
                role: 'operator' | 'engineer' | 'manager';
                active_shift_id: string | null;
                shift_name: string | null;
                deleted_at: string | null;
            }>(
                `SELECT o.id, o.name, o.personnel_code, o.role, o.active_shift_id, o.deleted_at, s.name as shift_name
                 FROM operators o
                 LEFT JOIN shifts s ON o.active_shift_id = s.id
                 ORDER BY o.created_at DESC`
            );

            return rows.map(row => ({
                id: row.id,
                name: row.name,
                personnel_code: row.personnel_code,
                role: row.role,
                active_shift_id: row.active_shift_id,
                shift_name: row.shift_name,
                is_active: row.deleted_at === null,
            }));
        } catch (e) {
            console.error('[UserManagementService ERROR] Failed to fetch operators:', e);
            throw e;
        }
    }

    public static async createUser(
        name: string,
        personnelCode: string,
        password: string,
        role: 'operator' | 'engineer' | 'manager',
        activeShiftId: string | null
    ): Promise<string> {
        try {
            const db = await this.getDB();
            const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;

            await db.runAsync(
                `INSERT INTO operators (id, name, personnel_code, password, role, active_shift_id)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, name, personnelCode, password, role, activeShiftId]
            );

            return id;
        } catch (e: any) {
            console.error('[UserManagementService ERROR] Failed to create user:', e);
            throw new Error(e?.message || 'Database error during user creation');
        }
    }

    public static async changeUserPassword(id: string, newPassword: string): Promise<void> {
        try {
            const db = await this.getDB();
            await db.runAsync(
                `UPDATE operators SET password = ?, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [newPassword, id]
            );
        } catch (e: any) {
            console.error('[UserManagementService ERROR] Password change failed:', e);
            throw new Error(e?.message || 'Database error during password change');
        }
    }

    public static async changeOwnPassword(session: OperatorSession, currentPassword: string, newPassword: string): Promise<void> {
        try {
            const db = await this.getDB();
            const row = await db.getFirstAsync<{ id: string }>(
                'SELECT id FROM operators WHERE id = ? AND password = ?',
                [session.id, currentPassword]
            );
            if (!row) {
                throw new Error('رمز عبور فعلی اشتباه است.');
            }
            await db.runAsync(
                `UPDATE operators SET password = ?, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [newPassword, session.id]
            );
        } catch (e: any) {
            console.error('[UserManagementService ERROR] Change own password failed:', e);
            throw new Error(e?.message || 'Database error during own password change');
        }
    }

    public static async toggleUserStatus(id: string, deactivate: boolean): Promise<void> {
        try {
            const db = await this.getDB();
            const deletedAtValue = deactivate ? new Date().toISOString() : null;

            await db.runAsync(
                `UPDATE operators SET deleted_at = ?, sync_status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [deletedAtValue, id]
            );
        } catch (e: any) {
            console.error('[UserManagementService ERROR] Toggle user status failed:', e);
            throw new Error(e?.message || 'Database error during status toggle');
        }
    }
}
