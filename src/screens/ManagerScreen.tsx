import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Card, Text, Button, useTheme, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthService, OperatorSession } from '../services/AuthService';
import { SessionHeader } from '../components/SessionHeader';
import { getDatabase } from '../database/Database';

interface ManagerScreenProps {
    navigation: {
        replace: (routeName: string) => void;
        navigate: (routeName: string) => void;
    };
}

export default function ManagerScreen({ navigation }: ManagerScreenProps) {
    const theme = useTheme();
    const [session, setSession] = useState<OperatorSession | null>(null);
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
                    }
                }
            } catch (e) { }
        })();
    }, []);

    useEffect(() => {
        const loadSession = async () => {
            try {
                const activeSession = await AuthService.getCurrentSession();
                if (activeSession) {
                    setSession(activeSession);
                } else {
                    navigation.replace('Login');
                }
            } catch (err) {
                console.warn('Failed to load active session in ManagerScreen:', err);
            }
        };
        loadSession();
    }, [navigation]);

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <SessionHeader session={session} navigation={navigation} />
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>
                    {flaggedMachines.length > 0 && (
                        <Card style={styles.alertCard} mode="outlined">
                            <Card.Content>
                                <Text style={styles.alertTitle}>⚠ هشدار انحراف کیفیت متوالی</Text>
                                <Text style={styles.alertBody}>
                                    دو آزمون QC پیاپی مغایر استاندارد بوده‌اند. بررسی قالب یا مواد اولیه الزامی است.
                                </Text>
                                {flaggedMachines.map(m => (
                                    <Text key={m} style={styles.alertMachine}>• {m}</Text>
                                ))}
                            </Card.Content>
                        </Card>
                    )}

                    <Card style={[styles.card, { backgroundColor: '#ffffff', borderColor: theme.colors.outline }]} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={[styles.cardTitle, { color: '#0F172A' }]}>
                                فرم‌ها و دسترسی‌های سریع مدیریت کارخانه
                            </Text>
                            <Divider style={[styles.divider, { backgroundColor: theme.colors.outline }]} />
                            <Button mode="contained" icon="clock-outline" onPress={() => navigation.navigate('ShiftManagement')} style={[styles.button, { backgroundColor: '#6366f1', borderColor: '#6366f1' }]} labelStyle={styles.buttonLabel}>مدیریت شیفت‌های کاری</Button>
                            <Button mode="contained" icon="target" onPress={() => navigation.navigate('ProductionTargets')} style={[styles.button, { backgroundColor: '#f59e0b', borderColor: '#f59e0b' }]} labelStyle={styles.buttonLabel}>تعریف اهداف تولید (میلگرد)</Button>
                            <Button mode="contained" icon="office-building" onPress={() => navigation.navigate('ManagerWorkshop')} style={[styles.button, { backgroundColor: theme.colors.primary }]} labelStyle={styles.buttonLabel}>تنظیمات سالن و خطوط فعال</Button>
                            <Button mode="contained" icon="account-group" onPress={() => navigation.navigate('UserManagement')} style={[styles.button, { backgroundColor: '#10B981', borderColor: '#10B981' }]} labelStyle={styles.buttonLabel}>مدیریت دسترسی و پرسنل</Button>
                            <Button mode="contained" icon="developer-board" onPress={() => navigation.navigate('IndustrialDashboard')} style={[styles.button, { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]} labelStyle={styles.buttonLabel}>داشبورد هوش صنعتی کارخانه</Button>
                            <Button mode="outlined" icon="database-search" onPress={() => navigation.navigate('History')} style={[styles.button, { borderColor: theme.colors.primary }]} labelStyle={[styles.buttonLabel, { color: theme.colors.primary }]}>گزارشات و تاریخچه کلی</Button>
                        </Card.Content>
                    </Card>

                    <Text style={[styles.footerText, { color: '#0F172A' }]}>متصل به دیتابیس بومی آفلاین: sanatify.db</Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    scrollContainer: { flexGrow: 1, justifyContent: 'center', paddingVertical: 16 },
    container: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, width: '100%' },
    card: { width: '100%', maxWidth: 400, borderRadius: 12, elevation: 4, backgroundColor: '#ffffff', marginBottom: 16 },
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 20, color: '#0F172A', lineHeight: 28, writingDirection: 'rtl' },
    divider: { marginBottom: 16 },
    button: { marginBottom: 14, borderRadius: 8, paddingVertical: 6 },
    buttonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    footerText: { marginTop: 20, fontSize: 12, color: '#0F172A', textAlign: 'center', lineHeight: 20 },
    alertCard: { width: '100%', maxWidth: 400, borderRadius: 12, marginBottom: 16, backgroundColor: 'rgba(248, 113, 113, 0.08)', borderColor: '#F87171', borderWidth: 1.5 },
    alertTitle: { fontWeight: 'bold', fontSize: 15, color: '#b91c1c', textAlign: 'right', marginBottom: 6 },
    alertBody: { fontSize: 13, color: '#7f1d1d', textAlign: 'right', lineHeight: 20, marginBottom: 4 },
    alertMachine: { fontSize: 13, fontWeight: 'bold', color: '#991b1b', textAlign: 'right', marginBottom: 2 },
    traceSectionTitle: { width: '100%', maxWidth: 400, fontWeight: 'bold', fontSize: 15, color: '#0F172A', textAlign: 'right', writingDirection: 'rtl', marginTop: 4, marginBottom: 12 },
    traceCard: { width: '100%', maxWidth: 400, borderRadius: 12, elevation: 4, backgroundColor: '#ffffff', marginBottom: 14, borderRightWidth: 5 },
    traceCardRow: { flexDirection: 'row-reverse', alignItems: 'center' },
    traceCardTextCol: { marginRight: 14, flexShrink: 1, alignItems: 'flex-end' },
    traceCardTitle: { fontWeight: 'bold', lineHeight: 24, textAlign: 'right', writingDirection: 'rtl', color: '#0F172A' },
    traceCardDesc: { color: '#64748B', marginTop: 4, lineHeight: 18, textAlign: 'right', writingDirection: 'rtl' },
});