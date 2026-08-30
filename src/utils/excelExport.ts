import { Platform, Share, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

// =====================================================================
//  excelExport — سرویس خروجی اکسل سراسری (Universal Excel Export)
//  خروجی CSV با UTF-8 BOM برای نمایش صحیح فارسی در Excel ویندوز.
//  پشتیبانی همزمان از اندروید (اشتراک‌گذاری/ذخیره) و وب (دانلود مستقیم Blob).
// =====================================================================

/** تعریف یک ستون گزارش: برچسب فارسی + کلید داده در آبجکت */
export interface ExcelColumn {
    label: string; // عنوان فارسی ستون (در هدر اکسل نمایش داده می‌شود)
    key: string;   // کلید متناظر در هر ردیفِ داده
}

export interface ExcelSection {
    sectionTitle: string;
    columns: ExcelColumn[];
    data: any[];
}

// نویسهٔ BOM برای شناسایی UTF-8 در Excel ویندوز (جلوگیری از به‌هم‌ریختگی فارسی)
const UTF8_BOM = '\uFEFF';

/** امن‌سازی یک مقدار برای فرمت CSV */
function escapeCsvValue(value: any): string {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    return `"${str.replace(/"/g, '""')}"`;
}

/** ساخت محتوای CSV تک‌بخشی با BOM، عنوان گزارش، هدرها و داده‌ها */
function buildCsv(columns: ExcelColumn[], data: any[], reportTitle?: string): string {
    const lines: string[] = [];
    if (reportTitle && reportTitle.trim()) {
        lines.push(escapeCsvValue(reportTitle.trim()));
        lines.push('');
    }
    lines.push(columns.map((c) => escapeCsvValue(c.label)).join(','));
    for (const row of data) {
        const cells = columns.map((c) => escapeCsvValue(row?.[c.key]));
        lines.push(cells.join(','));
    }
    return UTF8_BOM + lines.join('\r\n');
}

/** ساخت محتوای CSV چندبخشی با BOM */
function buildMultiCsv(sections: ExcelSection[], reportTitle?: string): string {
    const allLines: string[] = [];
    if (reportTitle && reportTitle.trim()) {
        allLines.push(escapeCsvValue(reportTitle.trim()));
        allLines.push('');
    }
    for (const section of sections) {
        allLines.push(escapeCsvValue(`▌ ${section.sectionTitle}`));
        allLines.push(section.columns.map((c) => escapeCsvValue(c.label)).join(','));
        for (const row of section.data) {
            allLines.push(section.columns.map((c) => escapeCsvValue(row?.[c.key])).join(','));
        }
        allLines.push('');
    }
    return UTF8_BOM + allLines.join('\r\n');
}

/**
 * دانلود مستقیم فایل در مرورگر ویندوز (لایه وب).
 * استفاده از globalThis برای عبور امن از type-check بدون نیاز به DOM lib،
 * و revoke با تأخیر برای جلوگیری از دانلود نیمه‌کاره در برخی مرورگرها.
 */
function triggerWebDownload(csvContent: string, safeName: string): void {
    const g: any = globalThis;
    if (!g.document || !g.URL || !g.Blob) {
        throw new Error('محیط مرورگر برای دانلود فایل در دسترس نیست.');
    }
    const blob = new g.Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = g.URL.createObjectURL(blob);
    const link = g.document.createElement('a');
    link.href = url;
    link.download = safeName;
    link.style.display = 'none';
    g.document.body.appendChild(link);
    link.click();
    g.document.body.removeChild(link);
    // تأخیر در آزادسازی URL تا دانلود در مرورگرهای ویندوز کامل شود
    setTimeout(() => {
        try {
            g.URL.revokeObjectURL(url);
        } catch (e) {
            // بی‌خطر
        }
    }, 1500);
}

/** ذخیره در cache موبایل + باز کردن برگهٔ اشتراک‌گذاری/ذخیره */
async function shareOnMobile(csvContent: string, safeName: string, dialogTitle: string): Promise<void> {
    const cacheDir = FileSystem.cacheDirectory;
    if (!cacheDir) {
        throw new Error('مسیر ذخیره‌سازی موقت در دسترس نیست.');
    }
    const fileUri = `${cacheDir}${safeName}`;
    await FileSystem.writeAsStringAsync(fileUri, csvContent, {
        encoding: FileSystem.EncodingType.UTF8,
    });
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
        await Sharing.shareAsync(fileUri, {
            mimeType: 'text/csv',
            dialogTitle,
        });
    } else {
        await Share.share({
            title: dialogTitle,
            message: `فایل «${safeName}» آماده است.`,
            url: fileUri,
        });
    }
}

/**
 * خروجی گرفتن از داده‌ها به فرمت CSV (قابل باز شدن در Excel).
 * - وب: دانلود مستقیم Blob در مرورگر.
 * - موبایل: ذخیره در cache + برگهٔ اشتراک‌گذاری.
 */
export async function exportToExcel(
    filename: string,
    columns: ExcelColumn[],
    data: any[],
    reportTitle?: string
): Promise<void> {
    if (!columns || columns.length === 0) {
        throw new Error('ستون‌های گزارش تعریف نشده‌اند.');
    }
    const csvContent = buildCsv(columns, data, reportTitle);
    const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    const title = reportTitle || 'خروجی گزارش MES';

    if (Platform.OS === 'web') {
        try {
            triggerWebDownload(csvContent, safeName);
        } catch (e: any) {
            console.error('[excelExport] Web download failed:', e);
            throw new Error(e?.message || 'دانلود فایل در مرورگر ناموفق بود.');
        }
        return;
    }

    try {
        await shareOnMobile(csvContent, safeName, title);
    } catch (e: any) {
        console.error('[excelExport] Mobile export failed:', e);
        throw new Error(e?.message || 'خروجی گرفتن روی دستگاه ناموفق بود.');
    }
}

/** خروجی چندبخشی: چند جدول در یک فایل CSV */
export async function exportMultiSectionToExcel(
    filename: string,
    sections: ExcelSection[],
    reportTitle?: string
): Promise<void> {
    if (!sections || sections.length === 0) {
        throw new Error('بخشی برای خروجی تعریف نشده است.');
    }
    const csvContent = buildMultiCsv(sections, reportTitle);
    const safeName = filename.endsWith('.csv') ? filename : `${filename}.csv`;
    const title = reportTitle || 'خروجی گزارش MES';

    if (Platform.OS === 'web') {
        try {
            triggerWebDownload(csvContent, safeName);
        } catch (e: any) {
            console.error('[excelExport] Web multi-download failed:', e);
            throw new Error(e?.message || 'دانلود فایل در مرورگر ناموفق بود.');
        }
        return;
    }

    try {
        await shareOnMobile(csvContent, safeName, title);
    } catch (e: any) {
        console.error('[excelExport] Mobile multi-export failed:', e);
        throw new Error(e?.message || 'خروجی گرفتن روی دستگاه ناموفق بود.');
    }
}