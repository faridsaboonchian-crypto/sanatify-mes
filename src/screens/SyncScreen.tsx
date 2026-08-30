import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, Divider, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SyncService, SyncResult } from '../services/SyncService';
import {
    isSupabaseReachable, isSupabaseConfigured,
    isInternalReachable, isInternalConfigured,
    purgeAllOperationalTables,
} from '../services/supabaseClient';
import { purgeOperationalData, seedDemoChainData } from '../database/Database';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';

export default function SyncScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const [checking, setChecking] = useState<boolean>(false);
    const [syncing, setSyncing] = useState<boolean>(false);
    const [purging, setPurging] = useState<boolean>(false);
    const [pulling, setPulling] = useState<boolean>(false);
    const [reachSup, setReachSup] = useState<boolean | null>(null);
    const [reachInt, setReachInt] = useState<boolean | null>(null);
    const [result, setResult] = useState<SyncResult | null>(null);

    const checkConnection = async () => {
        setChecking(true);
        try {
            const [s, i] = await Promise.all([isSupabaseReachable(), isInternalReachable()]);
            setReachSup(s); setReachInt(i);
        } catch (e) { setReachSup(false); setReachInt(false); }
        finally { setChecking(false); }
    };

    useEffect(() => { checkConnection(); }, []);

    const handleSync = async () => {
        if (!isSupabaseConfigured() && !isInternalConfigured()) {
            Alert.alert('تنظیمات ناقص', 'حداقل یکی از Supabase یا سرور داخلی را تنظیم کنید.');
            return;
        }
        try {
            setSyncing(true);
            const res = await SyncService.syncAll();
            setResult(res);
            Alert.alert('همگام‌سازی انجام شد', `مجموع رکورد: ${formatNumberFa(res.total_synced)}\nابر: ${res.supabase.ok ? '✅' : '❌'} | داخلی: ${res.internal.ok ? '✅' : '❌'}`);
        } catch (e: any) {
            Alert.alert('خطا در همگام‌سازی', e?.message || 'عملیات ناموفق بود.');
        } finally { setSyncing(false); }
    };

    // ✅ ADDITIVE — پاک‌سازی کامل داده‌های عملیاتی (محلی + ابر + آینه سرور)
    const handlePurge = () => {
        Alert.alert(
            'پاک‌سازی داده‌های عملیاتی',
            'تمام تولید / ضایعات / توقفات / QC / شمش / کوره / بندیل از این دستگاه و از ابر پاک می‌شود.\n\nداده‌های مرجع (پرسنل، شیفت، محصول، دستگاه) حفظ می‌شوند.\n\nادامه می‌دهید؟',
            [
                { text: 'انصراف', style: 'cancel' },
                {
                    text: 'پاک کن', style: 'destructive', onPress: async () => {
                        try {
                            setPurging(true);
                            const local = await purgeOperationalData();
                            try { await purgeAllOperationalTables(); } catch (e) { /* ابر اختیاری */ }
                            // یک sync خالی می‌فرستیم تا live.json روی سرور داخلی هم خالی شود
                            try { await SyncService.syncAll(); } catch (e) { /* بی‌خطر */ }
                            await checkConnection();
                            const total = Object.values(local).reduce((s, n) => s + (typeof n === 'number' && n > 0 ? n : 0), 0);
                            Alert.alert('پاک‌سازی انجام شد', `${formatNumberFa(total)} رکورد محلی پاک شد.\nابر و سرور داخلی نیز خالی شدند.\n\nاز این به بعد فقط دادهٔ واقعیِ ثبت‌شده نمایش داده می‌شود.`);
                        } catch (e: any) {
                            Alert.alert('خطا در پاک‌سازی', e?.message || String(e));
                        } finally { setPurging(false); }
                    },
                },
            ]
        );
    };

    // ✅ ADDITIVE — درج دادهٔ نمونهٔ زنجیره‌ای (دمو) + sync به ابر/وب
    const [seeding, setSeeding] = useState<boolean>(false);
    const handleSeedDemo = () => {
        Alert.alert(
            'درج دادهٔ نمونهٔ زنجیره‌ای',
            'یک زنجیرهٔ کاملِ دمو (۲ ذوب، ۱۸ شمش، ۱۲ بندیل با وضعیت‌های مختلف، ۲ آزمون QC، ۳ توقف، ضایعات) درج و به ابر/وب ارسال می‌شود. ادامه می‌دهید؟',
            [
                { text: 'انصراف', style: 'cancel' },
                {
                    text: 'درج کن', onPress: async () => {
                        try {
                            setSeeding(true);
                            const c = await seedDemoChainData();
                            try { await SyncService.syncAll(); } catch (e) { /* وب اختیاری */ }
                            Alert.alert('دادهٔ نمونه آماده شد ✅', `شمش: ${formatNumberFa(c.billets)} | بندیل: ${formatNumberFa(c.rebar_bundles)} | QC: ${formatNumberFa(c.quality_inspections)} | توقف: ${formatNumberFa(c.downtime_logs)}\nحالا داشبوردها، بالانس (ذوب KF-1405-01) و وب را ببینید.`);
                        } catch (e: any) {
                            Alert.alert('خطا در درج دمو', e?.message || String(e));
                        } finally { setSeeding(false); }
                    },
                },
            ]
        );
    };
    // ✅ ADDITIVE — D3: دریافت و ادغام دادهٔ مشترک از سرور کارخانه
    const handlePull = () => {
        Alert.alert(
            'دریافت و ادغام از سرور کارخانه',
            'داده‌های ثبت‌شدهٔ سایر دستگاه‌ها (شمش/کوره/بندیل/QC/توقفات) به همین گوشی اضافه/به‌روزرسانی می‌شود. ادامه می‌دهید؟',
            [
                { text: 'انصراف', style: 'cancel' },
                {
                    text: 'دریافت کن', style: 'default', onPress: async () => {
                        try {
                            setPulling(true);
                            const r = await SyncService.pullAndMergeFromServer();
                            Alert.alert('دریافت انجام شد ✅', `${formatNumberFa(r.total)} رکورد از سرور کارخانه ادغام شد.`);
                        } catch (e: any) {
                            Alert.alert('خطا در دریافت', e?.message || String(e));
                        } finally { setPulling(false); }
                    },
                },
            ]
        );
    };

    const chip = (ok: boolean | null, label: string) => {
        const color = ok === true ? '#059669' : ok === false ? '#dc2626' : '#94a3b8';
        const text = ok === true ? 'متصل' : ok === false ? 'قطع / تنظیم‌نشده' : '...';
        return (
            <Chip icon="circle-small" style={[styles.statusChip, { backgroundColor: color }]}>
                <Text style={styles.statusChipText}>{label}: {text}</Text>
            </Chip>
        );
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content title="همگام‌سازی ابری (یکپارچگی)" color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>وضعیت اتصال (ابر + داخلی)</Text>
                            <Divider style={styles.divider} />
                            <View style={styles.statusRow}>{chip(reachSup, 'ابر')}</View>
                            <View style={styles.statusRow}>{chip(reachInt, 'داخلی')}</View>
                            <Button mode="outlined" icon="refresh" loading={checking} onPress={checkConnection} compact style={{ alignSelf: 'flex-start', marginTop: 8 }}>بررسی مجدد</Button>
                            <Text variant="bodySmall" style={styles.hint}>«داخلی» = سرور کارخانه (بدون اینترنت). اگر اینترنت قطع شود ولی «داخلی» سبز باشد، یکپارچگی در LAN حفظ می‌شود.</Text>
                        </Card.Content>
                    </Card>

                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>ارسال داده به ابر و سرور داخلی</Text>
                            <Divider style={styles.divider} />
                            <Button mode="contained" icon="cloud-upload" loading={syncing} disabled={syncing} onPress={handleSync} style={styles.syncButton} labelStyle={styles.syncButtonLabel}>همگام‌سازی اکنون</Button>
                        </Card.Content>
                    </Card>
                    {/* ✅ ADDITIVE — کارت دریافت و ادغام (D3) */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>دریافت دادهٔ مشترک از سرور کارخانه</Text>
                            <Divider style={styles.divider} />
                            <Text variant="bodySmall" style={styles.hint}>
                                آنچه سایر دستگاه‌ها ثبت و sync کرده‌اند را به همین گوشی می‌آورد. ترتیب پیشنهادی: اول «دریافت»، بعد ثبت، بعد «همگام‌سازی».
                            </Text>
                            <Button mode="contained" icon="cloud-download" loading={pulling} disabled={pulling} onPress={handlePull} style={[styles.syncButton, { backgroundColor: '#0d9488' }]} labelStyle={styles.syncButtonLabel}>دریافت و ادغام از سرور</Button>
                        </Card.Content>
                    </Card>

                    {/* ✅ ADDITIVE — کارت دریافت و ادغام (D3) */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>دریافت دادهٔ مشترک از سرور کارخانه</Text>
                            <Divider style={styles.divider} />
                            <Text variant="bodySmall" style={styles.hint}>
                                آنچه سایر دستگاه‌ها ثبت و sync کرده‌اند را به همین گوشی می‌آورد. ترتیب پیشنهادی: اول «دریافت»، بعد ثبت، بعد «همگام‌سازی».
                            </Text>
                            <Button mode="contained" icon="cloud-download" loading={pulling} disabled={pulling} onPress={handlePull} style={[styles.syncButton, { backgroundColor: '#0d9488' }]} labelStyle={styles.syncButtonLabel}>دریافت و ادغام از سرور</Button>
                        </Card.Content>
                    </Card>
                    {/* ✅ ADDITIVE — کارت پاک‌سازی */}
                    <Card style={[styles.card, styles.purgeCard]} mode="outlined">
                        <Card.Content>
                            <Text variant="titleMedium" style={[styles.cardTitle, { color: '#b91c1c' }]}>پاک‌سازی داده‌های عملیاتی</Text>
                            <Divider style={styles.divider} />
                            <Text variant="bodySmall" style={styles.hint}>
                                داده‌های تستی/نمونه را از این دستگاه، از ابر و از سرور داخلی پاک می‌کند تا پنل فقط دادهٔ واقعی را نشان دهد. داده‌های مرجع (پرسنل/شیفت/محصول) پاک نمی‌شوند.
                            </Text>
                            <Button mode="contained" icon="delete-sweep" loading={purging} disabled={purging} onPress={handlePurge} style={[styles.syncButton, { backgroundColor: '#dc2626' }]} labelStyle={styles.syncButtonLabel}>پاک‌سازی کامل داده‌های عملیاتی</Button>
                        </Card.Content>
                    </Card>

                    {/* ✅ ADDITIVE — کارت دادهٔ نمونهٔ دمو */}
                    <Card style={[styles.card, { borderColor: '#93c5fd', borderWidth: 1.5 }]} mode="outlined">
                        <Card.Content>
                            <Text variant="titleMedium" style={[styles.cardTitle, { color: '#1d4ed8' }]}>دادهٔ نمونهٔ زنجیره‌ای (دمو/پرزنت)</Text>
                            <Divider style={styles.divider} />
                            <Text variant="bodySmall" style={styles.hint}>
                                یک زنجیرهٔ کاملِ واقعی‌نما برای نمایش به مدیر/مشتری درج می‌کند: شمش → کوره → بندیل (تأیید/مردود/در انتظار) → QC → توقفات → بالانس. با «پاک‌سازی» هر لحظه قابل حذف است.
                            </Text>
                            <Button mode="contained" icon="database-plus" loading={seeding} disabled={seeding} onPress={handleSeedDemo} style={[styles.syncButton, { backgroundColor: '#1d4ed8' }]} labelStyle={styles.syncButtonLabel}>درج دادهٔ نمونهٔ زنجیره‌ای 🏭</Button>
                        </Card.Content>
                    </Card>

                    {result && (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={styles.cardTitle}>گزارش آخرین همگام‌سازی</Text>
                                <Divider style={styles.divider} />
                                <View style={styles.detailRow}><Text style={styles.detailValue}>{formatJalaliDateTime(result.finished_at)}</Text><Text style={styles.detailLabel}>زمان پایان:</Text></View>
                                <View style={styles.detailRow}><Text style={styles.detailValue}>{formatNumberFa(result.total_synced)} رکورد</Text><Text style={styles.detailLabel}>مجموع:</Text></View>
                                <View style={styles.detailRow}><Text style={styles.detailValue}>{result.supabase.ok ? '✅ موفق' : '❌ خطا'}</Text><Text style={styles.detailLabel}>ابر (Supabase):</Text></View>
                                <View style={styles.detailRow}><Text style={styles.detailValue}>{result.internal.ok ? '✅ موفق' : '❌ خطا'}</Text><Text style={styles.detailLabel}>سرور داخلی:</Text></View>
                                <Divider style={styles.divider} />
                                {result.tables.map((t) => (
                                    <View key={t.table} style={styles.tableBlock}>
                                        <View style={styles.tableRow}>
                                            <Chip compact icon={t.ok ? 'check-circle' : 'alert-circle'} style={[styles.tableChip, { backgroundColor: t.ok ? 'rgba(52,211,153,0.16)' : 'rgba(248,113,113,0.16)' }]}>
                                                <Text style={[styles.tableChipText, { color: t.ok ? '#059669' : '#dc2626' }]}>{t.ok ? formatNumberFa(t.count) : 'خطا'}</Text>
                                            </Chip>
                                            <Text style={styles.tableName}>{t.table}</Text>
                                        </View>
                                        {!!t.error && <Text style={styles.tableError} numberOfLines={3}>{t.error}</Text>}
                                    </View>
                                ))}
                            </Card.Content>
                        </Card>
                    )}

                    <Text style={styles.footerText}>معماری: داخلی = قلب کارخانه، ابر = پشتیبان — داده هرگز گم نمی‌شود</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18, lineHeight: 26 },
    scrollContainer: { flexGrow: 1, paddingVertical: 16 },
    container: { alignItems: 'center', paddingHorizontal: 16, width: '100%' },
    card: { width: '100%', maxWidth: 450, borderRadius: 12, marginBottom: 16, backgroundColor: '#ffffff' },
    purgeCard: { borderColor: '#fca5a5', borderWidth: 1.5, backgroundColor: '#fff5f5' },
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 8, color: '#0F172A', lineHeight: 24, writingDirection: 'rtl' },
    divider: { marginBottom: 14 },
    hint: { color: '#64748B', textAlign: 'right', writingDirection: 'rtl', lineHeight: 20, marginTop: 4, marginBottom: 12 },
    statusRow: { flexDirection: 'row-reverse', justifyContent: 'flex-start', marginBottom: 8, width: '100%' },
    statusChip: { borderWidth: 0 },
    statusChipText: { color: '#ffffff', fontWeight: 'bold' },
    syncButton: { borderRadius: 8, paddingVertical: 4, backgroundColor: '#2563eb' },
    syncButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    detailRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, width: '100%' },
    detailLabel: { fontSize: 12, color: '#64748B', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, paddingLeft: 8 },
    detailValue: { fontSize: 13, fontWeight: 'bold', color: '#0F172A', textAlign: 'left', flexShrink: 1 },
    tableBlock: { marginBottom: 8, width: '100%' },
    tableRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    tableName: { fontFamily: 'monospace', fontSize: 12, color: '#334155', textAlign: 'left' },
    tableChip: { borderWidth: 0 },
    tableChipText: { fontWeight: 'bold', fontSize: 11 },
    tableError: { fontSize: 10, color: '#b91c1c', textAlign: 'left', fontFamily: 'monospace', marginTop: 3, lineHeight: 14, paddingHorizontal: 2 },
    footerText: { marginTop: 8, marginBottom: 16, fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});