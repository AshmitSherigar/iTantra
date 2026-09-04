import React from 'react';
import { Stack } from 'expo-router';

import { ThemeProvider } from '../context/ThemeContext';
import { LanguageProvider } from '../context/LanguageContext';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <LanguageProvider>
      <Stack>
        <Stack.Screen
          name="(tabs)"
          options={{
            headerShown: false,
          }}
        />

        <Stack.Screen
          name="settings"
          options={{
            headerShown: false,
          }}
        />
      </Stack>
      </LanguageProvider>
    </ThemeProvider>
  );
}
