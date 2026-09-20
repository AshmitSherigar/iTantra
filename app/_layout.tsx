import React, { useEffect } from 'react';
import { Alert, Linking, Vibration } from 'react-native';
import { Stack } from 'expo-router';

import { ThemeProvider } from '../context/ThemeContext';
import { LanguageProvider } from '../context/LanguageContext';
import { SosProvider } from '../context/SosContext';
import {
  AndroidNearbyBroadcastRuntime,
  MESH_DEFAULT_TTL,
  getEnvelopeTtl,
  isSosEnvelope,
  subscribeToBroadcasts,
} from '../features/bluetooth';
import { extractMapUrl } from '../features/sos/links';

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
    // Foreground notification presentation (SOS warnings must pop even in-app).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications');
      Notifications.setNotificationHandler?.({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: false,
        }),
      });
    } catch {}
    return subscribeToBroadcasts((broadcast) => {
      const lang = broadcastLangLabel(broadcast.language);
      const hops = broadcastHopCount(broadcast);
      const hopSuffix = hops > 0 ? ` — via ${hops} hop${hops === 1 ? '' : 's'}` : '';
      if (isSosEnvelope(broadcast)) {
        try {
          Vibration.vibrate([0, 500, 250, 500]);
        } catch {}
        const mapUrl = extractMapUrl(broadcast.message);
        Alert.alert(
          '🆘 SOS Emergency',
          `${broadcast.senderName}${lang ? ` (${lang})` : ''}: ${broadcast.message}${hopSuffix}`,
          [
            ...(mapUrl
              ? [
                  {
                    text: 'Open location',
                    onPress: () => {
                      Linking.openURL(mapUrl).catch(() => {});
                    },
                  } as const,
                ]
              : []),
            { text: 'Open SOS tab', onPress: () => {} },
            { text: 'Dismiss', style: 'cancel' },
          ],
        );
        return;
      }
      Alert.alert(
        '🚨 Emergency Broadcast',
        `${broadcast.senderName}${lang ? ` (${lang})` : ''}: ${broadcast.message}${hopSuffix}`,
        [{ text: 'OK' }, { text: 'Dismiss', style: 'cancel' }],
      );
    });
  }, []);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <SosProvider>
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
        </SosProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
