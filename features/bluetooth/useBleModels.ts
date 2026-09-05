import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { isLanguageInstalled } from '../models/languages';
import type { LanguageModel } from '../models/languages';

type ModelApis = {
  ensureSttReady: (path: string) => Promise<void>;
  releaseStt: () => Promise<void>;
  ensureTtsReady: (path: string) => Promise<void>;
  releaseTts: () => Promise<void>;
  stopTts: () => void;
  endStream: () => void;
};

/**
 * Heavy-model lifecycle: STT (~200MB) + TTS (~114MB) load only after the two
 * devices connect, and are destroyed on disconnect so RAM is freed. ONLY the
 * selected language's models are ever resident.
 */
export function useBleModels(
  isChatConnected: boolean,
  selectedLanguage: LanguageModel,
  apis: ModelApis,
) {
  const {
    ensureSttReady,
    releaseStt,
    ensureTtsReady,
    releaseTts,
    stopTts,
    endStream,
  } = apis;
  const wasConnectedRef = useRef(false);
  const apisRef = useRef(apis);
  apisRef.current = apis;

  useEffect(() => {
    if (isChatConnected && !wasConnectedRef.current) {
      wasConnectedRef.current = true;
      if (!isLanguageInstalled(selectedLanguage)) {
        console.log(
          `[Models] Peer connected but "${selectedLanguage.label}" is not installed — skipping model load.`,
        );
        Alert.alert(
          'Language model not installed',
          `The "${selectedLanguage.label}" voice models aren't installed yet. Install it or switch to an installed language to connect.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Install',
              onPress: () =>
                Alert.alert(
                  'Install language model',
                  `"${selectedLanguage.label}" model download isn't available yet.`,
                  [{ text: 'OK' }],
                ),
            },
            {
              text: 'View Languages',
              onPress: () => router.push('/settings/language'),
            },
          ],
        );
        return;
      }
      console.log(
        `[Models] Peer connected — loading ${selectedLanguage.label} STT (${selectedLanguage.sttAssetPath}) + TTS (${selectedLanguage.ttsAssetPath})…`,
      );
      // SEQUENTIAL, not concurrent: ONNX model load transiently needs ~2x
      // the model size (file buffer + graph + tensors). Loading one, yielding,
      // then the other keeps peak near ~500MB instead of ~700MB+ (LMK kill).
      void (async () => {
        try {
          await ensureSttReady(selectedLanguage.sttAssetPath!);
        } catch (e) {
          console.warn('[Models] STT load failed, continuing to TTS:', e);
        }
        await new Promise((r) => setTimeout(r, 500));
        try {
          await ensureTtsReady(selectedLanguage.ttsAssetPath!);
        } catch (e) {
          console.warn('[Models] TTS load failed:', e);
        }
      })();
    } else if (!isChatConnected && wasConnectedRef.current) {
      wasConnectedRef.current = false;
      console.log('[Models] Peer disconnected — releasing STT + TTS models…');
      try {
        apisRef.current.stopTts();
      } catch {}
      apisRef.current.endStream();
      void apisRef.current.releaseStt();
      void apisRef.current.releaseTts();
    }
  }, [
    isChatConnected,
    selectedLanguage,
    ensureSttReady,
    ensureTtsReady,
    releaseStt,
    releaseTts,
    stopTts,
    endStream,
  ]);
}

export function promptInstallLanguage(selectedLanguage: LanguageModel) {
  Alert.alert(
    'Language model not installed',
    `The "${selectedLanguage.label}" voice models aren't installed yet. Install it or switch to an installed language to connect.`,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Install',
        onPress: () =>
          Alert.alert(
            'Install language model',
            `"${selectedLanguage.label}" model download isn't available yet.`,
            [{ text: 'OK' }],
          ),
      },
      {
        text: 'View Languages',
        onPress: () => router.push('/settings/language'),
      },
    ],
  );
}
