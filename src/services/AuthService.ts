import { getDatabase, initDB } from '../database/Database';

export interface OperatorSession {
    id: string;
    name: string;
    personnel_code: string;
    role: 'operator' | 'manager' | 'engineer' | 'warehouse';
    active_shift_id: string | null;
    shift_name: string | null;
    workshop_id: string | null;
    workshop_name: string | null;
    line_id: string | null;
    line_name: string | null;
    machine_id: string | null;
    machine_name: string | null;
}

export class AuthService {
    // تضمین می‌کند دیتابیس قبل از هر کوئری آماده شده باشد
    private static initPromise: Promise<void> | null = null;

    private static async ensureInitialized(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = initDB().catch((e) => {
                this.initPromise = null;
                throw e;
            });
        }
        await this.initPromise;
    }

    private static async getDB() {
        return await getDatabase();
    }

    public static async validateOperatorLogin(
        personnelCode: string,
        password: string
    ): Promise<boolean> {
        try {
            await this.ensureInitialized();
            const db = await this.getDB();
            const rows = await db.getAllAsync<{ id: string }>(
                'SELECT id FROM operators WHERE personnel_code = ? AND password = ?',
                [personnelCode, password]
            );
            if (rows && rows.length > 0) {
                const operatorId = rows[0].id;
                await db.runAsync(
                    "INSERT OR REPLACE INTO meta (key, value) VALUES ('current_operator_id', ?)",
                    [operatorId]
                );
                return true;
            }
            return false;
        } catch (error: any) {
            console.error('[AuthService ERROR] Login failed:', error);
            throw new Error(error?.message || 'خطای امنیتی در لایه دیتابیس.');
        }
    }

    public static async getCurrentSession(): Promise<OperatorSession | null> {
        try {
            await this.ensureInitialized();
            const db = await this.getDB();
            const metaRows = await db.getAllAsync<{ value: string }>(
                "SELECT value FROM meta WHERE key = 'current_operator_id'"
            );
            if (!metaRows || metaRows.length === 0) return null;

            const operatorId = metaRows[0].value;
            const sessionRows = await db.getAllAsync<any>(
                `SELECT o.id, o.name, o.personnel_code, o.role, o.active_shift_id, s.name as shift_name,
                o.workshop_id, w.workshop_name, o.line_id, l.line_name, o.machine_id, m.name as machine_name
         FROM operators o
         LEFT JOIN shifts s ON o.active_shift_id = s.id
         LEFT JOIN workshops w ON o.workshop_id = w.id
         LEFT JOIN production_lines l ON o.line_id = l.id
         LEFT JOIN machines m ON o.machine_id = m.id
         WHERE o.id = ?`,
                [operatorId]
            );
            if (!sessionRows || sessionRows.length === 0) return null;

            const session = sessionRows[0];
            return {
                id: session.id,
                name: session.name,
                personnel_code: session.personnel_code,
                role: session.role,
                active_shift_id: session.active_shift_id,
                shift_name: session.shift_name,
                workshop_id: session.workshop_id,
                workshop_name: session.workshop_name,
                line_id: session.line_id,
                line_name: session.line_name,
                machine_id: session.machine_id,
                machine_name: session.machine_name,
            };
        } catch (error) {
            console.error('[AuthService ERROR] Failed to fetch session:', error);
            return null;
        }
    }

    public static async logout(): Promise<void> {
        try {
            const db = await this.getDB();
            await db.runAsync("DELETE FROM meta WHERE key = 'current_operator_id'");
        } catch (error) {
            console.error('[AuthService ERROR] Logout failed:', error);
        }
    }
}