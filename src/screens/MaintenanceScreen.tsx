import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { Card, Text, Button, TextInput, SegmentedButtons, Menu, Chip, Divider, ActivityIndicator, useTheme, Appbar } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase, generateUniqueId } from '../database/Database';
import { AuthService, OperatorSession } from '../services/AuthService';
import { exportToExcel, ExcelColumn } from '../utils/excelExport';
import { formatNumberFa, formatDurationFa, formatJalaliDateTime } from '../utils/dateUtils';

// =====================================================================
//  پنل تعمیرات و نگهداری فولادی — دو لایه (نسخهٔ چیدمانِ اصلاح‌شده RTL)
//  ۱) اضطراری واقعی (Corrective) + MTTR/MTBF واقعی + اکسل
//  ۲) پیشگیرانه سررسیددار (PM) ساعت/روز/تُن + «انجام شد» + اکسل
// =====================================================================
const FAILURE_REASONS = [
    { value: 'bearing', label: 'شکستگی بلبرینگ' },
    { value: 'roll', label: 'شکستگی/پوشش غلتک' },
    { value: 'shear_blade', label: 'تیغه قیچی' },
    { value: 'electrical', label: 'خرابی برقی' },
    { value: 'hydraulic', label: 'خرابی هیدرولیک' },
    { value: 'furnace', label: 'مشعل/نسوز کوره' },
    { value: 'other', label: 'سایر' },
];
const getReasonLabel = (v: string) => (FAILURE_REASONS.find(r => r.value === v) || { label: v || 'نامشخص' }).label;
const INTERVAL_LABEL: Record<string, string> = { hours: 'ساعت', days: 'روز', tons: 'تُن' };

async function pmStatusOf(db: any, t: any) {
    const interval = Number(t.interval_value) || 1;
    let used = 0;
    if (t.interval_type === 'tons') {
        const rows = t.last_done_at
            ? await db.getAllAsync<any>(`SELECT COALESCE(SUM(net_weight_kg),0) AS s FROM rebar_bundles WHERE produced_at >= ?`, [t.last_done_at])
            : await db.getAllAsync<any>(`SELECT COALESCE(SUM(net_weight_kg),0) AS s FROM rebar_bundles`);
        used = (rows[0]?.s || 0) / 1000;
    } else {
        const base = t.last_done_at || t.created_at;
        const ms = Date.now() - new Date(base).getTime();
        used = t.interval_type === 'hours' ? ms / 3600000 : ms / 86400000;
    }
    const ratio = used / interval;
    return { level: ratio >= 1 ? 'overdue' : ratio >= 0.8 ? 'soon' : 'ok', used, remaining: Math.max(0, 1 - ratio) * 100 };
}

