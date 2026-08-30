import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform, Share } from 'react-native';
import {
    Card,
    Text,
    Button,
    TextInput,
    useTheme,
    Appbar,
    Divider,
    ActivityIndicator,
    Chip,
    SegmentedButtons,
    Checkbox,
    Menu,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase, generateUniqueId } from '../database/Database';
import { exportToExcel, ExcelColumn } from '../utils/excelExport';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';

// =====================================================================
//  ShippingDispatchScreen — بارگیری تریلی، صدور گواهی MTC و خروجی اکسل
//  ذخیره‌سازی در جدول موجود industrial_events (بدون migration جدید)
// =====================================================================

type TabKey = 'loading' | 'mtc' | 'list';

interface BundleInfo {
    id: string;
    bundle_code: string;
    heat_number: string;
    rebar_size: number;
    rebar_grade: string;
    net_weight_kg: number;
    branch_count: number | null;
    quality_status: string;
    produced_at: string;
}

interface DispatchRecord {
    id: string;
    truck_plate: string;
    driver_name: string;
    bill_of_lading: string;
    buyer_name: string;
    bundle_codes: string[];
    heat_numbers: string[];
    total_weight_kg: number;
    dispatch_time: string;
}

export default function ShippingDispatchScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    // ---------- State ها ----------
    const [activeTab, setActiveTab] = useState<TabKey>('loading');

    // تب ۱: فرم بارگیری
    const [truckPlate, setTruckPlate] = useState<string>('');
    const [driverName, setDriverName] = useState<string>('');
    const [billOfLading, setBillOfLading] = useState<string>('');
    const [buyerName, setBuyerName] = useState<string>('');
    const [approvedBundles, setApprovedBundles] = useState<BundleInfo[]>([]);
    const [selectedBundleIds, setSelectedBundleIds] = useState<string[]>([]);
    const [loading, setLoading] = useState<boolean>(false);

    // تب ۲: MTC
    const [selectedDispatch, setSelectedDispatch] = useState<DispatchRecord | null>(null);
    const [mtcMenuVisible, setMtcMenuVisible] = useState<boolean>(false);

    // تب ۳: لیست بارگیری‌ها
    const [dispatchList, setDispatchList] = useState<DispatchRecord[]>([]);

    // ---------- بارگذاری بندیل‌های تأییدشده ----------
    const loadApprovedBundles = async () => {
        try {
            const db = await getDatabase();
            const rows = await db.getAllAsync<BundleInfo>(
                `SELECT id, bundle_code, heat_number, rebar_size, rebar_grade, net_weight_kg, branch_count, quality_status, produced_at
                 FROM rebar_bundles WHERE quality_status = 'APPROVED' ORDER BY produced_at DESC;`
            );
            setApprovedBundles(rows || []);
        } catch (e) {
            console.warn('[ShippingDispatch] load bundles failed:', e);
        }
    };

    // ---------- بارگذاری بارگیری‌ها ----------
    const loadDispatches = async () => {
        try {
            const db = await getDatabase();
            const rows = await db.getAllAsync<any>(
                `SELECT id, payload_json, created_at FROM industrial_events WHERE event_type = 'shipping' ORDER BY created_at DESC LIMIT 50;`
            );
            const parsed: DispatchRecord[] = (rows || [])
                .map((r) => {
                    try {
                        const p = JSON.parse(r.payload_json || '{}');
                        return { ...p, id: r.id, dispatch_time: r.created_at };
                    } catch {
                        return null;
                    }
                })
                .filter(Boolean) as DispatchRecord[];
            setDispatchList(parsed);
        } catch (e) {
            console.warn('[ShippingDispatch] load dispatches failed:', e);
        }
    };

    useEffect(() => {
        loadApprovedBundles();
        loadDispatches();
    }, []);

    // ---------- toggle انتخاب بندیل ----------
    const toggleBundle = (bundleId: string) => {
        setSelectedBundleIds((prev) =>
            prev.includes(bundleId)
                ? prev.filter((id) => id !== bundleId)
                : [...prev, bundleId]
        );
    };

    // ---------- ثبت بارگیری ----------
    const handleRegisterDispatch = async () => {
        if (!truckPlate.trim() || !driverName.trim() || !billOfLading.trim() || !buyerName.trim()) {
            Alert.alert('خطا در ورود داده', 'لطفاً تمام فیلدهای فرم بارگیری را تکمیل کنید.');
            return;
        }
        if (selectedBundleIds.length === 0) {
            Alert.alert('خطا در ورود داده', 'حداقل یک بندیل تأییدشده را انتخاب کنید.');
            return;
        }
        try {
            setLoading(true);
            const db = await getDatabase();
            const selectedBundles = approvedBundles.filter((b) => selectedBundleIds.includes(b.id));
            const totalWeight = selectedBundles.reduce((s, b) => s + (b.net_weight_kg || 0), 0);
            const heatNumbers = [...new Set(selectedBundles.map((b) => b.heat_number))];
            const bundleCodes = selectedBundles.map((b) => b.bundle_code);
            const dispatchId = generateUniqueId('dispatch');
            const payload = {
                truck_plate: truckPlate.trim(),
                driver_name: driverName.trim(),
                bill_of_lading: billOfLading.trim(),
                buyer_name: buyerName.trim(),
                bundle_codes: bundleCodes,
                heat_numbers: heatNumbers,
                total_weight_kg: totalWeight,
            };
            await db.runAsync(
                `INSERT INTO industrial_events (id, event_type, payload_json, sync_status, created_at) VALUES (?, 'shipping', ?, 'pending', ?);`,
                [dispatchId, JSON.stringify(payload), new Date().toISOString()]
            );
            Alert.alert(
                'ثبت بارگیری موفق',
                `تریلی ${truckPlate.trim()} با ${formatNumberFa(bundleCodes.length)} بندیل و وزن ${formatNumberFa(totalWeight)} کیلوگرم بارگیری شد.`
            );
            setTruckPlate('');
            setDriverName('');
            setBillOfLading('');
            setBuyerName('');
            setSelectedBundleIds([]);
            loadDispatches();
            loadApprovedBundles();
        } catch (e: any) {
            console.error('[ShippingDispatch] register failed:', e);
            Alert.alert('خطا در ثبت بارگیری', e?.message || 'عملیات ناموفق بود.');
        } finally {
            setLoading(false);
        }
    };

    // ---------- صدور / اشتراک‌گذاری MTC ----------
    const handleShareMTC = async () => {
        if (!selectedDispatch) {
            Alert.alert('خطا', 'ابتدا یک بارگیری را از منوی بالا انتخاب کنید.');
            return;
        }
        try {
            const db = await getDatabase();
            let qcRows: any[] = [];
            if (selectedDispatch.heat_numbers.length > 0) {
                const heatPlaceholders = selectedDispatch.heat_numbers.map(() => '?').join(',');
                qcRows = await db.getAllAsync<any>(
                    `SELECT * FROM quality_inspections WHERE heat_number IN (${heatPlaceholders}) ORDER BY timestamp DESC;`,
                    selectedDispatch.heat_numbers
                );
            }
            let mtcText = `🏭 گواهی تست کارخانه (MTC - Mill Test Certificate)\n`;
            mtcText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            mtcText += `📋 شماره بارنامه: ${selectedDispatch.bill_of_lading}\n`;
            mtcText += `🚛 پلاک تریلی: ${selectedDispatch.truck_plate}\n`;
            mtcText += `👤 راننده: ${selectedDispatch.driver_name}\n`;
            mtcText += `🏢 خریدار / پروژه: ${selectedDispatch.buyer_name}\n`;
            mtcText += `📅 تاریخ بارگیری: ${formatJalaliDateTime(selectedDispatch.dispatch_time)}\n`;
            mtcText += `⚖ وزن کل محموله: ${formatNumberFa(selectedDispatch.total_weight_kg)} کیلوگرم\n`;
            mtcText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            mtcText += `🔢 شماره ذوب(ها): ${selectedDispatch.heat_numbers.join(' ، ')}\n`;
            mtcText += `📦 پلاک‌های بندیل: ${selectedDispatch.bundle_codes.join(' ، ')}\n`;
            mtcText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            mtcText += `🧪 نتایج آزمون‌های کیفی:\n`;
            if (qcRows.length === 0) {
                mtcText += `  (نتایج QC برای این ذوب ثبت نشده است)\n`;
            } else {
                qcRows.forEach((qc, i) => {
                    mtcText += `  آزمون ${i + 1}: سایز ${qc.rebar_size} | تنش تسلیم ${qc.yield_strength ?? '-'} MPa | تنش کششی ${qc.tensile_strength ?? '-'} MPa | ازدیاد طول ${qc.elongation_percent ?? '-'}٪ | خمش ${qc.bend_test_passed ? 'مطابق' : 'مغایر'}\n`;
                });
            }
            mtcText += `━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            mtcText += `✅ استاندارد مرجع: ISIRI 3132 (گرید A3)\n`;
            mtcText += `🏭 صادرکننده: کارخانه فولاد صنعتی — سامانه MES Sanatify`;
            await Share.share({ message: mtcText, title: 'گواهی MTC' });
        } catch (e: any) {
            console.error('[ShippingDispatch] MTC share failed:', e);
            Alert.alert('خطا در صدور MTC', e?.message || 'عملیات ناموفق بود.');
        }
    };

    // ---------- خروجی اکسل ----------
    const handleExportExcel = async () => {
        if (dispatchList.length === 0) {
            Alert.alert('خطا', 'هیچ بارگیری برای خروجی وجود ندارد.');
            return;
        }
        try {
            const columns: ExcelColumn[] = [
                { label: 'شناسه', key: 'id' },
                { label: 'پلاک تریلی', key: 'truck_plate' },
                { label: 'نام راننده', key: 'driver_name' },
                { label: 'شماره بارنامه', key: 'bill_of_lading' },
                { label: 'خریدار / پروژه', key: 'buyer_name' },
                { label: 'تعداد بندیل', key: 'bundle_count' },
                { label: 'وزن کل (kg)', key: 'total_weight_kg' },
                { label: 'شماره ذوب(ها)', key: 'heat_numbers' },
                { label: 'پلاک‌های بندیل', key: 'bundle_codes' },
                { label: 'زمان بارگیری', key: 'dispatch_time' },
            ];
            const rows = dispatchList.map((d) => ({
                ...d,
                bundle_count: d.bundle_codes.length,
                heat_numbers: d.heat_numbers.join(' ، '),
                bundle_codes: d.bundle_codes.join(' ، '),
                dispatch_time: d.dispatch_time ? formatJalaliDateTime(d.dispatch_time) : '-',
            }));
            await exportToExcel(
                `گزارش_بارگیری_${new Date().toISOString().slice(0, 10)}`,
                columns,
                rows,
                `گزارش محموله‌های صادرشده و لوجستیک خروجی`
            );
            Alert.alert('موفق', 'فایل خروجی اکسل بارگیری آمادهٔ اشتراک‌گذاری/ذخیره شد.');
        } catch (e: any) {
            console.error('[ShippingDispatch] export failed:', e);
            Alert.alert('خطا در خروجی اکسل', e?.message || 'عملیات خروجی ناموفق بود.');
        }
    };

    // ---------- رندر تب ۱: ثبت بارگیری ----------
    const renderLoadingTab = () => (
        <>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        اطلاعات تریلی و بارنامه
                    </Text>
                    <Divider style={styles.divider} />
                    <TextInput
                        label="پلاک تریلی"
                        mode="outlined"
                        value={truckPlate}
                        onChangeText={setTruckPlate}
                        style={styles.input}
                        left={<TextInput.Icon icon="truck" />}
                        placeholder="مثال: ۱۲ع۳۴۵ - ایران ۷۷"
                    />
                    <TextInput
                        label="نام راننده"
                        mode="outlined"
                        value={driverName}
                        onChangeText={setDriverName}
                        style={styles.input}
                        left={<TextInput.Icon icon="account" />}
                    />
                    <TextInput
                        label="شماره بارنامه"
                        mode="outlined"
                        value={billOfLading}
                        onChangeText={setBillOfLading}
                        style={styles.input}
                        left={<TextInput.Icon icon="file-document-outline" />}
                        placeholder="مثال: BOL-1405-0724"
                    />
                    <TextInput
                        label="نام خریدار / پروژه"
                        mode="outlined"
                        value={buyerName}
                        onChangeText={setBuyerName}
                        style={styles.input}
                        left={<TextInput.Icon icon="office-building" />}
                    />
                </Card.Content>
            </Card>

            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        انتخاب بندیل‌های تأییدشده کیفی (APPROVED)
                    </Text>
                    <Divider style={styles.divider} />
                    {approvedBundles.length === 0 ? (
                        <Text variant="bodyMedium" style={styles.emptyText}>
                            هیچ بندیل تأییدشده‌ای برای بارگیری وجود ندارد. ابتدا بندیل‌ها را در QC تأیید کنید.
                        </Text>
                    ) : (
                        approvedBundles.map((b) => (
                            <View key={b.id} style={styles.bundleRow}>
                                <Checkbox
                                    status={selectedBundleIds.includes(b.id) ? 'checked' : 'unchecked'}
                                    onPress={() => toggleBundle(b.id)}
                                    color={theme.colors.primary}
                                />
                                <View style={styles.bundleInfo}>
                                    <Text variant="bodyMedium" style={styles.bundleCode}>
                                        {b.bundle_code}
                                    </Text>
                                    <Text variant="bodySmall" style={styles.bundleMeta}>
                                        ذوب {b.heat_number} | سایز {formatNumberFa(b.rebar_size)} | گرید {b.rebar_grade} | {formatNumberFa(b.net_weight_kg)} kg
                                    </Text>
                                </View>
                            </View>
                        ))
                    )}
                    <Button
                        mode="contained"
                        icon="truck-check"
                        loading={loading}
                        disabled={loading}
                        onPress={handleRegisterDispatch}
                        style={styles.actionButton}
                        labelStyle={styles.actionButtonLabel}
                    >
                        ثبت بارگیری تریلی
                    </Button>
                </Card.Content>
            </Card>
        </>
    );

    // ---------- رندر تب ۲: MTC ----------
    const renderMtcTab = () => (
        <>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        انتخاب بارگیری برای صدور MTC
                    </Text>
                    <Divider style={styles.divider} />
                    <Menu
                        visible={mtcMenuVisible}
                        onDismiss={() => setMtcMenuVisible(false)}
                        anchor={
                            <Button
                                mode="outlined"
                                icon="menu-down"
                                onPress={() => setMtcMenuVisible(true)}
                                style={styles.menuAnchor}
                                contentStyle={styles.menuAnchorContent}
                            >
                                {selectedDispatch
                                    ? `بارنامه ${selectedDispatch.bill_of_lading} — ${selectedDispatch.truck_plate}`
                                    : 'انتخاب بارگیری'}
                            </Button>
                        }
                    >
                        {dispatchList.length === 0 ? (
                            <Menu.Item title="هیچ بارگیری ثبت نشده" disabled />
                        ) : (
                            dispatchList.map((d) => (
                                <Menu.Item
                                    key={d.id}
                                    onPress={() => {
                                        setSelectedDispatch(d);
                                        setMtcMenuVisible(false);
                                    }}
                                    title={`${d.bill_of_lading} — ${d.truck_plate}`}
                                    leadingIcon={selectedDispatch?.id === d.id ? 'check' : undefined}
                                />
                            ))
                        )}
                    </Menu>
                </Card.Content>
            </Card>

            {selectedDispatch && (
                <Card style={[styles.card, styles.mtcCard]} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={styles.mtcCardTitle}>
                            🏭 گواهی تست کارخانه (MTC)
                        </Text>
                        <Divider style={styles.mtcDivider} />
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{selectedDispatch.bill_of_lading}</Text>
                            <Text style={styles.mtcLabel}>شماره بارنامه:</Text>
                        </View>
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{selectedDispatch.truck_plate}</Text>
                            <Text style={styles.mtcLabel}>پلاک تریلی:</Text>
                        </View>
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{selectedDispatch.driver_name}</Text>
                            <Text style={styles.mtcLabel}>راننده:</Text>
                        </View>
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{selectedDispatch.buyer_name}</Text>
                            <Text style={styles.mtcLabel}>خریدار / پروژه:</Text>
                        </View>
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{formatNumberFa(selectedDispatch.total_weight_kg)} kg</Text>
                            <Text style={styles.mtcLabel}>وزن کل:</Text>
                        </View>
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{selectedDispatch.heat_numbers.join(' ، ')}</Text>
                            <Text style={styles.mtcLabel}>شماره ذوب(ها):</Text>
                        </View>
                        <View style={styles.mtcRow}>
                            <Text style={styles.mtcValue}>{selectedDispatch.bundle_codes.join(' ، ')}</Text>
                            <Text style={styles.mtcLabel}>پلاک‌ها:</Text>
                        </View>
                        <Button
                            mode="contained"
                            icon="printer"
                            onPress={handleShareMTC}
                            style={[styles.actionButton, { backgroundColor: '#1e3d59' }]}
                            labelStyle={styles.actionButtonLabel}
                        >
                            چاپ / اشتراک‌گذاری MTC
                        </Button>
                    </Card.Content>
                </Card>
            )}

            {!selectedDispatch && (
                <Card style={styles.card} mode="elevated">
                    <Card.Content style={styles.emptyWrap}>
                        <Text variant="bodyMedium" style={styles.emptyText}>
                            یک بارگیری را از منوی بالا انتخاب کنید تا شناسنامهٔ کیفی (MTC) نمایش داده شود.
                        </Text>
                    </Card.Content>
                </Card>
            )}
        </>
    );

    // ---------- رندر تب ۳: لیست بارگیری‌ها ----------
    const renderListTab = () => (
        <>
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        محموله‌های صادرشده ({formatNumberFa(dispatchList.length)})
                    </Text>
                    <Divider style={styles.divider} />
                    {dispatchList.length === 0 ? (
                        <Text variant="bodyMedium" style={styles.emptyText}>
                            هیچ بارگیری ثبت نشده است.
                        </Text>
                    ) : (
                        dispatchList.map((d, idx) => (
                            <View key={d.id}>
                                <View style={styles.listItemHeader}>
                                    <Chip
                                        compact={true}
                                        icon="truck"
                                        style={styles.listChip}
                                        textStyle={styles.listChipText}
                                    >
                                        {d.truck_plate}
                                    </Chip>
                                    <Text variant="bodyLarge" style={styles.listItemTitle}>
                                        {d.bill_of_lading}
                                    </Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{d.driver_name}</Text>
                                    <Text style={styles.detailLabel}>راننده:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{d.buyer_name}</Text>
                                    <Text style={styles.detailLabel}>خریدار:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatNumberFa(d.bundle_codes.length)} بندیل</Text>
                                    <Text style={styles.detailLabel}>تعداد:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>{formatNumberFa(d.total_weight_kg)} kg</Text>
                                    <Text style={styles.detailLabel}>وزن باسکول:</Text>
                                </View>
                                <View style={styles.detailRow}>
                                    <Text style={styles.detailValue}>
                                        {d.dispatch_time ? formatJalaliDateTime(d.dispatch_time) : '-'}
                                    </Text>
                                    <Text style={styles.detailLabel}>زمان:</Text>
                                </View>
                                {idx < dispatchList.length - 1 && <Divider style={styles.itemDivider} />}
                            </View>
                        ))
                    )}
                    <Button
                        mode="contained"
                        icon="file-excel-outline"
                        onPress={handleExportExcel}
                        style={styles.exportButton}
                        labelStyle={styles.exportButtonLabel}
                    >
                        خروجی اکسل بارگیری و لوجستیک 📊
                    </Button>
                </Card.Content>
            </Card>
        </>
    );

    // ---------- رندر اصلی ----------
    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content
                        title="بارگیری تریلی و صدور MTC"
                        color="#ffffff"
                        titleStyle={styles.headerTitle}
                    />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
                <View style={styles.container}>
                    <SegmentedButtons
                        value={activeTab}
                        onValueChange={(v) => setActiveTab(v as TabKey)}
                        buttons={[
                            { value: 'loading', label: 'ثبت بارگیری', icon: 'truck' },
                            { value: 'mtc', label: 'صدور MTC', icon: 'certificate' },
                            { value: 'list', label: 'لیست و خروجی', icon: 'format-list-bulleted' },
                        ]}
                        style={styles.segmented}
                    />

                    {activeTab === 'loading' && renderLoadingTab()}
                    {activeTab === 'mtc' && renderMtcTab()}
                    {activeTab === 'list' && renderListTab()}

                    <Text style={styles.footerText}>
                        سامانه ردیابی فولاد — لوجستیک و صدور گواهی MTC بر بستر sanatify.db
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18, lineHeight: 26 },
    scrollContainer: { flexGrow: 1, paddingVertical: 16 },
    container: { alignItems: 'center', paddingHorizontal: 16, width: '100%' },
    segmented: { marginBottom: 16, width: '100%', maxWidth: 480 },
    card: { width: '100%', maxWidth: 480, borderRadius: 12, marginBottom: 16, backgroundColor: '#ffffff' },
    cardTitle: { fontWeight: 'bold', textAlign: 'right', marginBottom: 8, color: '#0F172A', lineHeight: 24, writingDirection: 'rtl' },
    divider: { marginBottom: 14 },
    input: { marginBottom: 14, textAlign: 'right' },
    actionButton: { borderRadius: 8, paddingVertical: 4, marginTop: 8 },
    actionButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    emptyWrap: { alignItems: 'center', paddingVertical: 24 },
    emptyText: { color: '#64748B', textAlign: 'center', lineHeight: 22 },
    // ----- تب ۱: بندیل‌ها -----
    bundleRow: { flexDirection: 'row-reverse', alignItems: 'center', marginBottom: 8, width: '100%' },
    bundleInfo: { flexShrink: 1, marginRight: 8, alignItems: 'flex-end' },
    bundleCode: { fontWeight: 'bold', color: '#0F172A', textAlign: 'right', writingDirection: 'rtl' },
    bundleMeta: { color: '#64748B', textAlign: 'right', writingDirection: 'rtl', marginTop: 2 },
    // ----- تب ۲: MTC -----
    menuAnchor: { marginBottom: 14, borderColor: '#94a3b8' },
    menuAnchorContent: { flexDirection: 'row-reverse' },
    mtcCard: { backgroundColor: '#0f172a' },
    mtcCardTitle: { fontWeight: 'bold', textAlign: 'right', color: '#ffffff', lineHeight: 24, writingDirection: 'rtl' },
    mtcDivider: { backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 12 },
    mtcRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, width: '100%' },
    mtcLabel: { fontSize: 12, color: '#94A3B8', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, paddingLeft: 8 },
    mtcValue: { fontSize: 13, fontWeight: 'bold', color: '#F8FAFC', textAlign: 'left', flexShrink: 1 },
    // ----- تب ۳: لیست -----
    listItemHeader: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, width: '100%' },
    listItemTitle: { fontWeight: 'bold', color: '#0F172A', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, marginRight: 8 },
    listChip: { backgroundColor: 'rgba(30,61,89,0.12)' },
    listChipText: { color: '#1e3d59', fontWeight: 'bold', fontSize: 11 },
    detailRow: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, width: '100%' },
    detailLabel: { fontSize: 12, color: '#64748B', textAlign: 'right', writingDirection: 'rtl', flexShrink: 1, paddingLeft: 8 },
    detailValue: { fontSize: 13, fontWeight: 'bold', color: '#0F172A', textAlign: 'left', flexShrink: 1 },
    itemDivider: { marginVertical: 10 },
    exportButton: { borderRadius: 8, backgroundColor: '#15803d', marginTop: 12, width: '100%' },
    exportButtonLabel: { fontSize: 15, fontWeight: 'bold', lineHeight: 24 },
    footerText: { marginTop: 8, marginBottom: 16, fontSize: 11, color: '#94A3B8', textAlign: 'center', lineHeight: 18 },
});