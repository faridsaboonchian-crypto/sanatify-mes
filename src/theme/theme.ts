import { MD3DarkTheme, adaptNavigationTheme } from 'react-native-paper';
import { DarkTheme as NavigationDarkTheme } from '@react-navigation/native';

const { DarkTheme } = adaptNavigationTheme({
    reactNavigationDark: NavigationDarkTheme,
});

// پیکربندی سراسری تایپوگرافی برای مهار بریدگی حروف فارسی و تعیین تراز راست‌چین [1]
const customTypography = {
    displayLarge: { lineHeight: 64, writingDirection: 'rtl' as const },
    displayMedium: { lineHeight: 52, writingDirection: 'rtl' as const },
    displaySmall: { lineHeight: 44, writingDirection: 'rtl' as const },
    headlineLarge: { lineHeight: 40, writingDirection: 'rtl' as const },
    headlineMedium: { lineHeight: 36, writingDirection: 'rtl' as const },
    headlineSmall: { lineHeight: 32, writingDirection: 'rtl' as const },
    titleLarge: { lineHeight: 28, writingDirection: 'rtl' as const },
    titleMedium: { lineHeight: 24, writingDirection: 'rtl' as const },
    titleSmall: { lineHeight: 20, writingDirection: 'rtl' as const },
    bodyLarge: { lineHeight: 24, writingDirection: 'rtl' as const },
    bodyMedium: { lineHeight: 20, writingDirection: 'rtl' as const },
    bodySmall: { lineHeight: 16, writingDirection: 'rtl' as const },
    labelLarge: { lineHeight: 20, writingDirection: 'rtl' as const },
    labelMedium: { lineHeight: 16, writingDirection: 'rtl' as const },
    labelSmall: { lineHeight: 14, writingDirection: 'rtl' as const },
};

export const MESTheme = {
    ...MD3DarkTheme,
    ...DarkTheme,
    colors: {
        ...MD3DarkTheme.colors,
        ...DarkTheme.colors,
        primary: '#10B981',
        secondary: '#F59E0B',
        background: '#0F172A',
        surface: '#111827',
        surfaceVariant: '#1E293B',
        error: '#EF4444',
        outline: '#475569',
        onSurface: '#F8FAFC',
        onBackground: '#F8FAFC',
        onPrimary: '#0F172A',
        onSecondary: '#0F172A',
    },
    fonts: {
        ...MD3DarkTheme.fonts,
        ...customTypography,
    },
};