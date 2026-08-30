import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform, RefreshControl } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, Divider, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase } from '../database/Database';
import { formatNumberFa, formatDurationFa } from '../utils/dateUtils';

// =====================================================================
//  داشبورد هوش صنعتی — نسخهٔ خط بشکهٔ فلزی (Drum-First)
//  OEE = دسترس‌پذیری × کارایی سرعت × کیفیت
//  دسترس‌پذیری = (زمان برنامه‌ریزی روز − توقفات) ÷ زمان برنامه‌ریزی روز
//  کارایی سرعت = تولید واقعی بشکه ÷ (نرخ ایده‌آل خط × ساعت کارکرد)
//  کیفیت = درصد قبولی آزمون‌های QC (نشت / فشار / پوشش)
//  منبع داده: production_logs + waste_logs + downtime_logs + quality_inspections + billets + rebar_bundles + pm_tasks
// =====================================================================
const PLANNED_DAY_MINUTES = 960; // دو شیفت ۸ ساعته (قابل تنظیم)
const IDEAL_DRUM_RATE_H = 30;    // نرخ ایده‌آل خط: ۳۰ بشکه در ساعت (قابل تنظیم)

// وضعیت سررسید یک کار PM (ساعت / روز / تُن)
async function pmStatusLevel(db: any, t: any): Promise<'ok' | 'soon' | 'overdue'> {
    const interval = Number(t.interval_value) || 1;
    let used = 0;
    if (t.interval_type === 'tons') {
        const rows = t.last_done_at
            ? await db.getAllAsync(`SELECT COALESCE(SUM(net_weight_kg),0) AS s FROM rebar_bundles WHERE produced_at >= ?`, [t.last_done_at]) as any[]
            : await db.getAllAsync(`SELECT COALESCE(SUM(net_weight_kg),0) AS s FROM rebar_bundles`) as any[];
        used = (rows[0]?.s || 0) / 1000;
    } else {
        const base = t.last_done_at || t.created_at;
        const ms = Date.now() - new Date(base).getTime();
        used = t.interval_type === 'hours' ? ms / 3600000 : ms / 86400000;
    }
    const ratio = used / interval;
    return ratio >= 1 ? 'overdue' : ratio >= 0.8 ? 'soon' : 'ok';
}

