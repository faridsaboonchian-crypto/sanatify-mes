import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Card, Text, Button, useTheme, TextInput, List, Avatar, Divider, Portal, Dialog, ActivityIndicator } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { UserManagementService, OperatorUser } from '../services/UserManagementService';
import { formatNumberFa } from '../utils/dateUtils';

export default function UserManagementScreen() {
    const theme = useTheme();
    const [users, setUsers] = useState<OperatorUser[]>([]);
    const [loading, setLoading] = useState(true);

    // استیت‌های دیالوگ ساخت پرسنل جدید
    const [createDialogVisible, setCreateDialogVisible] = useState(false);
    const [newName, setNewName] = useState('');
    const [newCode, setNewCode] = useState('');
    const [newPass, setNewPass] = useState('');

    // استیت‌های دیالوگ مدیریت و ریست رمز عبور کاربر انتخابی
    const [editDialogVisible, setEditDialogVisible] = useState(false);
    const [selectedUser, setSelectedUser] = useState<OperatorUser | null>(null);
    const [editPass, setEditPass] = useState('');

    const loadUsers = async () => {
        try {
            setLoading(true);
            const fetched = await UserManagementService.getOperators();
            setUsers(fetched);
        } catch (e) {
            console.error('Failed to load users:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadUsers();
    }, []);

    const handleCreateUser = async () => {
        if (!newName.trim() || !newCode.trim() || !newPass.trim()) {
            Alert.alert('خطا', 'لطفاً تمامی فیلدها را به طور کامل پر کنید.');
            return;
        }

        try {
            await UserManagementService.createUser(
                newName.trim(),
                newCode.trim(),
                newPass.trim(),
                'operator',
                'shift-morning-301'
            );
            Alert.alert('موفقیت', 'کاربر جدید کارگاه با موفقیت در دیتابیس بومی ثبت شد.');
            setCreateDialogVisible(false);
            setNewName('');
            setNewCode('');
            setNewPass('');
            loadUsers();
        } catch (e: any) {
            Alert.alert('خطا در ثبت', e?.message || 'کد پرسنلی تکراری است.');
        }
    };

    const handleResetPassword = async () => {
        if (!selectedUser || !editPass.trim()) {
            Alert.alert('خطا', 'لطفاً رمز عبور جدید را وارد کنید.');
            return;
        }

        try {
            await UserManagementService.changeUserPassword(selectedUser.id, editPass.trim());
            Alert.alert('موفقیت', `رمز عبور کاربری "${selectedUser.name}" با موفقیت بازنشانی شد.`);
            setEditDialogVisible(false);
            setSelectedUser(null);
            setEditPass('');
        } catch (e: any) {
            Alert.alert('خطا در تغییر رمز', e?.message || 'عملیات ناموفق بود.');
        }
    };

    const handleDeactivateUser = (user: OperatorUser) => {
        Alert.alert(
            user.is_active ? 'غیرفعال‌سازی کاربر' : 'فعال‌سازی مجدد کاربر',
            `آیا از تغییر وضعیت حساب کاربری "${user.name}" مطمئن هستید؟`,
            [
                { text: 'انصراف', style: 'cancel' },
                {
                    text: 'تایید',
                    onPress: async () => {
                        try {
                            await UserManagementService.toggleUserStatus(user.id, user.is_active);
                            loadUsers();
                        } catch (err) {
                            Alert.alert('خطا', 'تغییر وضعیت ناموفق بود.');
                        }
                    }
                }
            ]
        );
    };

    const openEditDialog = (user: OperatorUser) => {
        setSelectedUser(user);
        setEditDialogVisible(true);
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>

                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>لیست پرسنل و اپراتورهای کارخانه</Text>
                            <Divider style={styles.divider} />

                            {loading ? (
                                <ActivityIndicator size="small" color={theme.colors.primary} />
                            ) : (
                                users.map((user) => (
                                    <View key={user.id}>
                                        <List.Item
                                            title={user.name}
                                            description={`کد پرسنلی: ${formatNumberFa(user.personnel_code)} | نقش: ${user.role === 'manager' ? 'مدیر سالن' : 'اپراتور'}`}
                                            titleStyle={styles.listTitle}
                                            descriptionStyle={styles.listDesc}
                                            left={props => (
                                                <Avatar.Icon
                                                    {...props}
                                                    size={40}
                                                    icon={user.role === 'manager' ? 'account-tie' : 'account-hard-hat'}
                                                    style={{ backgroundColor: user.is_active ? theme.colors.secondary : theme.colors.outline }}
                                                />
                                            )}
                                            right={() => (
                                                <View style={styles.actionRow}>
                                                    <Button compact mode="text" onPress={() => openEditDialog(user)}>
                                                        رمز عبور
                                                    </Button>
                                                    <Button compact mode="text" onPress={() => handleDeactivateUser(user)}>
                                                        {user.is_active ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                                                    </Button>
                                                </View>
                                            )}
                                        />
                                        <Divider />
                                    </View>
                                ))
                            )}
                        </Card.Content>
                    </Card>

                    <Button mode="contained" icon="plus" onPress={() => setCreateDialogVisible(true)} style={styles.createBtn}>
                        افزودن کاربر جدید به کارگاه
                    </Button>
                </View>
            </ScrollView>

            {/* ۱. دیالوگ ساخت پرسنل جدید */}
            <Portal>
                <Dialog visible={createDialogVisible} onDismiss={() => setCreateDialogVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>تعریف پرسنل جدید</Dialog.Title>
                    <Dialog.Content>
                        <TextInput label="نام و نام خانوادگی" mode="outlined" value={newName} onChangeText={setNewName} style={styles.input} />
                        <TextInput label="کد پرسنلی (یکتا)" mode="outlined" keyboardType="numeric" value={newCode} onChangeText={setNewCode} style={styles.input} />
                        <TextInput label="رمز عبور ورود به تبلت" mode="outlined" value={newPass} onChangeText={setNewPass} style={styles.input} />
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setCreateDialogVisible(false)}>انصراف</Button>
                        <Button onPress={handleCreateUser}>ثبت کاربر</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>

            {/* ۲. دیالوگ بازنشانی رمز عبور پرسنل (انحصاری توسط مدیر) */}
            <Portal>
                <Dialog visible={editDialogVisible} onDismiss={() => setEditDialogVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>تغییر رمز عبور پرسنل</Dialog.Title>
                    <Dialog.Content>
                        <Text variant="bodyMedium" style={styles.dialogUserLabel}>کاربر انتخابی: {selectedUser?.name}</Text>
                        <TextInput label="رمز عبور جدید" mode="outlined" value={editPass} onChangeText={setEditPass} style={styles.input} />
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setEditDialogVisible(false)}>انصراف</Button>
                        <Button onPress={handleResetPassword}>ذخیره تغییرات</Button>
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
    actionRow: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
    },
    createBtn: {
        marginTop: 20,
        width: '100%',
        maxWidth: 450,
        borderRadius: 8,
    },
    dialogTitle: {
        textAlign: 'right',
        fontWeight: 'bold',
    },
    dialogUserLabel: {
        textAlign: 'right',
        marginBottom: 12,
        color: '#555',
    },
    input: {
        marginBottom: 10,
        textAlign: 'right',
    },
});