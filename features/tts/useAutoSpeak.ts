import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hindiTTS } from './HindiTTS';

export type AutoSpeakApi = {
  /** User toggle — when false, incoming messages are never spoken. */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** TTS engine ready (model loaded). */
  isReady: boolean;
  /** Currently synthesizing / playing. */
  isSpeaking: boolean;
  /** Last init / runtime error, if any. */
  error: string | null;
  /** Speak a complete received message (queued, non-interrupting). */
  speakFullMessage: (text: string) => void;
  /** Start a new packet-streamed utterance. */
  beginStream: () => void;
  /** Push newly-decoded text from arrived packets (starts audio early). */
  pushStreamText: (newText: string) => void;
  /** Flush the tail of the streamed utterance. */
  endStream: () => void;
  stop: () => void;
};

/**
 * Auto-speak controller for incoming BLE chat messages.
 *
 * - Lazily initializes the Hindi VITS streaming TTS engine once.
 * - Polls engine status so `isSpeaking` stays fresh for the UI.
 * - All speak methods are safe no-ops on web / before init / when disabled.
 */
export function useAutoSpeak(defaultEnabled = true): AutoSpeakApi {
  const [enabled, setEnabled] = useState(defaultEnabled);
  const [isReady, setIsReady] = useState(hindiTTS.getStatus().isInitialized);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // One-time lazy init.
  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web') return;
    if (hindiTTS.getStatus().isInitialized) {
      setIsReady(true);
      return;
    }
    (async () => {
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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll speaking state for UI.
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
      console.warn('[useAutoSpeak] enqueueSpeak failed:', err);
    }
  }, []);

  const beginStream = useCallback(() => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    try {
      hindiTTS.startStreamingUtterance();
    } catch (err) {
      console.warn('[useAutoSpeak] beginStream failed:', err);
    }
  }, []);

  const pushStreamText = useCallback((newText: string) => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    if (!newText) return;
    try {
      hindiTTS.appendStreamingText(newText);
    } catch (err) {
      console.warn('[useAutoSpeak] pushStreamText failed:', err);
    }
  }, []);

  const endStream = useCallback(() => {
    if (!enabledRef.current) return;
    if (Platform.OS === 'web') return;
    try {
      hindiTTS.finishStreamingUtterance();
    } catch (err) {
      console.warn('[useAutoSpeak] endStream failed:', err);
    }
  }, []);

  const stop = useCallback(() => {
    hindiTTS.stop().catch(() => {});
  }, []);

  // When the user disables auto-speak mid-utterance, stop playback.
  const handleSetEnabled = useCallback(
    (v: boolean) => {
      setEnabled(v);
      if (!v) {
        hindiTTS.stop().catch(() => {});
      }
    },
    [],
  );

  return {
    enabled,
    setEnabled: handleSetEnabled,
    isReady,
    isSpeaking,
    error,
    speakFullMessage,
    beginStream,
    pushStreamText,
    endStream,
    stop,
  };
}
