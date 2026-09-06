import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hindiTTS } from './HindiTTS';

export type AutoSpeakApi = {
  /** User toggle — when false, incoming messages are never spoken. */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** TTS engine ready (model loaded). */
  isReady: boolean;
  /** TTS model is currently loading. */
  isLoading: boolean;
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
  /**
   * Load the TTS model for one language on demand (call when BLE devices
   * connect). Idempotent per path — pass the selected language's
   * `ttsAssetPath` so ONLY that voice (~114MB) ever lives in RAM.
   */
  ensureReady: (modelPath?: string) => Promise<void>;
  /** Destroy the TTS engine to free native RAM (call on BLE disconnect). */
  release: () => Promise<void>;
};

/**
 * Auto-speak controller for incoming BLE chat messages.
 *
 * RAM discipline: the Hindi VITS model (~114MB) is heavy. Pass
 * `{ autoInit: false }` on the chat screen so nothing loads until the two
 * devices connect — then call `ensureReady()` on connect and `release()`
 * on disconnect. Test screens can keep the default `autoInit: true`.
 *
 * - Polls engine status so `isSpeaking` stays fresh for the UI.
 * - All speak methods are safe no-ops on web / before init / when disabled.
 */
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
    console.log(
      `[TTS] Loading voice model ${modelPath ?? '(default)'} (after BLE connect)…`,
    );
    try {
      await hindiTTS.initialize({ debug: __DEV__, modelPath });
      setIsReady(true);
      setError(null);
      console.log('[TTS] Voice model ready.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[TTS] Model load failed:', msg);
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const release = useCallback(async () => {
    try {
      await hindiTTS.destroy();
      console.log('[TTS] Voice model released (RAM freed).');
    } catch {
      // ignore
    } finally {
      setIsReady(false);
      setIsSpeaking(false);
    }
  }, []);

  // One-time lazy init (skipped when autoInit is false — chat screen loads
  // the model only after the two devices connect, to save RAM).
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
    stop,
    ensureReady,
    release,
  };
}
