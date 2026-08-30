import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Card, Text, useTheme, Avatar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthService, OperatorSession } from '../services/AuthService';
import { SessionHeader } from '../components/SessionHeader';

export default function WarehouseDashboard({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const [session, setSession] = useState<OperatorSession | null>(null);

    useEffect(() => {
        (async () => {
            try {
                const s = await AuthService.getCurrentSession();
                if (s) {
                    setSession(s);
                } else {
                    navigation.replace('Login');
                }
            } catch (e) {
                console.warn('[WarehouseDashboard] session load failed:', e);
            }
        })();
    }, [navigation]);

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <SessionHeader session={session} navigation={navigation} />
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>

                    <Card style={[styles.card, { backgroundColor: '#ffffff', borderColor: theme.colors.outline }]} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={[styles.cardTitle, { color: '#0F172A' }]}>
                                ماژول‌های انبار، ردیابی و لجستیک
                            </Text>
                            <Text style={styles.cardDesc}>
                                صدور پلاک بندیل، ثبت بارگیری تریلی، صدور گواهی MTC و ردیابی کامل از شمش تا محصول نهایی.
                            </Text>
                        </Card.Content>
                    </Card>

                    <Text style={styles.traceSectionTitle}>ردیابی شمش و بسته‌بندی</Text>

                    <Card style={[styles.traceCard, { borderRightColor: '#ea580c' }]} mode="elevated" onPress={() => navigation.navigate('BilletFurnace')}>
                        <Card.Content style={styles.traceCardRow}>
                            <Avatar.Icon size={46} icon="fire" style={{ backgroundColor: '#ea580c' }} />
                            <View style={styles.traceCardTextCol}>
                                <Text variant="titleMedium" style={styles.traceCardTitle}>مدیریت شمش و کوره</Text>
                                <Text variant="bodySmall" style={styles.traceCardDesc}>ثبت ورودی شمش، پایش کوره پیش‌گرم و زمان ماندگاری</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Card style={[styles.traceCard, { borderRightColor: '#0891b2' }]} mode="elevated" onPress={() => navigation.navigate('Bundling')}>
                        <Card.Content style={styles.traceCardRow}>
                            <Avatar.Icon size={46} icon="package-variant-closed" style={{ backgroundColor: '#0891b2' }} />
                            <View style={styles.traceCardTextCol}>
                                <Text variant="titleMedium" style={styles.traceCardTitle}>بسته‌بندی و پلاک بندیل</Text>
                                <Text variant="bodySmall" style={styles.traceCardDesc}>وزن‌کشی باسکول، ثبت سایز میلگرد و چاپ پلاک</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Text style={styles.traceSectionTitle}>ردیابی ذوب و بالانس مواد</Text>

                    <Card style={[styles.traceCard, { borderRightColor: '#7c3aed' }]} mode="elevated" onPress={() => navigation.navigate('Genealogy')}>
                        <Card.Content style={styles.traceCardRow}>
                            <Avatar.Icon size={46} icon="sitemap" style={{ backgroundColor: '#7c3aed' }} />
                            <View style={styles.traceCardTextCol}>
                                <Text variant="titleMedium" style={styles.traceCardTitle}>شجره‌نامه و ردیابی ذوب</Text>
                                <Text variant="bodySmall" style={styles.traceCardDesc}>استعلام شناسنامه کامل محصول، سابقه کوره و بندیل‌ها بر اساس شماره ذوب</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Card style={[styles.traceCard, { borderRightColor: '#15803d' }]} mode="elevated" onPress={() => navigation.navigate('MaterialBalance')}>
                        <Card.Content style={styles.traceCardRow}>
                            <Avatar.Icon size={46} icon="scale-balance" style={{ backgroundColor: '#15803d' }} />
                            <View style={styles.traceCardTextCol}>
                                <Text variant="titleMedium" style={styles.traceCardTitle}>بالانس مواد و راندمان وزنی</Text>
                                <Text variant="bodySmall" style={styles.traceCardDesc}>محاسبه Yield، ضایعات قیچی و افت کوره به تفکیک ذوب یا شیفت</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Text style={styles.traceSectionTitle}>لجستیک و یکپارچگی</Text>

                    <Card style={[styles.traceCard, { borderRightColor: '#0d9488' }]} mode="elevated" onPress={() => navigation.navigate('ShippingDispatch')}>
                        <Card.Content style={styles.traceCardRow}>
                            <Avatar.Icon size={46} icon="truck-delivery" style={{ backgroundColor: '#0d9488' }} />
                            <View style={styles.traceCardTextCol}>
                                <Text variant="titleMedium" style={styles.traceCardTitle}>بارگیری و صدور MTC</Text>
                                <Text variant="bodySmall" style={styles.traceCardDesc}>مدیریت تریلی‌ها، صدور گواهی MTC، خروج و اکسل</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Card style={[styles.traceCard, { borderRightColor: '#2563eb' }]} mode="elevated" onPress={() => navigation.navigate('Sync')}>
                        <Card.Content style={styles.traceCardRow}>
                            <Avatar.Icon size={46} icon="cloud-sync" style={{ backgroundColor: '#2563eb' }} />
                            <View style={styles.traceCardTextCol}>
                                <Text variant="titleMedium" style={styles.traceCardTitle}>همگام‌سازی ابری</Text>
                                <Text variant="bodySmall" style={styles.traceCardDesc}>ارسال دادهٔ کف کارخانه به Supabase برای پنل وب (ابر اول، داخلی پشتیبان)</Text>
                            </View>
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
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 12, color: '#0F172A', lineHeight: 28, writingDirection: 'rtl' },
    cardDesc: { color: '#4a5568', textAlign: 'right', lineHeight: 22, writingDirection: 'rtl' },
    footerText: { marginTop: 20, fontSize: 12, color: '#0F172A', textAlign: 'center', lineHeight: 20 },
    traceSectionTitle: { width: '100%', maxWidth: 400, fontWeight: 'bold', fontSize: 14, color: '#475569', textAlign: 'right', writingDirection: 'rtl', marginTop: 8, marginBottom: 12 },
    traceCard: { width: '100%', maxWidth: 400, borderRadius: 12, elevation: 4, backgroundColor: '#ffffff', marginBottom: 14, borderRightWidth: 5 },
    traceCardRow: { flexDirection: 'row-reverse', alignItems: 'center' },
    traceCardTextCol: { marginRight: 14, flexShrink: 1, alignItems: 'flex-end' },
    traceCardTitle: { fontWeight: 'bold', lineHeight: 24, textAlign: 'right', writingDirection: 'rtl', color: '#0F172A' },
    traceCardDesc: { color: '#64748B', marginTop: 4, lineHeight: 18, textAlign: 'right', writingDirection: 'rtl' },
});