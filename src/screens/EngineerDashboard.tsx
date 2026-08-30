import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import { Card, Text, Button, useTheme, Appbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase } from '../database/Database';

const EngineerDashboard: React.FC<any> = ({ navigation }) => {
    const theme = useTheme();
    const [flaggedMachines, setFlaggedMachines] = useState<string[]>([]);

    useEffect(() => {
        (async () => {
            try {
                const db = await getDatabase();
                const rows = await db.getAllAsync<{ rebar_size: string; bend_test_passed: number; visual_inspection: number; timestamp: string }>(
                    `SELECT rebar_size, bend_test_passed, visual_inspection, timestamp FROM quality_inspections ORDER BY timestamp DESC LIMIT 2;`
                );
                if (rows.length === 2) {
                    const test1Failed = rows[0].bend_test_passed === 0 || rows[0].visual_inspection === 0;
                    const test2Failed = rows[1].bend_test_passed === 0 || rows[1].visual_inspection === 0;
                    if (test1Failed && test2Failed) {
                        setFlaggedMachines([`خط تولید سایز ${rows[0].rebar_size}`]);
                    } else {
                        setFlaggedMachines([]);
                    }
                } else {
                    setFlaggedMachines([]);
                }
            } catch (e) {
                console.warn('[EngineerDashboard] Failed to check consecutive QC failures:', e);
            }
        })();
    }, []);

    const handleGoBack = () => {
        try {
            if (navigation.canGoBack()) {
                navigation.goBack();
            } else {
                navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            }
        } catch (e) {
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={handleGoBack} color="#ffffff" />
                    <Appbar.Content title="واحد مهندسی"
                        color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer}>
                <View style={styles.container}>
                    {flaggedMachines.length > 0 && (
                        <Card style={styles.alertCard} mode="outlined">
                            <Card.Content>
                                <Text style={styles.alertTitle}>⚠ هشدار انحراف کیفیت متوالی</Text>
                                <Text style={styles.alertBody}>
                                    دستگاه{flaggedMachines.length > 1 ? '‌های' : ''} زیر در دو آزمون QC پیاپی مغایر استاندارد A3 بوده‌اند:
                                </Text>
                                {flaggedMachines.map(m => (
                                    <Text key={m} style={styles.alertMachine}>• {m}</Text>
                                ))}
                                <Text style={styles.alertHint}>پیشنهاد می‌شود قالب یا مواد اولیه این خط بررسی شود.</Text>
                            </Card.Content>
                        </Card>
                    )}

                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text style={styles.cardTitle}>کنترل کیفیت</Text>
                            <Text style={styles.cardDesc}>
                                ثبت نتایج آزمون کشش، خمش و بازرسی ظاهری.
                            </Text>
                        </Card.Content>
                        <Card.Actions>
                            <Button
                                mode="contained"
                                onPress={() => navigation.navigate('QCInspection')}
                                icon="clipboard-check-outline"
                                style={styles.actionButton}
                            >
                                فرم کنترل کیفیت
                            </Button>
                        </Card.Actions>
                    </Card>

                    <Card style={[styles.card, { marginTop: 16 }]} mode="elevated">
                        <Card.Content>
                            <Text style={styles.cardTitle}>گزارش‌گیری کنترل کیفیت</Text>
                            <Text style={styles.cardDesc}>
                                خروجی اکسل رکوردهای QC و صدور گواهی انطباق استاندارد A3.
                            </Text>
                        </Card.Content>
                        <Card.Actions>
                            <Button
                                mode="contained"
                                onPress={() => navigation.navigate('QCExport')}
                                icon="file-excel-outline"
                                style={[styles.actionButton, { backgroundColor: '#15803d' }]}
                            >
                                خروجی اکسل و گواهی
                            </Button>
                        </Card.Actions>
                    </Card>

                    <Card style={[styles.card, { marginTop: 16 }]} mode="elevated">
                        <Card.Content>
                            <Text style={styles.cardTitle}>تعمیرات و قابلیت اطمینان</Text>
                            <Text style={styles.cardDesc}>
                                ثبت تعمیرات اضطراری، محاسبه شاخص‌های MTTR و MTBF دستگاه‌ها.
                            </Text>
                        </Card.Content>
                        <Card.Actions>
                            <Button
                                mode="contained"
                                onPress={() => navigation.navigate('MaintenanceScreen')}
                                icon="wrench-clock"
                                style={[styles.actionButton, { backgroundColor: '#dc2626' }]}
                            >
                                پنل تعمیرات و MTTR
                            </Button>
                        </Card.Actions>
                    </Card>

                    <Card style={[styles.card, { marginTop: 16 }]} mode="elevated">
                        <Card.Content>
                            <Text style={styles.cardTitle}>تحلیل و آمار</Text>
                            <Text style={styles.cardDesc}>
                                مشاهده OEE و وضعیت لحظه‌ای تولید.
                            </Text>
                        </Card.Content>
                        <Card.Actions>
                            <Button
                                mode="outlined"
                                onPress={() => navigation.navigate('OnlineDashboard')}
                                icon="chart-line"
                                style={styles.actionButton}
                            >
                                داشبورد آنلاین
                            </Button>
                        </Card.Actions>
                    </Card>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18 },
    scrollContainer: { flexGrow: 1, paddingVertical: 16 },
    container: { alignItems: 'center', paddingHorizontal: 16, width: '100%' },
    card: { width: '100%', maxWidth: 450, borderRadius: 12, backgroundColor: '#ffffff' },
    cardTitle: { fontWeight: 'bold', marginBottom: 8, textAlign: 'right', fontSize: 18, color: '#1a202c' },
    cardDesc: { marginBottom: 10, color: '#4a5568', textAlign: 'right', lineHeight: 22, fontSize: 16 },
    actionButton: { marginTop: 8, borderRadius: 8 },
    alertCard: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: 'rgba(248, 113, 113, 0.08)',
        borderColor: '#F87171',
        borderWidth: 1.5,
    },
    alertTitle: { fontWeight: 'bold', fontSize: 15, color: '#b91c1c', textAlign: 'right', marginBottom: 6 },
    alertBody: { fontSize: 13, color: '#7f1d1d', textAlign: 'right', lineHeight: 20, marginBottom: 4 },
    alertMachine: { fontSize: 13, fontWeight: 'bold', color: '#991b1b', textAlign: 'right', marginBottom: 2 },
    alertHint: { fontSize: 12, color: '#7f1d1d', textAlign: 'right', marginTop: 6, fontStyle: 'italic' },
    traceSectionTitle: {
        width: '100%',
        maxWidth: 450,
        fontWeight: 'bold',
        fontSize: 15,
        color: '#0F172A',
        textAlign: 'right',
        writingDirection: 'rtl',
        marginTop: 20,
        marginBottom: 12,
    },
    traceCard: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 12,
        elevation: 4,
        backgroundColor: '#ffffff',
        marginBottom: 14,
        borderRightWidth: 5,
    },
    traceCardRow: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
    },
    traceCardTextCol: {
        marginRight: 14,
        flexShrink: 1,
        alignItems: 'flex-end',
    },
    traceCardTitle: {
        fontWeight: 'bold',
        lineHeight: 24,
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#0F172A',
    },
    traceCardDesc: {
        color: '#64748B',
        marginTop: 4,
        lineHeight: 18,
        textAlign: 'right',
        writingDirection: 'rtl',
    },
});

export default EngineerDashboard;