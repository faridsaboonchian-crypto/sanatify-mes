import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert } from 'react-native';
import { Card, Text, Button, TextInput, useTheme, HelperText, Portal, Dialog, Avatar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthService, OperatorSession } from '../services/AuthService';

type ActiveRole = 'operator' | 'manager' | 'engineer' | 'warehouse' | null;

const convertToEnglishDigits = (str: string) => {
    if (!str) return '';
    const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
    const arabicDigits = '٠١٢٣٤٥٦٧٨٩';
    return str.replace(/[۰-۹٠-٩]/g, (d) => {
        if (persianDigits.includes(d)) return String(persianDigits.indexOf(d));
        if (arabicDigits.includes(d)) return String(arabicDigits.indexOf(d));
        return d;
    });
};

export default function LoginScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    const [activeRole, setActiveRole] = useState<ActiveRole>(null);
    const [personnelCode, setPersonnelCode] = useState('');
    const [password, setPassword] = useState('');
    const [secureText, setSecureText] = useState(true);
    const [errorMsg, setErrorMsg] = useState('');
    const [loading, setLoading] = useState(false);

    const handleOpenLogin = (role: 'operator' | 'manager' | 'engineer' | 'warehouse') => {
        setActiveRole(role);
        setErrorMsg('');
        setPersonnelCode('');
        setPassword('');
    };

    const handleLoginSubmit = async () => {
        setErrorMsg('');
        const code = convertToEnglishDigits(personnelCode).trim();
        const pass = convertToEnglishDigits(password).trim();
        console.log('[LoginScreen] submit clicked ->', { code, passLength: pass.length });

        if (!code || !pass) {
            setErrorMsg('لطفاً مشخصات را کامل وارد کنید.');
            return;
        }

        const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string): Promise<T> =>
            Promise.race([
                p,
                new Promise<T>((_, reject) =>
                    setTimeout(() => reject(new Error(msg)), ms)
                ),
            ]);

        try {
            setLoading(true);

            const isSuccess = await withTimeout(
                AuthService.validateOperatorLogin(code, pass),
                20000,
                'پاسخی از دیتابیس دریافت نشد. لطفاً برنامه را کامل بسته و دوباره باز کنید.'
            );

            if (isSuccess) {
                const session: OperatorSession | null = await withTimeout(
                    AuthService.getCurrentSession(),
                    15000,
                    'بارگذاری نشست با تأخیر مواجه شد.'
                );
                setActiveRole(null);

                if (session) {
                    const roleStr = session.role as string;
                    console.log('[LoginScreen] navigating for role =', roleStr);
                    if (roleStr === 'manager') {
                        navigation.replace('ManagerDashboard');
                    } else if (roleStr === 'engineer') {
                        navigation.replace('EngineerDashboard');
                    } else if (roleStr === 'warehouse') {
                        navigation.replace('WarehouseDashboard');
                    } else {
                        navigation.replace('OperatorDashboard');
                    }
                } else {
                    setErrorMsg('نشست فعال یافت نشد.');
                }
            } else {
                setErrorMsg('کد پرسنلی یا رمز عبور اشتباه است.');
            }
        } catch (err: any) {
            console.error('[LoginScreen ERROR]', err);
            setErrorMsg(err?.message || 'خطا در ارتباط با دیتابیس محلی.');
            Alert.alert('خطای سیستمی', `جزئیات خطا: ${err?.message || 'نامعلوم'}`);
        } finally {
            setLoading(false);
            console.log('[LoginScreen] submit finished -> loading reset to false');
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>

                    <View style={styles.headerContainer}>
                        <Text style={[styles.appTitle, { color: theme.colors.primary }]}>
                            سامانه هوشمند مانیتورینگ تولید
                        </Text>
                        <Text style={styles.appSubtitle}>
                            بستر کنترل یکپارچه چندسکویی کارخانه (MES)
                        </Text>
                    </View>

                    <Text variant="titleMedium" style={styles.selectRoleTitle}>لطفاً درگاه امنیتی ورود خود را انتخاب کنید:</Text>

                    <Card style={styles.roleCard} mode="elevated" onPress={() => handleOpenLogin('operator')}>
                        <Card.Content style={styles.cardRow}>
                            <Avatar.Icon size={40} icon="account-hard-hat" style={{ backgroundColor: theme.colors.primary }} />
                            <View style={styles.cardTextCol}>
                                <Text variant="titleMedium" style={styles.cardTitle}>ورود اپراتور سالن تولید</Text>
                                <Text variant="bodySmall" style={styles.cardDesc}>ثبت آمار تولید، ضایعات و خاموشی دستگاه</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Card style={styles.roleCard} mode="elevated" onPress={() => handleOpenLogin('engineer')}>
                        <Card.Content style={styles.cardRow}>
                            <Avatar.Icon size={40} icon="developer-board" style={{ backgroundColor: '#ff9800' }} />
                            <View style={styles.cardTextCol}>
                                <Text variant="titleMedium" style={styles.cardTitle}>ورود مهندس و کارشناس ارشد</Text>
                                <Text variant="bodySmall" style={styles.cardDesc}>آنالیز OEE، برنامه‌ریزی تولید و شاخص‌های MTTR/MTBF</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Card style={styles.roleCard} mode="elevated" onPress={() => handleOpenLogin('warehouse')}>
                        <Card.Content style={styles.cardRow}>
                            <Avatar.Icon size={40} icon="warehouse" style={{ backgroundColor: '#0d9488' }} />
                            <View style={styles.cardTextCol}>
                                <Text variant="titleMedium" style={styles.cardTitle}>ورود کارشناس انبار و لجستیک</Text>
                                <Text variant="bodySmall" style={styles.cardDesc}>صدور پلاک بندیل، بارگیری تریلی، صدور MTC و ردیابی شمش</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Card style={styles.roleCard} mode="elevated" onPress={() => handleOpenLogin('manager')}>
                        <Card.Content style={styles.cardRow}>
                            <Avatar.Icon size={40} icon="account-tie" style={{ backgroundColor: theme.colors.secondary }} />
                            <View style={styles.cardTextCol}>
                                {/* اصلاح متن به "ورود مدیریت" */}
                                <Text variant="titleMedium" style={styles.cardTitle}>ورود مدیریت</Text>
                                <Text variant="bodySmall" style={styles.cardDesc}>کنترل پرسنل، تعریف سالن‌ها و واگذاری اهداف تولید</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Text style={styles.versionText}>
                        معماری امنیتی تجاری چندنقشی - آفلاین-اول (Offline-First)
                    </Text>
                </View>
            </ScrollView>

            <Portal>
                <Dialog visible={activeRole !== null} onDismiss={() => setActiveRole(null)}>
                    <Dialog.Title style={styles.dialogTitle}>تایید هویت پرسنلی</Dialog.Title>
                    <Dialog.Content>
                        <TextInput
                            label="کد پرسنلی"
                            mode="outlined"
                            value={personnelCode}
                            onChangeText={(text) => setPersonnelCode(convertToEnglishDigits(text))}
                            keyboardType="numeric"
                            style={styles.input}
                            left={<TextInput.Icon icon="account" />}
                        />
                        <TextInput
                            label="رمز عبور"
                            mode="outlined"
                            value={password}
                            onChangeText={(text) => setPassword(convertToEnglishDigits(text))}
                            secureTextEntry={secureText}
                            style={styles.input}
                            left={<TextInput.Icon icon="lock" />}
                            right={<TextInput.Icon icon={secureText ? "eye" : "eye-off"} onPress={() => setSecureText(!secureText)} />}
                        />
                        <HelperText type="error" visible={errorMsg !== ''} style={styles.errorText}>
                            {errorMsg}
                        </HelperText>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setActiveRole(null)}>انصراف</Button>
                        <Button onPress={handleLoginSubmit} loading={loading} disabled={loading}>تایید ورود</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
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
        paddingHorizontal: 16,
        width: '100%',
    },
    headerContainer: {
        alignItems: 'center',
        marginBottom: 24,
    },
    appTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 8,
        lineHeight: 30,
    },
    appSubtitle: {
        fontSize: 14,
        color: '#666',
        textAlign: 'center',
        lineHeight: 22,
    },
    selectRoleTitle: {
        textAlign: 'right',
        width: '100%',
        maxWidth: 450,
        marginBottom: 12,
        fontWeight: 'bold',
        color: '#555',
    },
    roleCard: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 12,
        marginBottom: 12,
        backgroundColor: '#ffffff',
    },
    cardRow: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
    },
    cardTextCol: {
        marginRight: 12,
        flexShrink: 1,
        alignItems: 'flex-end',
    },
    cardTitle: {
        fontWeight: 'bold',
        lineHeight: 22,
    },
    cardDesc: {
        color: '#777',
        marginTop: 2,
        lineHeight: 16,
        textAlign: 'right',
    },
    dialogTitle: {
        textAlign: 'right',
        fontWeight: 'bold',
    },
    input: {
        marginBottom: 8,
        textAlign: 'right',
    },
    errorText: {
        textAlign: 'right',
        lineHeight: 18,
        fontWeight: 'bold',
    },
    versionText: {
        marginTop: 24,
        fontSize: 12,
        color: '#999',
        textAlign: 'center',
        lineHeight: 18,
    },
});