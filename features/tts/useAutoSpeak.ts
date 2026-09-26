import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hindiTTS } from '@/features/tts/HindiTTS';
import { logger } from '@/utils/logger';

export type AutoSpeakApi = {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  isReady: boolean;
  isLoading: boolean;
  isSpeaking: boolean;
  error: string | null;
  speakFullMessage: (text: string) => void;
  beginStream: () => void;
  pushStreamText: (newText: string) => void;
  endStream: () => void;
  /**
   * Drop buffered-but-unspoken stream text without speaking it (e.g. the
   * payload turned out to be mesh JSON, not chat). Already-queued speech
   * is untouched.
   */
  discardStream: () => void;
  stop: () => void;
  ensureReady: (modelPath?: string) => Promise<void>;
  release: () => Promise<void>;
};

export function useAutoSpeak(
  defaultEnabled = true,
  opts?: { autoInit?: boolean },
): AutoSpeakApi {
  const autoInit = opts?.autoInit ?? true;
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [isReady, setIsReady] = useState(hindiTTS.getStatus().isInitialized);
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const ensureReady = useCallback(async (modelPath?: string) => {
    if (Platform.OS === 'web') return;
    if (
      hindiTTS.getStatus().isInitialized &&
      (!modelPath || hindiTTS.getActiveModelPath() === modelPath)
    ) {
      setIsReady(true);
      return;
    }
    setIsLoading(true);
    setError(null);
    logger.info('TTS', 'Loading voice model', {
      modelPath: modelPath ?? '(default)',
    });
    try {
      await hindiTTS.initialize({ debug: __DEV__, modelPath });
      setIsReady(true);
      setError(null);
      logger.info('TTS', 'Voice model ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('TTS', 'Model load failed', msg);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const release = useCallback(async () => {
    try {
      await hindiTTS.destroy();
      logger.info('TTS', 'Voice model released and RAM freed');
    } catch {
      // ignore
    } finally {
      setIsReady(false);
      setIsSpeaking(false);
    }
  }, []);

  useEffect(() => {
    if (!autoInit) return;
    let cancelled = false;
    if (Platform.OS === 'web') return;
    if (hindiTTS.getStatus().isInitialized) {
      setIsReady(true);
      return;
    }
    (async () => {
      setIsLoading(true);
      try {
        await hindiTTS.initialize({ debug: __DEV__ });
        if (!cancelled) {
          setIsReady(true);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [autoInit]);

  useEffect(() => {
    const id = setInterval(() => {
      const s = hindiTTS.getStatus();
      setIsSpeaking(s.isSpeaking);
      if (s.isInitialized !== isReady) setIsReady(s.isInitialized);
    }, 400);
    return () => clearInterval(id);
  }, [isReady]);

  const speakFullMessage = useCallback((text: string) => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    if (!text?.trim()) return;
    try {
      hindiTTS.enqueueSpeak(text);
    } catch (err) {
      logger.warn('TTS', 'enqueueSpeak failed', err);
    }
  }, []);

  const beginStream = useCallback(() => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    try {
      hindiTTS.startStreamingUtterance();
    } catch (err) {
      logger.warn('TTS', 'beginStream failed', err);
    }
  }, []);

  const pushStreamText = useCallback((newText: string) => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    if (!newText) return;
    try {
      hindiTTS.appendStreamingText(newText);
    } catch (err) {
      logger.warn('TTS', 'pushStreamText failed', err);
    }
  }, []);

  const endStream = useCallback(() => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    try {
      hindiTTS.finishStreamingUtterance();
    } catch (err) {
      logger.warn('TTS', 'endStream failed', err);
    }
  }, []);

  const discardStream = useCallback(() => {
    if (Platform.OS === 'web') return;
    try {
      hindiTTS.discardStreamingBuffer();
    } catch (err) {
      console.warn('[useAutoSpeak] discardStream failed:', err);
    }
  }, []);

  const stop = useCallback(() => {
    hindiTTS.stop().catch(() => {});
  }, []);

  // When the user disables auto-speak mid-utterance, stop playback.
  const handleSetEnabled = useCallback((v: boolean) => {
    setEnabled(v);
    if (!v) {
      hindiTTS.stop().catch(() => {});
    }
  }, []);

  return {
    enabled,
    setEnabled: handleSetEnabled,
    isReady,
    isLoading,
    isSpeaking,
    error,
    speakFullMessage,
    beginStream,
    pushStreamText,
    endStream,
    discardStream,
    stop,
    ensureReady,
    release,
  };
}
