import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Platform, Alert, TouchableOpacity } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, TextInput, Divider, RadioButton, Chip } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDatabase, generateUniqueId } from '../database/Database';
import { WorkshopContextService, WorkshopContext } from '../services/WorkshopContextService';
import { IndustrialEventService } from '../services/IndustrialEventService';
import { AuthService, OperatorSession } from '../services/AuthService';

const NOMINAL_SIZES = [12, 14, 16, 18, 20, 22, 25, 26];

const toPersianDigits = (value: number | string): string => {
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    return String(value).replace(/[0-9]/g, (d) => persianDigits[Number(d)]);
};

// ✅ حکمِ کیفیِ نهایی را به بندیل(های) مرتبط اعمال می‌کند
// گرهٔ QC: rebar_bundles.quality_status  از  PENDING  ->  APPROVED / REJECTED
// منطقِ پیوند: اگر heat_number پر بود بر اساسِ آن (یک ذوب = چند بندیلِ هم‌سایز)،
// وگرنه بر اساسِ billet_id.  rebar_size همیشه در WHERE هست (در فرمِ QC اجباری است).
async function applyQualityVerdict(
    db: any,
    params: { heatNumber: string; billetId: string; rebarSize: string; verdict: 'APPROVED' | 'REJECTED' }
): Promise<number> {
    const size = Number(params.rebarSize);
    let sql = '';
    let args: any[] = [];

    if (params.heatNumber && params.heatNumber.trim()) {
        sql = `UPDATE rebar_bundles SET quality_status = ? WHERE heat_number = ? AND rebar_size = ?`;
        args = [params.verdict, params.heatNumber.trim(), size];
    } else if (params.billetId && params.billetId.trim()) {
        sql = `UPDATE rebar_bundles SET quality_status = ? WHERE billet_id = ? AND rebar_size = ?`;
        args = [params.verdict, params.billetId.trim(), size];
    } else {
        console.warn('[QC] applyQualityVerdict: هیچ کلیدِ پیوندی (heat_number/billet_id) موجود نیست.');
        return 0;
    }

    const result = await db.runAsync(sql, args);
    const changes = (result && typeof result.changes === 'number') ? result.changes : 0;
    if (changes === 0) {
        console.warn(`[QC] applyQualityVerdict: هیچ بندیلی برای "${params.heatNumber || params.billetId}" size=${size} یافت نشد — quality_status تغییر نکرد. (کلیدِ پیوند را چک کن)`);
    } else {
        console.log(`[QC] applyQualityVerdict: ${changes} بندیل -> ${params.verdict}`);
    }
    return changes;
}

