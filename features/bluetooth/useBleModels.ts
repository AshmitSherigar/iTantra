import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { router } from 'expo-router';
import { isLanguageInstalled } from '@/features/models/languages';
import type { LanguageModel } from '@/features/models/languages';
import { logger } from '@/utils/logger';

type ModelApis = {
  ensureSttReady: (path: string) => Promise<void>;
  releaseStt: () => Promise<void>;
  ensureTtsReady: (path: string) => Promise<void>;
  releaseTts: () => Promise<void>;
  stopTts: () => void;
  endStream: () => void;
};

export function useBleModels(
  isChatConnected: boolean,
  selectedLanguage: LanguageModel,
  apis: ModelApis,
) {
  const loggerScope = 'Models';
  const { ensureSttReady, ensureTtsReady } = apis;
  const apisRef = useRef(apis);
  const loadTokenRef = useRef(0);
  const activeLanguageRef = useRef<string | null>(null);
  apisRef.current = apis;

  const releaseModels = useCallback(async () => {
    try {
      apisRef.current.stopTts();
    } catch {}
    apisRef.current.endStream();
    try {
      await apisRef.current.releaseStt();
    } catch (error) {
      logger.warn(loggerScope, 'STT release failed', error);
    }
    try {
      await apisRef.current.releaseTts();
    } catch (error) {
      logger.warn(loggerScope, 'TTS release failed', error);
    }
    activeLanguageRef.current = null;
  }, []);

  useEffect(() => {
    const token = ++loadTokenRef.current;

    if (!isChatConnected) {
      return () => {
        if (loadTokenRef.current === token) {
          loadTokenRef.current += 1;
          void releaseModels();
        }
      };
    }

    if (!isLanguageInstalled(selectedLanguage)) {
      void releaseModels();
      logger.info(loggerScope, 'Peer connected but language is not installed', {
        language: selectedLanguage.id,
      });
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

    void (async () => {
      if (
        activeLanguageRef.current &&
        activeLanguageRef.current !== selectedLanguage.id
      ) {
        await releaseModels();
      }
      if (loadTokenRef.current !== token) return;

      activeLanguageRef.current = selectedLanguage.id;
      logger.info(loggerScope, 'Loading language models', {
        language: selectedLanguage.id,
      });
      try {
        await ensureSttReady(selectedLanguage.sttAssetPath!);
      } catch (error) {
        logger.warn(loggerScope, 'STT load failed', error);
        return;
      }
      if (loadTokenRef.current !== token) return;

      await new Promise((resolve) => setTimeout(resolve, 500));
      if (loadTokenRef.current !== token) return;

      try {
        await ensureTtsReady(selectedLanguage.ttsAssetPath!);
      } catch (error) {
        logger.warn(loggerScope, 'TTS load failed', error);
      }
    })();

    return () => {
      if (loadTokenRef.current === token) {
        loadTokenRef.current += 1;
        void releaseModels();
      }
    };
  }, [
    isChatConnected,
    selectedLanguage,
    ensureSttReady,
    ensureTtsReady,
    releaseModels,
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
