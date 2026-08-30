import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import {
    Card,
    Text,
    Button,
    TextInput,
    SegmentedButtons,
    Chip,
    Divider,
    useTheme,
    Appbar,
    ActivityIndicator,
    List,
    Menu,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TraceabilityService } from '../services/TraceabilityService';
import { AuthService, OperatorSession } from '../services/AuthService';
import { getDatabase } from '../database/Database';
import { formatNumberFa, formatJalaliDateTime } from '../utils/dateUtils';

// ---------------------------------------------------------------------------
//  BundlingScreen — فاز ۱ گام ۳: بسته‌بندی و صدور پلاک بندیل میلگرد
//  معماری: آفلاین-اول | تمام عملیات بر بستر SQLite محلی و TraceabilityService
// ---------------------------------------------------------------------------

// سایزهای استاندارد میلگرد (میلی‌متر)
const REBAR_SIZES: number[] = [10, 12, 14, 16, 18, 20, 22, 25, 28, 32];

// گریدهای استاندارد فولاد مطابق ISIRI 3132
const REBAR_GRADES: string[] = ['A2', 'A3', 'A4'];

// تایپ محلی پیشنهادِ جستجوی شماره ذوب (مستقل از exportهای سرویس جهت پایداری)
interface HeatSuggestion {
    id: string;
    heat_number: string;
    status: string;
}

// تایپ محلی ردیف بندیل (مطابق ستون‌های جدول rebar_bundles)
interface BundleRow {
    id: string;
    bundle_code: string;
    heat_number: string;
    rebar_size: number;
    rebar_grade: string;
    branch_count: number | null;
    net_weight_kg: number;
    quality_status: string;
    produced_at: string;
}

// تایپ محلی پلاکِ آخرین بندیل ثبت‌شده (جهت کارت پیش‌نمایش)
interface LastBundleTag {
    id: string;
    bundle_code: string;
    heat_number: string;
    rebar_size: number;
    rebar_grade: string;
    net_weight_kg: number;
    branch_count: number | null;
    produced_at: string;
    quality_status: string;
}

// برچسب فارسی وضعیت شمش در لیست پیشنهادها
const getBilletStatusLabel = (status: string): string => {
    if (status === 'IN_YARD') return 'در انبار';
    if (status === 'IN_FURNACE') return 'در کوره';
    if (status === 'ROLLED') return 'نوردشده';
    if (status === 'SCRAPPED') return 'اسقاط';
    return status || 'نامشخص';
};

// رنگ و آیکن وضعیت کیفی بندیل
const getQualityChipProps = (
    qualityStatus: string,
    theme: any
): { label: string; color: string; bg: string; icon: string } => {
    if (qualityStatus === 'APPROVED') {
        return { label: 'تأییدشده', color: '#059669', bg: 'rgba(52, 211, 153, 0.16)', icon: 'check-decagram' };
    }
    if (qualityStatus === 'REJECTED') {
        return { label: 'مردود', color: '#dc2626', bg: 'rgba(248, 113, 113, 0.16)', icon: 'close-octagon' };
    }
    return { label: 'در انتظار QC', color: theme.colors.primary, bg: 'rgba(56, 189, 248, 0.16)', icon: 'timer-sand' };
};