const MaintenanceScreen: React.FC<any> = ({ navigation }) => {
    const theme = useTheme();
    const [tab, setTab] = useState<'kpi' | 'corrective' | 'pm'>('kpi');
    const [session, setSession] = useState<OperatorSession | null>(null);
    const [machines, setMachines] = useState<any[]>([]);
    const [kpi, setKpi] = useState<any>(null);
    const [events, setEvents] = useState<any[]>([]);
    const [pmList, setPmList] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [cMachine, setCMachine] = useState('');
    const [cReason, setCReason] = useState('');
    const [cMinutes, setCMinutes] = useState('');
    const [cDesc, setCDesc] = useState('');
    const [machineMenu, setMachineMenu] = useState(false);
    const [reasonMenu, setReasonMenu] = useState(false);
    const [pMachine, setPMachine] = useState('');
    const [pTitle, setPTitle] = useState('');
    const [pType, setPType] = useState<'hours' | 'days' | 'tons'>('hours');
    const [pValue, setPValue] = useState('');
    const [pmMachineMenu, setPmMachineMenu] = useState(false);

    const machineName = (id: string) => (machines.find(x => x.id === id) || { name: id || '—' }).name;

    const loadAll = async () => {
        try {
            setLoading(true);
            const db = await getDatabase();
            const s = await AuthService.getCurrentSession();
            setSession(s);
            const mach = await db.getAllAsync<any>(`SELECT id, name, code FROM machines WHERE id NOT IN ('mach-press-01','mach-weld-02') ORDER BY code;`);
            setMachines(mach || []);
            const weekIso = new Date(Date.now() - 7 * 86400000).toISOString();
            const downWeek = await db.getAllAsync<any>(`SELECT duration_minutes, is_unplanned FROM downtime_logs WHERE start_time >= ?`, [weekIso]);

            const un = (downWeek || []).filter(r => r.is_unplanned);
            const dt = un.reduce((a, r) => a + (Number(r.duration_minutes) || 0), 0);
            const open = await db.getAllAsync<any>(`SELECT id FROM downtime_logs WHERE end_time IS NULL;`);
            const tasks = await db.getAllAsync<any>(`SELECT * FROM pm_tasks ORDER BY task_title;`);
            let overdue = 0;
            const enriched: any[] = [];
            for (const t of tasks || []) {
                const st = await pmStatusOf(db, t);
                if (st.level === 'overdue') overdue++;
                enriched.push({ ...t, st });
            }
            setPmList(enriched);
            setKpi({
                mttr: un.length > 0 ? Math.round(dt / un.length) : 0,
                mtbf: un.length > 0 ? Math.max(0, Math.round((7 * 720 - dt) / un.length)) : 7 * 720,
                failures: un.length, downtime: dt, open: (open || []).length, pmOverdue: overdue,
            });
            const ev = await db.getAllAsync<any>(`SELECT * FROM maintenance_events ORDER BY created_at DESC LIMIT 30;`);
            setEvents(ev || []);
        } catch (e) {
            console.warn('[Maintenance] load failed:', e);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { loadAll(); }, []);

    // ---------- ثبت تعمیر اضطراری (اصلاح‌شده: پارامترها کامل + ثبتِ توقفِ هم‌زمان) ----------
    const handleRegisterCorrective = async () => {
        if (!cMachine) { Alert.alert('خطا', 'دارایی را انتخاب کنید.'); return; }
        const mins = parseInt(cMinutes, 10);
        if (isNaN(mins) || mins <= 0) { Alert.alert('خطا', 'مدت تعمیر (دقیقه) را درست وارد کنید.'); return; }
        try {
            const db = await getDatabase();
            const now = new Date().toISOString();
            const start = new Date(Date.now() - mins * 60000).toISOString();
            // ۱) رویداد تعمیر (۱۷ ستون = ۱۷ پارامتر — دیگر NULL نداریم)
            await db.runAsync(
                `INSERT INTO maintenance_events (id, machine_id, operator_id, engineer_id, description, failure_reason_id, maintenance_type, started_at, completed_at, repair_minutes, status, start_time, end_time, cost, created_at, updated_at, sync_status)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?);`,
                [generateUniqueId('mnt'), cMachine, session?.id || null, session?.id || null, cDesc.trim() || 'تعمیر اضطراری خط', cReason || 'other', 'corrective', start, now, mins, 'completed', start, now, 0, now, now, 'pending']
            );
            // ۲) توقفِ اضطراریِ بستهٔ هم‌زمان (تا MTTR/MTBF و وب خودکار به‌روز شوند)
            await db.runAsync(
                `INSERT INTO downtime_logs (id, shift_id, reason_id, start_time, end_time, duration_minutes, timestamp, is_unplanned, machine_id, sync_status) VALUES (?,?,?,?,?,?,?,?,?, 'pending');`,
                [generateUniqueId('down'), session?.active_shift_id || 'shift-night-302', cReason || 'other', start, now, mins, start, 1, cMachine]
            );
            Alert.alert('ثبت شد', 'تعمیر اضطراری + توقفِ آن ثبت شد؛ شاخص‌ها به‌روز شدند.');
            setCMinutes(''); setCDesc(''); setCReason('');
            loadAll();
        } catch (e: any) { Alert.alert('خطا', e?.message || 'ثبت ناموفق بود.'); }
    };

    const handlePmDone = async (id: string) => {
        try {
            const db = await getDatabase();
            await db.runAsync(`UPDATE pm_tasks SET last_done_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?;`, [new Date().toISOString(), new Date().toISOString(), id]);
            Alert.alert('انجام شد', 'کار PM بسته شد و سررسید بعدی فعال شد.');
            loadAll();
        } catch (e: any) { Alert.alert('خطا', e?.message || 'عملیات ناموفق.'); }
    };

    const handleAddPm = async () => {
        if (!pMachine || !pTitle.trim()) { Alert.alert('خطا', 'دارایی و شرح کار الزامی است.'); return; }
        const val = parseFloat(pValue);
        if (isNaN(val) || val <= 0) { Alert.alert('خطا', 'بازه را درست وارد کنید.'); return; }
        try {
            const db = await getDatabase();
            await db.runAsync(
                `INSERT INTO pm_tasks (id, machine_id, asset_name, task_title, interval_type, interval_value, created_at, updated_at, sync_status) VALUES (?,?,?,?,?,?,?,?, 'pending');`,
                [generateUniqueId('pm'), pMachine, machineName(pMachine), pTitle.trim(), pType, val, new Date().toISOString(), new Date().toISOString()]
            );
            Alert.alert('افزوده شد', 'کار PM سررسیددار ایجاد شد.');
            setPTitle(''); setPValue('');
            loadAll();
        } catch (e: any) { Alert.alert('خطا', e?.message || 'ثبت ناموفق.'); }
    };

    const exportCorrective = async () => {
        if (events.length === 0) { Alert.alert('خطا', 'رکوردی برای خروجی نیست.'); return; }
        const columns: ExcelColumn[] = [
            { label: 'تاریخ', key: 'date' }, { label: 'دارایی', key: 'asset' }, { label: 'علت', key: 'reason' },
            { label: 'مدت تعمیر (دقیقه)', key: 'mins' }, { label: 'مهندس', key: 'eng' }, { label: 'توضیحات', key: 'desc' },
        ];
        const rows = events.map(e => ({
            date: e.completed_at ? formatJalaliDateTime(e.completed_at) : '-', asset: machineName(e.machine_id),
            reason: getReasonLabel(e.failure_reason_id || ''), mins: e.repair_minutes ?? '-', eng: session?.name || '-', desc: e.description || '-',
        }));
        await exportToExcel(`تعمیرات_اضطراری_${new Date().toISOString().slice(0, 10)}`, columns, rows, 'گزارش تعمیرات اضطراری خط نورد');
        Alert.alert('موفق', 'اکسل تعمیرات آماده شد.');
    };

    const exportPm = async () => {
        if (pmList.length === 0) { Alert.alert('خطا', 'رکوردی برای خروجی نیست.'); return; }
        const columns: ExcelColumn[] = [
            { label: 'دارایی', key: 'asset' }, { label: 'شرح کار', key: 'task' }, { label: 'نوع بازه', key: 'type' },
            { label: 'بازه', key: 'interval' }, { label: 'مصرف‌شده', key: 'used' }, { label: 'باقی‌مانده ٪', key: 'rem' },
            { label: 'وضعیت', key: 'status' }, { label: 'آخرین انجام', key: 'last' },
        ];
        const rows = pmList.map(t => ({
            asset: t.asset_name, task: t.task_title, type: INTERVAL_LABEL[t.interval_type] || t.interval_type,
            interval: formatNumberFa(t.interval_value), used: formatNumberFa(Math.round(t.st.used * 10) / 10),
            rem: formatNumberFa(Math.round(t.st.remaining)), status: t.st.level === 'overdue' ? 'معوق' : t.st.level === 'soon' ? 'نزدیک سررسید' : 'عادی',
            last: t.last_done_at ? formatJalaliDateTime(t.last_done_at) : '—',
        }));
        await exportToExcel(`PM_${new Date().toISOString().slice(0, 10)}`, columns, rows, 'گزارش تعمیرات پیشگیرانه (PM)');
        Alert.alert('موفق', 'اکسل PM آماده شد.');
    };

    const pmChip = (level: string) => level === 'overdue'
        ? { label: 'معوق', color: '#dc2626', bg: 'rgba(248,113,113,0.16)', icon: 'alert-octagon' }
        : level === 'soon'
            ? { label: 'نزدیک سررسید', color: '#f59e0b', bg: 'rgba(245,158,11,0.16)', icon: 'clock-alert' }
            : { label: 'عادی', color: '#059669', bg: 'rgba(52,211,153,0.16)', icon: 'check-circle' };

    const renderKpi = () => (
        <View style={styles.wrap}>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>شاخص‌های قابلیت اطمینان خط (۷ روز)</Text>
                    <Divider style={styles.divider} />
                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: '#dc2626' }]}>{kpi ? formatDurationFa(kpi.mttr) : '—'}</Text><Text style={styles.metricLabel}>MTTR (میانگین زمان تعمیر):</Text></View>
                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: theme.colors.primary }]}>{kpi ? formatDurationFa(kpi.mtbf) : '—'}</Text><Text style={styles.metricLabel}>MTBF (میانگین بین خرابی‌ها):</Text></View>
                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: '#dc2626' }]}>{kpi ? `${formatNumberFa(kpi.failures)} بار` : '—'}</Text><Text style={styles.metricLabel}>خرابی‌های اضطراری:</Text></View>
                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: '#f59e0b' }]}>{kpi ? formatDurationFa(kpi.downtime) : '—'}</Text><Text style={styles.metricLabel}>مجموع توقف اضطراری:</Text></View>
                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: '#dc2626' }]}>{kpi ? `${formatNumberFa(kpi.open)} مورد` : '—'}</Text><Text style={styles.metricLabel}>توقفِ بازِ فعلی:</Text></View>
                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: (kpi && kpi.pmOverdue > 0) ? '#dc2626' : '#059669' }]}>{kpi ? `${formatNumberFa(kpi.pmOverdue)} مورد` : '—'}</Text><Text style={styles.metricLabel}>کار PM معوق:</Text></View>
                </Card.Content>
            </Card>
            <Card style={[styles.card, styles.noteCard]} mode="outlined">
                <Card.Content>
                    <Text variant="bodySmall" style={styles.noteText}>
                        MTTR/MTBF از توقفاتِ ثبت‌شده در «توقفات نورد» محاسبه می‌شود. هر خرابیِ جدید (مثلاً شکستگی بلبرینگ دیشب) را در تبِ «اضطراری» ثبت کن تا این اعداد، سندِ واقعیِ خوابِ خط شوند.
                    </Text>
                </Card.Content>
            </Card>
        </View>
    );

    const renderCorrective = () => (
        <View style={styles.wrap}>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>ثبت تعمیر اضطراری (Corrective)</Text>
                    <Divider style={styles.divider} />
                    <Menu visible={machineMenu} onDismiss={() => setMachineMenu(false)} anchor={<Button mode="outlined" icon="menu-down" onPress={() => setMachineMenu(true)} style={styles.menuAnchor} contentStyle={styles.menuAnchorContent}>{cMachine ? machineName(cMachine) : 'انتخاب دارایی'}</Button>}>
                        {machines.map(m => (<Menu.Item key={m.id} onPress={() => { setCMachine(m.id); setMachineMenu(false); }} title={`${m.name} (${m.code})`} leadingIcon={cMachine === m.id ? 'check' : undefined} />))}
                    </Menu>
                    <Menu visible={reasonMenu} onDismiss={() => setReasonMenu(false)} anchor={<Button mode="outlined" icon="menu-down" onPress={() => setReasonMenu(true)} style={styles.menuAnchor} contentStyle={styles.menuAnchorContent}>{cReason ? getReasonLabel(cReason) : 'علت خرابی'}</Button>}>
                        {FAILURE_REASONS.map(r => (<Menu.Item key={r.value} onPress={() => { setCReason(r.value); setReasonMenu(false); }} title={r.label} leadingIcon={cReason === r.value ? 'check' : undefined} />))}
                    </Menu>
                    <TextInput label="مدت تعمیر (دقیقه)" mode="outlined" value={cMinutes} onChangeText={setCMinutes} keyboardType="numeric" style={styles.input} left={<TextInput.Icon icon="timer-outline" />} placeholder="مثال: 120" />
                    <TextInput label="توضیحات (قطعهٔ عوض‌شده، اقدام انجام‌شده)" mode="outlined" value={cDesc} onChangeText={setCDesc} style={styles.input} left={<TextInput.Icon icon="text-box-outline" />} />
                    <Button mode="contained" icon="wrench-clock" onPress={handleRegisterCorrective} style={[styles.actionButton, { backgroundColor: '#dc2626' }]} labelStyle={styles.actionButtonLabel}>ثبت تعمیر اضطراری</Button>
                </Card.Content>
            </Card>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>تعمیرات اخیر ({formatNumberFa(events.length)})</Text>
                    <Divider style={styles.divider} />
                    {events.length === 0 ? (<Text style={styles.emptyText}>هنوز تعمیر اضطراری ثبت نشده است.</Text>) : (
                        events.map(e => (
                            <View key={e.id} style={styles.eventItem}>
                                <View style={styles.eventHead}>
                                    <Chip compact icon="wrench" style={styles.eventChip} textStyle={styles.eventChipText}>{getReasonLabel(e.failure_reason_id || '')}</Chip>
                                    <Text style={styles.eventTitle} numberOfLines={2}>{machineName(e.machine_id)}</Text>
                                </View>
                                <View style={styles.metricRow}><Text style={styles.metricValue}>{e.repair_minutes != null ? formatDurationFa(e.repair_minutes) : '—'}</Text><Text style={styles.metricLabel}>مدت تعمیر:</Text></View>
                                <View style={styles.metricRow}><Text style={styles.metricValueSmall}>{e.completed_at ? formatJalaliDateTime(e.completed_at) : '—'}</Text><Text style={styles.metricLabel}>تاریخ:</Text></View>
                                {e.description ? <Text style={styles.eventDesc}>{e.description}</Text> : null}
                                <Divider style={styles.itemDivider} />
                            </View>
                        ))
                    )}
                    <Button mode="contained" icon="file-excel-outline" onPress={exportCorrective} style={[styles.exportButton, { backgroundColor: '#15803d' }]} labelStyle={styles.actionButtonLabel}>خروجی اکسل تعمیرات 📊</Button>
                </Card.Content>
            </Card>
        </View>
    );

    const renderPm = () => (
        <View style={styles.wrap}>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>کارهای پیشگیرانه سررسیددار (PM)</Text>
                    <Divider style={styles.divider} />
                    {pmList.length === 0 ? (<Text style={styles.emptyText}>هیچ کار PM تعریف نشده. از فرم پایین اضافه کن.</Text>) : (
                        pmList.map(t => {
                            const c = pmChip(t.st.level);
                            return (
                                <View key={t.id} style={styles.eventItem}>
                                    <View style={styles.eventHead}>
                                        <Chip compact icon={c.icon} style={{ backgroundColor: c.bg }} textStyle={{ color: c.color, fontWeight: 'bold', fontSize: 11 }}>{c.label}</Chip>
                                        <Text style={styles.eventTitle} numberOfLines={2}>{t.task_title}</Text>
                                    </View>
                                    <View style={styles.metricRow}><Text style={styles.metricValue} numberOfLines={2}>{t.asset_name}</Text><Text style={styles.metricLabel}>دارایی:</Text></View>
                                    <View style={styles.metricRow}><Text style={styles.metricValue}>{`${formatNumberFa(t.interval_value)} ${INTERVAL_LABEL[t.interval_type] || ''}`}</Text><Text style={styles.metricLabel}>بازه:</Text></View>
                                    <View style={styles.metricRow}><Text style={[styles.metricValue, { color: c.color }]}>{`${formatNumberFa(Math.round(t.st.used * 10) / 10)} ${INTERVAL_LABEL[t.interval_type] || ''}`}</Text><Text style={styles.metricLabel}>مصرف‌شده:</Text></View>
                                    <View style={styles.metricRow}><Text style={styles.metricValueSmall}>{t.last_done_at ? formatJalaliDateTime(t.last_done_at) : '—'}</Text><Text style={styles.metricLabel}>آخرین انجام:</Text></View>
                                    <Button mode="contained-tonal" icon="check-circle-outline" onPress={() => handlePmDone(t.id)} style={styles.doneButton}>انجام شد</Button>
                                    <Divider style={styles.itemDivider} />
                                </View>
                            );
                        })
                    )}
                    <Button mode="contained" icon="file-excel-outline" onPress={exportPm} style={[styles.exportButton, { backgroundColor: '#15803d' }]} labelStyle={styles.actionButtonLabel}>خروجی اکسل PM 📊</Button>
                </Card.Content>
            </Card>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>افزودن کار PM جدید</Text>
                    <Divider style={styles.divider} />
                    <Menu visible={pmMachineMenu} onDismiss={() => setPmMachineMenu(false)} anchor={<Button mode="outlined" icon="menu-down" onPress={() => setPmMachineMenu(true)} style={styles.menuAnchor} contentStyle={styles.menuAnchorContent}>{pMachine ? machineName(pMachine) : 'انتخاب دارایی'}</Button>}>
                        {machines.map(m => (<Menu.Item key={m.id} onPress={() => { setPMachine(m.id); setPmMachineMenu(false); }} title={`${m.name} (${m.code})`} leadingIcon={pMachine === m.id ? 'check' : undefined} />))}
                    </Menu>
                    <TextInput label="شرح کار (مثال: تعویض غلتک‌ها)" mode="outlined" value={pTitle} onChangeText={setPTitle} style={styles.input} left={<TextInput.Icon icon="clipboard-text-outline" />} />
                    <SegmentedButtons value={pType} onValueChange={(v) => setPType(v as any)} buttons={[{ value: 'hours', label: 'ساعت' }, { value: 'days', label: 'روز' }, { value: 'tons', label: 'تُن' }]} style={styles.segmented} />
                    <TextInput label="بازه (مثال: 500)" mode="outlined" value={pValue} onChangeText={setPValue} keyboardType="numeric" style={styles.input} left={<TextInput.Icon icon="counter" />} />
                    <Button mode="contained" icon="plus-box-outline" onPress={handleAddPm} style={[styles.actionButton, { backgroundColor: theme.colors.primary }]} labelStyle={styles.actionButtonLabel}>ایجاد کار PM</Button>
                </Card.Content>
            </Card>
        </View>
    );

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content title="پنل تعمیرات و نگهداری (PM + اضطراری)" color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}
            <View style={styles.segmentWrap}>
                <SegmentedButtons value={tab} onValueChange={(v) => setTab(v as any)} buttons={[{ value: 'kpi', label: 'شاخص‌ها' }, { value: 'corrective', label: 'اضطراری' }, { value: 'pm', label: 'پیشگیرانه PM' }]} />
            </View>
            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                {loading ? (<ActivityIndicator size="large" color={theme.colors.primary} style={{ marginVertical: 30 }} />) : (
                    tab === 'kpi' ? renderKpi() : tab === 'corrective' ? renderCorrective() : renderPm()
                )}
            </ScrollView>
        </SafeAreaView>
    );
};

