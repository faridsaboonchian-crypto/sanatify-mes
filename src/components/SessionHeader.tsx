import React from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { Avatar, Text, Button, useTheme } from 'react-native-paper';
import { AuthService, OperatorSession } from '../services/AuthService';
import { formatNumberFa } from '../utils/dateUtils'; // ایمپورت مبدل فارسی

interface SessionHeaderProps {
    session: OperatorSession | null;
    navigation: any;
}

export const SessionHeader: React.FC<SessionHeaderProps> = ({ session, navigation }) => {
    const theme = useTheme();

    const handleLogout = async () => {
        try {
            await AuthService.logout();
            navigation.replace('Login');
        } catch (err) {
            Alert.alert('خطا در خروج', 'عملیات خروج از حساب کاربری ناموفق بود.');
        }
    };

    const getRoleIcon = (): string => {
        if (session?.role === 'manager') {
            return 'account-tie';
        }
        if (session?.role === 'engineer') {
            return 'developer-board'; // ست کردن آیکون بورد مهندسی
        }
        return 'account-hard-hat';
    };

    const getRoleTitle = (): string => {
        if (session?.role === 'manager') {
            return 'صفحه مدیریت';
        }
        if (session?.role === 'engineer') {
            return 'میز کار مهندسان/کارشناسان'; // اصلاح عنوان در هدر مشترک متناسب با نقش جدید
        }
        return 'میز کار اپراتور کارگاه';
    };

    return (
        <View style={styles.headerWrapper}>
            <View style={[styles.inlineHeader, { backgroundColor: theme.colors.primary }]}>
                <Text variant="titleMedium" style={styles.inlineHeaderTitle}>
                    {getRoleTitle()}
                </Text>
                <Button
                    compact
                    mode="text"
                    textColor="#ffffff"
                    icon="logout"
                    onPress={handleLogout}
                    style={styles.headerLogoutBtn}
                    labelStyle={styles.logoutLabel}
                >
                    خروج
                </Button>
            </View>

            <View style={styles.avatarContainer}>
                <Avatar.Icon
                    size={64}
                    icon={getRoleIcon()}
                    style={{ backgroundColor: theme.colors.primary }}
                />
                <Text variant="headlineSmall" style={[styles.title, { color: theme.colors.primary }]}>
                    {session ? session.name : 'در حال بارگذاری...'}
                </Text>
                <Text variant="bodyMedium" style={styles.subtitle}>
                    کد پرسنلی: {session ? formatNumberFa(session.personnel_code) : '---'} | {session?.shift_name || 'شیفت ثبت‌نشده'}
                </Text>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    headerWrapper: {
        width: '100%',
        alignItems: 'center',
    },
    inlineHeader: {
        width: '100%',
        paddingVertical: 10,
        paddingHorizontal: 16,
        flexDirection: 'row-reverse',
        alignItems: 'center',
        justifyContent: 'space-between',
        elevation: 4,
    },
    inlineHeaderTitle: {
        color: '#ffffff',
        fontWeight: 'bold',
        lineHeight: 24,
    },
    headerLogoutBtn: {
        margin: 0,
    },
    logoutLabel: {
        fontWeight: 'bold',
        lineHeight: 20,
    },
    avatarContainer: {
        alignItems: 'center',
        marginVertical: 20,
    },
    title: {
        fontWeight: 'bold',
        marginTop: 12,
        textAlign: 'center',
        lineHeight: 32,
        writingDirection: 'rtl',
    },
    subtitle: {
        color: '#666',
        textAlign: 'center',
        marginTop: 4,
        lineHeight: 22,
        writingDirection: 'rtl',
    },
});