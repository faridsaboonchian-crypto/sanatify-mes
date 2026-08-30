import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, Share } from 'react-native';
import {
    Card,
    Text,
    Button,
    TextInput,
    SegmentedButtons,
    useTheme,
    Appbar,
    Divider,
    ActivityIndicator,
    Chip,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    MaterialBalanceService,
    HeatMaterialBalance,
    ShiftMaterialBalance,
    BalanceBreakdownRow,
} from '../services/MaterialBalanceService';
import { formatNumberFa } from '../utils/dateUtils';
import { exportToExcel, ExcelColumn } from '../utils/excelExport';

// آستانه‌های راندمان وزنی (درصد)
const YIELD_EXCELLENT = 96;
const YIELD_WARNING = 92;

type Mode = 'heat' | 'shift';
type ShiftSel = 'shift-morning-301' | 'shift-night-302' | 'all';

interface DisplayBalance {
    scopeLabel: string;
    input_weight_kg: number;
    output_weight_kg: number;
    scrap_weight_kg: number;
    scale_loss_kg: number;
    yield_rate_percent: number;
    scrap_rate_percent: number;
    scale_loss_percent: number;
    bundle_count: number;
    scrap_piece_count: number;
    estimated_unit_weight_kg: number;
    billet_count?: number;
}

// تبدیل وزن به تن/کیلوگرم با ارقام فارسی
const formatWeight = (kg: number): string => {
    if (kg >= 1000) {
        return `${formatNumberFa((kg / 1000).toFixed(3))} تن`;
    }
    return `${formatNumberFa(kg.toFixed(1))} کیلوگرم`;
};

// رنگ و برچسب وضعیت راندمان وزنی
const getYieldStatus = (
    yieldRate: number
): { color: string; bg: string; label: string; icon: string } => {
    if (yieldRate >= YIELD_EXCELLENT) {
        return { color: '#059669', bg: 'rgba(52, 211, 153, 0.16)', label: 'عالی', icon: 'check-decagram' };
    }
    if (yieldRate >= YIELD_WARNING) {
        return { color: '#d97706', bg: 'rgba(251, 191, 36, 0.16)', label: 'هشدار', icon: 'alert' };
    }
    return { color: '#dc2626', bg: 'rgba(248, 113, 113, 0.16)', label: 'بحرانی - پرت بالا', icon: 'alert-octagram' };
};