// ✅ چیدمانِ مقاوم RTL: بدون width درصدیِ تو در تو؛ stretch + flexWrap + flexShrink
const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 16, lineHeight: 24 },
    segmentWrap: { marginHorizontal: 16, marginTop: 12, marginBottom: 4 },
    scrollContainer: { padding: 16, paddingBottom: 40 },
    wrap: { alignSelf: 'stretch' },
    card: { alignSelf: 'stretch', borderRadius: 12, marginBottom: 16, backgroundColor: '#ffffff' },
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 8, color: '#0F172A', lineHeight: 24, writingDirection: 'rtl' },
    divider: { marginBottom: 14 },
    metricRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 10, alignSelf: 'stretch' },
    metricLabel: { color: '#475569', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, paddingLeft: 8, fontSize: 13, lineHeight: 20 },
    metricValue: { fontWeight: 'bold', color: '#0f172a', textAlign: 'left', fontSize: 15, flexShrink: 1, lineHeight: 22 },
    metricValueSmall: { fontWeight: 'bold', color: '#334155', textAlign: 'left', fontSize: 12, flexShrink: 1, lineHeight: 18 },
    input: { marginBottom: 12, textAlign: 'right' },
    menuAnchor: { marginBottom: 12, borderColor: '#94a3b8' },
    menuAnchorContent: { flexDirection: 'row-reverse' },
    segmented: { marginBottom: 12 },
    actionButton: { borderRadius: 8, paddingVertical: 4, alignSelf: 'stretch' },
    actionButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    exportButton: { borderRadius: 8, marginTop: 12, alignSelf: 'stretch' },
    doneButton: { borderRadius: 8, marginTop: 4, alignSelf: 'stretch' },
    eventItem: { marginBottom: 6, alignSelf: 'stretch' },
    eventHead: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, alignSelf: 'stretch' },
    eventTitle: { fontWeight: 'bold', color: '#0F172A', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, marginRight: 8, fontSize: 14, lineHeight: 22 },
    eventChip: { borderWidth: 0 },
    eventChipText: { fontWeight: 'bold', fontSize: 11, color: '#dc2626' },
    eventDesc: { fontSize: 12, color: '#64748B', textAlign: 'right', writingDirection: 'rtl', lineHeight: 18, marginBottom: 6 },
    itemDivider: { marginVertical: 10 },
    emptyText: { color: '#64748B', textAlign: 'center', lineHeight: 22, paddingVertical: 16 },
    noteCard: { backgroundColor: '#f8fafc', borderColor: '#e2e8f0', borderWidth: 1 },
    noteText: { color: '#64748b', lineHeight: 20, textAlign: 'right', writingDirection: 'rtl', fontSize: 12 },
});

export default MaintenanceScreen;