export default function BundlingScreen({ navigation }: { navigation: any }) {
    const theme = useTheme();

    // نشست فعال اپراتور/سرپرست
    const [session, setSession] = useState<OperatorSession | null>(null);

    // فیلدهای فرم
    const [heatQuery, setHeatQuery] = useState<string>('');          // ورودی جستجوی شماره ذوب
    const [selectedHeat, setSelectedHeat] = useState<string>('');    // شماره ذوب نهایی انتخاب‌شده
    const [selectedBilletId, setSelectedBilletId] = useState<string | null>(null);
    const [heatSuggestions, setHeatSuggestions] = useState<HeatSuggestion[]>([]);
    const [rebarSize, setRebarSize] = useState<number>(16);
    const [rebarGrade, setRebarGrade] = useState<string>('A3');
    const [netWeight, setNetWeight] = useState<string>('');
    const [branchCount, setBranchCount] = useState<string>('');
    // ✅ ADDITIVE — ذوب‌های اخیر برای انتخابِ یک‌ضربه‌ای (بدون تایپ)
    const [recentHeats, setRecentHeats] = useState<string[]>([]);

    // وضعیت منوی کشویی سایز
    const [sizeMenuOpen, setSizeMenuOpen] = useState<boolean>(false);

    // وضعیت عملیات و خروجی‌ها
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [lastBundle, setLastBundle] = useState<LastBundleTag | null>(null);
    const [recentBundles, setRecentBundles] = useState<BundleRow[]>([]);
    const [loadingRecent, setLoadingRecent] = useState<boolean>(true);

    // ساعت زندهٔ دستگاه (برای نمایش زمان روی پلاک صنعتی)
    const [liveClock, setLiveClock] = useState<string>(new Date().toISOString());

    // ---------------------------------------------------------------------------
    //  بارگذاری نشست فعال
    // ---------------------------------------------------------------------------
    useEffect(() => {
        (async () => {
            try {
                const activeSession = await AuthService.getCurrentSession();
                setSession(activeSession);
            } catch (e) {
                console.warn('[BundlingScreen] Failed to load session:', e);
            }
        })();
    }, []);

    // ---------------------------------------------------------------------------
    //  جستجوی خودکار شمش‌های فعال بر اساس شماره ذوب (دادهٔ محلی SQLite)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        const q = heatQuery.trim();
        if (q.length < 1) {
            setHeatSuggestions([]);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const db = await getDatabase();
                const rows = await db.getAllAsync<HeatSuggestion>(
                    `SELECT id, heat_number, status FROM billets
           WHERE heat_number LIKE ?
           ORDER BY received_at DESC, created_at DESC
           LIMIT 8;`,
                    [`%${q}%`]
                );
                if (!cancelled) {
                    setHeatSuggestions(rows ?? []);
                }
            } catch (e) {
                if (!cancelled) {
                    setHeatSuggestions([]);
                }
                console.warn('[BundlingScreen] Heat search failed:', e);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [heatQuery]);

    // ---------------------------------------------------------------------------
    //  بارگذاری لیست بندیل‌های اخیر
    // ---------------------------------------------------------------------------
    const loadRecentBundles = async () => {
        try {
            setLoadingRecent(true);
            const db = await getDatabase();
            const rows = await db.getAllAsync<BundleRow>(
                `SELECT id, bundle_code, heat_number, rebar_size, rebar_grade,
                branch_count, net_weight_kg, quality_status, produced_at
         FROM rebar_bundles
         ORDER BY produced_at DESC, created_at DESC
         LIMIT 20;`
            );
            setRecentBundles(rows ?? []);
        } catch (e) {
            console.warn('[BundlingScreen] Failed to load recent bundles:', e);
        } finally {
            setLoadingRecent(false);
        }
    };

    // ---------------------------------------------------------------------------
    //  ✅ ADDITIVE — خواندنِ ذوب‌های اخیر (بندیل‌ها + شمش‌ها) برای چیپ‌های یک‌ضربه‌ای
    // ---------------------------------------------------------------------------
    const loadRecentHeats = async () => {
        try {
            const db = await getDatabase();
            const rows = await db.getAllAsync<{ heat_number: string }>(
                `SELECT heat_number FROM (
                    SELECT heat_number, MAX(produced_at) AS last_t FROM rebar_bundles
                    WHERE heat_number IS NOT NULL AND heat_number <> '' GROUP BY heat_number
                    UNION
                    SELECT heat_number, MAX(received_at) AS last_t FROM billets
                    WHERE heat_number IS NOT NULL AND heat_number <> '' GROUP BY heat_number
                ) ORDER BY last_t DESC LIMIT 5;`
            );
            const list = (rows ?? []).map((r) => r.heat_number);
            setRecentHeats(list);
            // پیش‌فرضِ خودکار: آخرین ذوبِ ثبت‌شده (اپراتور معمولاً همان ذوب را ادامه می‌دهد)
            if (list.length > 0) {
                setHeatQuery(list[0]);
                setSelectedHeat(list[0]);
            }
        } catch (e) {
            console.warn('[BundlingScreen] loadRecentHeats failed:', e);
        }
    };

    // ---------------------------------------------------------------------------
    //  ✅ ADDITIVE — انتخابِ یک‌ضربه‌ای ذوب از چیپ‌های «ذوب‌های اخیر»
    // ---------------------------------------------------------------------------
    const handlePickQuickHeat = (heat: string) => {
        setHeatQuery(heat);
        setSelectedHeat(heat);
        setSelectedBilletId(null);
        setHeatSuggestions([]);
    };

    // ---------------------------------------------------------------------------
    //  ✅ ADDITIVE — رندر چیپ‌های «ذوب‌های اخیر» (بالای فرم، بدون تایپ)
    // ---------------------------------------------------------------------------
    const renderHeatQuickChips = () => {
        if (recentHeats.length === 0) return null;
        return (
            <View style={{ flexDirection: 'row-reverse', flexWrap: 'wrap', marginBottom: 12 }}>
                {recentHeats.map((h) => (
                    <Chip
                        key={h}
                        selected={selectedHeat === h}
                        onPress={() => handlePickQuickHeat(h)}
                        style={{ marginLeft: 8, marginBottom: 8, backgroundColor: selectedHeat === h ? theme.colors.primary : '#f1f5f9' }}
                        textStyle={{ fontWeight: 'bold', color: selectedHeat === h ? '#ffffff' : '#1e3d59' }}
                    >
                        {h}
                    </Chip>
                ))}
            </View>
        );
    };

    // ✅ ADDITIVE — بارگذاری هم‌زمانِ بندیل‌های اخیر + ذوب‌های اخیر
    useEffect(() => {
        loadRecentBundles();
        loadRecentHeats();
    }, []);

    // ---------------------------------------------------------------------------
    //  ساعت زنده فقط هنگام نمایش کارت پلاک فعال می‌شود
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!lastBundle) {
            return;
        }
        const id = setInterval(() => {
            setLiveClock(new Date().toISOString());
        }, 1000);
        return () => clearInterval(id);
    }, [lastBundle]);

    // ---------------------------------------------------------------------------
    //  انتخاب یک شماره ذوب از لیست پیشنهادها
    // ---------------------------------------------------------------------------
    const handlePickHeat = (suggestion: HeatSuggestion) => {
        setHeatQuery(suggestion.heat_number);
        setSelectedHeat(suggestion.heat_number);
        setSelectedBilletId(suggestion.id);
        setHeatSuggestions([]);
    };

    // ---------------------------------------------------------------------------
    //  پاک‌سازی دستی ورودی جستجو
    // ---------------------------------------------------------------------------
    const handleClearHeat = () => {
        setHeatQuery('');
        setSelectedHeat('');
        setSelectedBilletId(null);
        setHeatSuggestions([]);
    };

    // ---------------------------------------------------------------------------
    //  ثبت و صدور پلاک بندیل
    // ---------------------------------------------------------------------------
    const handleSubmitBundle = async () => {
        const heat = (selectedHeat.trim() || heatQuery.trim());
        if (!heat) {
            Alert.alert('خطا در ورود داده', 'لطفاً شماره ذوب را وارد یا از لیست انتخاب کنید.');
            return;
        }
        const parsedWeight = parseFloat(netWeight);
        if (isNaN(parsedWeight) || parsedWeight <= 0) {
            Alert.alert('خطا در ورود داده', 'وزن خالص بندیل باید عددی مثبت (بر حسب کیلوگرم) باشد.');
            return;
        }
        const parsedBranch = branchCount.trim() === '' ? undefined : parseInt(branchCount, 10);
        if (parsedBranch !== undefined && (isNaN(parsedBranch) || parsedBranch < 0)) {
            Alert.alert('خطا در ورود داده', 'تعداد شاخه باید یک عدد صحیح نامنفی باشد.');
            return;
        }

        try {
            setSubmitting(true);

            // فراخوانی سرویس ردیابی: تولید کد یکتا + تکمیل خودکار شجره‌نامهٔ ذوب
            const result = await TraceabilityService.createRebarBundle({
                heat_number: heat,
                rebar_size: rebarSize,
                rebar_grade: rebarGrade,
                net_weight_kg: parsedWeight,
                branch_count: parsedBranch,
                billet_id: selectedBilletId || undefined,
                operator_id: session?.id || undefined,
                shift_id: session?.active_shift_id || undefined,
                line_id: session?.line_id || undefined,
                workshop_id: session?.workshop_id || undefined,
            });

            const producedAt = new Date().toISOString();

            // ساخت آبجکت پیش‌نمایش پلاک از ورودی‌ها + کد تولیدشده
            setLastBundle({
                id: result.id,
                bundle_code: result.bundle_code,
                heat_number: heat,
                rebar_size: rebarSize,
                rebar_grade: rebarGrade,
                net_weight_kg: parsedWeight,
                branch_count: parsedBranch ?? null,
                produced_at: producedAt,
                quality_status: 'PENDING',
            });

            // پاک‌سازی فیلدهای مصرفی (سایز/گرید/ذوب برای تسریع ثبت بعدی نگه داشته می‌شوند)
            setNetWeight('');
            setBranchCount('');

            // بروزرسانی لیست اخیر
            await loadRecentBundles();

            Alert.alert(
                'صدور موفق پلاک',
                `بندیل با کد یکتای ${result.bundle_code} صادر و در سامانه ثبت شد.`
            );
        } catch (error: any) {
            console.error('[BundlingScreen] Create bundle failed:', error);
            Alert.alert('خطا در صدور پلاک', error?.message || 'عملیات ثبت بندیل ناموفق بود.');
        } finally {
            setSubmitting(false);
        }
    };

    // ---------------------------------------------------------------------------
    //  چاپ پلاک (آماده‌سازی برای اتصال به پرینتر صنعتی / لیبل‌زن)
    // ---------------------------------------------------------------------------
    const handlePrintTag = () => {
        if (!lastBundle) {
            return;
        }
        // پیلود استاندارد ارسال به پرینتر صنعتی (در فاز اتصال به سخت‌افزار مصرف می‌شود)
        const printPayload = {
            bundle_code: lastBundle.bundle_code,
            heat_number: lastBundle.heat_number,
            rebar_size_mm: lastBundle.rebar_size,
            rebar_grade: lastBundle.rebar_grade,
            net_weight_kg: lastBundle.net_weight_kg,
            branch_count: lastBundle.branch_count,
            quality_status: lastBundle.quality_status,
            produced_at: lastBundle.produced_at,
            workshop_id: session?.workshop_id || null,
            line_id: session?.line_id || null,
        };
        console.log('[BundlingScreen] Print payload ready for industrial printer:', printPayload);
        Alert.alert(
            'آماده‌سازی چاپ پلاک',
            `کد بندیل: ${lastBundle.bundle_code}\n` +
            `ذوب: ${lastBundle.heat_number} | سایز: ${lastBundle.rebar_size} | گرید: ${lastBundle.rebar_grade}\n` +
            `وزن: ${lastBundle.net_weight_kg} kg\n\n` +
            `این پلاک برای ارسال به پرینتر/لیبل‌زن صنعتی آماده شد.`
        );
    };

    // ---------------------------------------------------------------------------
    //  شروع ثبت بندیل جدید (پاک‌سازی کارت پیش‌نمایش)
    // ---------------------------------------------------------------------------
    const handleResetTag = () => {
        setLastBundle(null);
    };

    // ---------------------------------------------------------------------------
    //  رندر کارت پیش‌نمایش پلاک بندیل (ظاهر فلزی صنعتی)
    // ---------------------------------------------------------------------------
    const renderBundleTag = () => {
        if (!lastBundle) {
            return null;
        }
        const qc = getQualityChipProps(lastBundle.quality_status, theme);
        return (
            <Card style={styles.tagCard} mode="elevated">
                <View style={styles.tagHeader}>
                    <Text style={styles.tagHeaderTitle}>پلاک بندیل میلگرد</Text>
                    <View style={styles.tagHeaderDot} />
                </View>
                <Card.Content style={styles.tagBody}>
                    <Text style={styles.tagCodeLabel}>کد یکتای بندیل</Text>
                    <Text style={styles.tagCode}>{lastBundle.bundle_code}</Text>
                    <Divider style={styles.tagDivider} />
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValue}>{lastBundle.heat_number}</Text>
                        <Text style={styles.tagLabel}>شماره ذوب:</Text>
                    </View>
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValue}>{formatNumberFa(lastBundle.rebar_size)} mm</Text>
                        <Text style={styles.tagLabel}>سایز میلگرد:</Text>
                    </View>
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValue}>{lastBundle.rebar_grade}</Text>
                        <Text style={styles.tagLabel}>گرید فولاد:</Text>
                    </View>
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValue}>{formatNumberFa(lastBundle.net_weight_kg)} kg</Text>
                        <Text style={styles.tagLabel}>وزن خالص:</Text>
                    </View>
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValue}>
                            {lastBundle.branch_count != null ? `${formatNumberFa(lastBundle.branch_count)} شاخه` : '---'}
                        </Text>
                        <Text style={styles.tagLabel}>تعداد شاخه:</Text>
                    </View>
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValueSmall}>{formatJalaliDateTime(lastBundle.produced_at)}</Text>
                        <Text style={styles.tagLabel}>زمان تولید:</Text>
                    </View>
                    <View style={styles.tagRow}>
                        <Text style={styles.tagValueSmall}>{formatJalaliDateTime(liveClock)}</Text>
                        <Text style={styles.tagLabel}>ساعت زندهٔ دستگاه:</Text>
                    </View>
                    <View style={styles.tagQcRow}>
                        <Chip
                            icon={qc.icon}
                            style={[styles.tagQcChip, { backgroundColor: qc.bg }]}
                            textStyle={[styles.tagQcChipText, { color: qc.color }]}
                        >
                            وضعیت کیفی: {qc.label}
                        </Chip>
                    </View>
                    <Button
                        mode="contained"
                        icon="printer-pos"
                        onPress={handlePrintTag}
                        style={styles.printButton}
                        labelStyle={styles.printButtonLabel}
                    >
                        چاپ پلاک روی لیبل‌زن
                    </Button>
                    <Button
                        mode="outlined"
                        icon="plus-box-outline"
                        onPress={handleResetTag}
                        style={styles.newBundleButton}
                    >
                        ثبت بندیل جدید
                    </Button>
                </Card.Content>
            </Card>
        );
    };

    // ---------------------------------------------------------------------------
    //  رندر لیست بندیل‌های اخیر
    // ---------------------------------------------------------------------------
    const renderRecentList = () => {
        return (
            <Card style={styles.card} mode="elevated">
                <Card.Content>
                    <Text variant="titleMedium" style={styles.cardTitle}>
                        بندیل‌های صادرشدهٔ اخیر
                    </Text>
                    <Divider style={styles.divider} />
                    {loadingRecent ? (
                        <View style={styles.loadingWrap}>
                            <ActivityIndicator size="small" color={theme.colors.primary} />
                            <Text variant="bodySmall" style={styles.loadingText}>
                                در حال بارگذاری تاریخچهٔ بندیل‌ها...
                            </Text>
                        </View>
                    ) : recentBundles.length === 0 ? (
                        <View style={styles.emptyWrap}>
                            <Text variant="bodyMedium" style={styles.emptyText}>
                                هنوز بندیلی در این شیفت صادر نشده است.
                            </Text>
                        </View>
                    ) : (
                        recentBundles.map((bundle) => {
                            const qc = getQualityChipProps(bundle.quality_status, theme);
                            return (
                                <View key={bundle.id}>
                                    <List.Item
                                        title={bundle.bundle_code}
                                        titleStyle={styles.recentTitle}
                                        description={`ذوب ${bundle.heat_number} | سایز ${bundle.rebar_size} | گرید ${bundle.rebar_grade} | ${formatNumberFa(bundle.net_weight_kg)} kg`}
                                        descriptionStyle={styles.recentDesc}
                                        left={(props) => (
                                            <List.Icon
                                                {...props}
                                                icon="barcode"
                                                color={theme.colors.primary}
                                            />
                                        )}
                                        right={() => (
                                            <Chip
                                                compact={true}
                                                icon={qc.icon}
                                                style={[styles.recentChip, { backgroundColor: qc.bg }]}
                                                textStyle={[styles.recentChipText, { color: qc.color }]}
                                            >
                                                {qc.label}
                                            </Chip>
                                        )}
                                    />
                                    <Divider />
                                </View>
                            );
                        })
                    )}
                </Card.Content>
            </Card>
        );
    };

    // ---------------------------------------------------------------------------
    //  رندر اصلی صفحه
    // ---------------------------------------------------------------------------
    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.background }]}>
            {Platform.OS !== 'web' && (
                <Appbar.Header style={{ backgroundColor: theme.colors.primary }}>
                    <Appbar.BackAction onPress={() => navigation.goBack()} color="#ffffff" />
                    <Appbar.Content
                        title="بسته‌بندی و صدور پلاک بندیل"
                        color="#ffffff"
                        titleStyle={styles.headerTitle}
                    />
                </Appbar.Header>
            )}

            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.container}>
                    {/* ===================== کارت فرم صدور بندیل ===================== */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text variant="titleMedium" style={styles.cardTitle}>
                                تعریف و صدور بندیل میلگرد
                            </Text>
                            <Divider style={styles.divider} />

                            {/* ورودی شماره ذوب + جستجوی خودکار */}
                            <TextInput
                                label="شماره ذوب (Heat Number)"
                                mode="outlined"
                                value={heatQuery}
                                onChangeText={(text) => {
                                    setHeatQuery(text);
                                    setSelectedHeat('');
                                    setSelectedBilletId(null);
                                }}
                                style={styles.input}
                                left={<TextInput.Icon icon="fire-circle" />}
                                right={
                                    heatQuery.length > 0 ? (
                                        <TextInput.Icon icon="close" onPress={handleClearHeat} />
                                    ) : undefined
                                }
                                placeholder="مثال: H-2026-07-0145"
                            />

                            {/* ✅ ADDITIVE — چیپ‌های «ذوب‌های اخیر» (انتخاب یک‌ضربه‌ای، بدون تایپ) */}
                            {renderHeatQuickChips()}

                            {/* لیست پیشنهادی شمش‌های فعال */}
                            {heatSuggestions.length > 0 && (
                                <View style={styles.suggestionBox}>
                                    {heatSuggestions.map((s) => (
                                        <List.Item
                                            key={s.id}
                                            title={s.heat_number}
                                            titleStyle={styles.suggestionTitle}
                                            description={`شناسه شمش: ${s.id} — ${getBilletStatusLabel(s.status)}`}
                                            descriptionStyle={styles.suggestionDesc}
                                            onPress={() => handlePickHeat(s)}
                                            left={(props) => (
                                                <List.Icon {...props} icon="cube-outline" color={theme.colors.secondary} />
                                            )}
                                        />
                                    ))}
                                </View>
                            )}

                            {selectedHeat.length > 0 && (
                                <Chip
                                    icon="check-circle"
                                    style={styles.selectedHeatChip}
                                    textStyle={styles.selectedHeatChipText}
                                >
                                    ذوب انتخاب‌شده: {selectedHeat}
                                </Chip>
                            )}

                            {/* منوی کشویی سایز میلگرد */}
                            <Text variant="bodyMedium" style={styles.fieldLabel}>
                                سایز میلگرد (میلی‌متر):
                            </Text>
                            <Menu
                                visible={sizeMenuOpen}
                                onDismiss={() => setSizeMenuOpen(false)}
                                anchor={
                                    <Button
                                        mode="outlined"
                                        icon="ruler"
                                        onPress={() => setSizeMenuOpen(true)}
                                        style={styles.menuAnchor}
                                        contentStyle={styles.menuAnchorContent}
                                    >
                                        {`سایز ${rebarSize} میلی‌متر`}
                                    </Button>
                                }
                            >
                                {REBAR_SIZES.map((size) => (
                                    <Menu.Item
                                        key={size}
                                        onPress={() => {
                                            setRebarSize(size);
                                            setSizeMenuOpen(false);
                                        }}
                                        title={`سایز ${size} میلی‌متر`}
                                        leadingIcon={size === rebarSize ? 'check' : undefined}
                                    />
                                ))}
                            </Menu>

                            {/* انتخاب گرید فولاد */}
                            <Text variant="bodyMedium" style={styles.fieldLabel}>
                                گرید فولاد:
                            </Text>
                            <SegmentedButtons
                                value={rebarGrade}
                                onValueChange={(value) => setRebarGrade(value)}
                                buttons={REBAR_GRADES.map((grade) => ({
                                    value: grade,
                                    label: `گرید ${grade}`,
                                }))}
                                style={styles.segmented}
                            />

                            {/* وزن خالص بندیل */}
                            <TextInput
                                label="وزن خالص بندیل (کیلوگرم) — آمادهٔ باسکول"
                                mode="outlined"
                                value={netWeight}
                                onChangeText={setNetWeight}
                                keyboardType="numeric"
                                style={styles.input}
                                left={<TextInput.Icon icon="weight-kilogram" />}
                                placeholder="مثال: 2000"
                            />

                            {/* تعداد شاخه (اختیاری) */}
                            <TextInput
                                label="تعداد شاخه در بندیل (اختیاری)"
                                mode="outlined"
                                value={branchCount}
                                onChangeText={setBranchCount}
                                keyboardType="numeric"
                                style={styles.input}
                                left={<TextInput.Icon icon="format-list-bulleted" />}
                                placeholder="مثال: 40"
                            />

                            {/* دکمهٔ اصلی ثبت */}
                            <Button
                                mode="contained"
                                icon="barcode-scan"
                                loading={submitting}
                                disabled={submitting}
                                onPress={handleSubmitBundle}
                                style={styles.submitButton}
                                labelStyle={styles.submitButtonLabel}
                            >
                                ثبت و صدور پلاک بندیل
                            </Button>
                        </Card.Content>
                    </Card>

                    {/* ===================== کارت پیش‌نمایش پلاک ===================== */}
                    {renderBundleTag()}

                    {/* ===================== لیست بندیل‌های اخیر ===================== */}
                    {renderRecentList()}

                    <Text style={styles.footerText}>
                        سامانهٔ ردیابی فولاد — صدور پلاک آفلاین بر بستر sanatify.db
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

// ---------------------------------------------------------------------------
//  استایل‌ها
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    headerTitle: {
        fontWeight: 'bold',
        fontSize: 18,
        lineHeight: 26,
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
        maxWidth: 480,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: '#ffffff',
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        color: '#1a202c',
        lineHeight: 26,
        writingDirection: 'rtl',
    },
    divider: {
        marginBottom: 14,
    },
    input: {
        marginBottom: 14,
        textAlign: 'right',
    },
    fieldLabel: {
        textAlign: 'right',
        writingDirection: 'rtl',
        fontWeight: 'bold',
        color: '#475569',
        marginBottom: 8,
        lineHeight: 20,
    },
    menuAnchor: {
        marginBottom: 14,
        borderColor: '#94a3b8',
    },
    menuAnchorContent: {
        flexDirection: 'row-reverse',
    },
    segmented: {
        marginBottom: 14,
    },
    suggestionBox: {
        marginBottom: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#f8fafc',
        maxHeight: 200,
        overflow: 'hidden',
    },
    suggestionTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#0f172a',
    },
    suggestionDesc: {
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#64748b',
        fontSize: 11,
    },
    selectedHeatChip: {
        alignSelf: 'flex-start',
        marginBottom: 14,
        backgroundColor: 'rgba(52, 211, 153, 0.16)',
    },
    selectedHeatChipText: {
        color: '#059669',
        fontWeight: 'bold',
    },
    submitButton: {
        borderRadius: 10,
        paddingVertical: 6,
        marginTop: 4,
        backgroundColor: '#1e3d59',
    },
    submitButtonLabel: {
        fontSize: 16,
        fontWeight: 'bold',
        lineHeight: 24,
    },
    // ----- کارت پلاک صنعتی -----
    tagCard: {
        width: '100%',
        maxWidth: 480,
        borderRadius: 12,
        marginBottom: 16,
        backgroundColor: '#111827',
        borderWidth: 2,
        borderColor: '#f59e0b',
        overflow: 'hidden',
    },
    tagHeader: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#f59e0b',
        paddingHorizontal: 16,
        paddingVertical: 10,
    },
    tagHeaderTitle: {
        color: '#111827',
        fontWeight: 'bold',
        fontSize: 15,
        writingDirection: 'rtl',
    },
    tagHeaderDot: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: '#111827',
    },
    tagBody: {
        paddingVertical: 16,
    },
    tagCodeLabel: {
        color: '#94a3b8',
        textAlign: 'center',
        fontSize: 12,
        marginBottom: 4,
    },
    tagCode: {
        color: '#fde68a',
        textAlign: 'center',
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: 'monospace',
        letterSpacing: 1,
        marginBottom: 6,
    },
    tagDivider: {
        backgroundColor: 'rgba(245, 158, 11, 0.3)',
        marginVertical: 12,
    },
    tagRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 9,
        width: '100%',
    },
    tagLabel: {
        color: '#94a3b8',
        textAlign: 'right',
        writingDirection: 'rtl',
        fontSize: 13,
        flexShrink: 1,
        paddingLeft: 8,
    },
    tagValue: {
        color: '#f8fafc',
        fontWeight: 'bold',
        fontSize: 15,
        textAlign: 'left',
    },
    tagValueSmall: {
        color: '#e2e8f0',
        fontWeight: 'bold',
        fontSize: 12,
        textAlign: 'left',
        flexShrink: 1,
    },
    tagQcRow: {
        alignItems: 'flex-start',
        marginTop: 6,
        marginBottom: 14,
    },
    tagQcChip: {
        borderWidth: 0,
    },
    tagQcChipText: {
        fontWeight: 'bold',
        fontSize: 12,
    },
    printButton: {
        borderRadius: 8,
        paddingVertical: 4,
        backgroundColor: '#f59e0b',
    },
    printButtonLabel: {
        color: '#111827',
        fontWeight: 'bold',
        fontSize: 15,
    },
    newBundleButton: {
        borderRadius: 8,
        marginTop: 10,
        borderColor: '#f59e0b',
    },
    // ----- لیست اخیر -----
    loadingWrap: {
        alignItems: 'center',
        paddingVertical: 18,
    },
    loadingText: {
        marginTop: 8,
        color: '#64748b',
        textAlign: 'center',
    },
    emptyWrap: {
        alignItems: 'center',
        paddingVertical: 18,
    },
    emptyText: {
        color: '#888',
        textAlign: 'center',
        lineHeight: 22,
    },
    recentTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#0f172a',
        fontFamily: 'monospace',
    },
    recentDesc: {
        textAlign: 'right',
        writingDirection: 'rtl',
        color: '#64748b',
        fontSize: 12,
    },
    recentChip: {
        borderWidth: 0,
        height: 28,
    },
    recentChipText: {
        fontWeight: 'bold',
        fontSize: 11,
    },
    footerText: {
        marginTop: 8,
        marginBottom: 16,
        fontSize: 11,
        color: '#94a3b8',
        textAlign: 'center',
        lineHeight: 18,
    },
});