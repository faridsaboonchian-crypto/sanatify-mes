import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { AuthService, OperatorSession } from '../services/AuthService';

interface RoleGuardProps {
    allowedRoles: ('operator' | 'manager' | 'engineer' | 'warehouse')[];
    children: React.ReactNode;
    navigation: any;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({ allowedRoles, children, navigation }) => {
    const [session, setSession] = useState<OperatorSession | null>(null);
    const [checking, setChecking] = useState(true);

    useEffect(() => {
        const checkAccess = async () => {
            try {
                const currentSession = await AuthService.getCurrentSession();
                setSession(currentSession);
            } catch (err) {
                console.warn('RoleGuard check failed:', err);
            } finally {
                setChecking(false);
            }
        };
        checkAccess();
    }, []);

    if (checking) {
        return (
            <View style={styles.center}>
                <ActivityIndicator size="large" color="#1e3d59" />
            </View>
        );
    }

    // اگر سشن فعال نبود یا نقش کاربر مجاز نبود، دسترسی مسدود می‌شود
    if (!session || !allowedRoles.includes(session.role)) {
        return (
            <View style={styles.center}>
                <Text variant="headlineSmall" style={styles.errorText}>دسترسی غیرمجاز</Text>
                <Text variant="bodyMedium" style={styles.desc}>حساب کاربری شما مجوز ورود به این بخش مانیتورینگ را ندارد.</Text>
                <Button mode="contained" onPress={() => navigation.replace('Login')} style={styles.btn}>
                    بازگشت به صفحه ورود
                </Button>
            </View>
        );
    }

    return <>{children}</>;
};

const styles = StyleSheet.create({
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        backgroundColor: '#f5f7fa',
    },
    errorText: {
        color: '#ff3f3f',
        fontWeight: 'bold',
        marginBottom: 8,
        lineHeight: 32,
        writingDirection: 'rtl',
    },
    desc: {
        color: '#666',
        textAlign: 'center',
        marginBottom: 20,
        lineHeight: 22,
        writingDirection: 'rtl',
    },
    btn: {
        borderRadius: 8,
    },
});