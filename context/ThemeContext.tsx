import React, { createContext, useContext, useEffect, useState } from 'react';
import { Appearance as RNAppearance } from 'react-native';

import { Colors } from '@/constants/theme';

type ThemeMode = 'Light' | 'Dark' | 'System Default';

type ThemeContextType = {
  theme: ThemeMode;
  isDark: boolean;
  colors: typeof Colors.light;
  setTheme: (theme: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextType | null>(null);

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

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark,
        colors,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (context === null) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }

  return context;
}
