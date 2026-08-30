import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert, ActivityIndicator } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as XLSX from 'xlsx';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { getDatabase } from '../database/Database';
import { formatJalaliDateTime } from '../utils/dateUtils';

type RangeOption = 7 | 30 | 'all';

const toPersianDigits = (value: number | string): string => {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(value).replace(/[0-9]/g, (d) => persianDigits[Number(d)]);
};

const buildExcelRow = (row: any) => ({
    'شناسه بیلت': row.billet_id || '',
    'شماره ذوب/کوره': row.heat_number || '',
    'شماره پارتی': row.batch_number || '',
    'سایز اسمی (mm)': row.rebar_size || '',
    'قطر اندازه‌گیری‌شده (mm)': row.measured_diameter ?? '',
    'مساحت مقطع (mm2)': row.cross_section_area ?? '',
    'تنش تسلیم (MPa)': row.yield_strength ?? '',
    'استحکام کششی (MPa)': row.tensile_strength ?? '',
    'حداکثر بار (kgf)': row.max_load_kgf ?? '',
    'ازدیاد طول (%)': row.elongation_percent ?? '',
    'نسبت TS/YS': row.yield_ratio ?? '',
    'آزمون خمش': row.bend_test_passed === 1 ? 'قبول' : 'مردود',
    'بازرسی ظاهری': (row.visual_inspection === 1 || row.visual_inspection === '1') ? 'سالم' : 'معیوب',
    'وضعیت استاندارد A3': row.standard_compliant === 1 ? 'مطابق' : row.standard_compliant === 0 ? 'مغایر' : 'نامشخص',
    'سالن': row.workshop_name || '',
    'خط': row.line_name || '',
    'دستگاه': row.machine_name || '',
    'بازرس': row.inspector_name || row.inspector_id || '',
    'تاریخ ثبت': row.timestamp ? formatJalaliDateTime(row.timestamp) : '',
});

const buildCertificateHtml = (row: any): string => {
    const verdict = row.standard_compliant === 1 ? 'مطابق استاندارد' : row.standard_compliant === 0 ? 'مغایر استاندارد' : 'نامشخص';
    const verdictColor = row.standard_compliant === 1 ? '#15803d' : row.standard_compliant === 0 ? '#b91c1c' : '#475569';
    return `
    <html dir="rtl">
    <head>
        <meta charset="utf-8" />
        <style>
            body { font-family: Tahoma, Arial, sans-serif; padding: 32px; color: #1a202c; }
            h1 { font-size: 20px; text-align: center; margin-bottom: 4px; }
            h2 { font-size: 14px; text-align: center; color: #4a5568; font-weight: normal; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 24px; }
            td, th { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: right; font-size: 13px; }
            th { background-color: #f1f5f9; width: 40%; }
            .verdict { margin-top: 24px; text-align: center; font-size: 16px; font-weight: bold; color: ${verdictColor}; border: 2px solid ${verdictColor}; border-radius: 8px; padding: 10px; }
            .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; color: #4a5568; }
        </style>
    </head>
    <body>
        <h1>گواهی انطباق کنترل کیفیت میلگرد</h1>
        <h2>بر اساس استاندارد ملی ایران ISIRI 3132 (گرید A3)</h2>
        <table>
            <tr><th>شناسه بیلت</th><td>${row.billet_id || '-'}</td></tr>
            <tr><th>شماره ذوب/کوره</th><td>${row.heat_number || '-'}</td></tr>
            <tr><th>شماره پارتی</th><td>${row.batch_number || '-'}</td></tr>
            <tr><th>سایز اسمی</th><td>${row.rebar_size || '-'} mm</td></tr>
            <tr><th>تنش تسلیم</th><td>${row.yield_strength ?? '-'} MPa</td></tr>
            <tr><th>استحکام کششی</th><td>${row.tensile_strength ?? '-'} MPa</td></tr>
            <tr><th>ازدیاد طول</th><td>${row.elongation_percent ?? '-'} %</td></tr>
            <tr><th>نسبت TS/YS</th><td>${row.yield_ratio ?? '-'}</td></tr>
            <tr><th>آزمون خمش</th><td>${row.bend_test_passed === 1 ? 'قبول' : 'مردود'}</td></tr>
            <tr><th>بازرسی ظاهری</th><td>${(row.visual_inspection === 1 || row.visual_inspection === '1') ? 'سالم' : 'معیوب'}</td></tr>
            <tr><th>سالن / خط / دستگاه</th><td>${row.workshop_name || '-'} / ${row.line_name || '-'} / ${row.machine_name || '-'}</td></tr>
            <tr><th>بازرس</th><td>${row.inspector_name || '-'}</td></tr>
            <tr><th>تاریخ آزمون</th><td>${row.timestamp ? formatJalaliDateTime(row.timestamp) : '-'}</td></tr>
        </table>
        <div class="verdict">نتیجه نهایی: ${verdict}</div>
        <div class="footer">
            <span>شماره سند: ${row.id}</span>
            <span>تاریخ صدور: ${new Date().toLocaleDateString('en-GB')}</span>
        </div>
    </body>
    </html>`;
};

