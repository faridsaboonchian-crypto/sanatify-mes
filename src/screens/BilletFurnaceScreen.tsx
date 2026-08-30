import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import {
    Card,
    Text,
    Button,
    TextInput,
    SegmentedButtons,
    DataTable,
    FAB,
    Chip,
    Snackbar,
    Divider,
    ActivityIndicator,
    useTheme,
    Appbar,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    TraceabilityService,
    BilletRow,
    FurnaceActiveBillet,
} from '../services/TraceabilityService';
import { getDatabase } from '../database/Database';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';

// آستانهٔ هشدار پوسته‌سازی فولاد در کوره پیش‌گرم (به دقیقه)
const FURNACE_SCALE_RISK_MINUTES = 90;
// بازهٔ بروزرسانی زندهٔ زمان ماندگاری کوره (به میلی‌ثانیه)
const LIVE_TICK_INTERVAL_MS = 30000;

type TabKey = 'yard' | 'furnace';

interface EnrichedFurnaceRow extends FurnaceActiveBillet {
    residenceMinutes: number;
    danger: boolean;
}

export default function BilletFurnaceScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    // ---------- وضعیت تب‌ها ----------
    const [activeTab, setActiveTab] = useState<TabKey>('yard');

    // ---------- فیلدهای فرم ثبت شمش ----------
    const [heatNumber, setHeatNumber] = useState('');
    const [dimensions, setDimensions] = useState('');
    const [grade, setGrade] = useState('');
    const [supplier, setSupplier] = useState('');
    const [weight, setWeight] = useState('');
    const [batch, setBatch] = useState('');

    // ---------- وضعیت‌های بارگذاری و عملیات ----------
    const [registering, setRegistering] = useState(false);
    const [yardLoading, setYardLoading] = useState(false);
    const [furnaceLoading, setFurnaceLoading] = useState(false);
    const [chargingId, setChargingId] = useState<string | null>(null);
    const [dischargingId, setDischargingId] = useState<string | null>(null);

    // ---------- داده‌ها ----------
    const [yardBillets, setYardBillets] = useState<BilletRow[]>([]);
    const [furnaceActive, setFurnaceActive] = useState<FurnaceActiveBillet[]>([]);

    // تیک زنده برای محاسبهٔ بلادرنگ زمان ماندگاری کوره
    const [tick, setTick] = useState(0);

    // ---------- Snackbar ----------
    const [snack, setSnack] = useState<{ visible: boolean; message: string }>({
        visible: false,
        message: '',
    });
    const showSnack = (message: string) => setSnack({ visible: true, message });
    const hideSnack = () => setSnack((s) => ({ ...s, visible: false }));

    // ---------- محاسبهٔ زندهٔ ردیف‌های کوره (وابسته به tick) ----------
    const furnaceRows = useMemo<EnrichedFurnaceRow[]>(() => {
        const now = Date.now();
        return furnaceActive.map((item) => {
            const chargeMs = new Date(item.charge_time).getTime();
            const minutes =
                isNaN(chargeMs) || now < chargeMs
                    ? 0
                    : Math.floor((now - chargeMs) / 60000);
            return {
                ...item,
                residenceMinutes: minutes,
                danger: minutes > FURNACE_SCALE_RISK_MINUTES,
            };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [furnaceActive, tick]);

    // ---------- بارگذاری لیست انبار (وضعیت IN_YARD) ----------
    const loadYard = async () => {
        try {
            setYardLoading(true);
            const db = await getDatabase();
            // TraceabilityService متد لیست انبار ندارد؛ لذا خواندن فقط‌خواندنی
            // شمش‌های موجود در حیاط مستقیماً از لایهٔ دیتابیس انجام می‌شود.
            const rows = await db.getAllAsync<BilletRow>(
                `SELECT * FROM billets WHERE status = 'IN_YARD' ORDER BY received_at DESC, created_at DESC;`
            );
            setYardBillets(rows ?? []);
        } catch (e: any) {
            console.warn('[BilletFurnace] loadYard failed:', e);
            Alert.alert('خطا در بارگذاری انبار', e?.message || 'امکان خواندن لیست شمش‌ها وجود ندارد.');
        } finally {
            setYardLoading(false);
        }
    };

    // ---------- بارگذاری شمش‌های فعال داخل کوره ----------
    const loadFurnace = async (silent: boolean = false) => {
        try {
            if (!silent) setFurnaceLoading(true);
            const rows = await TraceabilityService.getFurnaceCurrentStatus();
            setFurnaceActive(rows ?? []);
        } catch (e: any) {
            console.warn('[BilletFurnace] loadFurnace failed:', e);
            if (!silent) {
                Alert.alert('خطا در مانیتورینگ کوره', e?.message || 'امکان خواندن وضعیت کوره وجود ندارد.');
            }
        } finally {
            if (!silent) setFurnaceLoading(false);
        }
    };

    // ---------- بارگذاری اولیه ----------
    useEffect(() => {
        loadYard();
        loadFurnace(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ---------- تیک زنده فقط هنگام حضور در تب کوره ----------
    useEffect(() => {
        if (activeTab !== 'furnace') return;
        const id = setInterval(() => setTick((t) => t + 1), LIVE_TICK_INTERVAL_MS);
        return () => clearInterval(id);
    }, [activeTab]);

    // ---------- تغییر تب همراه با بروزرسانی داده ----------
    const handleTabChange = (value: string) => {
        const next = value as TabKey;
        setActiveTab(next);
        if (next === 'yard') loadYard();
        else loadFurnace(true);
    };

    // ---------- ثبت شمش جدید در انبار ----------
    const handleRegisterBillet = async () => {
        const heat = heatNumber.trim();
        if (!heat) {
            Alert.alert('ورودی نامعتبر', 'شماره ذوب (Heat Number) الزامی است.');
            return;
        }
        const parsedWeight = parseFloat(weight);
        try {
            setRegistering(true);
            await TraceabilityService.registerBilletBatch({
                heat_number: heat,
                dimensions: dimensions.trim() || undefined,
                grade: grade.trim() || undefined,
                supplier_name: supplier.trim() || undefined,
                batch_number: batch.trim() || undefined,
                initial_weight_kg: isNaN(parsedWeight) ? undefined : parsedWeight,
                received_at: new Date().toISOString(),
            });
            showSnack(`شمش ذوب ${heat} با موفقیت در انبار ثبت شد.`);
            setHeatNumber('');
            setDimensions('');
            setGrade('');
            setSupplier('');
            setWeight('');
            setBatch('');
            await loadYard();
        } catch (e: any) {
            console.error('[BilletFurnace] registerBillet failed:', e);
            Alert.alert('خطا در ثبت شمش', e?.message || 'عملیات ثبت شمش ناموفق بود.');
        } finally {
            setRegistering(false);
        }
    };

    // ---------- شارژ شمش از انبار به کوره ----------
    const doCharge = async (billet: BilletRow) => {
        try {
            setChargingId(billet.id);
            await TraceabilityService.chargeBilletToFurnace(billet.id, {});
            showSnack(`شمش ذوب ${billet.heat_number} به کوره پیش‌گرم شارژ شد.`);
            await loadYard();
            await loadFurnace(true);
        } catch (e: any) {
            console.error('[BilletFurnace] charge failed:', e);
            Alert.alert('خطا در شارژ کوره', e?.message || 'انتقال شمش به کوره ناموفق بود.');
        } finally {
            setChargingId(null);
        }
    };

    const handleCharge = (billet: BilletRow) => {
        Alert.alert(
            'شارژ به کوره پیش‌گرم',
            `آیا شمش با شماره ذوب «${billet.heat_number}» به کوره منتقل شود؟`,
            [
                { text: 'انصراف', style: 'cancel' },
                { text: 'شارژ', onPress: () => doCharge(billet) },
            ]
        );
    };

    // ---------- تخلیه شمش از کوره ----------
    const doDischarge = async (row: EnrichedFurnaceRow) => {
        try {
            setDischargingId(row.furnace_log_id);
            const residence = await TraceabilityService.dischargeBilletFromFurnace(
                row.furnace_log_id
            );
            showSnack(
                `شمش ذوب ${row.heat_number} پس از ${formatNumberFa(residence)} دقیقه از کوره تخلیه شد.`
            );
            await loadFurnace(false);
        } catch (e: any) {
            console.error('[BilletFurnace] discharge failed:', e);
            Alert.alert('خطا در تخلیه کوره', e?.message || 'تخلیه شمش از کوره ناموفق بود.');
        } finally {
            setDischargingId(null);
        }
    };

    const handleDischarge = (row: EnrichedFurnaceRow) => {
        Alert.alert(
            'تخلیه از کوره',
            `آیا شمش ذوب «${row.heat_number}» از کوره خارج و ثبت پایان پیش‌گرم شود؟`,
            [
                { text: 'انصراف', style: 'cancel' },
                { text: 'تخلیه', onPress: () => doDischarge(row) },
            ]
        );
    };

    // ---------- بروزرسانی دستی (FAB) ----------
    const handleRefreshAll = () => {
        loadYard();
        loadFurnace(true);
        showSnack('داده‌ها بروزرسانی شد.');
    };

    const handleGoBack = () => {
        try {
            if (navigation && navigation.canGoBack()) navigation.goBack();
            else navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        } catch (e) {
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        }
    };

    // ===================== رندر تب انبار =====================
    const renderYardTab = () => (
        <View style={styles.tabContent}>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        ثبت ورود شمش جدید به انبار
                    </Text>
                    <Divider style={styles.divider} />
                    <TextInput
                        label="شماره ذوب (Heat Number) *"
                        mode="outlined"
                        value={heatNumber}
                        onChangeText={setHeatNumber}
                        style={styles.input}
                        left={<TextInput.Icon icon="fire-circle" />}
                        placeholder="مثال: H-2026-07-0145"
                    />
                    <TextInput
                        label="ابعاد شمش (مثال: 125x125)"
                        mode="outlined"
                        value={dimensions}
                        onChangeText={setDimensions}
                        style={styles.input}
                        left={<TextInput.Icon icon="ruler-square" />}
                    />
                    <TextInput
                        label="گرید فولاد (مثال: 3SP / 5SP)"
                        mode="outlined"
                        value={grade}
                        onChangeText={setGrade}
                        style={styles.input}
                        left={<TextInput.Icon icon="alpha-g-circle-outline" />}
                    />
                    <TextInput
                        label="نام تامین‌کننده"
                        mode="outlined"
                        value={supplier}
                        onChangeText={setSupplier}
                        style={styles.input}
                        left={<TextInput.Icon icon="truck-delivery-outline" />}
                    />
                    <TextInput
                        label="وزن اولیه (کیلوگرم)"
                        mode="outlined"
                        value={weight}
                        onChangeText={setWeight}
                        keyboardType="numeric"
                        style={styles.input}
                        left={<TextInput.Icon icon="weight-kilogram" />}
                    />
                    <TextInput
                        label="شماره پارت / بچ (اختیاری)"
                        mode="outlined"
                        value={batch}
                        onChangeText={setBatch}
                        style={styles.input}
                        left={<TextInput.Icon icon="barcode" />}
                    />
                    <Button
                        mode="contained"
                        icon="warehouse-plus"
                        loading={registering}
                        disabled={registering}
                        onPress={handleRegisterBillet}
                        style={styles.primaryButton}
                        labelStyle={styles.buttonLabel}
                    >
                        ثبت شمش در انبار
                    </Button>
                </Card.Content>
            </Card>

            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        شمش‌های موجود در انبار (وضعیت IN_YARD)
                    </Text>
                    <Divider style={styles.divider} />
                    {yardLoading && yardBillets.length === 0 ? (
                        <View style={styles.loadingWrap}>
                            <ActivityIndicator size="large" color={theme.colors.primary} />
                            <Text variant="bodySmall" style={styles.loadingText}>
                                در حال خواندن موجودی انبار...
                            </Text>
                        </View>
                    ) : yardBillets.length === 0 ? (
                        <View style={styles.emptyWrap}>
                            <Text variant="bodyMedium" style={styles.emptyText}>
                                هیچ شمش فعالی در انبار ثبت نشده است.
                            </Text>
                        </View>
                    ) : (
                        <ScrollView horizontal showsHorizontalScrollIndicator={true}>
                            <DataTable>
                                <DataTable.Header>
                                    <DataTable.Title style={styles.dtTitle}>شماره ذوب</DataTable.Title>
                                    <DataTable.Title style={styles.dtTitle}>گرید</DataTable.Title>
                                    <DataTable.Title style={styles.dtTitle}>ابعاد</DataTable.Title>
                                    <DataTable.Title style={styles.dtTitle} numeric>
                                        وزن (kg)
                                    </DataTable.Title>
                                    <DataTable.Title style={styles.dtTitle}>عملیات</DataTable.Title>
                                </DataTable.Header>
                                {yardBillets.map((b) => (
                                    <DataTable.Row key={b.id}>
                                        <DataTable.Cell style={styles.dtCell}>
                                            {b.heat_number}
                                        </DataTable.Cell>
                                        <DataTable.Cell style={styles.dtCell}>
                                            {b.grade ?? '-'}
                                        </DataTable.Cell>
                                        <DataTable.Cell style={styles.dtCell}>
                                            {b.dimensions ?? '-'}
                                        </DataTable.Cell>
                                        <DataTable.Cell style={styles.dtCell} numeric>
                                            {b.initial_weight_kg != null
                                                ? formatNumberFa(b.initial_weight_kg)
                                                : '-'}
                                        </DataTable.Cell>
                                        <DataTable.Cell style={styles.dtCell}>
                                            <Button
                                                compact={true}
                                                mode="contained-tonal"
                                                loading={chargingId === b.id}
                                                disabled={chargingId !== null}
                                                onPress={() => handleCharge(b)}
                                            >
                                                شارژ
                                            </Button>
                                        </DataTable.Cell>
                                    </DataTable.Row>
                                ))}
                            </DataTable>
                        </ScrollView>
                    )}
                </Card.Content>
            </Card>
        </View>
    );

    // ===================== رندر تب کوره =====================
    const renderFurnaceTab = () => (
        <View style={styles.tabContent}>
            <Card style={[styles.card, styles.furnaceHeaderCard]} mode="elevated">
                <Card.Content>
                    <View style={styles.furnaceHeaderRow}>
                        <Chip
                            icon="fire"
                            style={styles.furnaceStatusChip}
                            textStyle={styles.furnaceStatusChipText}
                        >
                            شمش‌های فعال داخل کوره: {formatNumberFa(furnaceRows.length)}
                        </Chip>
                        <Chip
                            icon="alert-decagram"
                            style={styles.riskLegendChip}
                            textStyle={styles.riskLegendChipText}
                        >
                            آستانهٔ خطر پوسته‌سازی: بیش از {formatNumberFa(FURNACE_SCALE_RISK_MINUTES)} دقیقه
                        </Chip>
                    </View>
                </Card.Content>
            </Card>

            {furnaceLoading && furnaceRows.length === 0 ? (
                <Card style={styles.card} mode="elevated">
                    <Card.Content style={styles.loadingWrap}>
                        <ActivityIndicator size="large" color={theme.colors.primary} />
                        <Text variant="bodySmall" style={styles.loadingText}>
                            در حال پایش لحظه‌ای کوره پیش‌گرم...
                        </Text>
                    </Card.Content>
                </Card>
            ) : furnaceRows.length === 0 ? (
                <Card style={styles.card} mode="elevated">
                    <Card.Content style={styles.emptyWrap}>
                        <Text variant="bodyMedium" style={styles.emptyText}>
                            کوره پیش‌گرم در حال حاضر خالی است. از تب انبار یک شمش شارژ کنید.
                        </Text>
                    </Card.Content>
                </Card>
            ) : (
                furnaceRows.map((row) => (
                    <Card
                        key={row.furnace_log_id}
                        style={[styles.card, styles.furnaceCard, row.danger && styles.furnaceCardDanger]}
                        mode="elevated"
                    >
                        <Card.Content>
                            <View style={styles.furnaceRowHeader}>
                                <Text variant="titleMedium" style={styles.furnaceHeat}>
                                    ذوب {row.heat_number}
                                </Text>
                                {row.danger ? (
                                    <Chip
                                        icon="alert-octagram"
                                        style={styles.dangerChip}
                                        textStyle={styles.dangerChipText}
                                    >
                                        خطر پوسته‌سازی
                                    </Chip>
                                ) : (
                                    <Chip
                                        icon="fire-circle"
                                        style={styles.safeChip}
                                        textStyle={styles.safeChipText}
                                    >
                                        در حال پیش‌گرم
                                    </Chip>
                                )}
                            </View>
                            <Divider style={styles.divider} />
                            <View style={styles.metricRow}>
                                <Text
                                    variant="bodyLarge"
                                    style={[styles.metricValue, row.danger && styles.dangerText]}
                                >
                                    {formatNumberFa(row.residenceMinutes)} دقیقه
                                </Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>
                                    زمان ماندگاری در کوره:
                                </Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={styles.metricValue}>
                                    {row.furnace_temperature_celsius != null
                                        ? `${formatNumberFa(row.furnace_temperature_celsius)} °C`
                                        : '---'}
                                </Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>
                                    دمای ثبت‌شدهٔ کوره:
                                </Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodySmall" style={styles.metricValueSmall}>
                                    {formatJalaliDateTime(row.charge_time)}
                                </Text>
                                <Text variant="bodySmall" style={styles.metricLabel}>
                                    لحظهٔ شارژ:
                                </Text>
                            </View>
                            <Button
                                mode="contained"
                                icon="export"
                                loading={dischargingId === row.furnace_log_id}
                                disabled={dischargingId !== null}
                                onPress={() => handleDischarge(row)}
                                style={[
                                    styles.dischargeButton,
                                    row.danger && styles.dischargeButtonDanger,
                                ]}
                                labelStyle={styles.buttonLabel}
                            >
                                تخلیه از کوره و ثبت پایان پیش‌گرم
                            </Button>
                        </Card.Content>
                    </Card>
                ))
            )}
        </View>
    );

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                <Appbar.BackAction onPress={handleGoBack} color="#ffffff" />
                <Appbar.Content
                    title="مدیریت شمش و کوره پیش‌گرم"
                    color="#ffffff"
                    titleStyle={styles.headerTitle}
                />
            </Appbar.Header>

            <View style={styles.segmentWrap}>
                <SegmentedButtons
                    value={activeTab}
                    onValueChange={handleTabChange}
                    buttons={[
                        { value: 'yard', label: 'ثبت و انبار شمش', icon: 'warehouse' },
                        { value: 'furnace', label: 'مانیتورینگ کوره', icon: 'fire' },
                    ]}
                />
            </View>

            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                keyboardShouldPersistTaps="handled"
            >
                {activeTab === 'yard' ? renderYardTab() : renderFurnaceTab()}
            </ScrollView>

            <FAB
                icon="refresh"
                label="بروزرسانی"
                onPress={handleRefreshAll}
                style={styles.fab}
                color="#ffffff"
            />

            <Snackbar visible={snack.visible} onDismiss={hideSnack} duration={2600}>
                {snack.message}
            </Snackbar>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    headerTitle: {
        fontWeight: 'bold',
        fontSize: 18,
        lineHeight: 26,
    },
    segmentWrap: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 4,
    },
    scrollContainer: {
        flexGrow: 1,
        paddingVertical: 12,
        paddingBottom: 96,
    },
    tabContent: {
        alignItems: 'center',
        paddingHorizontal: 16,
        width: '100%',
    },
    card: {
        width: '100%',
        maxWidth: 480,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: '#ffffff',
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#1a202c',
        lineHeight: 26,
    },
    divider: {
        marginVertical: 12,
    },
    input: {
        marginBottom: 12,
        textAlign: 'right',
    },
    primaryButton: {
        borderRadius: 8,
        paddingVertical: 4,
        marginTop: 4,
    },
    buttonLabel: {
        fontSize: 15,
        fontWeight: 'bold',
        lineHeight: 24,
    },
    loadingWrap: {
        alignItems: 'center',
        paddingVertical: 24,
    },
    loadingText: {
        marginTop: 10,
        color: '#64748B',
        textAlign: 'center',
    },
    emptyWrap: {
        alignItems: 'center',
        paddingVertical: 24,
    },
    emptyText: {
        color: '#888',
        textAlign: 'center',
        lineHeight: 22,
    },
    dtTitle: {
        fontWeight: 'bold',
        fontSize: 13,
    },
    dtCell: {
        fontSize: 13,
    },
    furnaceHeaderCard: {
        backgroundColor: '#0f172a',
    },
    furnaceHeaderRow: {
        flexDirection: 'row-reverse',
        flexWrap: 'wrap',
        justifyContent: 'flex-start',
        alignItems: 'center',
    },
    furnaceStatusChip: {
        backgroundColor: 'rgba(56, 189, 248, 0.18)',
        marginLeft: 8,
        marginBottom: 4,
    },
    furnaceStatusChipText: {
        color: '#38BDF8',
        fontWeight: 'bold',
    },
    riskLegendChip: {
        backgroundColor: 'rgba(248, 113, 113, 0.18)',
        marginBottom: 4,
    },
    riskLegendChipText: {
        color: '#F87171',
        fontWeight: 'bold',
        fontSize: 11,
    },
    furnaceCard: {
        borderLeftWidth: 4,
        borderLeftColor: '#38BDF8',
    },
    furnaceCardDanger: {
        borderLeftColor: '#EF4444',
        backgroundColor: '#FFF5F5',
    },
    furnaceRowHeader: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
    },
    furnaceHeat: {
        fontWeight: 'bold',
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#0f172a',
        flexShrink: 1,
    },
    safeChip: {
        backgroundColor: 'rgba(52, 211, 153, 0.16)',
    },
    safeChipText: {
        color: '#059669',
        fontWeight: 'bold',
        fontSize: 11,
    },
    dangerChip: {
        backgroundColor: '#EF4444',
    },
    dangerChipText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 11,
    },
    metricRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        width: '100%',
    },
    metricLabel: {
        color: '#475569',
        textAlign: 'right',
        writingDirection: 'rtl',
        flexShrink: 1,
        paddingLeft: 8,
    },
    metricValue: {
        fontWeight: 'bold',
        color: '#0f172a',
        textAlign: 'left',
    },
    metricValueSmall: {
        fontWeight: 'bold',
        color: '#334155',
        textAlign: 'left',
    },
    dangerText: {
        color: '#DC2626',
    },
    dischargeButton: {
        borderRadius: 8,
        paddingVertical: 4,
        marginTop: 6,
        backgroundColor: '#1e3d59',
    },
    dischargeButtonDanger: {
        backgroundColor: '#DC2626',
    },
    fab: {
        position: 'absolute',
        bottom: 16,
        left: 16,
        backgroundColor: '#1e3d59',
    },
});