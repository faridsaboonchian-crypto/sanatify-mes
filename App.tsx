import React, { useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Provider as PaperProvider, Text } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { initDB } from './src/database/Database';
import { IndustrialTheme } from './src/theme/industrialTheme';
import { RoleGuard } from './src/components/RoleGuard';
import { AutoSync } from './src/components/AutoSync';
import LoginScreen from './src/screens/LoginScreen';
import WorkerScreen from './src/screens/WorkerScreen';
import ManagerScreen from './src/screens/ManagerScreen';
import EngineerDashboard from './src/screens/EngineerDashboard';
import WarehouseDashboard from './src/screens/WarehouseDashboard';
import OnlineDashboard from './src/screens/OnlineDashboard';
import HistoryScreen from './src/screens/HistoryScreen';
import UserManagementScreen from './src/screens/UserManagementScreen';
import ManagerWorkshopScreen from './src/screens/ManagerWorkshopScreen';
import IndustrialDashboard from './src/screens/IndustrialDashboard';
import QCInspectionScreen from './src/screens/QCInspectionScreen';
import QCExportScreen from './src/screens/QCExportScreen';
import MaterialBalanceScreen from './src/screens/MaterialBalanceScreen';
import ShiftManagementScreen from './src/screens/ShiftManagementScreen';
import ProductionTargetsScreen from './src/screens/ProductionTargetsScreen';
import MaintenanceScreen from './src/screens/MaintenanceScreen';
import RollingDowntimeScreen from './src/screens/RollingDowntimeScreen';
import ShippingDispatchScreen from './src/screens/ShippingDispatchScreen';
import SyncScreen from './src/screens/SyncScreen';
// ✅ ADDITIVE — فاز ۱ ردیابی فولاد (Traceability)
import BilletFurnaceScreen from './src/screens/BilletFurnaceScreen';
import BundlingScreen from './src/screens/BundlingScreen';
import GenealogyScreen from './src/screens/GenealogyScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  const [dbReady, setDbReady] = useState(false);

  useEffect(() => {
    const setupApp = async () => {
      try {
        if (Platform.OS !== 'web') {
          await initDB();
        }
        setDbReady(true);
      } catch (err) {
        console.error('Database startup error:', err);
        setDbReady(true);
      }
    };
    setupApp();
  }, []);

  if (!dbReady) {
    return (
      <PaperProvider theme={IndustrialTheme}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={IndustrialTheme.colors.primary} />
          <Text variant="titleMedium" style={styles.loadingText}>
            در حال بارگذاری سامانه...
          </Text>
        </View>
      </PaperProvider>
    );
  }

  return (
    <SafeAreaProvider>
      {/* ✅ ADDITIVE — نگهبانِ sync خودکار (بدون UI، فقط پس‌زمینه؛ در وب غیرفعال) */}
      <AutoSync />

      <PaperProvider theme={IndustrialTheme}>
        <StatusBar style="dark" backgroundColor="#1e3d59" />
        <NavigationContainer theme={IndustrialTheme as any}>
          <Stack.Navigator
            screenOptions={{
              headerShown: Platform.OS === 'web',
              headerStyle: { backgroundColor: IndustrialTheme.colors.primary },
              headerTintColor: '#ffffff',
              headerTitleStyle: { fontWeight: 'bold' },
            }}
          >
            <Stack.Screen name="Login" component={LoginScreen} options={{ title: 'ورود به سامانه' }} />

            <Stack.Screen name="OperatorDashboard" options={{ title: 'میز کار اپراتور' }}>
              {props => (
                <RoleGuard allowedRoles={['operator']} navigation={props.navigation}>
                  <WorkerScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="ManagerDashboard" options={{ title: 'صفحه مدیریت' }}>
              {props => (
                <RoleGuard allowedRoles={['manager']} navigation={props.navigation}>
                  <ManagerScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="UserManagement" options={{ title: 'مدیریت کاربران' }}>
              {props => (
                <RoleGuard allowedRoles={['manager']} navigation={props.navigation}>
                  <UserManagementScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="EngineerDashboard" options={{ title: 'میز کار مهندسی' }}>
              {props => (
                <RoleGuard allowedRoles={['engineer']} navigation={props.navigation}>
                  <EngineerDashboard {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="WarehouseDashboard" options={{ title: 'میز کار انبار و لجستیک' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse']} navigation={props.navigation}>
                  <WarehouseDashboard {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="QCInspection" options={{ title: 'فرم کنترل کیفیت' }}>
              {props => (
                <RoleGuard allowedRoles={['engineer', 'manager']} navigation={props.navigation}>
                  <QCInspectionScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="QCExport" options={{ title: 'خروجی اکسل QC' }}>
              {props => (
                <RoleGuard allowedRoles={['engineer', 'manager']} navigation={props.navigation}>
                  <QCExportScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="ShiftManagement" options={{ title: 'مدیریت شیفت‌ها' }}>
              {props => (
                <RoleGuard allowedRoles={['manager']} navigation={props.navigation}>
                  <ShiftManagementScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="ProductionTargets" options={{ title: 'اهداف تولید' }}>
              {props => (
                <RoleGuard allowedRoles={['manager']} navigation={props.navigation}>
                  <ProductionTargetsScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="MaintenanceScreen" options={{ title: 'تعمیرات و MTTR' }}>
              {props => (
                <RoleGuard allowedRoles={['engineer', 'manager']} navigation={props.navigation}>
                  <MaintenanceScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            {/* ✅ ADDITIVE — فاز ۱ ردیابی فولاد (Traceability) — حالا با نگهبان نقش */}
            <Stack.Screen name="BilletFurnace" options={{ title: 'مدیریت شمش و کوره پیش‌گرم' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse']} navigation={props.navigation}>
                  <BilletFurnaceScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="Bundling" options={{ title: 'بسته‌بندی و صدور پلاک بندیل' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse']} navigation={props.navigation}>
                  <BundlingScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="ShippingDispatch" options={{ title: 'بارگیری تریلی و صدور MTC' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse']} navigation={props.navigation}>
                  <ShippingDispatchScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="RollingDowntime" options={{ title: 'مدیریت توقفات خط نورد' }}>
              {props => (
                <RoleGuard allowedRoles={['operator', 'engineer', 'manager', 'warehouse']} navigation={props.navigation}>
                  <RollingDowntimeScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="Genealogy" options={{ title: 'شجره‌نامه و ردیابی ذوب' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse', 'engineer', 'manager']} navigation={props.navigation}>
                  <GenealogyScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="MaterialBalance" options={{ title: 'بالانس مواد و راندمان وزنی' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse', 'engineer', 'manager']} navigation={props.navigation}>
                  <MaterialBalanceScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            {/* ✅ ADDITIVE — فاز یکپارچگی ابری — با نگهبان نقش */}
            <Stack.Screen name="Sync" options={{ title: 'همگام‌سازی ابری' }}>
              {props => (
                <RoleGuard allowedRoles={['warehouse', 'manager']} navigation={props.navigation}>
                  <SyncScreen {...props} />
                </RoleGuard>
              )}
            </Stack.Screen>

            <Stack.Screen name="OnlineDashboard" component={OnlineDashboard} options={{ title: 'داشبورد آنلاین تولید' }} />
            <Stack.Screen name="History" component={HistoryScreen} options={{ title: 'تاریخچه عملیات' }} />
            <Stack.Screen name="ManagerWorkshop" component={ManagerWorkshopScreen} options={{ title: 'تنظیمات سالن' }} />
            <Stack.Screen name="IndustrialDashboard" component={IndustrialDashboard} options={{ title: 'داشبورد هوش صنعتی' }} />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f7fa',
  },
  loadingText: {
    marginTop: 16,
    fontWeight: 'bold',
    color: '#1e3d59',
  },
});