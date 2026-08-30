import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import {
    Card,
    Text,
    Button,
    TextInput,
    useTheme,
    Appbar,
    Divider,
    ActivityIndicator,
    Avatar,
    Chip,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TraceabilityService, GenealogyResult } from '../services/TraceabilityService';
import { getDatabase } from '../database/Database';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';
import { exportMultiSectionToExcel, ExcelSection } from '../utils/excelExport';

// آستانهٔ مجاز زمان ماندگاری در کوره پیش‌گرم (دقیقه) — بیش از این مقدار خطر پوسته‌سازی فولاد
const FURNACE_MAX_RESIDENCE_MINUTES = 90;

export default function GenealogyScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    // ---------- State ها ----------
    const [searchQuery, setSearchQuery] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [hasSearched, setHasSearched] = useState<boolean>(false);
    const [genealogy, setGenealogy] = useState<GenealogyResult | null>(null);
    const [resolvedHeatNumber, setResolvedHeatNumber] = useState<string>('');

    // ---------- منطق جستجو (شماره ذوب یا کد بندیل) ----------
    const handleSearch = async () => {
        const query = searchQuery.trim();
        if (!query) {
            Alert.alert('خطا در ورود داده', 'لطفاً شماره ذوب یا کد بندیل را وارد کنید.');
            return;
        }

        try {
            setLoading(true);
            setHasSearched(true);
            setGenealogy(null);
            setResolvedHeatNumber('');

            // ابتدا به عنوان شماره ذوب استعلام بگیر
            let result = await TraceabilityService.getBilletGenealogy(query);
            let resolvedHeat = query;

            // اگر هیچ داده‌ای یافت نشد، به عنوان کد بندیل جستجو کن
            const isEmpty =
                result.billets.length === 0 &&
                result.furnace_logs.length === 0 &&
                result.rebar_bundles.length === 0;

            if (isEmpty) {
                const db = await getDatabase();
                const bundleRow = await db.getFirstAsync<{ heat_number: string }>(
                    `SELECT heat_number FROM rebar_bundles WHERE bundle_code = ? LIMIT 1;`,
                    [query]
                );
                if (bundleRow && bundleRow.heat_number) {
                    resolvedHeat = bundleRow.heat_number;
                    result = await TraceabilityService.getBilletGenealogy(resolvedHeat);
                }
            }

            setGenealogy(result);
            setResolvedHeatNumber(resolvedHeat);
        } catch (error: any) {
            console.error('[GenealogyScreen] Search failed:', error);
            Alert.alert('خطا در استعلام', error?.message || 'عملیات جستجوی شجره‌نامه ناموفق بود.');
        } finally {
            setLoading(false);
        }
    };

    // ---------- خروجی اکسل (افزوده‌شده) ----------
    const handleExportExcel = async () => {
        if (!genealogy) {
            Alert.alert('خطا', 'ابتدا یک شجره‌نامه استعلام کنید.');
            return;
        }
        try {
            const sections: ExcelSection[] = [
                {
                    sectionTitle: 'شمش‌های ورودی',
                    columns: [
                        { label: 'شناسه شمش', key: 'id' },
                        { label: 'شماره ذوب', key: 'heat_number' },
                        { label: 'ابعاد', key: 'dimensions' },
                        { label: 'گرید', key: 'grade' },
                        { label: 'تامین‌کننده', key: 'supplier_name' },
                        { label: 'وزن اولیه (kg)', key: 'initial_weight_kg' },
                        { label: 'تاریخ ورود', key: 'received_at' },
                        { label: 'وضعیت', key: 'status' },
                    ],
                    data: genealogy.billets.map((b) => ({
                        ...b,
                        received_at: b.received_at ? formatJalaliDateTime(b.received_at) : '-',
                    })),
                },
                {
                    sectionTitle: 'سابقه کوره پیش‌گرم',
                    columns: [
                        { label: 'شناسه لاگ', key: 'id' },
                        { label: 'شماره ذوب', key: 'heat_number' },
                        { label: 'زمان شارژ', key: 'charge_time' },
                        { label: 'زمان تخلیه', key: 'discharge_time' },
                        { label: 'ماندگاری (دقیقه)', key: 'residence_time_minutes' },
                        { label: 'دمای کوره (°C)', key: 'furnace_temperature_celsius' },
                    ],
                    data: genealogy.furnace_logs.map((f) => ({
                        ...f,
                        charge_time: f.charge_time ? formatJalaliDateTime(f.charge_time) : '-',
                        discharge_time: f.discharge_time ? formatJalaliDateTime(f.discharge_time) : 'هنوز در کوره',
                    })),
                },
                {
                    sectionTitle: 'بندیل‌های خروجی',
                    columns: [
                        { label: 'کد بندیل', key: 'bundle_code' },
                        { label: 'شماره ذوب', key: 'heat_number' },
                        { label: 'سایز', key: 'rebar_size' },
                        { label: 'گرید', key: 'rebar_grade' },
                        { label: 'تعداد شاخه', key: 'branch_count' },
                        { label: 'وزن خالص (kg)', key: 'net_weight_kg' },
                        { label: 'زمان تولید', key: 'produced_at' },
                        { label: 'وضعیت کیفی', key: 'quality_status' },
                    ],
                    data: genealogy.rebar_bundles.map((r) => ({
                        ...r,
                        produced_at: r.produced_at ? formatJalaliDateTime(r.produced_at) : '-',
                    })),
                },
            ];

            await exportMultiSectionToExcel(
                `شجره‌نامه_${genealogy.heat_number}`,
                sections,
                `شجره‌نامه و ردیابی ذوب — ${genealogy.heat_number}`
            );
            Alert.alert('موفق', 'فایل شجره‌نامه (۳ بخش) آمادهٔ اشتراک‌گذاری/ذخیره شد.');
        } catch (e: any) {
            console.error('[GenealogyScreen] export failed:', e);
            Alert.alert('خطا در خروجی اکسل', e?.message || 'عملیات خروجی ناموفق بود.');
        }
    };

    // ---------- محاسبهٔ زمان ماندگاری (ثبت‌شده یا زنده) ----------
    const getResidenceMinutes = (log: {
        charge_time: string;
        discharge_time: string | null;
        residence_time_minutes: number | null;
    }): number => {
        if (log.discharge_time && log.residence_time_minutes != null) {
            return log.residence_time_minutes;
        }
        // اگر هنوز تخلیه نشده، محاسبهٔ زنده از لحظهٔ شارژ تا اکنون
        const chargeMs = new Date(log.charge_time).getTime();
        if (isNaN(chargeMs)) return 0;
        return Math.max(0, Math.floor((Date.now() - chargeMs) / 60000));
    };

    // ---------- ویژگی‌های نمایشی وضعیت کیفی بندیل ----------
    const getQualityProps = (
        status: string
    ): { label: string; color: string; bg: string; icon: string } => {
        if (status === 'APPROVED') {
            return { label: 'تأییدشده', color: '#059669', bg: 'rgba(52, 211, 153, 0.16)', icon: 'check-decagram' };
        }
        if (status === 'REJECTED') {
            return { label: 'مردود', color: '#dc2626', bg: 'rgba(248, 113, 113, 0.16)', icon: 'close-octagon' };
        }
        return { label: 'در انتظار QC', color: '#d97706', bg: 'rgba(251, 191, 36, 0.16)', icon: 'timer-sand' };
    };

    // ---------- بررسی خالی بودن نتایج ----------
    const isResultEmpty = (): boolean => {
        if (!genealogy) return true;
        return (
            genealogy.billets.length === 0 &&
            genealogy.furnace_logs.length === 0 &&
            genealogy.rebar_bundles.length === 0
        );
    };

    // ---------- محاسبهٔ وزن کل تولیدشده ----------
    const getTotalProducedWeight = (): number => {
        if (!genealogy) return 0;
        return genealogy.rebar_bundles.reduce((sum, b) => sum + (b.net_weight_kg || 0), 0);
    };

    // ---------- بخش جستجو ----------
    const renderSearchSection = () => (
        <Card style={styles.card} mode="elevated">
            <Card.Content>
                <Text variant="titleMedium" style={styles.cardTitle}>
                    استعلام شجره‌نامه محصول
                </Text>
                <Divider style={styles.divider} />
                <TextInput
                    label="شماره ذوب (Heat Number) یا کد بندیل (Bundle Code)"
                    mode="outlined"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    style={styles.input}
                    left={<TextInput.Icon icon="magnify" />}
                    right={
                        searchQuery.length > 0 ? (
                            <TextInput.Icon icon="close" onPress={() => setSearchQuery('')} />
                        ) : undefined
                    }
                    placeholder="مثال: H-2026-07-0145 یا BND-..."
                />
                <Button
                    mode="contained"
                    icon="file-tree"
                    onPress={handleSearch}
                    loading={loading}
                    disabled={loading}
                    style={styles.searchButton}
                    labelStyle={styles.searchButtonLabel}
                >
                    استعلام شجره‌نامه محصول
                </Button>
            </Card.Content>
        </Card>
    );

    // ---------- حالت بارگذاری ----------
    const renderLoading = () => (
        <Card style={styles.card} mode="elevated">
            <Card.Content style={styles.loadingWrap}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text variant="bodyMedium" style={styles.loadingText}>
                    در حال ردیابی و بازیابی شجره‌نامه ذوب...
                </Text>
            </Card.Content>
        </Card>
    );

    // ---------- حالت عدم یافتن داده ----------
    const renderEmptyState = () => (
        <Card style={styles.card} mode="elevated">
            <Card.Content style={styles.emptyWrap}>
                <Avatar.Icon
                    size={56}
                    icon="file-search-outline"
                    style={{ backgroundColor: theme.colors.background }}
                />
                <Text variant="titleMedium" style={styles.emptyTitle}>
                    هیچ داده‌ای یافت نشد
                </Text>
                <Text variant="bodySmall" style={styles.emptyDesc}>
                    برای عبارت «{searchQuery.trim()}» هیچ شمش، لاگ کوره یا بندیلی در پایگاه‌داده محلی ثبت نشده است.
                </Text>
            </Card.Content>
        </Card>
    );

    // ---------- کارت ۱: خلاصه ذوب ----------
    const renderSummaryCard = () => {
        if (!genealogy) return null;
        const totalWeight = getTotalProducedWeight();
        return (
            <Card style={[styles.card, styles.summaryCard]} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.summaryCardTitle}>
                        خلاصه ذوب: {resolvedHeatNumber}
                    </Text>
                    <Divider style={styles.summaryDivider} />
                    <View style={styles.summaryRow}>
                        <View style={styles.summaryCol}>
                            <Text variant="headlineMedium" style={styles.summaryValue}>
                                {formatNumberFa(genealogy.billets.length)}
                            </Text>
                            <Text variant="bodySmall" style={styles.summaryLabel}>
                                شمش ورودی
                            </Text>
                        </View>
                        <View style={styles.summaryCol}>
                            <Text variant="headlineMedium" style={styles.summaryValue}>
                                {formatNumberFa(genealogy.rebar_bundles.length)}
                            </Text>
                            <Text variant="bodySmall" style={styles.summaryLabel}>
                                بندیل خروجی
                            </Text>
                        </View>
                        <View style={styles.summaryCol}>
                            <Text variant="headlineMedium" style={styles.summaryValue}>
                                {formatNumberFa(Math.round(totalWeight))}
                            </Text>
                            <Text variant="bodySmall" style={styles.summaryLabel}>
                                وزن کل (kg)
                            </Text>
                        </View>
                    </View>
                </Card.Content>
            </Card>
        );
    };

    // ---------- کارت ۲: شمش‌های ورودی ----------
    const renderBilletsCard = () => {
        if (!genealogy || genealogy.billets.length === 0) return null;
        return (
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        شمش‌های ورودی ({formatNumberFa(genealogy.billets.length)})
                    </Text>
                    <Divider style={styles.divider} />
                    {genealogy.billets.map((billet) => (
                        <View key={billet.id} style={styles.listItemWrap}>
                            <View style={styles.listItemHeader}>
                                <Avatar.Icon size={32} icon="cube-outline" style={{ backgroundColor: '#ea580c' }} />
                                <Text variant="bodyLarge" style={styles.listItemTitle}>
                                    {billet.heat_number}
                                </Text>
                            </View>
                            <View style={styles.detailRow}>
                                <Text style={styles.detailValue}>{billet.dimensions ?? '---'}</Text>
                                <Text style={styles.detailLabel}>ابعاد:</Text>
                            </View>
                            <View style={styles.detailRow}>
                                <Text style={styles.detailValue}>{billet.grade ?? '---'}</Text>
                                <Text style={styles.detailLabel}>گرید:</Text>
                            </View>
                            <View style={styles.detailRow}>
                                <Text style={styles.detailValue}>{billet.supplier_name ?? '---'}</Text>
                                <Text style={styles.detailLabel}>تامین‌کننده:</Text>
                            </View>
                            <View style={styles.detailRow}>
                                <Text style={styles.detailValue}>
                                    {billet.received_at ? formatJalaliDateTime(billet.received_at) : '---'}
                                </Text>
                                <Text style={styles.detailLabel}>تاریخ ورود:</Text>
                            </View>
                            {billet.id !== genealogy.billets[genealogy.billets.length - 1].id && (
                                <Divider style={styles.itemDivider} />
                            )}
                        </View>
                    ))}
                </Card.Content>
            </Card>
        );
    };

    // ---------- کارت ۳: سابقه کوره پیش‌گرم ----------
    const renderFurnaceCard = () => {
        if (!genealogy || genealogy.furnace_logs.length === 0) return null;
        return (
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        سابقه کوره پیش‌گرم ({formatNumberFa(genealogy.furnace_logs.length)})
                    </Text>
                    <Divider style={styles.divider} />
                    {genealogy.furnace_logs.map((log) => {
                        const residence = getResidenceMinutes(log);
                        const isOverLimit = residence > FURNACE_MAX_RESIDENCE_MINUTES;
                        const isDischarged = log.discharge_time != null;
                        return (
                            <View key={log.id} style={styles.listItemWrap}>
                                <View style={styles.listItemHeader}>
                                    <Avatar.Icon
                                        size={32}
                                        icon={isDischarged ? 'fire-circle' : 'fire-alert'}
                                        style={{ backgroundColor: isOverLimit ? '#dc2626' : '#059669' }}
                                    />
                                    <Text variant="bodyLarge" style={styles.listItemTitle}>
                                        {log.heat_number}
                                    </Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatJalaliDateTime(log.charge_time)}</Text>
                                    <Text style={styles.detailLabel}>زمان شارژ:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>
                                        {log.discharge_time ? formatJalaliDateTime(log.discharge_time) : 'هنوز در کوره'}
                                    </Text>
                                    <Text style={styles.detailLabel}>زمان تخلیه:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Chip
                                        compact={true}
                                        icon={isOverLimit ? 'alert-octagram' : 'check-circle'}
                                        style={[
                                            styles.residenceChip,
                                            {
                                                backgroundColor: isOverLimit
                                                    ? 'rgba(248, 113, 113, 0.16)'
                                                    : 'rgba(52, 211, 153, 0.16)',
                                            },
                                        ]}
                                        textStyle={[
                                            styles.residenceChipText,
                                            { color: isOverLimit ? '#dc2626' : '#059669' },
                                        ]}
                                    >
                                        {formatNumberFa(residence)} دقیقه {isOverLimit ? '(بیش از حد مجاز!)' : '(عادی)'}
                                    </Chip>
                                    <Text style={styles.detailLabel}>ماندگاری:</Text>
                                </View>
                                {log.furnace_temperature_celsius != null && (
                                    <View style={styles.detailRow}>
                                        <Text style={styles.detailValue}>
                                            {formatNumberFa(log.furnace_temperature_celsius)} °C
                                        </Text>
                                        <Text style={styles.detailLabel}>دمای کوره:</Text>
                                    </View>
                                )}
                                {log.id !== genealogy.furnace_logs[genealogy.furnace_logs.length - 1].id && (
                                    <Divider style={styles.itemDivider} />
                                )}
                            </View>
                        );
                    })}
                </Card.Content>
            </Card>
        );
    };

    // ---------- کارت ۴: بندیل‌های خروجی ----------
    const renderBundlesCard = () => {
        if (!genealogy || genealogy.rebar_bundles.length === 0) return null;
        return (
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        بندیل‌های خروجی ({formatNumberFa(genealogy.rebar_bundles.length)})
                    </Text>
                    <Divider style={styles.divider} />
                    {genealogy.rebar_bundles.map((bundle) => {
                        const qc = getQualityProps(bundle.quality_status);
                        return (
                            <View key={bundle.id} style={styles.listItemWrap}>
                                <View style={styles.listItemHeader}>
                                    <Avatar.Icon
                                        size={32}
                                        icon="package-variant-closed"
                                        style={{ backgroundColor: '#0891b2' }}
                                    />
                                    <Text variant="bodyLarge" style={styles.listItemTitle}>
                                        {bundle.bundle_code}
                                    </Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatNumberFa(bundle.rebar_size)} mm</Text>
                                    <Text style={styles.detailLabel}>سایز:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{bundle.rebar_grade}</Text>
                                    <Text style={styles.detailLabel}>گرید:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatNumberFa(bundle.net_weight_kg)} kg</Text>
                                    <Text style={styles.detailLabel}>وزن باسکول:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Chip
                                        compact={true}
                                        icon={qc.icon}
                                        style={[styles.qualityChip, { backgroundColor: qc.bg }]}
                                        textStyle={[styles.qualityChipText, { color: qc.color }]}
                                    >
                                        {qc.label}
                                    </Chip>
                                    <Text style={styles.detailLabel}>وضعیت کیفی:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatJalaliDateTime(bundle.produced_at)}</Text>
                                    <Text style={styles.detailLabel}>زمان تولید:</Text>
                                </View>
                                {bundle.id !== genealogy.rebar_bundles[genealogy.rebar_bundles.length - 1].id && (
                                    <Divider style={styles.itemDivider} />
                                )}
                            </View>
                        );
                    })}
                </Card.Content>
            </Card>
        );
    };

    // ---------- رندر اصلی ----------
    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content
                        title="جستجو و شجره‌نامه زنده ذوب"
                        color="#ffffff"
                        titleStyle={styles.headerTitle}
                    />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>
                    {renderSearchSection()}

                    {loading && renderLoading()}

                    {!loading && hasSearched && isResultEmpty() && renderEmptyState()}

                    {!loading && hasSearched && !isResultEmpty() && (
                        <>
                            {renderSummaryCard()}
                            {renderBilletsCard()}
                            {renderFurnaceCard()}
                            {renderBundlesCard()}

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

                    <Text style={styles.footerText}>
                        سامانه ردیابی فولاد — شجره‌نامه آفلاین بر بستر sanatify.db
                    </Text>
                </View>
            </ScrollView>
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
    scrollContainer: {
        flexGrow: 1,
        paddingVertical: 16,
    },
    container: {
        alignItems: 'center',
        paddingHorizontal: 16,
        width: '100%',
    },
    card: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: '#ffffff',
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        color: '#0F172A',
        lineHeight: 24,
        writingDirection: 'rtl',
    },
    divider: {
        marginBottom: 14,
    },
    input: {
        marginBottom: 14,
        textAlign: 'right',
    },
    searchButton: {
        borderRadius: 8,
        paddingVertical: 4,
        backgroundColor: '#1e3d59',
    },
    searchButtonLabel: {
        fontSize: 15,
        fontWeight: 'bold',
        lineHeight: 24,
    },
    loadingWrap: {
        alignItems: 'center',
        paddingVertical: 24,
    },
    loadingText: {
        marginTop: 12,
        color: '#64748B',
        textAlign: 'center',
    },
    emptyWrap: {
        alignItems: 'center',
        paddingVertical: 28,
    },
    emptyTitle: {
        fontWeight: 'bold',
        marginTop: 12,
        color: '#0F172A',
        textAlign: 'center',
    },
    emptyDesc: {
        marginTop: 8,
        color: '#64748B',
        textAlign: 'center',
        lineHeight: 20,
    },
    // ----- کارت خلاصه ذوب -----
    summaryCard: {
        backgroundColor: '#1e3d59',
    },
    summaryCardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        color: '#ffffff',
        lineHeight: 24,
        writingDirection: 'rtl',
    },
    summaryDivider: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        marginVertical: 12,
    },
    summaryRow: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        width: '100%',
    },
    summaryCol: {
        alignItems: 'center',
    },
    summaryValue: {
        color: '#ffffff',
        fontWeight: 'bold',
        lineHeight: 32,
    },
    summaryLabel: {
        color: '#ffffff',
        opacity: 0.8,
        marginTop: 4,
        lineHeight: 16,
    },
    // ----- آیتم‌های لیست -----
    listItemWrap: {
        marginBottom: 4,
    },
    listItemHeader: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
        marginBottom: 8,
    },
    listItemTitle: {
        fontWeight: 'bold',
        marginRight: 10,
        color: '#0F172A',
        textAlign: 'right',
        writingDirection: 'rtl',
        flexShrink: 1,
    },
    detailRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
        width: '100%',
    },
    detailLabel: {
        fontSize: 12,
        color: '#64748B',
        textAlign: 'right',
        writingDirection: 'rtl',
        flexShrink: 1,
        paddingLeft: 8,
    },
    detailValue: {
        fontSize: 13,
        fontWeight: 'bold',
        color: '#0F172A',
        textAlign: 'left',
        flexShrink: 1,
    },
    itemDivider: {
        marginVertical: 10,
    },
    residenceChip: {
        borderWidth: 0,
        height: 28,
    },
    residenceChipText: {
        fontWeight: 'bold',
        fontSize: 11,
    },
    qualityChip: {
        borderWidth: 0,
        height: 28,
    },
    qualityChipText: {
        fontWeight: 'bold',
        fontSize: 11,
    },
    // ----- Export (افزوده‌شده) -----
    exportButton: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 8,
        backgroundColor: '#15803d',
        marginBottom: 12,
    },
    exportButtonLabel: {
        fontSize: 15,
        fontWeight: 'bold',
        lineHeight: 24,
    },
    footerText: {
        marginTop: 8,
        marginBottom: 16,
        fontSize: 11,
        color: '#94A3B8',
        textAlign: 'center',
        lineHeight: 18,
    },
});