import { useEffect } from 'react';
import { Platform } from 'react-native';
import { AutoSyncService } from '../services/AutoSyncService';

// =====================================================================
//  AutoSync — کامپوننتِ بدون UI که نگهبانِ sync خودکار را روشن/خاموش می‌کند.
//  در mount -> start ، در unmount -> stop.
//  فاصلهٔ پیش‌فرض: ۳ دقیقه (قابل تغییر).
// =====================================================================

const AUTO_SYNC_INTERVAL_MS = 3 * 60 * 1000; // 3 دقیقه

export function AutoSync(): null {
    useEffect(() => {
        if (Platform.OS === 'web') return; // در وب غیرفعال
        AutoSyncService.start(AUTO_SYNC_INTERVAL_MS);
        return () => {
            AutoSyncService.stop();
        };
    }, []);

    return null; // هیچ UI ندارد
}