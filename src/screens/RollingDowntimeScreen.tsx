import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import {
    Card,
    Text,
    Button,
    useTheme,
    Appbar,
    Divider,
    ActivityIndicator,
    Chip,
    Switch,
    Menu,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DowntimeService } from '../services/DowntimeService';
import { OeeService, OeeMetrics } from '../services/OeeService';
import { AuthService, OperatorSession } from '../services/AuthService';
import { getDatabase } from '../database/Database';
import { exportToExcel, ExcelColumn } from '../utils/excelExport';
import { formatNumberFa, formatDurationFa, formatJalaliDateTime } from '../utils/dateUtils';

// =====================================================================
//  RollingDowntimeScreen — مدیریت توقفات خط نورد، OEE و خروجی اکسل
// =====================================================================

// علل توقف نورد گرم
const ROLLING_DOWNTIME_REASONS = [
    { value: 'seam-wheel-change', label: 'تعویض چرخ درزبند' },
    { value: 'coil-feed-jam', label: 'گیرش ورق در فیدر' },
    { value: 'forming-adjust', label: 'تنظیم دستگاه فرمینگ' },
    { value: 'paint-booth-cleaning', label: 'تمیزکاری اتاق رنگ' },
    { value: 'mech_elec', label: 'خرابی مکانیکی / برقی' },
];

