import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Card, Text, Button, useTheme, Divider, Portal, Dialog, TextInput, List, Avatar, ActivityIndicator, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WorkshopContextService, WorkshopContext } from '../services/WorkshopContextService';
import { AuthService, OperatorSession } from '../services/AuthService';
import { SessionHeader } from '../components/SessionHeader';
import { formatNumberFa } from '../utils/dateUtils';
import { getDatabase } from '../database/Database';

export default function ManagerWorkshopScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const [session, setSession] = useState<OperatorSession | null>(null);
    const [contexts, setContexts] = useState<WorkshopContext[]>([]);
    const [activeIds, setActiveIds] = useState<string[]>([]);
    const [loading, setLoading] = useState(true);

    const [dialogVisible, setDialogVisible] = useState(false);
    const [editingContext, setEditingContext] = useState<WorkshopContext | null>(null);
    const [wName, setWName] = useState('');
    const [lName, setLName] = useState('');
    const [mName, setMName] = useState('');
    const [supName, setSupName] = useState('');

    const loadContextsData = async () => {
        try {
            setLoading(true);
            const [list, activeList, activeSession] = await Promise.all([
                WorkshopContextService.getWorkshopContexts(),
                WorkshopContextService.getActiveContexts(),
                AuthService.getCurrentSession()
            ]);
            setContexts(list);
            setActiveIds(activeList.map(c => c.id));
            setSession(activeSession);
        } catch (e) {
            console.error('Failed to load contexts:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadContextsData();
    }, []);

    const openCreateDialog = () => {
        setEditingContext(null);
        setWName(''); setLName(''); setMName(''); setSupName('');
        setDialogVisible(true);
    };

    const openEditDialog = (ctx: WorkshopContext) => {
        setEditingContext(ctx);
        setWName(ctx.workshop_name);
        setLName(ctx.line_name);
        setMName(ctx.machine_name);
        setSupName(ctx.assigned_supervisor || '');
        setDialogVisible(true);
    };

    const handleDeleteContext = (ctx: WorkshopContext) => {
        Alert.alert(
            'حذف سالن',
            `آیا از حذف سالن "${ctx.workshop_name}" مطمئن هستید؟`,
            [
                { text: 'انصراف', style: 'cancel' },
                {
                    text: 'حذف',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const db = await getDatabase();
                            await db.runAsync(`DELETE FROM workshop_contexts WHERE id = ?;`, [ctx.id]);
                            Alert.alert('موفق', 'سالن مورد نظر حذف شد.');
                            loadContextsData();
                        } catch (e) {
                            Alert.alert('خطا', 'حذف سالن ممکن است به دلیل وجود داده‌های وابسته مقدور نباشد.');
                        }
                    }
                }
            ]
        );
    };

    const handleSaveContext = async () => {
        if (!wName.trim() || !lName.trim() || !mName.trim()) {
            Alert.alert('خطا', 'لطفاً تمامی فیلدها را به طور کامل پر کنید.');
            return;
        }

        try {
            if (editingContext) {
                // حالت ویرایش
                const db = await getDatabase();
                await db.runAsync(
                    `UPDATE workshop_contexts SET workshop_name = ?, line_name = ?, machine_name = ?, assigned_supervisor = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?;`,
                    [wName.trim(), lName.trim(), mName.trim(), supName.trim() || 'مهندس رضا اکبری', editingContext.id]
                );
                Alert.alert('موفقیت', 'سالن با موفقیت ویرایش شد.');
            } else {
                // حالت ایجاد
                await WorkshopContextService.createWorkshopContext(
                    wName.trim(),
                    lName.trim(),
                    mName.trim(),
                    supName.trim() || 'مهندس رضا اکبری'
                );
                Alert.alert('موفقیت', 'موقعیت و سالن جدید با موفقیت ثبت شد.');
            }
            setDialogVisible(false);
            loadContextsData();
        } catch (e: any) {
            Alert.alert('خطا در ثبت', e?.message || 'عملیات ناموفق بود.');
        }
    };

    const handleSelectActiveContext = async (id: string) => {
        try {
            await WorkshopContextService.toggleActiveContext(id);
            loadContextsData();
        } catch (e) {
            Alert.alert('خطا', 'ویرایش وضعیت کانتکست با خطا مواجه شد.');
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <SessionHeader session={session} navigation={navigation} />

            {Platform.OS !== 'web' && (
                <View style={styles.backButtonRow}>
                    <Button compact icon="arrow-left" mode="text" onPress={() => navigation.goBack()} labelStyle={styles.backButtonLabel}>
                        بازگشت به میز کار مدیریت
                    </Button>
                </View>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>

                    <Card style={[styles.card, styles.activeCard]} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.activeCardTitle}>تعداد سالن‌های فعال کلاینت</Text>
                            <Divider style={styles.divider} />
                            {activeIds.length > 0 ? (
                                <View style={styles.activeGrid}>
                                    <View style={styles.metricRow}>
                                        <Text variant="bodyLarge" style={styles.activeValue}>
                                            {formatNumberFa(activeIds.length)} سالن/خط فعال
                                        </Text>
                                        <Text variant="bodyMedium">وضعیت جاری:</Text>
                                    </View>
                                    <Text style={[styles.emptyText, { marginTop: 4, color: theme.colors.secondary }]}>
                                        سیستم مجهز به فعال‌سازی چندگانه خطوط است.
                                    </Text>
                                </View>
                            ) : (
                                <Text style={styles.emptyText}>هیچ کانتکست سالنی فعال نشده است.</Text>
                            )}
                        </Card.Content>
                    </Card>

                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>لیست سالن‌ها و خطوط موجود</Text>
                            <Divider style={styles.divider} />

                            {loading ? (
                                <ActivityIndicator size="small" color={theme.colors.primary} />
                            ) : (
                                contexts.map((ctx) => {
                                    const isActive = activeIds.includes(ctx.id);
                                    return (
                                        <View key={ctx.id}>
                                            <List.Item
                                                title={`سالن ${ctx.workshop_name} / خط ${ctx.line_name}`}
                                                description={`دستگاه: ${ctx.machine_name}`}
                                                titleStyle={styles.listTitle}
                                                descriptionStyle={styles.listDesc}
                                                left={props => (
                                                    <Avatar.Icon
                                                        {...props}
                                                        size={40}
                                                        icon="factory"
                                                        style={{ backgroundColor: isActive ? theme.colors.secondary : theme.colors.outline }}
                                                    />
                                                )}
                                                right={() => (
                                                    <View style={styles.rowActions}>
                                                        <Button
                                                            compact
                                                            mode={isActive ? "contained" : "outlined"}
                                                            onPress={() => handleSelectActiveContext(ctx.id)}
                                                            labelStyle={styles.listButtonLabel}
                                                            style={{ marginRight: 8, height: 36, justifyContent: 'center' }}
                                                        >
                                                            {isActive ? 'فعال' : 'غیرفعال'}
                                                        </Button>
                                                        <IconButton
                                                            icon="pencil"
                                                            size={20}
                                                            onPress={() => openEditDialog(ctx)}
                                                            iconColor="#1e3d59"
                                                        />
                                                        <IconButton
                                                            icon="trash-can-outline"
                                                            size={20}
                                                            onPress={() => handleDeleteContext(ctx)}
                                                            iconColor="#dc2626"
                                                        />
                                                    </View>
                                                )}
                                            />
                                            <Divider />
                                        </View>
                                    );
                                })
                            )}
                        </Card.Content>
                    </Card>

                    <Button mode="contained" icon="plus" onPress={openCreateDialog} style={styles.createBtn} labelStyle={styles.createBtnLabel}>
                        تعریف موقعیت / سالن جدید
                    </Button>
                </View>
            </ScrollView>

            <Portal>
                <Dialog visible={dialogVisible} onDismiss={() => setDialogVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>
                        {editingContext ? 'ویرایش سالن و موقعیت' : 'تعریف سالن و موقعیت جدید'}
                    </Dialog.Title>
                    <Dialog.Content>
                        <TextInput label="نام سالن (مثال: جوشکاری)" mode="outlined" value={wName} onChangeText={setWName} style={styles.input} />
                        <TextInput label="نام خط تولید (مثال: خط ۲)" mode="outlined" value={lName} onChangeText={setLName} style={styles.input} />
                        <TextInput label="نام دستگاه (مثال: CNC-05)" mode="outlined" value={mName} onChangeText={setMName} style={styles.input} />
                        <TextInput label="نام سرپرست سالن" mode="outlined" value={supName} onChangeText={setSupName} style={styles.input} />
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setDialogVisible(false)}>انصراف</Button>
                        <Button onPress={handleSaveContext}>{editingContext ? 'ذخیره تغییرات' : 'ثبت موقعیت'}</Button>
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
    backButtonRow: {
        flexDirection: 'row-reverse',
        paddingHorizontal: 16,
        marginTop: 8,
        width: '100%',
    },
    backButtonLabel: {
        fontWeight: 'bold',
        fontSize: 13,
        lineHeight: 20,
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
    activeCard: {
        borderColor: '#4caf50',
        borderWidth: 1.5,
    },
    activeCardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        color: '#4caf50',
        lineHeight: 24,
        writingDirection: 'rtl',
    },
    activeGrid: {
        width: '100%',
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        lineHeight: 24,
        writingDirection: 'rtl',
    },
    divider: {
        marginBottom: 10,
    },
    metricRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
        width: '100%',
    },
    activeValue: {
        fontWeight: 'bold',
        color: '#333',
        lineHeight: 20,
    },
    rowActions: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
    },
    listTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        lineHeight: 22,
        writingDirection: 'rtl',
        flexShrink: 1,
    },
    listDesc: {
        textAlign: 'right',
        lineHeight: 18,
        writingDirection: 'rtl',
        flexShrink: 1,
    },
    listButtonLabel: {
        fontSize: 12,
        lineHeight: 18,
        fontWeight: 'bold',
    },
    createBtn: {
        marginTop: 10,
        width: '100%',
        maxWidth: 450,
        borderRadius: 8,
    },
    createBtnLabel: {
        fontWeight: 'bold',
        fontSize: 14,
        lineHeight: 22,
    },
    dialogTitle: {
        textAlign: 'right',
        fontWeight: 'bold',
    },
    input: {
        marginBottom: 10,
        textAlign: 'right',
    },
    emptyText: {
        textAlign: 'center',
        color: '#888',
        marginTop: 10,
        lineHeight: 20,
        writingDirection: 'rtl',
    },
});