import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, ScrollView, Platform, ActivityIndicator, RefreshControl, Share } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, Avatar, Divider, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { IndustrialEventService } from '../services/IndustrialEventService';
import { WorkshopContextService, WorkshopContext } from '../services/WorkshopContextService';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';

const toPersianDigits = (value: number | string): string => {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(value).replace(/[0-9]/g, (d) => persianDigits[Number(d)]);
};

const isToday = (isoString: string): boolean => {
    if (!isoString) return false;
    const d = new Date(isoString);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
};

export default function HistoryScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    const [events, setEvents] = useState<any[]>([]);
    const [filteredEvents, setFilteredEvents] = useState<any[]>([]);
    const [filterType, setFilterType] = useState<'all' | 'production' | 'downtime' | 'waste' | 'quality'>('all');
    const [activeContext, setActiveContext] = useState<WorkshopContext | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showSummary, setShowSummary] = useState(false);

    const [selectedWorkshop, setSelectedWorkshop] = useState<string>('all');
    const [selectedLine, setSelectedLine] = useState<string>('all');
    const [selectedShift, setSelectedShift] = useState<string>('all');

    const fetchHistory = async () => {
        try {
            setLoading(true);
            const [data, context] = await Promise.all([
                IndustrialEventService.queryTimeline('all'),
                WorkshopContextService.getActiveContext()
            ]);
            setEvents(data);
            setFilteredEvents(data);
            setActiveContext(context);
        } catch (e) {
            console.error('Failed to fetch local workshop history:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        fetchHistory();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        fetchHistory();
    };

    useEffect(() => {
        let result = events;

        if (filterType !== 'all') {
            result = result.filter(e => e.type === filterType);
        }
        if (selectedWorkshop !== 'all') {
            result = result.filter(e => e.workshop_name === selectedWorkshop);
        }
        if (selectedLine !== 'all') {
            result = result.filter(e => e.line_name === selectedLine);
        }
        if (selectedShift !== 'all') {
            result = result.filter(e => e.shift_id === selectedShift);
        }

        setFilteredEvents(result);
    }, [filterType, selectedWorkshop, selectedLine, selectedShift, events]);

    const shiftSummary = useMemo(() => {
        const todays = events.filter(e => isToday(e.timestamp));
        const totalGood = todays.filter(e => e.type === 'production').reduce((sum, e) => sum + (Number(e.payload?.quantity) || 0), 0);
        const totalWaste = todays.filter(e => e.type === 'waste').reduce((sum, e) => sum + (Number(e.payload?.quantity) || 0), 0);
        const downtimeEvents = todays.filter(e => e.type === 'downtime');
        const totalDowntimeMinutes = downtimeEvents.reduce((sum, e) => sum + (Number(e.payload?.duration) || 0), 0);
        const activeDowntimeCount = downtimeEvents.filter(e => !e.payload?.duration).length;

        const reasonCounts: Record<string, number> = {};
        downtimeEvents.forEach(e => {
            const reason = e.payload?.reason || 'نامشخص';
            reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
        });
        const topReasonEntry = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0];

        const qcEvents = todays.filter(e => e.type === 'quality');
        const qcPass = qcEvents.filter(e => e.payload?.compliant === 'pass').length;
        const qcFail = qcEvents.filter(e => e.payload?.compliant === 'fail').length;

        return {
            totalGood,
            totalWaste,
            totalDowntimeMinutes,
            activeDowntimeCount,
            topReason: topReasonEntry ? topReasonEntry[0] : null,
            qcTotal: qcEvents.length,
            qcPass,
            qcFail,
        };
    }, [events]);

    const handleShareSummary = async () => {
        const s = shiftSummary;
        const message =
            `📋 خلاصه پایان شیفت — ${activeContext ? activeContext.workshop_name : 'کارخانه'}\n` +
            `📅 ${formatJalaliDateTime(new Date().toISOString())}\n\n` +
            `✅ تولید سالم: ${toPersianDigits(s.totalGood)} عدد\n` +
            `🗑 ضایعات: ${toPersianDigits(s.totalWaste)} عدد\n` +
            `⏱ مجموع توقفات: ${toPersianDigits(s.totalDowntimeMinutes)} دقیقه` +
            (s.activeDowntimeCount > 0 ? ` (⚠ ${toPersianDigits(s.activeDowntimeCount)} توقف هنوز فعال است)\n` : '\n') +
            (s.topReason ? `🔧 پرتکرارترین علت توقف: ${s.topReason}\n` : '') +
            `🧪 کنترل کیفیت: ${toPersianDigits(s.qcTotal)} آزمون (${toPersianDigits(s.qcPass)} مطابق / ${toPersianDigits(s.qcFail)} مغایر استاندارد)`;

        try {
            await Share.share({ message });
        } catch (e) {
            console.warn('[HistoryScreen] Failed to share summary:', e);
        }
    };

    const getShiftLabel = (shiftId?: string | null): string => {
        if (!shiftId) return 'نامشخص';
        if (shiftId === 'shift-morning-301') return 'شیفت صبح';
        if (shiftId === 'shift-night-302') return 'شیفت شب';
        return shiftId;
    };

    const getEventIcon = (type: string, duration: any): string => {
        if (type === 'production') return 'check-circle';
        if (type === 'waste') return 'delete-circle';
        if (type === 'downtime') return duration ? 'wrench-clock' : 'alert-octagon';
        if (type === 'quality') return 'clipboard-check-outline';
        return 'history';
    };

    const getEventIconColor = (type: string, duration: any): string => {
        if (type === 'production') return '#34D399';
        if (type === 'waste') return '#F87171';
        if (type === 'downtime') return duration ? '#34D399' : '#F87171';
        if (type === 'quality') return '#38BDF8';
        return '#94A3B8';
    };

    const getEventBadgeBg = (type: string, duration: any = false): string => {
        if (type === 'production') return 'rgba(52, 211, 153, 0.16)';
        if (type === 'waste') return 'rgba(248, 113, 113, 0.16)';
        if (type === 'downtime') return duration ? 'rgba(52, 211, 153, 0.16)' : 'rgba(248, 113, 113, 0.16)';
        if (type === 'quality') return 'rgba(56, 189, 248, 0.16)';
        return 'rgba(148, 163, 184, 0.16)';
    };

    const getEventTypeName = (type: string, duration: any = false): string => {
        if (type === 'production') return 'تولید سالم';
        if (type === 'waste') return 'ضایعات';
        if (type === 'downtime') return duration ? 'توقف رفع‌شده' : 'توقف فعال';
        if (type === 'quality') return 'کنترل کیفیت';
        return 'سایر رویدادها';
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content
                        title={`تاریخچه عملیات سالن ${activeContext ? activeContext.workshop_name : 'کارخانه'}`}
                        color="#ffffff"
                        titleStyle={styles.headerTitle}
                    />
                    <Appbar.Action icon="clipboard-text-clock-outline" color="#ffffff" onPress={() => setShowSummary(v => !v)} />
                </Appbar.Header>
            )}

            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                <View style={styles.container}>

                    {showSummary && (
                        <Card style={styles.summaryCard} mode="outlined">
                            <Card.Content>
                                <Text style={styles.summaryTitle}>📋 خلاصه پایان شیفت — امروز</Text>
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryValue}>{toPersianDigits(shiftSummary.totalGood)} عدد</Text>
                                    <Text style={styles.summaryLabel}>تولید سالم:</Text>
                                </View>
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryValue}>{toPersianDigits(shiftSummary.totalWaste)} عدد</Text>
                                    <Text style={styles.summaryLabel}>ضایعات:</Text>
                                </View>
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryValue}>
                                        {toPersianDigits(shiftSummary.totalDowntimeMinutes)} دقیقه
                                        {shiftSummary.activeDowntimeCount > 0 ? ` (⚠ ${toPersianDigits(shiftSummary.activeDowntimeCount)} فعال)` : ''}
                                    </Text>
                                    <Text style={styles.summaryLabel}>مجموع توقفات:</Text>
                                </View>
                                {shiftSummary.topReason && (
                                    <View style={styles.summaryRow}>
                                        <Text style={styles.summaryValue} numberOfLines={1}>{shiftSummary.topReason}</Text>
                                        <Text style={styles.summaryLabel}>پرتکرارترین علت توقف:</Text>
                                    </View>
                                )}
                                <View style={styles.summaryRow}>
                                    <Text style={styles.summaryValue}>
                                        {toPersianDigits(shiftSummary.qcPass)} مطابق / {toPersianDigits(shiftSummary.qcFail)} مغایر
                                    </Text>
                                    <Text style={styles.summaryLabel}>کنترل کیفیت:</Text>
                                </View>

                                <Button
                                    mode="contained"
                                    icon="share-variant"
                                    onPress={handleShareSummary}
                                    style={styles.shareButton}
                                >
                                    اشتراک‌گذاری خلاصه
                                </Button>
                            </Card.Content>
                        </Card>
                    )}

                    <View style={styles.filterOuterContainer}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                            <Chip
                                selected={filterType === 'all'}
                                onPress={() => setFilterType('all')}
                                style={[styles.chip, filterType === 'all' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, filterType === 'all' && styles.chipTextSelected]}
                            >
                                همه وقایع
                            </Chip>
                            <Chip
                                selected={filterType === 'production'}
                                onPress={() => setFilterType('production')}
                                style={[styles.chip, filterType === 'production' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, filterType === 'production' && styles.chipTextSelected]}
                                icon="check-circle-outline"
                            >
                                تولید سالم
                            </Chip>
                            <Chip
                                selected={filterType === 'downtime'}
                                onPress={() => setFilterType('downtime')}
                                style={[styles.chip, filterType === 'downtime' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, filterType === 'downtime' && styles.chipTextSelected]}
                                icon="wrench-outline"
                            >
                                توقفات خط
                            </Chip>
                            <Chip
                                selected={filterType === 'waste'}
                                onPress={() => setFilterType('waste')}
                                style={[styles.chip, filterType === 'waste' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, filterType === 'waste' && styles.chipTextSelected]}
                                icon="delete-empty"
                            >
                                ضایعات
                            </Chip>
                            <Chip
                                selected={filterType === 'quality'}
                                onPress={() => setFilterType('quality')}
                                style={[styles.chip, filterType === 'quality' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, filterType === 'quality' && styles.chipTextSelected]}
                                icon="clipboard-check-outline"
                            >
                                کنترل کیفیت
                            </Chip>
                        </ScrollView>
                    </View>

                    <View style={styles.filterOuterContainer}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterScroll}>
                            <Chip
                                selected={selectedWorkshop === 'all'}
                                onPress={() => setSelectedWorkshop('all')}
                                style={[styles.chip, selectedWorkshop === 'all' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, selectedWorkshop === 'all' && styles.chipTextSelected]}
                            >
                                همه سالن‌ها
                            </Chip>
                            <Chip
                                selected={selectedWorkshop === 'پرس‌کاری فلزات'}
                                onPress={() => setSelectedWorkshop('پرس‌کاری فلزات')}
                                style={[styles.chip, selectedWorkshop === 'پرس‌کاری فلزات' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, selectedWorkshop === 'پرس‌کاری فلزات' && styles.chipTextSelected]}
                                icon="factory"
                            >
                                پرس‌کاری
                            </Chip>
                            <Chip
                                selected={selectedWorkshop === 'جوشکاری رباتیک'}
                                onPress={() => setSelectedWorkshop('جوشکاری رباتیک')}
                                style={[styles.chip, selectedWorkshop === 'جوشکاری رباتیک' ? styles.chipSelected : styles.chipUnselected]}
                                textStyle={[styles.chipText, selectedWorkshop === 'جوشکاری رباتیک' && styles.chipTextSelected]}
                                icon="factory"
                            >
                                جوشکاری
                            </Chip>
                        </ScrollView>
                    </View>

                    <View style={styles.listWrapper}>
                        {filteredEvents.map((event) => {
                            const hasDuration = event.type === 'downtime' && event.payload && event.payload.duration != null;
                            return (
                                <Card
                                    key={event.id}
                                    style={[
                                        styles.itemCard,
                                        event.type === 'downtime' && {
                                            borderColor: hasDuration ? '#34D399' : '#F87171',
                                        }
                                    ]}
                                    mode="outlined"
                                >
                                    <Card.Content style={styles.cardContent}>

                                        <View style={styles.itemHeader}>
                                            <View style={styles.itemTitleRow}>
                                                <Avatar.Icon
                                                    size={36}
                                                    icon={getEventIcon(event.type, hasDuration)}
                                                    style={{ backgroundColor: getEventIconColor(event.type, hasDuration) }}
                                                />
                                                <View style={styles.titleCol}>
                                                    <Text variant="titleMedium" style={styles.itemTitle}>{event.title}</Text>
                                                    <Text variant="bodySmall" style={[styles.itemTime, { color: '#F8FAFC' }]}>{formatJalaliDateTime(event.timestamp)}</Text>
                                                </View>
                                            </View>

                                            <View style={[styles.badge, { backgroundColor: getEventBadgeBg(event.type, hasDuration) }]}>
                                                <Text style={[styles.badgeText, { color: getEventIconColor(event.type, hasDuration) }]}>
                                                    {getEventTypeName(event.type, hasDuration)}
                                                </Text>
                                            </View>
                                        </View>

                                        <Divider style={styles.cardDivider} />

                                        <View style={styles.detailsGrid}>
                                            <View style={styles.detailRow}>
                                                <Text style={[styles.detailLabel, { color: '#94A3B8' }]}>دستگاه / خط:</Text>
                                                <Text style={[styles.detailValue, { color: '#F8FAFC' }]} numberOfLines={1} ellipsizeMode="tail">
                                                    {event.machine_name} / {event.line_name || 'خط ۳'}
                                                </Text>
                                            </View>
                                            <View style={styles.detailRow}>
                                                <Text style={[styles.detailLabel, { color: '#94A3B8' }]}>شیفت کاری:</Text>
                                                <Text style={[styles.detailValue, { color: '#F8FAFC' }]}>{getShiftLabel(event.shift_id)}</Text>
                                            </View>

                                            {event.operator_name && (
                                                <View style={styles.detailRow}>
                                                    <Text style={[styles.detailLabel, { color: '#94A3B8' }]}>اپراتور ثبت‌کننده:</Text>
                                                    <Text style={[styles.detailValue, { color: '#F8FAFC' }]} numberOfLines={1} ellipsizeMode="tail">{event.operator_name}</Text>
                                                </View>
                                            )}

                                            {event.description && (
                                                <View style={styles.detailRow}>
                                                    <Text style={[styles.detailLabel, { color: '#94A3B8' }]}>جزئیات رویداد:</Text>
                                                    <Text style={[styles.detailValue, { color: '#F8FAFC' }]} numberOfLines={1} ellipsizeMode="tail">
                                                        {event.description}
                                                    </Text>
                                                </View>
                                            )}
                                        </View>

                                    </Card.Content>
                                </Card>
                            );
                        })}

                        {filteredEvents.length === 0 && (
                            <Card style={styles.itemCard} mode="outlined">
                                <Card.Content style={styles.emptyState}>
                                    <Avatar.Icon size={40} icon="history" style={{ backgroundColor: theme.colors.background }} />
                                    <Text variant="bodyMedium" style={styles.emptyText}>
                                        هیچ تراکنش ثبتی با این دسته‌بندی فیلترها یافت نشد.
                                    </Text>
                                </Card.Content>
                            </Card>
                        )}
                    </View>

                    <Text style={styles.footerText}>
                        نمایش لاگ‌های بومی آفلاین کارخانه بر بستر موتور رویدادها
                    </Text>

                    {Platform.OS === 'web' && (
                        <Button mode="outlined" icon="arrow-left" onPress={() => navigation.goBack()} style={styles.webBackButton}>
                            بازگشت به میز کار
                        </Button>
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18, lineHeight: 26 },
    scrollContainer: { flexGrow: 1, paddingVertical: 16 },
    container: { alignItems: 'center', width: '100%' },
    summaryCard: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 12,
        marginBottom: 16,
        marginHorizontal: 16,
        backgroundColor: '#0f172a',
        borderColor: '#334155',
    },
    summaryTitle: { fontWeight: 'bold', fontSize: 15, color: '#F8FAFC', textAlign: 'right', marginBottom: 10 },
    summaryRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 6 },
    summaryLabel: { fontSize: 12, color: '#94A3B8' },
    summaryValue: { fontSize: 12, fontWeight: 'bold', color: '#F8FAFC', flexShrink: 1, textAlign: 'left' },
    shareButton: { marginTop: 10, borderRadius: 8, backgroundColor: '#ff6b35' },
    filterOuterContainer: { width: '100%', paddingHorizontal: 16, marginBottom: 8 },
    filterScroll: { flexDirection: 'row-reverse', alignItems: 'center' },
    chip: { marginLeft: 8, borderRadius: 16, height: 34 },
    chipUnselected: { backgroundColor: '#1E293B' },
    chipSelected: { backgroundColor: '#ff6b35' },
    chipText: { fontSize: 12, lineHeight: 18, fontWeight: 'bold', color: '#F1F5F9' },
    chipTextSelected: { color: '#ffffff' },
    listWrapper: { width: '100%', paddingHorizontal: 16, alignItems: 'center', marginTop: 12 },
    itemCard: { width: '100%', maxWidth: 450, borderRadius: 12, backgroundColor: '#111827', marginBottom: 12, borderColor: '#475569' },
    cardContent: { paddingVertical: 14, paddingHorizontal: 14 },
    itemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', width: '100%' },
    itemTitleRow: { flexDirection: 'row-reverse', alignItems: 'center', flexShrink: 1 },
    titleCol: { marginRight: 12, alignItems: 'flex-end', flexShrink: 1 },
    itemTitle: { fontWeight: 'bold', lineHeight: 22, textAlign: 'right', writingDirection: 'rtl', color: '#F8FAFC' },
    itemTime: { color: '#E2E8F0', fontSize: 10, lineHeight: 16, marginTop: 2, textAlign: 'right' },
    badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, alignSelf: 'center' },
    badgeText: { fontSize: 10, fontWeight: 'bold', lineHeight: 14 },
    cardDivider: { marginVertical: 12 },
    detailsGrid: { width: '100%' },
    detailRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, width: '100%' },
    detailLabel: { fontSize: 11, color: '#94A3B8', textAlign: 'right', lineHeight: 16 },
    detailValue: { fontSize: 12, fontWeight: 'bold', color: '#F8FAFC', textAlign: 'left', lineHeight: 18, flexShrink: 1 },
    emptyState: { alignItems: 'center', paddingVertical: 24 },
    emptyText: { marginTop: 12, color: '#F8FAFC', lineHeight: 22 },
    footerText: { marginTop: 20, fontSize: 11, color: '#E2E8F0', textAlign: 'center', lineHeight: 20 },
    webBackButton: { marginTop: 24, width: '100%', maxWidth: 450 },
});