export default function IndustrialDashboard({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [m, setM] = useState<any>(null);

    const loadDashboardData = async () => {
        try {
            const db = await getDatabase();
            const d0 = new Date(); d0.setHours(0, 0, 0, 0);
            const todayIso = d0.toISOString();
            const weekIso = new Date(Date.now() - 7 * 86400000).toISOString();

            const prod = await db.getAllAsync(`SELECT good_quantity, product_id FROM production_logs WHERE timestamp >= ?`, [todayIso]) as any[];
            const waste = await db.getAllAsync(`SELECT quantity FROM waste_logs WHERE timestamp >= ?`, [todayIso]) as any[];
            const downToday = await db.getAllAsync(`SELECT duration_minutes FROM downtime_logs WHERE start_time >= ?`, [todayIso]) as any[];
            const downWeek = await db.getAllAsync(`SELECT duration_minutes, is_unplanned FROM downtime_logs WHERE start_time >= ?`, [weekIso]) as any[];
            let qc = await db.getAllAsync(`SELECT bend_test_passed, visual_inspection FROM quality_inspections WHERE timestamp >= ?`, [todayIso]) as any[];
            if (!(qc || []).length) qc = await db.getAllAsync(`SELECT bend_test_passed, visual_inspection FROM quality_inspections`) as any[];
            const coils = await db.getAllAsync(`SELECT initial_weight_kg FROM billets WHERE received_at >= ?`, [todayIso]) as any[];
            const bundles = await db.getAllAsync(`SELECT net_weight_kg, quality_status, produced_at FROM rebar_bundles`) as any[];

            const good = (prod || []).reduce((s: number, r: any) => s + (Number(r.good_quantity) || 0), 0);
            const wasteCnt = (waste || []).reduce((s: number, r: any) => s + (Number(r.quantity) || 0), 0);
            const matYield = (good + wasteCnt) > 0 ? (good / (good + wasteCnt)) * 100 : 0;
            const dtToday = (downToday || []).reduce((s: number, r: any) => s + (Number(r.duration_minutes) || 0), 0);
            const unWeek = (downWeek || []).filter((r: any) => r.is_unplanned);
            const dtWeek = unWeek.reduce((s: number, r: any) => s + (Number(r.duration_minutes) || 0), 0);
            const failures = unWeek.length;

            const availability = Math.max(0, Math.min(100, ((PLANNED_DAY_MINUTES - dtToday) / PLANNED_DAY_MINUTES) * 100));
            const opHours = Math.max(0, (PLANNED_DAY_MINUTES - dtToday)) / 60;
            const performance = opHours > 0 ? Math.min(100, (good / (IDEAL_DRUM_RATE_H * opHours)) * 100) : 0;
            const qcTotal = (qc || []).length;
            const qcPass = (qc || []).filter((r: any) => (Number(r.bend_test_passed) || 0) === 1 && (Number(r.visual_inspection) || 0) === 1).length;
            const quality = qcTotal > 0 ? (qcPass / qcTotal) * 100 : 0;
            const oee = (availability * performance * quality) / 10000;

            const inputTons = (coils || []).reduce((s: number, r: any) => s + (Number(r.initial_weight_kg) || 0), 0) / 1000;
            const approvedBundles = (bundles || []).filter((b: any) => b.quality_status === 'APPROVED').length;
            const prodMap: Record<string, number> = {};
            (prod || []).forEach((r: any) => { prodMap[String(r.product_id || 'نامشخص')] = (prodMap[String(r.product_id || 'نامشخص')] || 0) + (Number(r.good_quantity) || 0); });
            const topProducts = Object.entries(prodMap).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, c]) => ({ product: p, count: c }));

            let pmOverdue = 0;
            try {
                const tasks = await db.getAllAsync(`SELECT * FROM pm_tasks;`) as any[];
                for (const t of tasks || []) {
                    if ((await pmStatusLevel(db, t)) === 'overdue') pmOverdue++;
                }
            } catch (e) { /* جدول PM شاید هنوز ساخته نشده */ }

            setM({
                good, wasteCnt, matYield, dtToday, availability, performance, quality, oee,
                inputTons, approvedBundles, topProducts,
                mttr: failures > 0 ? Math.round(dtWeek / failures) : 0,
                mtbf: failures > 0 ? Math.max(0, Math.round((7 * 720 - dtWeek) / failures)) : 7 * 720,
                failures, pmOverdue,
            });
        } catch (error) {
            console.error('[IndustrialDashboard ERROR]', error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => { loadDashboardData(); }, []);
    const onRefresh = () => { setRefreshing(true); loadDashboardData(); };

    if (loading) {
        return (
            <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text variant="titleMedium" style={styles.loadingText}>در حال محاسبات شاخص‌های خط بشکه...</Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content title="داشبورد هوش صنعتی خط بشکه" color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}
            <ScrollView contentContainerStyle={styles.scrollContainer} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
                <View style={styles.container}>

                    {/* کارت OEE خط بشکه */}
                    <Card style={[styles.card, styles.oeeCard]} mode="elevated">
                        <Card.Content style={styles.oeeContent}>
                            <Text variant="headlineLarge" style={styles.oeeValue}>{m ? `${formatNumberFa(m.oee.toFixed(1))}٪` : '---'}</Text>
                            <Text variant="titleMedium" style={styles.oeeTitle}>راندمان کلی خط بشکه (OEE)</Text>
                            <Divider style={styles.oeeDivider} />
                            <View style={styles.oeeRow}>
                                <View style={styles.oeeCol}>
                                    <Text variant="bodyLarge" style={styles.oeeSubValue}>{m ? `${formatNumberFa(m.availability.toFixed(1))}٪` : '---'}</Text>
                                    <Text variant="bodySmall" style={styles.oeeSubLabel}>دسترس‌پذیری</Text>
                                </View>
                                <View style={styles.oeeCol}>
                                    <Text variant="bodyLarge" style={styles.oeeSubValue}>{m ? `${formatNumberFa(m.performance.toFixed(1))}٪` : '---'}</Text>
                                    <Text variant="bodySmall" style={styles.oeeSubLabel}>کارایی سرعت</Text>
                                </View>
                                <View style={styles.oeeCol}>
                                    <Text variant="bodyLarge" style={styles.oeeSubValue}>{m ? `${formatNumberFa(m.quality.toFixed(1))}٪` : '---'}</Text>
                                    <Text variant="bodySmall" style={styles.oeeSubLabel}>کیفیت (قبولی QC)</Text>
                                </View>
                            </View>
                        </Card.Content>
                    </Card>

                    {/* کارنامه تولید بشکه امروز */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>کارنامه تولید بشکه (امروز)</Text>
                            <Divider style={styles.divider} />
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: '#059669' }]}>{m ? `${formatNumberFa(m.good)} عدد` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>تولید بشکه سالم</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: '#dc2626' }]}>{m ? `${formatNumberFa(m.wasteCnt)} عدد` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>ضایعات بشکه (نشت/دفرمه/پوشش)</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: '#ffc107' }]}>{m ? formatDurationFa(m.dtToday) : '۰ دقیقه'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>توقفات ثبت‌شدهٔ امروز</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={styles.metricValue}>{m ? `${formatNumberFa(m.inputTons.toFixed(2))} تُن` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>ورق ورودی امروز (کویل)</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: '#059669' }]}>{m ? `${formatNumberFa(m.approvedBundles)} پالت` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>محمولهٔ تأییدشدهٔ QC</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: theme.colors.secondary }]}>{m ? `${formatNumberFa(m.matYield.toFixed(1))}٪` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>راندمان مواد (بدون پرت)</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    {/* ترکیب تولید امروز */}
                    {m && m.topProducts.length > 0 && (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={styles.cardTitle}>ترکیب تولید امروز</Text>
                                <Divider style={styles.divider} />
                                {m.topProducts.map((p: any) => (
                                    <View key={p.product} style={styles.metricRow}>
                                        <Text variant="bodyLarge" style={styles.metricValue}>{formatNumberFa(p.count)} عدد</Text>
                                        <Text variant="bodyMedium" style={styles.metricLabel}>{p.product === 'DR-220L' ? 'بشکه ۲۲۰ لیتری نفتی' : p.product}</Text>
                                    </View>
                                ))}
                            </Card.Content>
                        </Card>
                    )}

                    {/* تعمیرات و قابلیت اطمینان */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>تعمیرات و قابلیت اطمینان خط (۷ روز)</Text>
                            <Divider style={styles.divider} />
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: '#dc2626' }]}>{m ? formatDurationFa(m.mttr) : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>MTTR (میانگین زمان تعمیر)</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: theme.colors.primary }]}>{m ? formatDurationFa(m.mtbf) : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>MTBF (میانگین بین خرابی‌ها)</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: '#dc2626' }]}>{m ? `${formatNumberFa(m.failures)} بار` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>خرابی‌های اضطراری (تعویض چرخ درزبند و…)</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text variant="bodyLarge" style={[styles.metricValue, { color: m && m.pmOverdue > 0 ? '#dc2626' : '#059669' }]}>{m ? `${formatNumberFa(m.pmOverdue)} مورد` : '۰'}</Text>
                                <Text variant="bodyMedium" style={styles.metricLabel}>کارهای PM معوق (سررسید گذشته)</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    {/* شفافیت فرمول‌ها */}
                    <Card style={[styles.card, styles.noteCard]} mode="outlined">
                        <Card.Content>
                            <Text variant="bodySmall" style={styles.noteText}>
                                فرمول‌ها: دسترس‌پذیری = (زمان روز − توقف) ÷ زمان روز | کارایی = تولید بشکه ÷ (۳۰ بشکه/ساعت × ساعت کارکرد) | کیفیت = قبولی آزمون‌های نشت/فشار/پوشش. اعداد از ثبت‌های واقعی اپراتور و بازرس محاسبه می‌شوند.
                            </Text>
                        </Card.Content>
                    </Card>

                    {Platform.OS === 'web' && (
                        <Button mode="outlined" icon="arrow-left" onPress={() => navigation.goBack()} style={styles.webBackButton}>بازگشت</Button>
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18, lineHeight: 26 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    loadingText: { marginTop: 16, fontWeight: 'bold', lineHeight: 24, color: '#0F172A' },
    scrollContainer: { flexGrow: 1, paddingVertical: 16 },
    container: { alignItems: 'center', paddingHorizontal: 16, width: '100%' },
    card: { width: '100%', maxWidth: 450, borderRadius: 12, marginBottom: 16, backgroundColor: '#ffffff' },
    oeeCard: { backgroundColor: '#1e3d59' },
    oeeContent: { alignItems: 'center', paddingVertical: 20 },
    oeeValue: { color: '#ffffff', fontWeight: 'bold', fontSize: 48, lineHeight: 56 },
    oeeTitle: { color: '#ffffff', marginTop: 4, opacity: 0.9, lineHeight: 24, writingDirection: 'rtl' },
    oeeDivider: { width: '80%', backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 14 },
    oeeRow: { flexDirection: 'row', width: '100%', justifyContent: 'space-around' },
    oeeCol: { alignItems: 'center' },
    oeeSubValue: { color: '#ffffff', fontWeight: 'bold', lineHeight: 22 },
    oeeSubLabel: { color: '#ffffff', opacity: 0.8, marginTop: 2, lineHeight: 18 },
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 8, lineHeight: 24, writingDirection: 'rtl', color: '#0F172A' },
    divider: { marginBottom: 16 },
    metricRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, width: '100%' },
    metricValue: { fontWeight: 'bold', lineHeight: 22, minWidth: 80, textAlign: 'left', color: '#0F172A' },
    metricLabel: { flexShrink: 1, textAlign: 'right', paddingLeft: 12, lineHeight: 20, writingDirection: 'rtl', color: '#1E293B' },
    noteCard: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0' },
    noteText: { color: '#64748b', lineHeight: 20, textAlign: 'right', writingDirection: 'rtl' },
    webBackButton: { marginTop: 8, width: '100%', maxWidth: 450 },
});