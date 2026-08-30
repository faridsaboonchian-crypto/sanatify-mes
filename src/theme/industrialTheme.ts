import { DefaultTheme } from 'react-native-paper';

export const IndustrialTheme = {
    ...DefaultTheme,
    colors: {
        ...DefaultTheme.colors,
        primary: '#1e3d59',
        accent: '#ff6b35',
        background: '#f5f7fa',
        surface: '#ffffff',
        text: '#1a202c',
        error: '#dc2626',
        disabled: '#9ca3af',
        placeholder: '#6b7280',
    },
    roundness: 8,
};

export default IndustrialTheme;