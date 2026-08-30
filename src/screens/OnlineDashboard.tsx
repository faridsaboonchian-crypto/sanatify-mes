import React from 'react';
import { View, StyleSheet, ScrollView, Platform, Dimensions } from 'react-native';
import { Card, Text, Button, useTheme, Appbar, Divider } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');

const OnlineDashboard: React.FC<any> = ({ navigation }) => {
    const theme = useTheme();

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
                    <Appbar.Content title="داشبورد آنلاین تولید" color="#ffffff" titleStyle={styles.headerTitle} />
                </Appbar.Header>
            )}

            <ScrollView contentContainerStyle={styles.scrollContainer}>
                <View style={styles.container}>

                    {/* کارت اول: شاخص اثربخشی کلی تجهیزات OEE */}
                    <Card style={[styles.card, styles.oeeCard]} mode="elevated">
                        <Card.Content style={styles.oeeContent}>
                            <Text style={styles.oeeValue}>۸۲.۴٪</Text>
                            <Text style={styles.oeeTitle}>راندمان کل سالن تولید (OEE)</Text>
                        </Card.Content>
                    </Card>

                    {/* کارت دوم: شاخص‌های سه‌گانه OEE */}
                    <Card style={styles.card} mode="elevated">
                        <Card.Content>
                            <Text style={styles.cardTitle}>شاخص‌های کارایی خط تولید</Text>
                            <Divider style={styles.divider} />

                            <View style={styles.metricRow}>
                                <Text style={styles.metricValue}>۹۰.۲٪</Text>
                                <Text style={styles.metricLabel}>میزان دسترس‌پذیری ماشین‌آلات</Text>
                            </View>

                            <View style={styles.metricRow}>
                                <Text style={styles.metricValue}>۹۲.۵٪</Text>
                                <Text style={styles.metricLabel}>میزان عملکرد اسمی</Text>
                            </View>

                            <View style={styles.metricRow}>
                                <Text style={styles.metricValue}>۹۸.۷٪</Text>
                                <Text style={styles.metricLabel}>شاخص کیفیت قطعات سالم</Text>
                            </View>
                        </Card.Content>
                    </Card>

                    <Text style={styles.footerText}>
                        آخرین به‌روزرسانی شاخص‌ها: همین الان - سیستم آفلاین-اول
                    </Text>

                    {Platform.OS === 'web' && (
                        <Button mode="outlined" icon="arrow-left" onPress={handleGoBack} style={styles.webBackButton}>
                            بازگشت به میز کار
                        </Button>
                    )}
                </View>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
    },
    headerTitle: {
        fontWeight: 'bold',
        fontSize: 18,
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
        marginBottom: 16,
        backgroundColor: '#ffffff',
    },
    oeeCard: {
        backgroundColor: '#1e3d59',
    },
    oeeContent: {
        alignItems: 'center',
        paddingVertical: 24,
    },
    oeeValue: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 48,
        marginBottom: 8,
    },
    oeeTitle: {
        color: '#ffffff',
        marginTop: 8,
        opacity: 0.9,
        fontSize: 16,
        textAlign: 'center',
    },
    cardTitle: {
        fontWeight: 'bold',
        textAlign: 'right',
        marginBottom: 8,
        fontSize: 18,
        color: '#1a202c',
    },
    divider: {
        marginBottom: 16,
        height: 2,
        backgroundColor: '#1e3d59',
    },
    metricRow: {
        flexDirection: 'row-reverse',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
    },
    metricValue: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#1e3d59',
    },
    metricLabel: {
        fontSize: 16,
        color: '#4a5568',
    },
    footerText: {
        marginTop: 20,
        fontSize: 14,
        color: '#718096',
        textAlign: 'center',
    },
    webBackButton: {
        marginTop: 24,
        width: '100%',
        maxWidth: 450,
    },
});

export default OnlineDashboard;