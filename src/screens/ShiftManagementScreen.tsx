import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, TextInput, Divider, List, IconButton } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase } from '../database/Database';

const ShiftManagementScreen: React.FC<any> = ({ navigation }) => {
    const theme = useTheme();
    const [shifts, setShifts] = useState<any[]>([]);
    const [name, setName] = useState('');
    const [duration, setDuration] = useState('480');

    const fetchShifts = async () => {
        const db = await getDatabase();
        const data = await db.getAllAsync(`SELECT * FROM shifts ORDER BY id DESC;`);
        setShifts(data);
    };

    useEffect(() => { fetchShifts(); }, []);

    const handleAdd = async () => {
        if (!name.trim()) return Alert.alert('خطا', 'نام شیفت الزامی است.');
        const db = await getDatabase();
        await db.runAsync(`INSERT INTO shifts (id, name, planned_duration_minutes) VALUES (?, ?, ?);`, [`shift-${Date.now()}`, name.trim(), parseInt(duration) || 480]);
        setName('');
        Alert.alert('موفق', 'شیفت ثبت شد.');
        fetchShifts();
    };

    const handleDelete = async (id: string) => {
        const db = await getDatabase();
        await db.runAsync(`DELETE FROM shifts WHERE id = ?;`, [id]);
        fetchShifts();
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                <Appbar.Content title="مدیریت شیفت‌های کاری" color="#ffffff" />
            </Appbar.Header>
            <ScrollView contentContainerStyle={styles.container}>
                <Card style={styles.card}>
                    <Card.Content>
                        <Text style={styles.title}>تعریف شیفت جدید</Text>
                        <Divider style={styles.divider} />
                        <TextInput label="نام شیفت (مثال: شیفت صبح)" value={name} onChangeText={setName} style={styles.input} mode="outlined" />
                        <TextInput label="مدت زمان (دقیقه)" value={duration} onChangeText={setDuration} keyboardType="numeric" style={styles.input} mode="outlined" />
                        <Button mode="contained" onPress={handleAdd} icon="plus">افزودن شیفت</Button>
                    </Card.Content>
                </Card>

                <Card style={styles.card}>
                    <Card.Content>
                        <Text style={styles.title}>لیفت شیفت‌ها</Text>
                        <Divider style={styles.divider} />
                        {shifts.map(s => (
                            <List.Item
                                key={s.id}
                                title={s.name}
                                description={`${s.planned_duration_minutes} دقیقه`}
                                right={() => <IconButton icon="delete" iconColor="#dc2626" onPress={() => handleDelete(s.id)} />}
                            />
                        ))}
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
    title: { fontWeight: 'bold', marginBottom: 8, textAlign: 'right' },
    divider: { marginBottom: 12 },
    input: { marginBottom: 12, textAlign: 'right' }
});

export default ShiftManagementScreen;