export default function QCExportScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState(false);
    const [rows, setRows] = useState<any[]>([]);
    const [rangeDays, setRangeDays] = useState<RangeOption>(30);

    const fetchData = async () => {
        try {
            setLoading(true);
            const db = await getDatabase();
            const data = await db.getAllAsync<any>(
                `SELECT * FROM quality_inspections ORDER BY created_at DESC LIMIT 500;`
            );
            setRows(data);
        } catch (e) {
            console.error('[QCExport] Failed to fetch inspections:', e);
            Alert.alert('خطا', 'واکشی رکوردهای کنترل کیفیت با خطا مواجه شد.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const filteredRows = useMemo(() => {
        if (rangeDays === 'all') return rows;
        const cutoff = Date.now() - rangeDays * 24 * 60 * 60 * 1000;
        return rows.filter(r => {
            const t = new Date(r.timestamp || r.created_at).getTime();
            return !isNaN(t) && t >= cutoff;
        });
    }, [rows, rangeDays]);

    const handleExportExcel = async () => {
        if (filteredRows.length === 0) {
            Alert.alert('داده‌ای موجود نیست', 'در بازه‌ی انتخاب‌شده رکوردی برای خروجی گرفتن وجود ندارد.');
            return;
        }
        setExporting(true);
        try {
            const excelRows = filteredRows.map(buildExcelRow);
            const worksheet = XLSX.utils.json_to_sheet(excelRows);
            worksheet['!cols'] = Object.keys(excelRows[0]).map(() => ({ wch: 18 }));

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'کنترل کیفیت');

            const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
            const fileName = `QC-Report-${new Date().toISOString().slice(0, 10)}.xlsx`;
            const fileUri = FileSystem.cacheDirectory + fileName;

            await FileSystem.writeAsStringAsync(fileUri, base64, {
                encoding: FileSystem.EncodingType.Base64,
            });

            const canShare = await Sharing.isAvailableAsync();
            if (canShare) {
                await Sharing.shareAsync(fileUri, {
                    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    dialogTitle: 'اشتراک‌گذاری گزارش اکسل کنترل کیفیت',
                    UTI: 'com.microsoft.excel.xlsx',
                });
            } else {
                Alert.alert('فایل ساخته شد', `فایل در مسیر ${fileUri} ذخیره شد.`);
            }
        } catch (e) {
            console.error('[QCExport] Excel export failed:', e);
            Alert.alert('خطا در خروجی اکسل', 'ساخت فایل اکسل با خطا مواجه شد. اگر پیام خطا مربوط به Buffer بود، به من اطلاع بده.');
        } finally {
            setExporting(false);
        }
    };

    const handleGenerateCertificate = async (row: any) => {
        setExporting(true);
        try {
            const html = buildCertificateHtml(row);
            const { uri } = await Print.printToFileAsync({ html });
            const canShare = await Sharing.isAvailableAsync();
            if (canShare) {
                await Sharing.shareAsync(uri, {
                    mimeType: 'application/pdf',
                    dialogTitle: 'اشتراک‌گذاری گواهی انطباق',
                    UTI: 'com.adobe.pdf',
                });
            } else {
                Alert.alert('فایل ساخته شد', `گواهی در مسیر ${uri} ذخیره شد.`);
            }
        } catch (e) {
            console.error('[QCExport] Certificate generation failed:', e);
            Alert.alert('خطا در صدور گواهی', 'ساخت فایل PDF با خطا مواجه شد.');
        } finally {
            setExporting(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content title="گزارش‌گیری کنترل کیفیت" color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}

            <View style={styles.filterRow}>
                {([7, 30, 'all'] as RangeOption[]).map(opt => (
                    <Chip
                        key={String(opt)}
                        selected={rangeDays === opt}
                        onPress={() => setRangeDays(opt)}
                        style={[styles.chip, rangeDays === opt ? styles.chipSelected : styles.chipUnselected]}
                        textStyle={[styles.chipText, rangeDays === opt && styles.chipTextSelected]}
                    >
                        {opt === 'all' ? 'همه' : `${toPersianDigits(opt)} روز اخیر`}
                    </Chip>
                ))}
            </View>

            <View style={styles.exportButtonWrap}>
                <Button
                    mode="contained"
                    icon="file-excel"
                    onPress={handleExportExcel}
                    disabled={exporting || loading}
                    loading={exporting}
                    style={styles.excelButton}
                >
                    خروجی اکسل ({toPersianDigits(filteredRows.length)} رکورد)
                </Button>
            </View>

            {loading ? (
                <ActivityIndicator size="large" style={{ marginTop: 40 }} color={theme.colors.primary} />
            ) : (
                <ScrollView contentContainerStyle={styles.scrollContainer}>
                    {filteredRows.map(row => (
                        <Card key={row.id} style={styles.recordCard} mode="outlined">
                            <Card.Content>
                                <Text style={styles.recordTitle}>
                                    بیلت {row.billet_id} — سایز {toPersianDigits(row.rebar_size)} mm
                                </Text>
                                <Text style={styles.recordSub}>
                                    {row.timestamp ? formatJalaliDateTime(row.timestamp) : ''} · {row.workshop_name || 'سالن نامشخص'}
                                </Text>
                                <Text style={[
                                    styles.recordVerdict,
                                    row.standard_compliant === 1 ? styles.verdictPass : row.standard_compliant === 0 ? styles.verdictFail : styles.verdictUnknown
                                ]}>
                                    {row.standard_compliant === 1 ? '✓ مطابق استاندارد A3' : row.standard_compliant === 0 ? '✕ مغایر استاندارد A3' : 'نامشخص'}
                                </Text>
                            </Card.Content>
                            <Card.Actions>
                                <Button
                                    mode="outlined"
                                    icon="certificate-outline"
                                    onPress={() => handleGenerateCertificate(row)}
                                    disabled={exporting}
                                >
                                    صدور گواهی انطباق
                                </Button>
                            </Card.Actions>
                        </Card>
                    ))}

                    {filteredRows.length === 0 && (
                        <Text style={styles.emptyText}>هیچ رکوردی در این بازه یافت نشد.</Text>
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18 },
    filterRow: {
        flexDirection: 'row-reverse',
        paddingHorizontal: 16,
        paddingTop: 12,
    },
    chip: { marginLeft: 8, borderRadius: 16, height: 34 },
    chipUnselected: { backgroundColor: '#e2e8f0' },
    chipSelected: { backgroundColor: '#1e3d59' },
    chipText: { fontSize: 12, fontWeight: 'bold', color: '#1a202c' },
    chipTextSelected: { color: '#ffffff' },
    exportButtonWrap: { paddingHorizontal: 16, paddingTop: 14 },
    excelButton: { borderRadius: 8, backgroundColor: '#15803d' },
    scrollContainer: { padding: 16, paddingBottom: 40 },
    recordCard: { marginBottom: 12, borderRadius: 12 },
    recordTitle: { fontWeight: 'bold', fontSize: 15, textAlign: 'right', color: '#1a202c' },
    recordSub: { fontSize: 12, color: '#4a5568', textAlign: 'right', marginTop: 4 },
    recordVerdict: { fontSize: 12, fontWeight: 'bold', textAlign: 'right', marginTop: 8 },
    verdictPass: { color: '#15803d' },
    verdictFail: { color: '#b91c1c' },
    verdictUnknown: { color: '#64748b' },
    emptyText: { textAlign: 'center', color: '#64748b', marginTop: 40 },
});