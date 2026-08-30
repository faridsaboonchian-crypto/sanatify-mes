import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, RefreshControl } from 'react-native';
import { Card, Text, Button, useTheme, Divider, Portal, Dialog, TextInput, List, Avatar, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthService, OperatorSession } from '../services/AuthService';
import { InventoryService } from '../services/InventoryService';
import { StockAlertService } from '../services/StockAlertService';
import { SessionHeader } from '../components/SessionHeader';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';

export default function EmployeeDashboard({ navigation }: { navigation: any }) {
    const theme = useTheme();

    const [session, setSession] = useState<OperatorSession | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    // استیت‌های لایو انبار
    const [rawStock, setRawStock] = useState<any[]>([]);
    const [lineStock, setLineStock] = useState<any[]>([]);
    const [alerts, setAlerts] = useState<any[]>([]);
    const [recentTransactions, setRecentTransactions] = useState<any[]>([]); // کارتابل تراکنش‌ها

    // استیت‌های تراکنش انبار
    const [txDialogVisible, setTxDialogVisible] = useState(false);
    const [txLoading, setTxLoading] = useState(false);
    const [selectedProductId, setSelectedProductId] = useState('raw-sheet-steel');
    const [selectedWarehouseId, setSelectedWarehouseId] = useState('wh-raw-101');
    const [txType, setTxType] = useState<'receipt' | 'issue'>('receipt');
    const [txQty, setTxQty] = useState('');
    const [txNote, setTxNote] = useState('');

    const [productPickerVisible, setProductPickerVisible] = useState(false);
    const [warehousePickerVisible, setWarehousePickerVisible] = useState(false);

    const loadInventoryData = async () => {
        try {
            if (loading && !refreshing) setLoading(true);

            const activeSession = await AuthService.getCurrentSession();
            if (activeSession) {
                setSession(activeSession);
            } else {
                navigation.replace('Login');
                return;
            }

            const [rawStockList, lineStockList, activeAlerts, recentTxs] = await Promise.all([
                InventoryService.getWarehouseStock('wh-raw-101'),
                InventoryService.getWarehouseStock('wh-line-102'),
                StockAlertService.getLowStockAlerts(),
                InventoryService.getRecentTransactions() // لود داینامیک ۵ تراکنش آخر کارتابل
            ]);

            setRawStock(rawStockList);
            setLineStock(lineStockList);
            setAlerts(activeAlerts);
            setRecentTransactions(recentTxs);
        } catch (e) {
            console.error('[EmployeeDashboard ERROR] Failed to load logistics data:', e);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    };

    useEffect(() => {
        loadInventoryData();
    }, []);

    const onRefresh = () => {
        setRefreshing(true);
        loadInventoryData();
    };

    const handleRegisterTransaction = async () => {
        const qty = parseFloat(txQty);
        if (isNaN(qty) || qty <= 0) {
            Alert.alert('خطا در ورود داده', 'لطفاً مقدار معتبر و بزرگتر از صفر وارد کنید.');
            return;
        }
        if (!session) return;

        try {
            setTxLoading(true);

            await InventoryService.registerStockTransaction({
                warehouseId: selectedWarehouseId,
                lineId: selectedWarehouseId === 'wh-line-102' ? 'line-press-03' : null,
                productId: selectedProductId,
                type: txType,
                quantity: qty,
                unit: selectedProductId === 'raw-sheet-steel' ? 'kg' : 'pcs',
                refType: 'user_action',
                refId: null,
                operatorId: session.id,
                note: txNote.trim() || undefined
            });

            Alert.alert('موفقیت ثبت سند', `سند با موفقیت در دیتابیس بومی ذخیره شد.`);
            setTxDialogVisible(false);
            setTxQty('');
            setTxNote('');
            loadInventoryData(); // تازه‌سازی خودکار کارتابل
        } catch (e: any) {
            Alert.alert('خطا در ثبت سند', e?.message || 'تراکنش انبار با شکست مواجه شد.');
        } finally {
            setTxLoading(false);
        }
    };

    const getProductName = (id: string) => {
        if (id === 'raw-sheet-steel') return 'ورق فلزی خام (رول)';
        if (id === 'prod-a-201') return 'قطعه فلزی تیپ A';
        return 'قطعه فلزی تیپ B';
    };

    const getWarehouseName = (id: string) => {
        if (id === 'wh-raw-101') return 'انبار مرکزی مواد اولیه';
        return 'انبار موقت خط تولید';
    };

    const getTxTypeLabel = (type: string) => {
        if (type === 'receipt') return 'رسید انبار';
        if (type === 'issue') return 'حواله خروج';
        if (type === 'transfer_out') return 'انتقال (حواله)';
        if (type === 'transfer_in') return 'انتقال (رسید)';
        if (type === 'reservation') return 'رزرو تولید';
        if (type === 'consumption') return 'مصرف خط تولید';
        return 'سند اصلاحی';
    };

    if (loading) {
        return (
            <View style={[styles.loadingContainer, { backgroundColor: theme.colors.background }]}>
                <ActivityIndicator size="large" color={theme.colors.primary} />
                <Text variant="titleMedium" style={[styles.loadingText, { color: theme.colors.primary }]}>
                    در حال واکشی اطلاعات لجستیک و انبار...
                </Text>
            </View>
        );
    }

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <SessionHeader session={session} navigation={navigation} />

            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                keyboardShouldPersistTaps="handled"
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
            >
                <View style={styles.container}>

                    {/* هشدارهای کسری انبار بر اساس ممیزی BOM */}
                    {alerts.length > 0 && (
                        <Card style={[styles.card, styles.alertCard]} mode="elevated">
                            <Card.Content>
                                <View style={styles.alertHeader}>
                                    <Avatar.Icon size={32} icon="alert-decagram" style={{ backgroundColor: theme.colors.error }} />
                                    <Text variant="titleMedium" style={styles.alertTitle}>هشدارهای کسری موجودی کالا</Text>
                                </View>
                                <Divider style={styles.divider} />
                                {alerts.map((alt) => (
                                    <Text key={alt.id} variant="bodyMedium" style={styles.alertMessage}>
                                        ⚠️ {alt.message}
                                    </Text>
                                ))}
                            </Card.Content>
                        </Card>
                    )}

                    {/* موجودی انبار مرکزی */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>موجودی انبار مرکزی مواد اولیه (WH-RAW)</Text>
                            <Divider style={styles.divider} />

                            {rawStock.map((item) => (
                                <View key={item.id} style={styles.metricRow}>
                                    <Text variant="bodyLarge" style={styles.stockValue}>
                                        {formatNumberFa(item.quantity)} {item.unit === 'kg' ? 'کیلوگرم' : 'عدد'}
                                    </Text>
                                    <Text variant="bodyMedium">{item.product_name}</Text>
                                </View>
                            ))}

                            {rawStock.length === 0 && (
                                <Text style={styles.emptyText}>هیچ کالایی در انبار مرکزی موجود نیست.</Text>
                            )}
                        </Card.Content>
                    </Card>

                    {/* موجودی انبار موقت خط */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>موجودی انبار موقت خط پرس ۳ (WH-LINE)</Text>
                            <Divider style={styles.divider} />

                            {lineStock.map((item) => (
                                <View key={item.id} style={styles.metricRow}>
                                    <Text variant="bodyLarge" style={styles.stockValue}>
                                        {formatNumberFa(item.quantity)} {item.unit === 'kg' ? 'کیلوگرم' : 'عدد'}
                                    </Text>
                                    <Text variant="bodyMedium">{item.product_name}</Text>
                                </View>
                            ))}

                            {lineStock.length === 0 && (
                                <Text style={styles.emptyText}>هیچ کالایی در انبار خط تولید موجود نیست.</Text>
                            )}
                        </Card.Content>
                    </Card>

                    {/* دکمه رسید/حواله جدید */}
                    <Button
                        mode="contained"
                        icon="warehouse"
                        onPress={() => setTxDialogVisible(true)}
                        style={styles.actionBtn}
                        labelStyle={styles.actionBtnLabel}
                    >
                        ثبت سند ورود / خروج کالا
                    </Button>

                    {/* کارتابل مانیتورینگ لایو آخرین تراکنش‌ها */}
                    <Card style={[styles.card, { marginTop: 16 }]} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>آخرین تراکنش‌های ثبت‌شده انبار</Text>
                            <Divider style={styles.divider} />

                            {recentTransactions.map((tx) => (
                                <View key={tx.id}>
                                    <List.Item
                                        title={`${getTxTypeLabel(tx.transaction_type)}: ${formatNumberFa(tx.quantity)} ${tx.unit === 'kg' ? 'کیلوگرم' : 'عدد'}`}
                                        description={`کالا: ${tx.product_name} | محل: ${tx.warehouse_name || 'پای خط'}`}
                                        titleStyle={styles.listTitle}
                                        descriptionStyle={styles.listDesc}
                                        left={props => (
                                            <Avatar.Icon
                                                {...props}
                                                size={36}
                                                icon={tx.transaction_type === 'receipt' || tx.transaction_type === 'transfer_in' ? "arrow-down-bold-circle" : "arrow-up-bold-circle"}
                                                style={{ backgroundColor: tx.transaction_type === 'receipt' || tx.transaction_type === 'transfer_in' ? theme.colors.secondary : theme.colors.error }}
                                            />
                                        )}
                                        right={() => (
                                            <Text variant="bodySmall" style={styles.timeText}>{formatJalaliDateTime(tx.created_at)}</Text>
                                        )}
                                    />
                                    <Divider />
                                </View>
                            ))}

                            {recentTransactions.length === 0 && (
                                <Text style={styles.emptyText}>هیچ تراکنش انبارداری ثبت نشده است.</Text>
                            )}
                        </Card.Content>
                    </Card>

                </View>
            </ScrollView>

            {/* دیالوگ ثبت تراکنش انبار */}
            <Portal>
                <Dialog visible={txDialogVisible} onDismiss={() => setTxDialogVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>ثبت رسید / حواله فیزیکی کالا</Dialog.Title>
                    <Dialog.Content>

                        <View style={styles.typeRow}>
                            <Button
                                mode={txType === 'receipt' ? 'contained' : 'outlined'}
                                onPress={() => setTxType('receipt')}
                                style={styles.typeBtn}
                            >
                                رسید (ورود کالا)
                            </Button>
                            <Button
                                mode={txType === 'issue' ? 'contained' : 'outlined'}
                                onPress={() => setTxType('issue')}
                                style={styles.typeBtn}
                            >
                                حواله (خروج کالا)
                            </Button>
                        </View>

                        <Text variant="bodySmall" style={styles.formLabel}>انتخاب انبار فیزیکی:</Text>
                        <Button mode="outlined" onPress={() => setWarehousePickerVisible(true)} style={styles.pickerBtn}>
                            {getWarehouseName(selectedWarehouseId)}
                        </Button>

                        <Text variant="bodySmall" style={styles.formLabel}>انتخاب کالا / مواد خام:</Text>
                        <Button mode="outlined" onPress={() => setProductPickerVisible(true)} style={styles.pickerBtn}>
                            {getProductName(selectedProductId)}
                        </Button>

                        <TextInput
                            label="مقدار / تعداد کالا"
                            mode="outlined"
                            keyboardType="numeric"
                            value={txQty}
                            onChangeText={setTxQty}
                            style={styles.input}
                        />

                        <TextInput
                            label="توضیحات و گزارش ثبت سند"
                            mode="outlined"
                            value={txNote}
                            onChangeText={setTxNote}
                            style={styles.input}
                        />

                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setTxDialogVisible(false)}>انصراف</Button>
                        <Button onPress={handleRegisterTransaction} loading={txLoading} disabled={txLoading}>تایید ثبت سند</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* انتخاب کالا */}
            <Portal>
                <Dialog visible={productPickerVisible} onDismiss={() => setProductPickerVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>انتخاب نوع کالا</Dialog.Title>
                    <Dialog.Content>
                        <List.Item title="ورق فلزی خام (رول)" onPress={() => { setSelectedProductId('raw-sheet-steel'); setProductPickerVisible(false); }} titleStyle={styles.listTitle} />
                        <Divider />
                        <List.Item title="قطعه فلزی تیپ A" onPress={() => { setSelectedProductId('prod-a-201'); setProductPickerVisible(false); }} titleStyle={styles.listTitle} />
                        <Divider />
                        <List.Item title="قطعه فلزی تیپ B" onPress={() => { setSelectedProductId('prod-b-202'); setProductPickerVisible(false); }} titleStyle={styles.listTitle} />
                    </Dialog.Content>
                </Dialog>
            </Portal>

            {/* انتخاب انبار */}
            <Portal>
                <Dialog visible={warehousePickerVisible} onDismiss={() => setWarehousePickerVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>انتخاب انبار فیزیکی</Dialog.Title>
                    <Dialog.Content>
                        <List.Item title="انبار مرکزی مواد اولیه (WH-RAW)" onPress={() => { setSelectedWarehouseId('wh-raw-101'); setWarehousePickerVisible(false); }} titleStyle={styles.listTitle} />
                        <Divider />
                        <List.Item title="انبار موقت خط تولید (WH-LINE)" onPress={() => { setSelectedWarehouseId('wh-line-102'); setWarehousePickerVisible(false); }} titleStyle={styles.listTitle} />
                    </Dialog.Content>
                </Dialog>
            </Portal>

        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 16,
        fontWeight: 'bold',
        lineHeight: 24,
    },
    scrollContainer: {
        flexGrow: 1,
        paddingVertical: 16,
    },
    container: {
        alignItems: 'center',
        paddingHorizontal: 16,
        width: '100%',
    },
    card: {
        width: '100%',
        maxWidth: 450,
        borderRadius: 12,
        backgroundColor: '#ffffff',
        marginBottom: 16,
    },
    alertCard: {
        borderColor: '#ff3f3f',
        borderWidth: 1.5,
        backgroundColor: '#fffbe6',
    },
    alertHeader: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
        marginBottom: 8,
        width: '100%',
    },
    alertTitle: {
        color: '#ff3f3f',
        fontWeight: 'bold',
        marginRight: 10,
        lineHeight: 24,
    },
    alertMessage: {
        color: '#c62828',
        fontWeight: 'bold',
        lineHeight: 20,
        textAlign: 'right',
        marginTop: 8,
        writingDirection: 'rtl',
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        lineHeight: 24,
        writingDirection: 'rtl',
    },
    divider: {
        marginBottom: 12,
    },
    metricRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
        width: '100%',
    },
    stockValue: {
        fontWeight: 'bold',
        color: '#333',
        lineHeight: 20,
    },
    actionBtn: {
        marginTop: 10,
        width: '100%',
        maxWidth: 450,
        borderRadius: 8,
        paddingVertical: 4,
    },
    actionBtnLabel: {
        fontWeight: 'bold',
        fontSize: 15,
        lineHeight: 24,
    },
    typeRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        marginBottom: 16,
        width: '100%',
    },
    typeBtn: {
        flex: 0.48,
        borderRadius: 8,
    },
    formLabel: {
        textAlign: 'right',
        color: '#666',
        marginBottom: 6,
        lineHeight: 18,
        writingDirection: 'rtl',
    },
    pickerBtn: {
        marginBottom: 14,
        borderRadius: 8,
        height: 44,
        justifyContent: 'center',
    },
    input: {
        marginBottom: 10,
        textAlign: 'right',
    },
    dialogTitle: {
        textAlign: 'right',
        fontWeight: 'bold',
    },
    listTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        lineHeight: 22,
        writingDirection: 'rtl',
    },
    listDesc: {
        textAlign: 'right',
        lineHeight: 18,
        writingDirection: 'rtl',
    },
    timeText: {
        fontSize: 10,
        color: '#888',
        alignSelf: 'center',
    },
    emptyText: {
        textAlign: 'center',
        color: '#888',
        marginTop: 10,
        lineHeight: 20,
        writingDirection: 'rtl',
    },
    footerText: {
        marginTop: 20,
        fontSize: 12,
        color: '#888',
        textAlign: 'center',
        lineHeight: 20,
    },
});