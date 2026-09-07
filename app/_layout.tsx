import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';

import { ThemeProvider } from '../context/ThemeContext';
import { LanguageProvider } from '../context/LanguageContext';
import {
  AndroidNearbyBroadcastRuntime,
  subscribeToBroadcasts,
} from '../features/bluetooth';

export default function RootLayout() {
  useEffect(() => {
    return subscribeToBroadcasts((broadcast) => {
      Alert.alert(
        '🚨 Emergency Broadcast',
        `${broadcast.senderName}: ${broadcast.message}`,
        [
          { text: 'OK' },
          { text: 'Dismiss', style: 'cancel' },
        ],
      );
    });
  }, []);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <AndroidNearbyBroadcastRuntime />
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
