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
 * devices connect, and are destroyed on disconnect so RAM is freed. The
 * selected language is preloaded; incoming messages in another bundled
 * language switch the shared TTS voice per message (one voice resident at
 * a time).
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
  const loadedLanguageIdRef = useRef<string | null>(null);
  const apisRef = useRef(apis);
  apisRef.current = apis;

  useEffect(() => {
    // (Re)load when connecting fresh OR when the language changes
    // mid-chat — previously a mid-chat switch was ignored and the old
    // voice kept speaking (or nothing spoke after an eviction).
    const needsLoad =
      (isChatConnected && !wasConnectedRef.current) ||
      (isChatConnected &&
        wasConnectedRef.current &&
        loadedLanguageIdRef.current !== selectedLanguage.id);
    if (needsLoad) {
      wasConnectedRef.current = true;
      loadedLanguageIdRef.current = selectedLanguage.id;
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
        `[Models] Peer connected — loading ${selectedLanguage.label} TTS (${selectedLanguage.ttsAssetPath}) + STT (${selectedLanguage.sttAssetPath})…`,
      );
      // TTS FIRST: it is smaller (~114MB vs ~200MB) and incoming chat is
      // mute until it loads — previously STT blocked the voice for the
      // whole load window while speak calls silently dropped. SEQUENTIAL,
      // not concurrent: ONNX load transiently needs ~2x the model size
      // (file buffer + graph + tensors); one at a time keeps peak near
      // ~500MB instead of ~700MB+ (LMK kill).
      void (async () => {
        try {
          await ensureTtsReady(selectedLanguage.ttsAssetPath!);
        } catch (e) {
          console.warn('[Models] TTS load failed, continuing to STT:', e);
        }
        await new Promise((r) => setTimeout(r, 500));
        try {
          await ensureSttReady(selectedLanguage.sttAssetPath!);
        } catch (e) {
          console.warn('[Models] STT load failed:', e);
        }
      })();
    } else if (!isChatConnected && wasConnectedRef.current) {
      wasConnectedRef.current = false;
      loadedLanguageIdRef.current = null;
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
