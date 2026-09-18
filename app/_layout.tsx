import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { Stack } from 'expo-router';

import { ThemeProvider } from '../context/ThemeContext';
import { LanguageProvider } from '../context/LanguageContext';
import {
  AndroidNearbyBroadcastRuntime,
  MESH_DEFAULT_TTL,
  getEnvelopeTtl,
  subscribeToBroadcasts,
} from '../features/bluetooth';

import { SUPPORTED_LANGUAGES } from '../features/models/languages';

function broadcastLangLabel(lang: string): string {
  const found = SUPPORTED_LANGUAGES.find(
    (l) => l.id === (lang ?? '').trim().toLowerCase(),
  );
  return found ? found.label : lang?.trim() || '';
}

export function broadcastHopCount(envelope: { ttl?: number }): number {
  return Math.max(0, MESH_DEFAULT_TTL - getEnvelopeTtl(envelope));
}

export default function RootLayout() {
  useEffect(() => {
    return subscribeToBroadcasts((broadcast) => {
      const lang = broadcastLangLabel(broadcast.language);
      const hops = broadcastHopCount(broadcast);
      Alert.alert(
        '🚨 Emergency Broadcast',
        `${broadcast.senderName}${lang ? ` (${lang})` : ''}: ${broadcast.message}${hops > 0 ? ` — via ${hops} hop${hops === 1 ? '' : 's'}` : ''}`,
        [{ text: 'OK' }, { text: 'Dismiss', style: 'cancel' }],
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