const QCInspectionScreen: React.FC<any> = ({ navigation }) => {
    const theme = useTheme();
    const [loading, setLoading] = useState(false);

    const [billetId, setBilletId] = useState('');
    const [heatNumber, setHeatNumber] = useState('');
    const [batchNumber, setBatchNumber] = useState('');
    const [rebarSize, setRebarSize] = useState('');
    const [measuredDiameter, setMeasuredDiameter] = useState('');
    const [crossSectionArea, setCrossSectionArea] = useState('');

    const [yieldStrength, setYieldStrength] = useState('');
    const [tensileStrength, setTensileStrength] = useState('');
    const [maxLoad, setMaxLoad] = useState('');
    const [elongation, setElongation] = useState('');

    const [bendTest, setBendTest] = useState('1');
    const [visualInspection, setVisualInspection] = useState('1');

    const [activeContext, setActiveContext] = useState<WorkshopContext | null>(null);
    const [session, setSession] = useState<OperatorSession | null>(null);
    const [gradeSpec, setGradeSpec] = useState({ minYield: 400, minTensile: 600, minElongation: 16 });

    // ✅ ADDITIVE — بندیل‌های در انتظارِ QC + آیتمِ انتخاب‌شده (برای پر شدنِ خودکارِ فیلدها)
    const [pendingBundles, setPendingBundles] = useState<Array<{ id: string; bundle_code: string; heat_number: string | null; billet_id: string | null; rebar_size: any; rebar_grade: string | null }>>([]);
    const [pickedId, setPickedId] = useState<string | null>(null);

    // ✅ ADDITIVE — خواندنِ بندیل‌های PENDING از حافظه (منبعِ لیستِ انتخابِ سریع)
    const loadPendingBundles = async () => {
        try {
            const db = await getDatabase();
            const rows = await db.getAllAsync<{ id: string; bundle_code: string; heat_number: string | null; billet_id: string | null; rebar_size: any; rebar_grade: string | null }>(
                `SELECT id, bundle_code, heat_number, billet_id, rebar_size, rebar_grade
                 FROM rebar_bundles
                 WHERE quality_status = 'PENDING'
                 ORDER BY produced_at DESC
                 LIMIT 50;`
            );
            setPendingBundles(rows || []);
        } catch (e) {
            console.warn('[QC] loadPendingBundles error:', e);
            setPendingBundles([]);
        }
    };

    // ✅ ADDITIVE — با لمسِ یک بندیل، فیلدهای فرم خودکار پر می‌شوند (بدون تایپِ دستیِ کدهای طولانی)
    const pickPendingBundle = (b: typeof pendingBundles[number]) => {
        setHeatNumber(b.heat_number ?? '');
        setBilletId(b.billet_id ?? '');
        const sz = b.rebar_size;
        const szStr = sz == null ? '' : (Number.isInteger(Number(sz)) ? String(Math.round(Number(sz))) : String(sz));
        setRebarSize(szStr);
        setPickedId(b.id);
    };

    useEffect(() => {
        (async () => {
            try {
                const context = await WorkshopContextService.getActiveContext();
                setActiveContext(context);
            } catch (e) {
                console.warn('[QC] Failed to load active workshop context:', e);
            }
        })();

        (async () => {
            try {
                const currentSession = await AuthService.getCurrentSession();
                setSession(currentSession);
            } catch (e) {
                console.warn('[QC] Failed to load operator session:', e);
            }
        })();

        (async () => {
            try {
                const db = await getDatabase();
                const row = await db.getFirstAsync<{ min_yield_mpa: number; min_tensile_mpa: number; min_elongation_pct: number }>(
                    `SELECT min_yield_mpa, min_tensile_mpa, min_elongation_pct FROM grade_specs WHERE grade = 'A3' LIMIT 1;`
                );
                if (row) {
                    setGradeSpec({
                        minYield: row.min_yield_mpa,
                        minTensile: row.min_tensile_mpa,
                        minElongation: row.min_elongation_pct,
                    });
                }
            } catch (e) {
                console.warn('[QC] Failed to load grade spec, using defaults:', e);
            }
        })();
    }, []);

    // ✅ ADDITIVE — بارگذاریِ اولیهٔ لیستِ بندیل‌های در انتظار، موقعِ باز شدنِ صفحه
    useEffect(() => {
        (async () => {
            try { await loadPendingBundles(); }
            catch (e) { console.warn('[QC] initial pending load failed:', e); }
        })();
    }, []);

    const nominalArea = rebarSize ? (Math.PI * Math.pow(Number(rebarSize) / 2, 2)) : 0;

    const yieldRatioValue = (yieldStrength && tensileStrength && parseFloat(yieldStrength) > 0)
        ? parseFloat(tensileStrength) / parseFloat(yieldStrength)
        : null;

    const complianceResult: 'pass' | 'fail' | null = (() => {
        if (!yieldStrength || !tensileStrength || !elongation) return null;
        const y = parseFloat(yieldStrength);
        const t = parseFloat(tensileStrength);
        const e = parseFloat(elongation);
        if (isNaN(y) || isNaN(t) || isNaN(e)) return null;
        return (y >= gradeSpec.minYield && t >= gradeSpec.minTensile && e >= gradeSpec.minElongation) ? 'pass' : 'fail';
    })();

    const handleSave = async () => {
        if (!billetId || !rebarSize || !yieldStrength || !tensileStrength) {
            Alert.alert('خطا', 'لطفاً تمام فیلدهای الزامی را تکمیل کنید.');
            return;
        }

        setLoading(true);
        try {
            const db = await getDatabase();
            const id = generateUniqueId('qc');
            const timestamp = new Date().toISOString();

            const computedYieldRatio = yieldRatioValue !== null ? Number(yieldRatioValue.toFixed(2)) : null;
            const compliantFlag = complianceResult === null ? null : (complianceResult === 'pass' ? 1 : 0);

            // حکمِ نهایی: استانداردِ کششی (A3) + خمش + بازرسیِ سطح؛ هر سه باید قبول باشند
            const tensilePass = complianceResult === 'pass';
            const bendPass = bendTest === '1';
            const visualPass = visualInspection === '1';
            const finalVerdict: 'APPROVED' | 'REJECTED' =
                (tensilePass && bendPass && visualPass) ? 'APPROVED' : 'REJECTED';

            // تراکنش: یا «بازرسی + تغییرِ وضعیتِ بندیل» هر دو ثبت می‌شوند، یا هیچ‌کدام
            await db.execAsync('BEGIN');

            await db.runAsync(
                `INSERT INTO quality_inspections (
                    id, billet_id, rebar_size, measured_diameter, cross_section_area,
                    yield_strength, tensile_strength, max_load_kgf, elongation_percent, 
                    bend_test_passed, visual_inspection, inspector_id, inspector_name, timestamp,
                    heat_number, batch_number, yield_ratio, standard_compliant,
                    workshop_name, line_name, machine_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    id, billetId, rebarSize,
                    parseFloat(measuredDiameter) || 0,
                    parseFloat(crossSectionArea) || 0,
                    parseFloat(yieldStrength),
                    parseFloat(tensileStrength),
                    parseFloat(maxLoad) || 0,
                    parseFloat(elongation) || 0,
                    parseInt(bendTest),
                    parseInt(visualInspection),
                    session?.id ?? null,
                    session?.name ?? null,
                    timestamp,
                    heatNumber || null,
                    batchNumber || null,
                    computedYieldRatio,
                    compliantFlag,
                    activeContext?.workshop_name ?? null,
                    activeContext?.line_name ?? null,
                    activeContext?.machine_name ?? null,
                ]
            );

            // گرهٔ QC: وضعیتِ بندیل را به حکمِ نهایی ببر (بارگیری را باز/قفل کن)
            await applyQualityVerdict(db, {
                heatNumber,
                billetId,
                rebarSize,
                verdict: finalVerdict,
            });

            await db.execAsync('COMMIT');

            // ✅ ADDITIVE — بندیلِ تازه تأیید/ردشده از لیستِ «در انتظار» حذف شود
            await loadPendingBundles();

            // بازتابِ رویداد در تایم‌لاینِ یکپارچه (بیرونِ تراکنش — غیربحرانی)
            try {
                await IndustrialEventService.createEvent(
                    'quality',
                    session?.id ?? null,
                    session?.name ?? null,
                    null,
                    activeContext?.workshop_name ?? null,
                    null,
                    activeContext?.line_name ?? null,
                    null,
                    activeContext?.machine_name ?? null,
                    session?.active_shift_id ?? null,
                    {
                        issue: `سایز ${rebarSize} میلی‌متر - ${finalVerdict === 'APPROVED' ? 'تأیید نهایی شد (مطابق A3 + خمش + سطح)' : 'رد شد (مغایر استاندارد/خمش/سطح)'}`,
                        details: `شناسه بیلت: ${billetId} | تنش تسلیم: ${yieldStrength} MPa | استحکام کششی: ${tensileStrength} MPa | ازدیاد طول: ${elongation}% | خمش: ${bendPass ? 'قبول' : 'مردود'} | سطح: ${visualPass ? 'سالم' : 'معیوب'}`,
                        billet_id: billetId,
                        quality_inspection_id: id,
                        compliant: finalVerdict === 'APPROVED' ? 'pass' : 'fail',
                    },
                    'QCInspectionScreen'
                );
            } catch (timelineError) {
                console.warn('[QC] Saved successfully but failed to mirror into unified timeline:', timelineError);
            }

            // پیامِ دقیق بر اساسِ دلیلِ رد
            if (finalVerdict === 'REJECTED') {
                if (complianceResult === null) {
                    Alert.alert('ذخیره شد — تأیید ممکن نیست', 'پارامترهای کششی (تسلیم/کششی/ازدیاد طول) کامل وارد نشده‌اند؛ بندیل REJECTED شد و قابلِ بارگیری نیست.');
                } else if (!tensilePass) {
                    Alert.alert('ذخیره شد — ردِ کیفی', 'نتایج کششی پایین‌تر از حدِ مجازِ استانداردِ A3 است. بندیل REJECTED شد و قابلِ بارگیری نیست.');
                } else {
                    Alert.alert('ذخیره شد — ردِ کیفی', 'کششی مطابق است، اما آزمونِ خمش یا بازرسیِ سطح مردود است. بندیل REJECTED شد و قابلِ بارگیری نیست.');
                }
            } else {
                Alert.alert('موفقیت', 'کنترلِ کیفیت تأیید شد. بندیل APPROVED شد و در صفحهٔ بارگیری در دسترس است.');
            }

            setBilletId(''); setHeatNumber(''); setBatchNumber('');
            setRebarSize(''); setMeasuredDiameter(''); setCrossSectionArea('');
            setYieldStrength(''); setTensileStrength(''); setMaxLoad(''); setElongation('');
            setPickedId(null);   // ✅ ADDITIVE

        } catch (error) {
            // اگر هر چیزی شکست خورد، تراکنش را برگردان تا وضعیتِ نیمه‌کاره نماند
            try {
                const db = await getDatabase();
                await db.execAsync('ROLLBACK');
            } catch (rbErr) {
                console.warn('[QC] Rollback failed (probably no active transaction):', rbErr);
            }
            console.error('QC Save Error:', error);
            Alert.alert('خطای پایگاه داده', 'ذخیره اطلاعات با خطا مواجه شد.');
        } finally {
            setLoading(false);
        }
    };

    const handleGoBack = () => {
        try {
            if (navigation && navigation.canGoBack()) {
                navigation.goBack();
            } else {
                navigation.reset({
                    index: 0,
                    routes: [{ name: 'EngineerDashboard' }],
                });
            }
        } catch (error) {
            console.error('Navigation error:', error);
            navigation.reset({
                index: 0,
                routes: [{ name: 'Login' }],
            });
        }
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={handleGoBack} color="#ffffff" />
                    <Appbar.Content title="فرم کنترل کیفیت میلگرد" color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer}>

                {activeContext && (
                    <Card style={styles.contextCard} mode="outlined">
                        <Card.Content style={styles.contextContent}>
                            <Text style={styles.contextText}>
                                سالن: {activeContext.workshop_name} · خط: {activeContext.line_name} · دستگاه: {activeContext.machine_name}
                            </Text>
                            {session ? (
                                <Text style={styles.contextText}>بازرس: {session.name} ({session.role === 'engineer' ? 'مهندس' : session.role === 'manager' ? 'مدیر' : 'اپراتور'})</Text>
                            ) : (
                                <Text style={styles.warningText}>هشدار: نشست اپراتور فعال یافت نشد؛ این رکورد بدون نام بازرس ثبت می‌شود.</Text>
                            )}
                        </Card.Content>
                    </Card>
                )}

                {/* ✅ ADDITIVE — انتخابِ سریع از بندیل‌های در انتظار QC (پر شدنِ خودکارِ فیلدها؛ بدون تایپِ دستیِ کدهای طولانی) */}
                <Card style={styles.card} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            انتخابِ سریع از بندیل‌های در انتظار QC
                        </Text>
                        <Divider style={[styles.divider, { backgroundColor: theme.colors.primary }]} />
                        <Text style={styles.pendingHint}>
                            برای پر شدنِ خودکارِ «شناسه بیلت / شماره ذوب / سایز»، بندیل را لمس کنید؛ سپس اعدادِ آزمون را وارد و ذخیره کنید.
                        </Text>
                        {pendingBundles.length === 0 ? (
                            <Text style={styles.pendingEmpty}>بندیلِ در انتظارِ QC یافت نشد. ابتدا در صفحهٔ بسته‌بندی پلاک صادر کنید.</Text>
                        ) : (
                            <ScrollView style={styles.pendingScroll} nestedScrollEnabled>
                                {pendingBundles.map((b) => (
                                    <TouchableOpacity
                                        key={b.id}
                                        activeOpacity={0.7}
                                        onPress={() => pickPendingBundle(b)}
                                        style={[styles.pendingItem, b.id === pickedId && { borderColor: theme.colors.primary, borderWidth: 2, backgroundColor: '#e0f2fe' }]}
                                    >
                                        <Text style={styles.pendingCode} numberOfLines={1}>{b.bundle_code}</Text>
                                        <Text style={styles.pendingMeta} numberOfLines={2}>
                                            ذوب: {b.heat_number || '—'}  ·  بیلت: {b.billet_id || '—'}  ·  سایز: {b.rebar_size ?? '—'}  ·  گرید: {b.rebar_grade || '—'}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        )}
                    </Card.Content>
                </Card>

                <Card style={styles.card} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            اطلاعات متریال
                        </Text>
                        <Divider style={[styles.divider, { backgroundColor: theme.colors.primary }]} />

                        <TextInput
                            label="شناسه بیلت"
                            value={billetId}
                            onChangeText={setBilletId}
                            style={styles.input}
                            mode="outlined"
                            dense
                        />
                        <TextInput
                            label="شماره ذوب / کوره"
                            value={heatNumber}
                            onChangeText={setHeatNumber}
                            style={styles.input}
                            mode="outlined"
                            dense
                        />
                        <TextInput
                            label="شماره پارتی تولید"
                            value={batchNumber}
                            onChangeText={setBatchNumber}
                            style={styles.input}
                            mode="outlined"
                            dense
                        />

                        <Text style={styles.radioLabel}>سایز اسمی میلگرد (mm):</Text>
                        <View style={styles.sizeRow}>
                            {NOMINAL_SIZES.map(size => {
                                const selected = rebarSize === String(size);
                                return (
                                    <Chip
                                        key={size}
                                        selected={selected}
                                        onPress={() => setRebarSize(String(size))}
                                        style={[styles.sizeChip, selected ? { backgroundColor: theme.colors.primary } : styles.sizeChipUnselected]}
                                        textStyle={[styles.sizeChipText, selected && styles.sizeChipTextSelected]}
                                    >
                                        {toPersianDigits(size)}
                                    </Chip>
                                );
                            })}
                        </View>
                        {rebarSize ? (
                            <Text style={styles.nominalAreaText}>
                                مساحت مقطع اسمی محاسبه‌شده: {toPersianDigits(nominalArea.toFixed(1))} mm² (فقط مرجع؛ مساحت اندازه‌گیری‌شده را جدا وارد کنید)
                            </Text>
                        ) : null}

                        <TextInput
                            label="قطر اندازه‌گیری‌شده (mm)"
                            value={measuredDiameter}
                            onChangeText={setMeasuredDiameter}
                            style={styles.input}
                            mode="outlined"
                            keyboardType="numeric"
                            dense
                        />
                        <TextInput
                            label="مساحت سطح مقطع اندازه‌گیری‌شده (mm²)"
                            value={crossSectionArea}
                            onChangeText={setCrossSectionArea}
                            style={styles.input}
                            mode="outlined"
                            keyboardType="numeric"
                            dense
                        />
                    </Card.Content>
                </Card>

                <Card style={styles.card} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            آزمون کشش (دستگاه Gotech)
                        </Text>
                        <Divider style={[styles.divider, { backgroundColor: theme.colors.primary }]} />

                        <TextInput
                            label="تنش تسلیم (MPa)"
                            value={yieldStrength}
                            onChangeText={setYieldStrength}
                            style={styles.input}
                            mode="outlined"
                            keyboardType="numeric"
                            dense
                        />
                        <TextInput
                            label="استحکام کششی (MPa)"
                            value={tensileStrength}
                            onChangeText={setTensileStrength}
                            style={styles.input}
                            mode="outlined"
                            keyboardType="numeric"
                            dense
                        />
                        <TextInput
                            label="حداکثر بار (kgf)"
                            value={maxLoad}
                            onChangeText={setMaxLoad}
                            style={styles.input}
                            mode="outlined"
                            keyboardType="numeric"
                            dense
                        />
                        <TextInput
                            label="ازدیاد طول (%)"
                            value={elongation}
                            onChangeText={setElongation}
                            style={styles.input}
                            mode="outlined"
                            keyboardType="numeric"
                            dense
                        />

                        {yieldRatioValue !== null && (
                            <Text style={styles.ratioText}>
                                نسبت استحکام کششی به تسلیم (Ts/Ys): {toPersianDigits(yieldRatioValue.toFixed(2))}
                            </Text>
                        )}

                        {complianceResult && (
                            <View style={[styles.verdictBadge, complianceResult === 'pass' ? styles.verdictPass : styles.verdictFail]}>
                                <Text style={[styles.verdictText, complianceResult === 'pass' ? styles.verdictTextPass : styles.verdictTextFail]}>
                                    {complianceResult === 'pass'
                                        ? `✓ مطابق استاندارد A3 (حداقل تسلیم ${toPersianDigits(gradeSpec.minYield)}، حداقل کششی ${toPersianDigits(gradeSpec.minTensile)} مگاپاسکال)`
                                        : `✕ زیر حد استاندارد A3 (حداقل تسلیم ${toPersianDigits(gradeSpec.minYield)}، حداقل کششی ${toPersianDigits(gradeSpec.minTensile)} مگاپاسکال)`}
                                </Text>
                            </View>
                        )}
                    </Card.Content>
                </Card>

                <Card style={styles.card} mode="elevated">
                    <Card.Content>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                            بازرسی ظاهری و خمش
                        </Text>
                        <Divider style={[styles.divider, { backgroundColor: theme.colors.primary }]} />

                        <Text style={styles.radioLabel}>آزمون خمش:</Text>
                        <RadioButton.Group onValueChange={value => setBendTest(value)} value={bendTest}>
                            <View style={styles.radioRow}>
                                <Text style={styles.radioText}>قبول</Text>
                                <RadioButton value="1" color={theme.colors.primary} />
                            </View>
                            <View style={styles.radioRow}>
                                <Text style={styles.radioText}>مردود (ترک‌خوردگی)</Text>
                                <RadioButton value="0" color={theme.colors.primary} />
                            </View>
                        </RadioButton.Group>

                        <Text style={styles.radioLabel}>بازرسی سطح:</Text>
                        <RadioButton.Group onValueChange={value => setVisualInspection(value)} value={visualInspection}>
                            <View style={styles.radioRow}>
                                <Text style={styles.radioText}>سالم</Text>
                                <RadioButton value="1" color={theme.colors.primary} />
                            </View>
                            <View style={styles.radioRow}>
                                <Text style={styles.radioText}>معیوب</Text>
                                <RadioButton value="0" color={theme.colors.primary} />
                            </View>
                        </RadioButton.Group>
                    </Card.Content>
                </Card>

                <Button
                    mode="contained"
                    onPress={handleSave}
                    style={styles.saveButton}
                    disabled={loading}
                    loading={loading}
                >
                    {loading ? 'در حال ذخیره‌سازی...' : 'ذخیره نتایج کنترل کیفیت'}
                </Button>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    headerTitle: { fontWeight: 'bold', fontSize: 18 },
    scrollContainer: { padding: 16, paddingBottom: 40 },
    card: {
        marginBottom: 16,
        borderRadius: 12,
        elevation: 3,
    },
    contextCard: {
        marginBottom: 16,
        borderRadius: 12,
        backgroundColor: '#eef2f7',
        borderColor: '#cbd5e1',
    },
    contextContent: {
        paddingVertical: 10,
    },
    contextText: {
        fontSize: 13,
        color: '#334155',
        textAlign: 'right',
        lineHeight: 20,
    },
    warningText: {
        fontSize: 12,
        color: '#b91c1c',
        textAlign: 'right',
        lineHeight: 18,
    },
    sectionTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        fontSize: 16,
    },
    divider: {
        marginBottom: 12,
        height: 2,
    },
    input: {
        marginBottom: 12,
        backgroundColor: '#fff',
        fontSize: 16,
        color: '#1a202c',
        textAlign: 'right',
    },
    radioLabel: {
        fontSize: 16,
        fontWeight: 'bold',
        marginTop: 10,
        marginBottom: 5,
        textAlign: 'right',
        color: '#1a202c',
    },
    radioText: {
        fontSize: 16,
        color: '#1a202c',
    },
    radioRow: {
        flexDirection: 'row-reverse',
        alignItems: 'center',
        justifyContent: 'flex-end',
        marginBottom: 8,
    },
    sizeRow: {
        flexDirection: 'row-reverse',
        flexWrap: 'wrap',
        marginBottom: 4,
    },
    sizeChip: {
        marginLeft: 8,
        marginBottom: 8,
        borderRadius: 16,
    },
    sizeChipUnselected: {
        backgroundColor: '#f5f7fa',
        borderColor: '#cbd5e1',
        borderWidth: 1,
    },
    sizeChipText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1a202c',
    },
    sizeChipTextSelected: {
        color: '#ffffff',
    },
    nominalAreaText: {
        fontSize: 12,
        color: '#4a5568',
        textAlign: 'right',
        marginBottom: 12,
    },
    ratioText: {
        fontSize: 13,
        color: '#1a202c',
        textAlign: 'right',
        marginTop: 2,
        marginBottom: 10,
        fontWeight: '600',
    },
    verdictBadge: {
        borderRadius: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginBottom: 4,
    },
    verdictPass: {
        backgroundColor: 'rgba(52, 211, 153, 0.15)',
    },
    verdictFail: {
        backgroundColor: 'rgba(248, 113, 113, 0.15)',
    },
    verdictText: {
        fontSize: 12,
        fontWeight: 'bold',
        textAlign: 'right',
    },
    verdictTextPass: {
        color: '#15803d',
    },
    verdictTextFail: {
        color: '#b91c1c',
    },
    // ✅ ADDITIVE — استایل‌های لیستِ انتخابِ سریع
    pendingHint: {
        fontSize: 12,
        color: '#475569',
        textAlign: 'right',
        lineHeight: 20,
        marginBottom: 10,
    },
    pendingEmpty: {
        fontSize: 13,
        color: '#b91c1c',
        textAlign: 'right',
        lineHeight: 20,
        paddingVertical: 8,
    },
    pendingScroll: {
        maxHeight: 240,
    },
    pendingItem: {
        backgroundColor: '#f1f5f9',
        borderColor: '#cbd5e1',
        borderWidth: 1,
        borderRadius: 10,
        padding: 10,
        marginBottom: 8,
    },
    pendingCode: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#1e3d59',
        textAlign: 'right',
        marginBottom: 4,
    },
    pendingMeta: {
        fontSize: 12,
        color: '#334155',
        textAlign: 'right',
        lineHeight: 18,
    },
    saveButton: {
        marginTop: 10,
        padding: 5,
        borderRadius: 8,
    }
});

export default QCInspectionScreen;