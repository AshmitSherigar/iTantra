import React, { useEffect } from 'react';
import { Linking, Vibration } from 'react-native';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import {
  Fraunces_700Bold,
  Fraunces_800ExtraBold,
  Fraunces_900Black,
  useFonts,
} from '@expo-google-fonts/fraunces';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';

import { ThemeProvider } from '../context/ThemeContext';
import { AppModalProvider, showAppAlert } from '../components/ui/AppModal';
import { LanguageProvider } from '../context/LanguageContext';
import { SosProvider } from '../context/SosContext';
import {
  AndroidNearbyBroadcastRuntime,
  MESH_DEFAULT_TTL,
  getEnvelopeTtl,
  isRangeEnvelope,
  isSosEnvelope,
  subscribeToBroadcasts,
} from '../features/bluetooth';
import { resolveSosMapUrl } from '../features/sos/links';
import { ensureSosIncomingCategory } from '../features/sos/notify';
import { stopSosSiren } from '../features/sos/siren';

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
  // Warm editorial type: Fraunces (display serif) + DM Sans (body).
  const [fontsLoaded] = useFonts({
    Fraunces_700Bold,
    Fraunces_800ExtraBold,
    Fraunces_900Black,
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

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
    try {
      void ensureSosIncomingCategory();
    } catch {}
    return subscribeToBroadcasts((broadcast) => {
      // Device-search ranging pings are consumed only by that screen.
      if (isRangeEnvelope(broadcast)) return;
      const lang = broadcastLangLabel(broadcast.language);
      const hops = broadcastHopCount(broadcast);
      const hopSuffix =
        hops > 0 ? ` - via ${hops} hop${hops === 1 ? '' : 's'}` : '';
      if (isSosEnvelope(broadcast)) {
        try {
          Vibration.vibrate([0, 500, 250, 500]);
        } catch {}
        const mapUrl = resolveSosMapUrl(
          broadcast.message,
          broadcast.sos?.lat,
          broadcast.sos?.lon,
        );
        void showAppAlert(
          'SOS Emergency',
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
            {
              text: 'Stop siren',
              onPress: () => {
                void stopSosSiren();
              },
            },
            { text: 'Open SOS tab', onPress: () => {} },
            { text: 'Dismiss', style: 'cancel' },
          ],
        );
        return;
      }
      void showAppAlert(
        'Emergency Broadcast',
        `${broadcast.senderName}${lang ? ` (${lang})` : ''}: ${broadcast.message}${hopSuffix}`,
        [{ text: 'OK' }, { text: 'Dismiss', style: 'cancel' }],
      );
    });
  }, []);

  return (
    <ThemeProvider>
      <AppModalProvider>
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
      </AppModalProvider>
    </ThemeProvider>
  );
}