// فرمت زمان زنده (HH:MM:SS)
const formatLiveTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export default function RollingDowntimeScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    // ---------- State ها ----------
    const [session, setSession] = useState<OperatorSession | null>(null);
    const [activeDowntime, setActiveDowntime] = useState<{ id: string; start_time: string; reason_id: string } | null>(null);
    const [selectedReason, setSelectedReason] = useState<string>('');
    const [isPlanned, setIsPlanned] = useState<boolean>(false);
    const [reasonMenuVisible, setReasonMenuVisible] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(false);
    const [oee, setOee] = useState<OeeMetrics | null>(null);
    const [downtimeList, setDowntimeList] = useState<any[]>([]);
    const [liveSeconds, setLiveSeconds] = useState<number>(0);

    // ---------- بارگذاری داده‌ها ----------
    const loadDowntimeList = async (shiftId: string) => {
        try {
            const db = await getDatabase();
            const rows = await db.getAllAsync<any>(
                `SELECT * FROM downtime_logs WHERE shift_id = ? ORDER BY timestamp DESC LIMIT 50;`,
                [shiftId]
            );
            setDowntimeList(rows || []);
        } catch (e) {
            console.warn('[RollingDowntime] downtime list load failed:', e);
        }
    };

    const loadShopFloorData = async () => {
        try {
            const activeSession = await AuthService.getCurrentSession();
            if (activeSession) {
                setSession(activeSession);
            } else {
                navigation.replace('Login');
                return;
            }
            const machineId = activeSession.machine_id || 'mach-press-01';
            const shiftId = activeSession.active_shift_id || 'shift-morning-301';
            const [ongoingDowntime, todayOee] = await Promise.all([
                DowntimeService.getActiveDowntime(machineId),
                OeeService.getTodayOEE(),
            ]);
            setActiveDowntime(ongoingDowntime);
            setOee(todayOee);
            await loadDowntimeList(shiftId);
        } catch (e) {
            console.warn('[RollingDowntime] load failed:', e);
        }
    };

    useEffect(() => {
        loadShopFloorData();
    }, []);

    // ---------- تایمر زنده ----------
    useEffect(() => {
        if (!activeDowntime) {
            setLiveSeconds(0);
            return;
        }
        const interval = setInterval(() => {
            const startMs = new Date(activeDowntime.start_time).getTime();
            const nowMs = Date.now();
            setLiveSeconds(Math.max(0, Math.floor((nowMs - startMs) / 1000)));
        }, 1000);
        return () => clearInterval(interval);
    }, [activeDowntime]);

    // ---------- شروع توقف ----------
    const handleStartDowntime = async () => {
        if (!selectedReason) {
            Alert.alert('خطا در ورود داده', 'لطفاً علت توقف را انتخاب کنید.');
            return;
        }
        if (!session) return;
        try {
            setLoading(true);
            const shiftId = session.active_shift_id || 'shift-morning-301';
            const startTime = new Date().toISOString();
            await DowntimeService.createDowntimeLog(shiftId, selectedReason, startTime);
            Alert.alert('ثبت توقف', 'توقف خط نورد آغاز شد. ماشین به حالت خاموش درآمد.');
            setSelectedReason('');
            setIsPlanned(false);
            loadShopFloorData();
        } catch (e: any) {
            Alert.alert('خطا در شروع توقف', e?.message || 'عملیات ناموفق بود.');
        } finally {
            setLoading(false);
        }
    };

    // ---------- پایان توقف ----------
    const handleEndDowntime = async () => {
        if (!activeDowntime) return;
        try {
            setLoading(true);
            const endTime = new Date().toISOString();
            const startMs = new Date(activeDowntime.start_time).getTime();
            const endMs = new Date(endTime).getTime();
            const durationMinutes = Math.max(1, Math.round((endMs - startMs) / 60000));
            await DowntimeService.closeDowntimeLog(activeDowntime.id, endTime, durationMinutes);
            Alert.alert('پایان توقف', `توقف با مدت ${formatNumberFa(durationMinutes)} دقیقه بسته شد. خط تولید بیدار شد.`);
            loadShopFloorData();
        } catch (e: any) {
            Alert.alert('خطا در پایان توقف', e?.message || 'عملیات ناموفق بود.');
        } finally {
            setLoading(false);
        }
    };

    // ---------- خروجی اکسل ----------
    const handleExportExcel = async () => {
        if (downtimeList.length === 0) {
            Alert.alert('خطا', 'هیچ توقفی برای خروجی وجود ندارد.');
            return;
        }
        try {
            const columns: ExcelColumn[] = [
                { label: 'شناسه', key: 'id' },
                { label: 'علت توقف', key: 'reason_id' },
                { label: 'نوع', key: 'is_unplanned' },
                { label: 'زمان شروع', key: 'start_time' },
                { label: 'زمان پایان', key: 'end_time' },
                { label: 'مدت (دقیقه)', key: 'duration_minutes' },
                { label: 'شیفت', key: 'shift_id' },
            ];
            const rows = downtimeList.map(d => ({
                ...d,
                is_unplanned: d.is_unplanned ? 'اضطراری' : 'برنامه‌ریزی‌شده',
                start_time: d.start_time ? formatJalaliDateTime(d.start_time) : '-',
                end_time: d.end_time ? formatJalaliDateTime(d.end_time) : 'در حال توقف',
                duration_minutes: d.duration_minutes ?? '-',
            }));
            await exportToExcel(
                `توقفات_خط_نورد_${new Date().toISOString().slice(0, 10)}`,
                columns,
                rows,
                `گزارش توقفات خط نورد — شیفت ${session?.active_shift_id || 'نامشخص'}`
            );
            Alert.alert('موفق', 'فایل خروجی اکسل توقفات آمادهٔ اشتراک‌گذاری/ذخیره شد.');
        } catch (e: any) {
            console.error('[RollingDowntime] export failed:', e);
            Alert.alert('خطا در خروجی اکسل', e?.message || 'عملیات خروجی ناموفق بود.');
        }
    };

    // ---------- برچسب علت ----------
    const getReasonLabel = (value: string): string => {
        const found = ROLLING_DOWNTIME_REASONS.find(r => r.value === value);
        return found ? found.label : value;
    };

    const selectedReasonLabel = selectedReason ? getReasonLabel(selectedReason) : '';

    // ---------- رندر ----------
    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content
                        title="مدیریت توقفات خط نورد"
                        color="#ffffff"
                        titleStyle={styles.headerTitle}
                    />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>

                    {/* ---------- بخش تایمر توقف زنده ---------- */}
                    {activeDowntime ? (
                        <Card style={[styles.card, styles.downtimeActiveCard]} mode="elevated">
                            <Card.Content>
                                <View style={styles.downtimeAlertHeader}>
                                    <Chip
                                        icon="alert-decagram"
                                        style={styles.downtimeChip}
                                        textStyle={styles.downtimeChipText}
                                    >
                                        توقف فعال
                                    </Chip>
                                    <Text variant="headlineMedium" style={styles.liveTimer}>
                                        {formatLiveTime(liveSeconds)}
                                    </Text>
                                </View>
                                <Divider style={styles.divider} />
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{getReasonLabel(activeDowntime.reason_id)}</Text>
                                    <Text style={styles.detailLabel}>علت توقف:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatJalaliDateTime(activeDowntime.start_time)}</Text>
                                    <Text style={styles.detailLabel}>زمان شروع:</Text>
                                </View>
                                <Button
                                    mode="contained"
                                    icon="play-circle"
                                    loading={loading}
                                    disabled={loading}
                                    onPress={handleEndDowntime}
                                    style={[styles.actionButton, { backgroundColor: '#059669' }]}
                                    labelStyle={styles.actionButtonLabel}
                                >
                                    پایان توقف و راه‌اندازی خط
                                </Button>
                            </Card.Content>
                        </Card>
                    ) : (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={styles.cardTitle}>
                                    ثبت شروع توقف خط نورد
                                </Text>
                                <Divider style={styles.divider} />

                                <Text variant="bodyMedium" style={styles.fieldLabel}>علت توقف:</Text>
                                <Menu
                                    visible={reasonMenuVisible}
                                    onDismiss={() => setReasonMenuVisible(false)}
                                    anchor={
                                        <Button
                                            mode="outlined"
                                            icon="menu-down"
                                            onPress={() => setReasonMenuVisible(true)}
                                            style={styles.menuAnchor}
                                            contentStyle={styles.menuAnchorContent}
                                        >
                                            {selectedReasonLabel || 'انتخاب علت توقف'}
                                        </Button>
                                    }
                                >
                                    {ROLLING_DOWNTIME_REASONS.map(r => (
                                        <Menu.Item
                                            key={r.value}
                                            onPress={() => {
                                                setSelectedReason(r.value);
                                                setReasonMenuVisible(false);
                                            }}
                                            title={r.label}
                                            leadingIcon={selectedReason === r.value ? 'check' : undefined}
                                        />
                                    ))}
                                </Menu>

                                <View style={styles.switchRow}>
                                    <Text style={styles.switchLabel}>
                                        {isPlanned ? 'برنامه‌ریزی‌شده (Planned)' : 'اضطراری (Unplanned)'}
                                    </Text>
                                    <Switch
                                        value={isPlanned}
                                        onValueChange={setIsPlanned}
                                        color={theme.colors.primary}
                                    />
                                </View>

                                <Button
                                    mode="contained"
                                    icon="alert-octagon"
                                    loading={loading}
                                    disabled={loading}
                                    onPress={handleStartDowntime}
                                    style={[styles.actionButton, { backgroundColor: '#dc2626' }]}
                                    labelStyle={styles.actionButtonLabel}
                                >
                                    شروع توقف خط
                                </Button>
                            </Card.Content>
                        </Card>
                    )}

                    {/* ---------- کارت OEE زنده ---------- */}
                    <Card style={[styles.card, styles.oeeCard]} mode="elevated">
                        <Card.Content style={styles.oeeContent}>
                            <Text variant="headlineLarge" style={styles.oeeValue}>
                                {oee ? `${formatNumberFa(oee.oee.toFixed(1))}٪` : '---'}
                            </Text>
                            <Text variant="titleMedium" style={styles.oeeTitle}>
                                راندمان کلی خط نورد (OEE)
                            </Text>
                            <Divider style={styles.oeeDivider} />
                            <View style={styles.oeeRow}>
                                <View style={styles.oeeCol}>
                                    <Text variant="bodyLarge" style={styles.oeeSubValue}>
                                        {oee ? `${formatNumberFa(oee.availability.toFixed(1))}٪` : '---'}
                                    </Text>
                                    <Text variant="bodySmall" style={styles.oeeSubLabel}>دسترس‌پذیری</Text>
                                </View>
                                <View style={styles.oeeCol}>
                                    <Text variant="bodyLarge" style={styles.oeeSubValue}>
                                        {oee ? `${formatNumberFa(oee.performance.toFixed(1))}٪` : '---'}
                                    </Text>
                                    <Text variant="bodySmall" style={styles.oeeSubLabel}>عملکرد</Text>
                                </View>
                                <View style={styles.oeeCol}>
                                    <Text variant="bodyLarge" style={styles.oeeSubValue}>
                                        {oee ? `${formatNumberFa(oee.quality.toFixed(1))}٪` : '---'}
                                    </Text>
                                    <Text variant="bodySmall" style={styles.oeeSubLabel}>کیفیت</Text>
                                </View>
                            </View>
                        </Card.Content>
                    </Card>

                    {/* ---------- جدول توقفات شیفت ---------- */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>
                                توقفات ثبت‌شده در شیفت جاری ({formatNumberFa(downtimeList.length)})
                            </Text>
                            <Divider style={styles.divider} />

                            {downtimeList.length === 0 ? (
                                <Text variant="bodyMedium" style={styles.emptyText}>
                                    هیچ توقفی در این شیفت ثبت نشده است.
                                </Text>
                            ) : (
                                downtimeList.map((d, idx) => {
                                    const isActive = d.end_time == null;
                                    return (
                                        <View key={d.id}>
                                            <View style={styles.listItemHeader}>
                                                <Chip
                                                    compact={true}
                                                    icon={isActive ? 'alert-octagon' : 'check-circle'}
                                                    style={[
                                                        styles.statusChip,
                                                        { backgroundColor: isActive ? 'rgba(248,113,113,0.16)' : 'rgba(52,211,153,0.16)' },
                                                    ]}
                                                    textStyle={[
                                                        styles.statusChipText,
                                                        { color: isActive ? '#dc2626' : '#059669' },
                                                    ]}
                                                >
                                                    {isActive ? 'فعال' : 'بسته‌شده'}
                                                </Chip>
                                                <Text variant="bodyLarge" style={styles.listItemTitle}>
                                                    {getReasonLabel(d.reason_id)}
                                                </Text>
                                            </View>
                                            <View style={styles.detailRow}>
                                                <Text style={styles.detailValue}>
                                                    {d.start_time ? formatJalaliDateTime(d.start_time) : '-'}
                                                </Text>
                                                <Text style={styles.detailLabel}>شروع:</Text>
                                            </View>
                                            <View style={styles.detailRow}>
                                                <Text style={styles.detailValue}>
                                                    {d.end_time ? formatJalaliDateTime(d.end_time) : 'در حال توقف'}
                                                </Text>
                                                <Text style={styles.detailLabel}>پایان:</Text>
                                            </View>
                                            <View style={styles.detailRow}>
                                                <Text style={styles.detailValue}>
                                                    {d.duration_minutes != null ? `${formatNumberFa(d.duration_minutes)} دقیقه` : '-'}
                                                </Text>
                                                <Text style={styles.detailLabel}>مدت:</Text>
                                            </View>
                                            <View style={styles.detailRow}>
                                                <Text style={styles.detailValue}>
                                                    {d.is_unplanned ? 'اضطراری' : 'برنامه‌ریزی‌شده'}
                                                </Text>
                                                <Text style={styles.detailLabel}>نوع:</Text>
                                            </View>
                                            {idx < downtimeList.length - 1 && <Divider style={styles.itemDivider} />}
                                        </View>
                                    );
                                })
                            )}

                            <Button
                                mode="contained"
                                icon="file-excel-outline"
                                onPress={handleExportExcel}
                                style={styles.exportButton}
                                labelStyle={styles.exportButtonLabel}
                            >
                                خروجی اکسل توقفات 📊
                            </Button>
                        </Card.Content>
                    </Card>

                    <Text style={styles.footerText}>
                        سامانه ردیابی فولاد — مدیریت توقفات خط نورد بر بستر sanatify.db
                    </Text>
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
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 8, color: '#0F172A', lineHeight: 24, writingDirection: 'rtl' },
    divider: { marginBottom: 14 },
    fieldLabel: { textAlign: 'right', writingDirection: 'rtl', fontWeight: 'bold', color: '#475569', marginBottom: 8, lineHeight: 20 },
    menuAnchor: { marginBottom: 14, borderColor: '#94a3b8' },
    menuAnchorContent: { flexDirection: 'row-reverse' },
    switchRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, width: '100%' },
    switchLabel: { fontWeight: 'bold', color: '#0F172A', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1 },
    actionButton: { borderRadius: 8, paddingVertical: 4 },
    actionButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    // ----- توقف فعال -----
    downtimeActiveCard: { borderColor: '#dc2626', borderWidth: 1.5, backgroundColor: '#fff5f5' },
    downtimeAlertHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    downtimeChip: { backgroundColor: '#dc2626' },
    downtimeChipText: { color: '#ffffff', fontWeight: 'bold' },
    liveTimer: { fontWeight: 'bold', color: '#dc2626', fontFamily: 'monospace', fontSize: 32, lineHeight: 40 },
    // ----- OEE -----
    oeeCard: { backgroundColor: '#1e3d59' },
    oeeContent: { alignItems: 'center', paddingVertical: 20 },
    oeeValue: { color: '#ffffff', fontWeight: 'bold', fontSize: 48, lineHeight: 56 },
    oeeTitle: { color: '#ffffff', marginTop: 4, opacity: 0.9, lineHeight: 24, writingDirection: 'rtl' },
    oeeDivider: { width: '80%', backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 14 },
    oeeRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-around' },
    oeeCol: { alignItems: 'center' },
    oeeSubValue: { color: '#ffffff', fontWeight: 'bold', lineHeight: 22 },
    oeeSubLabel: { color: '#ffffff', opacity: 0.8, marginTop: 2, lineHeight: 18 },
    // ----- لیست توقفات -----
    listItemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, width: '100%' },
    listItemTitle: { fontWeight: 'bold', color: '#0F172A', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, marginRight: 8 },
    statusChip: { borderWidth: 0 },
    statusChipText: { fontWeight: 'bold', fontSize: 11 },
    detailRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, width: '100%' },
    detailLabel: { fontSize: 12, color: '#64748B', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, paddingLeft: 8 },
    detailValue: { fontSize: 13, fontWeight: 'bold', color: '#0F172A', textAlign: 'left', flexShrink: 1 },
    itemDivider: { marginVertical: 10 },
    emptyText: { color: '#64748B', textAlign: 'center', lineHeight: 22, paddingVertical: 16 },
    // ----- Export -----
    exportButton: { borderRadius: 8, backgroundColor: '#15803d', marginTop: 12, width: '100%' },
    exportButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    footerText: { marginTop: 8, marginBottom: 16, fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});