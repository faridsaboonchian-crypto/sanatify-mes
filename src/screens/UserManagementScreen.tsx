import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, TextInput, List, Avatar, Divider, Portal, Dialog, IconButton, RadioButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase } from '../database/Database';

export default function UserManagementScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    const [dialogVisible, setDialogVisible] = useState(false);
    const [editingUser, setEditingUser] = useState<any | null>(null);

    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('operator');

    // لیست نقش‌های سازمانی کارخانه
    const rolesList = [
        { value: 'operator', label: 'اپراتور سالن تولید' },
        { value: 'engineer', label: 'مهندس و کارشناس' },
        { value: 'manager', label: 'مدیر کارخانه' },
        { value: 'qc_manager', label: 'مدیر تضمین کیفیت' },
        { value: 'prod_manager', label: 'مدیر تولید' },
        { value: 'shift_manager', label: 'سرپرست شیفت' },
        { value: 'maintenance', label: 'مدیر نگهداری و تعمیرات' },
    ];

    const fetchUsers = async () => {
        try {
            setLoading(true);
            const db = await getDatabase();
            const data = await db.getAllAsync<any>(`SELECT * FROM operators ORDER BY name DESC;`);
            setUsers(data);
        } catch (e) {
            console.error('Fetch users error:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleGoBack = () => {
        if (navigation.canGoBack()) navigation.goBack();
        else navigation.reset({ index: 0, routes: [{ name: 'ManagerDashboard' }] });
    };

    const openAddDialog = () => {
        setEditingUser(null);
        setName(''); setCode(''); setPassword(''); setRole('operator');
        setDialogVisible(true);
    };

    const openEditDialog = (user: any) => {
        setEditingUser(user);
        setName(user.name);
        setCode(user.personnel_code);
        setPassword(user.password);
        setRole(user.role);
        setDialogVisible(true);
    };

    const handleDelete = (user: any) => {
        Alert.alert(
            "حذف کارمند",
            `آیا از حذف "${user.name}" مطمئن هستید؟ لاگ‌های تولید او به نام کاربر "سیستم" ثبت می‌شود.`,
            [
                { text: "انصراف", style: "cancel" },
                {
                    text: "حذف",
                    style: "destructive",
                    onPress: async () => {
                        try {
                            const db = await getDatabase();
                            // انتقال لاگ‌ها به کاربر سیستم برای رفع خطای کلید خارجی
                            await db.runAsync(`UPDATE production_logs SET operator_id = 'system-user' WHERE operator_id = ?;`, [user.id]);
                            await db.runAsync(`DELETE FROM operators WHERE id = ?;`, [user.id]);
                            Alert.alert('موفق', 'کارمند با موفقیت حذف شد.');
                            fetchUsers();
                        } catch (e: any) {
                            Alert.alert('خطا', e?.message || 'حذف کاربرد مقدور نیست.');
                        }
                    }
                }
            ]
        );
    };

    const handleSave = async () => {
        if (!name.trim() || !code.trim() || !password.trim()) {
            Alert.alert('خطا', 'تمامی فیلدها الزامی هستند.');
            return;
        }

        try {
            const db = await getDatabase();
            if (editingUser) {
                await db.runAsync(
                    `UPDATE operators SET name = ?, personnel_code = ?, password = ?, role = ? WHERE id = ?;`,
                    [name.trim(), code.trim(), password.trim(), role, editingUser.id]
                );
                Alert.alert('موفق', 'اطلاعات کارمند با موفقیت ویرایش شد.');
            } else {
                const id = `op-${Date.now()}`;
                await db.runAsync(
                    `INSERT INTO operators (id, name, personnel_code, password, role) VALUES (?, ?, ?, ?, ?);`,
                    [id, name.trim(), code.trim(), password.trim(), role]
                );
                Alert.alert('موفق', 'کارمند جدید با موفقیت اضافه شد.');
            }
            setDialogVisible(false);
            fetchUsers();
        } catch (e: any) {
            Alert.alert('خطای دیتابیس', e?.message || 'عملیات ناموفق بود.');
        }
    };

    const getRoleIcon = (userRole: string) => {
        if (userRole === 'manager' || userRole.includes('manager')) return 'account-tie';
        if (userRole === 'engineer') return 'developer-board';
        return 'account-hard-hat';
    };

    const getRoleColor = (userRole: string) => {
        if (userRole === 'manager' || userRole.includes('manager')) return theme.colors.secondary;
        if (userRole === 'engineer') return '#ff9800';
        return theme.colors.primary;
    };

    const getRoleLabel = (userRole: string) => {
        const found = rolesList.find(r => r.value === userRole);
        return found ? found.label : userRole;
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                <Appbar.BackAction onPress={handleGoBack} color="#ffffff" />
                <Appbar.Content title="مدیریت دسترسی و پرسنل" color="#ffffff" />
            </Appbar.Header>

            <ScrollView contentContainerStyle={styles.container}>
                <Button
                    mode="contained"
                    icon="account-plus"
                    onPress={openAddDialog}
                    style={styles.addButton}
                >
                    ثبت کارمند جدید
                </Button>

                <Card style={styles.card}>
                    <Card.Content>
                        <Text style={styles.cardTitle}>لیست پرسنل کارخانه</Text>
                        <Divider style={styles.divider} />

                        {loading ? (
                            <Text style={styles.emptyText}>در حال بارگذاری...</Text>
                        ) : users.length === 0 ? (
                            <Text style={styles.emptyText}>هیچ پرسنلی ثبت نشده است.</Text>
                        ) : (
                            users.map((user) => (
                                <View key={user.id}>
                                    <List.Item
                                        title={user.name}
                                        description={`کد: ${user.personnel_code} | نقش: ${getRoleLabel(user.role)}`}
                                        titleStyle={styles.listTitle}
                                        descriptionStyle={styles.listDesc}
                                        left={props => (
                                            <Avatar.Icon
                                                {...props}
                                                size={40}
                                                icon={getRoleIcon(user.role)}
                                                style={{ backgroundColor: getRoleColor(user.role) }}
                                            />
                                        )}
                                        right={() => (
                                            <View style={styles.rowActions}>
                                                <IconButton
                                                    icon="pencil"
                                                    size={20}
                                                    onPress={() => openEditDialog(user)}
                                                    iconColor="#1e3d59"
                                                />
                                                <IconButton
                                                    icon="trash-can-outline"
                                                    size={20}
                                                    onPress={() => handleDelete(user)}
                                                    iconColor="#dc2626"
                                                />
                                            </View>
                                        )}
                                    />
                                    <Divider />
                                </View>
                            ))
                        )}
                    </Card.Content>
                </Card>
            </ScrollView>

            <Portal>
                <Dialog visible={dialogVisible} onDismiss={() => setDialogVisible(false)}>
                    <Dialog.Title style={styles.dialogTitle}>
                        {editingUser ? 'ویرایش اطلاعات پرسنل' : 'ثبت پرسنل جدید'}
                    </Dialog.Title>
                    <Dialog.Content>
                        <TextInput label="نام و نام خانوادگی" mode="outlined" value={name} onChangeText={setName} style={styles.input} />
                        <TextInput label="کد پرسنلی" mode="outlined" value={code} onChangeText={setCode} keyboardType="numeric" style={styles.input} />
                        <TextInput label="رمز عبور" mode="outlined" value={password} onChangeText={setPassword} style={styles.input} />

                        <Text style={styles.radioLabel}>انتخاب نقش سازمانی:</Text>
                        <ScrollView style={{ maxHeight: 150 }}>
                            <RadioButton.Group onValueChange={value => setRole(value)} value={role}>
                                {rolesList.map(r => (
                                    <View key={r.value} style={styles.radioRow}>
                                        <Text>{r.label}</Text>
                                        <RadioButton value={r.value} color={theme.colors.primary} />
                                    </View>
                                ))}
                            </RadioButton.Group>
                        </ScrollView>
                    </Dialog.Content>
                    <Dialog.Actions>
                        <Button onPress={() => setDialogVisible(false)}>انصراف</Button>
                        <Button onPress={handleSave}>{editingUser ? 'ذخیره تغییرات' : 'ثبت کارمند'}</Button>
                    </Dialog.Actions>
                </Dialog>
            </Portal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    container: { padding: 16 },
    addButton: { marginBottom: 16, borderRadius: 8, padding: 4 },
    card: { borderRadius: 12, marginBottom: 16 },
    cardTitle: { fontWeight: 'bold', marginBottom: 8, textAlign: 'right', color: '#1a202c' },
    divider: { marginBottom: 8 },
    listTitle: { fontWeight: 'bold', textAlign: 'right', color: '#1a202c' },
    listDesc: { textAlign: 'right', color: '#718096' },
    rowActions: { flexDirection: 'row-reverse', alignItems: 'center' },
    emptyText: { textAlign: 'center', color: '#888', marginTop: 20 },
    dialogTitle: { textAlign: 'right', fontWeight: 'bold' },
    input: { marginBottom: 12, textAlign: 'right' },
    radioLabel: { fontWeight: 'bold', marginTop: 8, marginBottom: 8, textAlign: 'right', color: '#4a5568' },
    radioRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingHorizontal: 8 }
});