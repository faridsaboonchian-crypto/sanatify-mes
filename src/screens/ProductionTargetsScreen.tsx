import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, TextInput, Divider, List } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase } from '../database/Database';

const ProductionTargetsScreen: React.FC<any> = ({ navigation }) => {
    const theme = useTheme();
    const [productName, setProductName] = useState('');
    const [qty, setQty] = useState('');
    const [activeTarget, setActiveTarget] = useState<any>(null);

    const fetchActiveTarget = async () => {
        try {
            const db = await getDatabase();
            const res = await db.getFirstAsync<any>(`SELECT pt.*, p.name as product_name FROM production_targets pt JOIN products p ON pt.product_id = p.id WHERE pt.status = 'active' ORDER BY pt.created_at DESC LIMIT 1;`);
            setActiveTarget(res);
        } catch (e) {
            console.error('[ProductionTargetsScreen] fetchActiveTarget error:', e);
        }
    };

    useEffect(() => { fetchActiveTarget(); }, []);

    const handleAdd = async () => {
        if (!productName.trim() || !qty.trim()) {
            return Alert.alert('خطا', 'نام محصول و تعداد هدف الزامی است.');
        }
        const parsedQty = parseInt(qty, 10);
        if (isNaN(parsedQty) || parsedQty <= 0) {
            return Alert.alert('خطا', 'تعداد هدف باید یک عدد معتبر و بزرگ‌تر از صفر باشد.');
        }

        try {
            const db = await getDatabase();
            const now = Date.now();

            // ۱. بستن تمام اهداف قبلی فعال (هم در targets هم در jobs برای هماهنگی دو صفحه)
            await db.runAsync(`UPDATE production_targets SET status = 'completed' WHERE status = 'active';`);
            await db.runAsync(`UPDATE production_jobs SET status = 'paused', updated_at = CURRENT_TIMESTAMP WHERE status = 'active';`);

            // ۲. ثبت محصول جدید در جدول محصولات
            const productId = `prod-${now}`;
            await db.runAsync(
                `INSERT INTO products (id, name, ideal_cycle_time_seconds) VALUES (?, ?, 0);`,
                [productId, productName.trim()]
            );

            // ۳. ثبت سفارش تولید (برای دیده‌شدن هدف در میز کار اپراتور)
            const orderId = `order-${now}`;
            const orderNumber = `WO-${now}`;
            await db.runAsync(
                `INSERT INTO production_orders (id, order_number, target_quantity, status, priority, sync_status, created_at, updated_at)
                 VALUES (?, ?, ?, 'active', 3, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
                [orderId, orderNumber, parsedQty]
            );

            // ۴. تخصیص دستور کار فعال به دستگاه پرس (کارت هدف اپراتور از همین جدول می‌خواند)
            const jobId = `job-${now}`;
            await db.runAsync(
                `INSERT INTO production_jobs (id, order_id, product_id, machine_id, status, sync_status, created_at, updated_at)
                 VALUES (?, ?, ?, 'mach-press-01', 'active', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`,
                [jobId, orderId, productId]
            );

            // ۵. صدور دستور کار در جدول اهداف (با کلیدهای خارجی معتبر)
            const targetId = `tgt-${now}`;
            await db.runAsync(
                `INSERT INTO production_targets (id, target_quantity, target_date, target_shift_id, target_machine_id, target_line_id, target_workshop_id, product_id, created_by, status)
                 VALUES (?, ?, date('now'), 'shift-morning-301', 'mach-press-01', 'line-press-03', 'ws-press', ?, 'op-reza-1003', 'active');`,
                [targetId, parsedQty, productId]
            );

            Alert.alert('موفق', 'دستور کار جدید با موفقیت صادر شد و به اپراتور ارسال گردید.');
            setProductName('');
            setQty('');
            fetchActiveTarget();
        } catch (error: any) {
            console.error('[ProductionTargetsScreen ERROR] dispatch failed:', error);
            Alert.alert('خطا در صدور دستور کار', error?.message || 'عملیات ناموفق بود. لطفاً دوباره تلاش کنید.');
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                <Appbar.Content title="صدور دستور کار تولید" color="#ffffff" />
            </Appbar.Header>
            <ScrollView contentContainerStyle={styles.container}>

                {activeTarget && (
                    <Card style={[styles.card, { borderColor: '#10b981', borderWidth: 1 }]}>
                        <Card.Content>
                            <Text style={styles.title}>🎯 هدف فعلی فعال در سالن</Text>
                            <Divider style={styles.divider} />
                            <View style={styles.metricRow}>
                                <Text style={styles.value}>{activeTarget.product_name}</Text>
                                <Text style={styles.label}>محصول:</Text>
                            </View>
                            <View style={styles.metricRow}>
                                <Text style={styles.value}>{activeTarget.target_quantity} عدد</Text>
                                <Text style={styles.label}>تعداد هدف:</Text>
                            </View>
                        </Card.Content>
                    </Card>
                )}

                <Card style={styles.card}>
                    <Card.Content>
                        <Text style={styles.title}>تعریف دستور کار جدید</Text>
                        <Divider style={styles.divider} />

                        <TextInput
                            label="نام محصول (مثال: میلگرد آجدار سایز 16)"
                            value={productName}
                            onChangeText={setProductName}
                            style={styles.input}
                            mode="outlined"
                        />

                        <TextInput
                            label="تعداد هدف (مثال: 1200)"
                            value={qty}
                            onChangeText={setQty}
                            keyboardType="numeric"
                            style={styles.input}
                            mode="outlined"
                        />

                        <Button mode="contained" onPress={handleAdd} icon="send" style={styles.button}>صدور دستور کار شیفت</Button>
                    </Card.Content>
                </Card>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    container: { padding: 16 },
    card: { marginBottom: 16, borderRadius: 12 },
    title: { fontWeight: 'bold', marginBottom: 8, textAlign: 'right', color: '#1a202c' },
    divider: { marginBottom: 12 },
    input: { marginBottom: 12, textAlign: 'right' },
    button: { borderRadius: 8, padding: 4 },
    metricRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', marginBottom: 8 },
    label: { fontSize: 14, color: '#4a5568' },
    value: { fontSize: 16, fontWeight: 'bold', color: '#1e3d59' }
});

export default ProductionTargetsScreen;