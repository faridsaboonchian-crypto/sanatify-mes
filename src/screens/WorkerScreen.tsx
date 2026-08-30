import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Card, Text, Button, useTheme, Avatar, TextInput, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProductionService } from '../services/ProductionService';
import { WasteService } from '../services/WasteService';
import { DowntimeService } from '../services/DowntimeService';
import { OperatorProfileService } from '../services/OperatorProfileService';
import { ProductionTargetService, ActiveTarget } from '../services/ProductionTargetService';
import { AuthService, OperatorSession } from '../services/AuthService';
import { SessionHeader } from '../components/SessionHeader';
import { formatNumberFa } from '../utils/dateUtils';

export default function WorkerScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const machineId = 'mach-press-01';

    // استیت‌ها
    const [session, setSession] = useState<OperatorSession | null>(null);
    const [activeTarget, setActiveTarget] = useState<ActiveTarget | null>(null);
    const [todayProducedCount, setTodayProducedCount] = useState<number>(0);

    const [goodQuantity, setGoodQuantity] = useState('');
    const [prodLoading, setProdLoading] = useState(false);

    const [wasteQuantity, setWasteQuantity] = useState('');
    const [wasteReason, setWasteReason] = useState('');
    const [wasteLoading, setWasteLoading] = useState(false);

    const [activeDowntime, setActiveDowntime] = useState<{ id: string; start_time: string; reason_id: string } | null>(null);
    const [downReason, setDownReason] = useState('');
    const [downLoading, setDownLoading] = useState(false);

    const [editName, setEditName] = useState('');
    const [profileLoading, setProfileLoading] = useState(false);

    const loadShopFloorData = async () => {
        try {
            const activeSession = await AuthService.getCurrentSession();
            if (activeSession) {
                setSession(activeSession);
                setEditName(activeSession.name);
            } else {
                navigation.replace('Login');
                return;
            }

            const [target, todayCount, ongoingDowntime] = await Promise.all([
                ProductionTargetService.getActiveTargetForMachine(machineId),
                ProductionService.getTodayProductionCount(),
                DowntimeService.getActiveDowntime(machineId),
            ]);

            setActiveTarget(target);
            setTodayProducedCount(todayCount);
            setActiveDowntime(ongoingDowntime);
        } catch (err) {
            console.warn('Failed to load shop floor data:', err);
        }
    };

    useEffect(() => {
        loadShopFloorData();
    }, []);

    const handleRegisterProduction = async () => {
        const qty = parseInt(goodQuantity, 10);
        if (isNaN(qty) || qty <= 0) {
            Alert.alert('خطا در ورود داده', 'لطفاً تعداد تولید معتبر وارد کنید.');
            return;
        }
        if (!session) return;

        try {
            setProdLoading(true);

            // استخراج کامل و داینامیک کانتکست ۸ پارامتری MES
            const operatorId = session.id;
            const productId = activeTarget ? activeTarget.productId : "prod-a-201";
            const shiftId = session.active_shift_id || "shift-morning-301";
            const activeMachineId = session.machine_id || "mach-press-01";
            const lineId = session.line_id || "line-press-03";
            const workshopId = session.workshop_id || "ws-press";
            const targetId = activeTarget ? activeTarget.jobId : null;

            // فراخوانی متد ۸ پارامتری نوین سرویس تولید
            await ProductionService.createProductionLog(
                operatorId,
                productId,
                shiftId,
                qty,
                activeMachineId,
                lineId,
                workshopId,
                targetId
            );

            Alert.alert('ثبت موفق', `تعداد ${formatNumberFa(qty)} قطعه تولید سالم با موفقیت ثبت شد.`);
            setGoodQuantity('');
            loadShopFloorData();
        } catch (error: any) {
            Alert.alert('خطا در ثبت', error?.message || 'عملیات ناموفق بود.');
        } finally {
            setProdLoading(false);
        }
    };

    const handleRegisterWaste = async () => {
        const qty = parseInt(wasteQuantity, 10);
        if (isNaN(qty) || qty <= 0 || !wasteReason.trim()) {
            Alert.alert('خطا در ورود داده', 'لطفاً تعداد ضایعات و علت آن را به طور کامل وارد کنید.');
            return;
        }
        if (!session) return;

        try {
            setWasteLoading(true);
            const shiftId = session.active_shift_id || 'shift-morning-301';
            await WasteService.createWasteLog(shiftId, wasteReason.trim(), qty, session.id);
            Alert.alert('ثبت موفق', `آمار ضایعات تعداد ${formatNumberFa(qty)} قطعه با موفقیت ثبت گردید.`);
            setWasteQuantity('');
            setWasteReason('');
            loadShopFloorData();
        } catch (error: any) {
            Alert.alert('خطا در ثبت ضایعات', error?.message || 'عملیات ناموفق بود.');
        } finally {
            setWasteLoading(false);
        }
    };

    const handleStartDowntime = async () => {
        if (!downReason.trim()) {
            Alert.alert('خطا در ورود داده', 'لطفاً علت توقف دستگاه را وارد کنید.');
            return;
        }
        if (!session) return;

        try {
            setDownLoading(true);
            const shiftId = session.active_shift_id || 'shift-morning-301';
            const startTime = new Date().toISOString();
            await DowntimeService.createDowntimeLog(shiftId, downReason.trim(), startTime);
            Alert.alert('ثبت توقف', 'رویداد توقف دستگاه آغاز شد. ماشین به حالت خاموش در آمد.');
            setDownReason('');
            loadShopFloorData();
        } catch (error: any) {
            Alert.alert('خطا در شروع توقف', error?.message || 'عملیات ناموفق بود.');
        } finally {
            setDownLoading(false);
        }
    };

    const handleEndDowntime = async () => {
        if (!activeDowntime) return;

        try {
            setDownLoading(true);
            const endTime = new Date().toISOString();

            const startMs = new Date(activeDowntime.start_time).getTime();
            const endMs = new Date(endTime).getTime();
            const durationMinutes = Math.max(1, Math.round((endMs - startMs) / (1000 * 60)));

            await DowntimeService.closeDowntimeLog(activeDowntime.id, endTime, durationMinutes);
            Alert.alert('راه‌اندازی مجدد', `توقف با ثبت مدت زمان ${formatNumberFa(durationMinutes)} دقیقه با موفقیت بسته شد. خط تولید بیدار شد.`);
            loadShopFloorData();
        } catch (error: any) {
            Alert.alert('خطا در پایان توقف', error?.message || 'عملیات ناموفق بود.');
        } finally {
            setDownLoading(false);
        }
    };

    const handleUpdateProfile = async () => {
        if (!editName.trim()) {
            Alert.alert('خطا', 'لطفاً نام خود را وارد کنید.');
            return;
        }
        if (!session) return;

        try {
            setProfileLoading(true);
            await OperatorProfileService.updateProfileName(session.id, editName.trim());
            Alert.alert('موفقیت', 'مشخصات هویتی شما در پایگاه‌داده محلی با موفقیت اصلاح شد.');
            loadShopFloorData();
        } catch (error: any) {
            Alert.alert('خطا در به‌روزرسانی', error?.message || 'عملیات ناموفق بود.');
        } finally {
            setProfileLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <SessionHeader session={session} navigation={navigation} />

            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>

                    {activeTarget ? (
                        <Card style={[styles.card, styles.targetCard]} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={styles.targetCardTitle}>هدف تولید فعال شیفت جاری</Text>
                                <Divider style={styles.divider} />
                                <View style={styles.metricRow}>
                                    <Text variant="bodyLarge" style={{ fontWeight: 'bold', color: theme.colors.primary }}>{activeTarget.productName}</Text>
                                    <Text variant="bodyMedium">محصول در حال ساخت:</Text>
                                </View>
                                <View style={styles.metricRow}>
                                    <Text variant="bodyLarge" style={{ fontWeight: 'bold', color: theme.colors.secondary }}>{formatNumberFa(todayProducedCount)} از {formatNumberFa(activeTarget.targetQuantity)} قطعه</Text>
                                    <Text variant="bodyMedium">میزان پیشرفت فیزیکی کار:</Text>
                                </View>
                            </Card.Content>
                        </Card>
                    ) : (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content style={{ alignItems: 'center' }}>
                                <Text variant="bodyMedium" style={{ color: '#888' }}>هیچ هدف تولید فعالی از سمت سرپرست صادر نشده است.</Text>
                            </Card.Content>
                        </Card>
                    )}

                    {activeDowntime ? (
                        <Card style={[styles.card, styles.downtimeActiveCard]} mode="elevated">
                            <Card.Content>
                                <View style={styles.downtimeAlertHeader}>
                                    <Avatar.Icon size={32} icon="alert-decagram" style={{ backgroundColor: theme.colors.error }} />
                                    <Text variant="titleMedium" style={styles.downtimeAlertText}>دستگاه در وضعیت خاموش / توقف فیزیکی است!</Text>
                                </View>
                                <Text variant="bodyMedium" style={styles.downtimeDesc}>علت خرابی: {activeDowntime.reason_id}</Text>
                                <Button
                                    mode="contained"
                                    icon="play-circle"
                                    loading={downLoading}
                                    disabled={downLoading}
                                    onPress={handleEndDowntime}
                                    style={[styles.registerButton, { backgroundColor: theme.colors.secondary, marginTop: 14 }]}
                                    labelStyle={styles.registerButtonLabel}
                                >
                                    ثبت پایان توقف و راه‌اندازی خط
                                </Button>
                            </Card.Content>
                        </Card>
                    ) : (
                        <Card style={styles.card} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={styles.cardTitle}>ثبت شروع توقف دستگاه پرس PR-01</Text>
                                <TextInput
                                    label="علت بروز توقف فیزیکی (مثال: خرابی قالب)"
                                    mode="outlined"
                                    value={downReason}
                                    onChangeText={setDownReason}
                                    style={styles.input}
                                    left={<TextInput.Icon icon="wrench-clock" />}
                                />
                                <Button
                                    mode="contained"
                                    icon="alert-octagon"
                                    loading={downLoading}
                                    disabled={downLoading}
                                    onPress={handleStartDowntime}
                                    style={[styles.registerButton, { backgroundColor: theme.colors.error }]}
                                    labelStyle={styles.registerButtonLabel}
                                >
                                    ثبت شروع توقف خط
                                </Button>
                            </Card.Content>
                        </Card>
                    )}

                    {!activeDowntime && (
                        <Card style={[styles.card, styles.actionCard]} mode="elevated">
                            <Card.Content>
                                <Text variant="titleMedium" style={styles.cardTitle}>ثبت کارکرد قطعات سالم</Text>
                                <TextInput
                                    label="تعداد قطعات سالم تولیدشده"
                                    mode="outlined"
                                    value={goodQuantity}
                                    onChangeText={setGoodQuantity}
                                    keyboardType="numeric"
                                    style={styles.input}
                                    left={<TextInput.Icon icon="counter" />}
                                />
                                <Button
                                    mode="contained"
                                    icon="plus-circle"
                                    onPress={handleRegisterProduction}
                                    loading={prodLoading}
                                    disabled={prodLoading}
                                    style={[styles.registerButton, { backgroundColor: theme.colors.primary }]}
                                    labelStyle={styles.registerButtonLabel}
                                >
                                    ثبت تولید سالم
                                </Button>
                            </Card.Content>
                        </Card>
                    )}

                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>ثبت ضایعات تولید</Text>
                            <TextInput
                                label="تعداد قطعات معیوب / ضایعاتی"
                                mode="outlined"
                                value={wasteQuantity}
                                onChangeText={setWasteQuantity}
                                keyboardType="numeric"
                                style={styles.input}
                                left={<TextInput.Icon icon="numeric" />}
                            />
                            <TextInput
                                label="علت بروز ضایعات (مثال: پلیسه داشتن لبه ورق)"
                                mode="outlined"
                                value={wasteReason}
                                onChangeText={setWasteReason}
                                style={styles.input}
                                left={<TextInput.Icon icon="alert-outline" />}
                            />
                            <Button
                                mode="contained"
                                icon="minus-circle"
                                onPress={handleRegisterWaste}
                                loading={wasteLoading}
                                disabled={wasteLoading}
                                style={[styles.registerButton, { backgroundColor: theme.colors.error }]}
                                labelStyle={styles.registerButtonLabel}
                            >
                                ثبت ضایعات کارگاه
                            </Button>
                        </Card.Content>
                    </Card>

                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>ویرایش اطلاعات کاربری من</Text>
                            <TextInput
                                label="نام و نام خانوادگی اپراتور"
                                mode="outlined"
                                value={editName}
                                onChangeText={setEditName}
                                style={styles.input}
                                left={<TextInput.Icon icon="account-edit" />}
                            />
                            <Button
                                mode="contained"
                                icon="check"
                                onPress={handleUpdateProfile}
                                loading={profileLoading}
                                disabled={profileLoading}
                                style={[styles.registerButton, { backgroundColor: theme.colors.secondary }]}
                                labelStyle={styles.registerButtonLabel}
                            >
                                ذخیره اطلاعات من
                            </Button>
                        </Card.Content>
                    </Card>

                    <Text style={styles.footerText}>
                        متصل به دیتابیس بومی آفلاین کارگاه: sanatify.db
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
    scrollContainer: {
        flexGrow: 1,
        justifyContent: 'center',
        paddingVertical: 16,
    },
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        width: '100%',
    },
    card: {
        width: '100%',
        maxWidth: 400,
        borderRadius: 12,
        elevation: 4,
        backgroundColor: '#ffffff',
        marginBottom: 16,
    },
    targetCard: {
        borderColor: '#4caf50',
        borderWidth: 1,
    },
    targetCardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        color: '#4caf50',
        lineHeight: 24,
        writingDirection: 'rtl',
    },
    actionCard: {
        borderColor: '#e0e0e0',
        borderWidth: 1,
    },
    downtimeActiveCard: {
        borderColor: '#ff3f3f',
        borderWidth: 1.5,
        backgroundColor: '#fffbe6',
    },
    downtimeAlertHeader: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
        marginBottom: 10,
        width: '100%',
    },
    downtimeAlertText: {
        color: '#ff3f3f',
        fontWeight: 'bold',
        marginRight: 10,
        lineHeight: 24,
        flexShrink: 1,
        textAlign: 'right',
        writingDirection: 'rtl',
    },
    downtimeDesc: {
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#333',
        lineHeight: 20,
        marginBottom: 6,
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 16,
        color: '#333',
        lineHeight: 28,
        writingDirection: 'rtl',
    },
    divider: {
        marginBottom: 12,
    },
    metricRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        width: '100%',
    },
    input: {
        marginBottom: 16,
        textAlign: 'right',
    },
    registerButton: {
        borderRadius: 8,
        paddingVertical: 4,
    },
    registerButtonLabel: {
        fontSize: 15,
        fontWeight: 'bold',
        lineHeight: 24,
    },
    footerText: {
        marginTop: 20,
        fontSize: 12,
        color: '#888',
        textAlign: 'center',
        lineHeight: 20,
    },
});