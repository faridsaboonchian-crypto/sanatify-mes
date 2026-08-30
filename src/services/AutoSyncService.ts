import { Platform } from 'react-native';
import { SyncService } from './SyncService';

// =====================================================================
//  AutoSyncService — نگهبانِ sync خودکار (singleton)
//  هر intervalMs یک بار SyncService.syncAll را صدا می‌زند.
//  - در وب غیرفعال (expo-sqlite در وب نیست).
//  - از تداخل جلوگیری می‌کند (اگر sync قبلی در حال اجراست، skip).
//  - هرگز crash نمی‌کند (همه در try/catch).
// =====================================================================

export class AutoSyncService {
    private static timer: ReturnType<typeof setInterval> | null = null;
    private static firstTimer: ReturnType<typeof setTimeout> | null = null;
    private static syncing = false;
    private static running = false;

    /** شروع sync خودکار. فقط یک بار فعال می‌شود. */
    public static start(intervalMs: number = 3 * 60 * 1000): void {
        if (Platform.OS === 'web') {
            console.log('[AutoSync] web platform -> disabled (no local DB).');
            return;
        }
        if (this.running) {
            console.log('[AutoSync] already running -> ignore start.');
            return;
        }
        this.running = true;

        // اولین sync با کمی تأخیر (تا UI و session آماده شوند)
        this.firstTimer = setTimeout(() => {
            this.firstTimer = null;
            this.tick();
        }, 5000);

        // sync دوره‌ای
        this.timer = setInterval(() => {
            this.tick();
        }, intervalMs);

        console.log(`[AutoSync] started (interval ${intervalMs}ms, first tick in 5s).`);
    }

    /** توقف sync خودکار (مثلاً موقع خروج از اپ). */
    public static stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.firstTimer) {
            clearTimeout(this.firstTimer);
            this.firstTimer = null;
        }
        this.running = false;
        console.log('[AutoSync] stopped.');
    }

    public static isRunning(): boolean {
        return this.running;
    }

    /** یک دور sync — با guard تداخل. */
    private static async tick(): Promise<void> {
        if (this.syncing) {
            console.log('[AutoSync] previous sync still running -> skip this tick.');
            return;
        }
        this.syncing = true;
        try {
            const res = await SyncService.syncAll();
            console.log(
                `[AutoSync] tick done -> total=${res.total_synced}, supabase=${res.supabase.ok}, internal=${res.internal.ok}`
            );
        } catch (e: any) {
            console.warn('[AutoSync] tick failed (ignored):', e?.message || String(e));
        } finally {
            this.syncing = false;
        }
    }
}