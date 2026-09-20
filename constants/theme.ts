import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance as RNAppearance } from 'react-native';

export const Colors = {
  light: {
    background: '#F5F7FA',
    surface: '#FFFFFF',
    card: '#FFFFFF',
    text: '#111827',
    textSecondary: '#6B7280',
    border: '#E5E7EB',
    primary: '#2563EB',
    primaryMuted: '#DBEAFE',
    error: '#DC2626',
    success: '#16A34A',
    warning: '#D97706',
    icon: '#374151',
    inputBackground: '#F3F4F6',
    shadow: '#0000001A',
  },
  dark: {
    background: '#0F172A',
    surface: '#111827',
    card: '#1F2937',
    text: '#F9FAFB',
    textSecondary: '#9CA3AF',
    border: '#374151',
    primary: '#60A5FA',
    primaryMuted: '#1D4ED8',
    error: '#F87171',
    success: '#4ADE80',
    warning: '#FBBF24',
    icon: '#E5E7EB',
    inputBackground: '#1F2937',
    shadow: '#0000004D',
  },
};

export const FontSize = { small: 12, body: 16, medium: 17, title: 30 };

export const Radius = { sm: 8, md: 14, lg: 18, round: 999 };

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 };

type ThemeMode = 'Light' | 'Dark' | 'System Default';

type ThemeContextType = {
  theme: ThemeMode;
  isDark: boolean;
  colors: typeof Colors.light;
  setTheme: (theme: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>('Light');

  const [systemDark, setSystemDark] = useState(
    RNAppearance.getColorScheme() === 'dark',
  );

  useEffect(() => {
    const subscription = RNAppearance.addChangeListener(({ colorScheme }) => {
      setSystemDark(colorScheme === 'dark');
    });

    return () => subscription.remove();
  }, []);

  const isDark = theme === 'Dark' || (theme === 'System Default' && systemDark);

  const colors = isDark ? Colors.dark : Colors.light;
  const themeContextValue = {
    theme,
    isDark,
    colors,
    setTheme,
  };

  return React.createElement(
    ThemeContext.Provider,
    { value: themeContextValue },
    children,
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return context;
}