export default function MaterialBalanceScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    const [mode, setMode] = useState<Mode>('heat');
    const [heatInput, setHeatInput] = useState<string>('');
    const [shiftSel, setShiftSel] = useState<ShiftSel>('all');
    const [dateInput, setDateInput] = useState<string>('');

    const [loading, setLoading] = useState<boolean>(false);
    const [hasCalculated, setHasCalculated] = useState<boolean>(false);
    const [balance, setBalance] = useState<DisplayBalance | null>(null);
    const [breakdown, setBreakdown] = useState<BalanceBreakdownRow[]>([]);

    const getShiftLabel = (sel: ShiftSel): string => {
        if (sel === 'shift-morning-301') return 'شیفت صبح';
        if (sel === 'shift-night-302') return 'شیفت شب';
        return 'همهٔ شیفت‌ها';
    };

    const handleCalculate = async () => {
        try {
            setLoading(true);
            setHasCalculated(true);

            if (mode === 'heat') {
                const heat = heatInput.trim();
                if (!heat) {
                    Alert.alert('خطا در ورود داده', 'لطفاً شماره ذوب را وارد کنید.');
                    setLoading(false);
                    return;
                }
                const res: HeatMaterialBalance =
                    await MaterialBalanceService.calculateHeatMaterialBalance(heat);
                setBalance({
                    scopeLabel: `شماره ذوب ${res.heat_number}`,
                    input_weight_kg: res.input_weight_kg,
                    output_weight_kg: res.output_weight_kg,
                    scrap_weight_kg: res.scrap_weight_kg,
                    scale_loss_kg: res.scale_loss_kg,
                    yield_rate_percent: res.yield_rate_percent,
                    scrap_rate_percent: res.scrap_rate_percent,
                    scale_loss_percent: res.scale_loss_percent,
                    bundle_count: res.bundle_count,
                    scrap_piece_count: res.scrap_piece_count,
                    estimated_unit_weight_kg: res.estimated_unit_weight_kg,
                    billet_count: res.billet_count,
                });
                setBreakdown(MaterialBalanceService.buildBreakdown(res));
            } else {
                const d = dateInput.trim();
                const s = shiftSel === 'all' ? undefined : shiftSel;
                const res: ShiftMaterialBalance =
                    await MaterialBalanceService.getShiftMaterialBalance(d ? undefined : s, d ? d : undefined);
                setBalance({
                    scopeLabel: res.scope_label,
                    input_weight_kg: res.input_weight_kg,
                    output_weight_kg: res.output_weight_kg,
                    scrap_weight_kg: res.scrap_weight_kg,
                    scale_loss_kg: res.scale_loss_kg,
                    yield_rate_percent: res.yield_rate_percent,
                    scrap_rate_percent: res.scrap_rate_percent,
                    scale_loss_percent: res.scale_loss_percent,
                    bundle_count: res.bundle_count,
                    scrap_piece_count: res.scrap_piece_count,
                    estimated_unit_weight_kg: res.estimated_unit_weight_kg,
                });
                setBreakdown(MaterialBalanceService.buildBreakdown(res));
            }
        } catch (error: any) {
            console.error('[MaterialBalanceScreen] calculate failed:', error);
            Alert.alert('خطا در محاسبه بالانس', error?.message || 'عملیات محاسبه ناموفق بود.');
        } finally {
            setLoading(false);
        }
    };

    const handleShare = async () => {
        if (!balance) return;
        const b = balance;
        const message =
            `⚖ گزارش بالانس مواد و راندمان وزنی\n` +
            `📌 محدوده: ${b.scopeLabel}\n` +
            `📥 شمش ورودی: ${formatWeight(b.input_weight_kg)}\n` +
            `📦 بندیل سالم: ${formatWeight(b.output_weight_kg)} (${formatNumberFa(b.yield_rate_percent)}٪)\n` +
            `🗑 ضایعات قیچی/پرت: ${formatWeight(b.scrap_weight_kg)} (${formatNumberFa(b.scrap_piece_count)} قطعه - ${formatNumberFa(b.scrap_rate_percent)}٪)\n` +
            `🔥 افت کوره/پوسته: ${formatWeight(b.scale_loss_kg)} (${formatNumberFa(b.scale_loss_percent)}٪)\n` +
            `🎯 راندمان وزنی (Yield): ${formatNumberFa(b.yield_rate_percent)}٪\n` +
            `ℹ وزن واحد تخمینی ضایعات: ${formatNumberFa(b.estimated_unit_weight_kg)} kg`;
        try {
            await Share.share({ message });
        } catch (e) {
            console.warn('[MaterialBalanceScreen] share failed:', e);
        }
    };

    // ---------- خروجی اکسل (افزوده‌شده) ----------
    const handleExportExcel = async () => {
        if (!balance) {
            Alert.alert('خطا', 'ابتدا یک بالانس محاسبه کنید.');
            return;
        }
        try {
            const columns: ExcelColumn[] = [
                { label: 'شرح آیتم', key: 'label' },
                { label: 'وزن (کیلوگرم)', key: 'weight_kg' },
                { label: 'درصد از شمش ورودی', key: 'percent' },
            ];
            const rows: any[] = breakdown.map((r) => ({
                label: r.label,
                weight_kg: r.weight_kg,
                percent: `${r.percent}٪`,
            }));
            // ردیف‌های خلاصهٔ شاخص‌های کلیدی
            rows.push({ label: '─── شاخص‌های کلیدی ───', weight_kg: '', percent: '' });
            rows.push({ label: 'راندمان وزنی (Yield)', weight_kg: balance.output_weight_kg, percent: `${balance.yield_rate_percent}٪` });
            rows.push({ label: 'نرخ ضایعات', weight_kg: balance.scrap_weight_kg, percent: `${balance.scrap_rate_percent}٪` });
            rows.push({ label: 'نرخ افت کوره', weight_kg: balance.scale_loss_kg, percent: `${balance.scale_loss_percent}٪` });
            rows.push({ label: 'تعداد بندیل', weight_kg: balance.bundle_count, percent: '' });
            rows.push({ label: 'تعداد قطعات ضایعاتی', weight_kg: balance.scrap_piece_count, percent: '' });
            rows.push({ label: 'وزن واحد تخمینی ضایعات (kg)', weight_kg: balance.estimated_unit_weight_kg, percent: '' });

            await exportToExcel(
                `بالانس_مواد_${balance.scopeLabel.replace(/\s+/g, '_')}`,
                columns,
                rows,
                `گزارش بالانس مواد و راندمان وزنی — ${balance.scopeLabel}`
            );
            Alert.alert('موفق', 'فایل خروجی اکسل آمادهٔ اشتراک‌گذاری/ذخیره شد.');
        } catch (e: any) {
            console.error('[MaterialBalanceScreen] export failed:', e);
            Alert.alert('خطا در خروجی اکسل', e?.message || 'عملیات خروجی ناموفق بود.');
        }
    };

    // ---------- کارت شاخص کلیدی ----------
    const renderKpiCard = (
        title: string,
        valueKg: number,
        extra: string | null,
        accent: string,
        icon: string
    ) => (
        <View style={styles.kpiWrap}>
            <Card style={[styles.kpiCard, { borderTopColor: accent }]} mode="elevated">
                <Card.Content style={styles.kpiContent}>
                    <View style={[styles.kpiIconDot, { backgroundColor: accent }]} />
                    <Text variant="bodySmall" style={styles.kpiTitle}>{title}</Text>
                    <Text variant="titleMedium" style={[styles.kpiValue, { color: accent }]}>
                        {formatWeight(valueKg)}
                    </Text>
                    {extra ? <Text variant="bodySmall" style={styles.kpiExtra}>{extra}</Text> : null}
                </Card.Content>
            </Card>
        </View>
    );

    // ---------- گیج راندمان وزنی ----------
    const renderYieldGauge = () => {
        if (!balance) return null;
        const status = getYieldStatus(balance.yield_rate_percent);
        const clamped = Math.max(0, Math.min(100, balance.yield_rate_percent));
        return (
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <View style={styles.gaugeHeader}>
                        <Chip
                            icon={status.icon}
                            style={[styles.gaugeChip, { backgroundColor: status.bg }]}
                            textStyle={[styles.gaugeChipText, { color: status.color }]}
                        >
                            وضعیت راندمان: {status.label}
                        </Chip>
                        <Text variant="headlineMedium" style={[styles.gaugeValue, { color: status.color }]}>
                            {formatNumberFa(balance.yield_rate_percent)}٪
                        </Text>
                    </View>
                    <Text variant="bodySmall" style={styles.gaugeCaption}>
                        راندمان وزنی (Yield Rate) — نسبت وزن بندیل سالم به شمش ورودی
                    </Text>
                    <View style={styles.gaugeTrack}>
                        <View
                            style={[
                                styles.gaugeFill,
                                { width: `${clamped}%`, backgroundColor: status.color },
                            ]}
                        />
                    </View>
                    <View style={styles.gaugeLegendRow}>
                        <Text style={[styles.gaugeLegend, { color: '#dc2626' }]}>بحرانی &lt;۹۲</Text>
                        <Text style={[styles.gaugeLegend, { color: '#d97706' }]}>هشدار ۹۲-۹۶</Text>
                        <Text style={[styles.gaugeLegend, { color: '#059669' }]}>عالی ≥۹۶</Text>
                    </View>
                </Card.Content>
            </Card>
        );
    };

    // ---------- جدول تفکیکی ----------
    const renderBreakdown = () => {
        if (!balance || breakdown.length === 0) return null;
        return (
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        جدول تفکیکی بالانس مواد
                    </Text>
                    <Divider style={styles.divider} />
                    {breakdown.map((row, idx) => {
                        const accent =
                            row.kind === 'input'
                                ? '#1e3d59'
                                : row.kind === 'output'
                                    ? '#059669'
                                    : row.kind === 'scrap'
                                        ? '#dc2626'
                                        : '#d97706';
                        return (
                            <View key={idx}>
                                <View style={styles.breakRow}>
                                    <View style={[styles.breakDot, { backgroundColor: accent }]} />
                                    <Text style={styles.breakLabel}>{row.label}</Text>
                                </View>
                                <View style={styles.breakValues}>
                                    <Text style={[styles.breakPercent, { color: accent }]}>
                                        {formatNumberFa(row.percent)}٪
                                    </Text>
                                    <Text style={styles.breakWeight}>{formatWeight(row.weight_kg)}</Text>
                                </View>
                                <View style={styles.breakTrack}>
                                    <View
                                        style={[
                                            styles.breakFill,
                                            { width: `${Math.max(0, Math.min(100, row.percent))}%`, backgroundColor: accent },
                                        ]}
                                    />
                                </View>
                                {idx < breakdown.length - 1 && <Divider style={styles.breakDivider} />}
                            </View>
                        );
                    })}
                    <Text variant="bodySmall" style={styles.noteText}>
                        ℹ وزن ضایعات بر اساس {formatNumberFa(balance.estimated_unit_weight_kg)} کیلوگرم به ازای هر قطعه
                        تخمین زده شده است (میانگین وزن شاخهٔ بندیل یا ثابت صنعتی).
                    </Text>
                </Card.Content>
            </Card>
        );
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content
                        title="بالانس مواد و راندمان وزنی"
                        color="#ffffff"
                        titleStyle={styles.headerTitle}
                    />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>
                    {/* ---------- فیلتر ---------- */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>
                                انتخاب محدودهٔ محاسبه بالانس
                            </Text>
                            <Divider style={styles.divider} />
                            <SegmentedButtons
                                value={mode}
                                onValueChange={(v) => setMode(v as Mode)}
                                buttons={[
                                    { value: 'heat', label: 'بر اساس ذوب', icon: 'fire' },
                                    { value: 'shift', label: 'بر اساس شیفت', icon: 'clock-outline' },
                                ]}
                                style={styles.segmented}
                            />

                            {mode === 'heat' ? (
                                <TextInput
                                    label="شماره ذوب (Heat Number)"
                                    mode="outlined"
                                    value={heatInput}
                                    onChangeText={setHeatInput}
                                    style={styles.input}
                                    left={<TextInput.Icon icon="fire-circle" />}
                                    placeholder="مثال: H-2026-07-0145"
                                />
                            ) : (
                                <>
                                    <Text variant="bodyMedium" style={styles.fieldLabel}>شیفت کاری:</Text>
                                    <SegmentedButtons
                                        value={shiftSel}
                                        onValueChange={(v) => setShiftSel(v as ShiftSel)}
                                        buttons={[
                                            { value: 'shift-morning-301', label: 'صبح' },
                                            { value: 'shift-night-302', label: 'شب' },
                                            { value: 'all', label: 'همه' },
                                        ]}
                                        style={styles.segmented}
                                    />
                                    <TextInput
                                        label="تاریخ میلادی (اختیاری - اولویت با تاریخ: YYYY-MM-DD)"
                                        mode="outlined"
                                        value={dateInput}
                                        onChangeText={setDateInput}
                                        style={styles.input}
                                        left={<TextInput.Icon icon="calendar" />}
                                        placeholder="مثال: 2026-07-24"
                                    />
                                </>
                            )}

                            <Button
                                mode="contained"
                                icon="scale-balance"
                                onPress={handleCalculate}
                                loading={loading}
                                disabled={loading}
                                style={styles.calcButton}
                                labelStyle={styles.calcButtonLabel}
                            >
                                محاسبه بالانس مواد
                            </Button>
                        </Card.Content>
                    </Card>

                    {loading && (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content style={styles.loadingWrap}>
                                <ActivityIndicator size="large" color={theme.colors.primary} />
                                <Text variant="bodyMedium" style={styles.loadingText}>
                                    در حال محاسبهٔ بالانس وزنی و راندمان...
                                </Text>
                            </Card.Content>
                        </Card>
                    )}

                    {!loading && hasCalculated && balance && balance.input_weight_kg <= 0 && (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content style={styles.emptyWrap}>
                                <Text variant="bodyMedium" style={styles.emptyText}>
                                    برای محدودهٔ «{balance.scopeLabel}» هیچ شمش ورودی ثبت نشده است.
                                </Text>
                            </Card.Content>
                        </Card>
                    )}

                    {!loading && balance && balance.input_weight_kg > 0 && (
                        <>
                            <Text variant="bodySmall" style={styles.scopeText}>
                                محدودهٔ گزارش: {balance.scopeLabel}
                            </Text>

                            {/* ---------- KPI ها ---------- */}
                            <View style={styles.kpiGrid}>
                                {renderKpiCard('شمش ورودی', balance.input_weight_kg, balance.billet_count != null ? `${formatNumberFa(balance.billet_count)} شمش` : null, '#1e3d59', 'cube-outline')}
                                {renderKpiCard('بندیل سالم', balance.output_weight_kg, `${formatNumberFa(balance.bundle_count)} بندیل`, '#059669', 'package-variant-closed')}
                                {renderKpiCard('ضایعات قیچی/پرت', balance.scrap_weight_kg, `${formatNumberFa(balance.scrap_piece_count)} قطعه`, '#dc2626', 'content-cut')}
                                {renderKpiCard('افت کوره/پوسته', balance.scale_loss_kg, 'محاسباتی', '#d97706', 'fire-alert')}
                            </View>

                            {renderYieldGauge()}
                            {renderBreakdown()}

                            <Button
                                mode="outlined"
                                icon="share-variant"
                                onPress={handleShare}
                                style={styles.shareButton}
                            >
                                اشتراک‌گذاری / گزارش‌گیری بالانس
                            </Button>

                            <Button
                                mode="contained"
                                icon="file-excel-outline"
                                onPress={handleExportExcel}
                                style={styles.exportButton}
                                labelStyle={styles.exportButtonLabel}
                            >
                                خروجی اکسل 📊
                            </Button>
                        </>
                    )}

                    {!loading && !hasCalculated && (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content style={styles.emptyWrap}>
                                <Text variant="bodyMedium" style={styles.emptyText}>
                                    یک شماره ذوب یا شیفت انتخاب و دکمهٔ محاسبه را بزنید تا کارنامهٔ بالانس وزنی و
                                    راندمان تولید نمایش داده شود.
                                </Text>
                            </Card.Content>
                        </Card>
                    )}

                    <Text style={styles.footerText}>
                        سامانه ردیابی فولاد — بالانس مواد آفلاین بر بستر sanatify.db
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
    card: { width: '100%', maxWidth: 480, borderRadius: 12, marginBottom: 16, backgroundColor: '#ffffff' },
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 8, color: '#0F172A', lineHeight: 24, writingDirection: 'rtl' },
    divider: { marginBottom: 14 },
    segmented: { marginBottom: 14 },
    input: { marginBottom: 14, textAlign: 'right' },
    fieldLabel: { textAlign: 'right', writingDirection: 'rtl', fontWeight: 'bold', color: '#475569', marginBottom: 8, lineHeight: 20 },
    calcButton: { borderRadius: 8, paddingVertical: 4, backgroundColor: '#1e3d59' },
    calcButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    loadingWrap: { alignItems: 'center', paddingVertical: 24 },
    loadingText: { marginTop: 12, color: '#64748B', textAlign: 'center' },
    emptyWrap: { alignItems: 'center', paddingVertical: 24 },
    emptyText: { color: '#64748B', textAlign: 'center', lineHeight: 22 },
    scopeText: { width: '100%', maxWidth: 480, textAlign: 'right', writingDirection: 'rtl', color: '#475569', fontWeight: 'bold', marginBottom: 10, lineHeight: 20 },
    // ----- KPI -----
    kpiGrid: { width: '100%', maxWidth: 480, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    kpiWrap: { width: '48%', marginBottom: 12 },
    kpiCard: { borderRadius: 12, borderTopWidth: 4, backgroundColor: '#ffffff' },
    kpiContent: { alignItems: 'center', paddingVertical: 10 },
    kpiIconDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 8 },
    kpiTitle: { color: '#64748B', textAlign: 'center', lineHeight: 18, marginBottom: 4 },
    kpiValue: { fontWeight: 'bold', textAlign: 'center', lineHeight: 24 },
    kpiExtra: { color: '#94A3B8', marginTop: 4, textAlign: 'center' },
    // ----- Gauge -----
    gaugeHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    gaugeChip: { borderWidth: 0 },
    gaugeChipText: { fontWeight: 'bold', fontSize: 12 },
    gaugeValue: { fontWeight: 'bold', lineHeight: 40 },
    gaugeCaption: { color: '#64748B', textAlign: 'right', writingDirection: 'rtl', marginTop: 8, lineHeight: 18 },
    gaugeTrack: { height: 14, borderRadius: 7, backgroundColor: '#e2e8f0', marginTop: 12, overflow: 'hidden' },
    gaugeFill: { height: 14, borderRadius: 7 },
    gaugeLegendRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, width: '100%' },
    gaugeLegend: { fontSize: 11, fontWeight: 'bold' },
    // ----- Breakdown -----
    breakRow: { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 4 },
    breakDot: { width: 10, height: 10, borderRadius: 5, marginLeft: 8 },
    breakLabel: { fontWeight: 'bold', color: '#0F172A', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, lineHeight: 20 },
    breakValues: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, width: '100%' },
    breakPercent: { fontWeight: 'bold', fontSize: 15 },
    breakWeight: { fontWeight: 'bold', color: '#334155', fontSize: 13 },
    breakTrack: { height: 8, borderRadius: 4, backgroundColor: '#e2e8f0', overflow: 'hidden', marginBottom: 4 },
    breakFill: { height: 8, borderRadius: 4 },
    breakDivider: { marginVertical: 10 },
    noteText: { color: '#94A3B8', textAlign: 'right', writingDirection: 'rtl', marginTop: 10, lineHeight: 18 },
    shareButton: { borderRadius: 8, borderColor: '#1e3d59', marginBottom: 8, width: '100%', maxWidth: 480 },
    // ----- Export (افزوده‌شده) -----
    exportButton: { borderRadius: 8, backgroundColor: '#15803d', marginBottom: 8, width: '100%', maxWidth: 480 },
    exportButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    footerText: { marginTop: 8, marginBottom: 16, fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});