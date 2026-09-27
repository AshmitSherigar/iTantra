import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { DEFAULT_TTS_MODEL_PATH, hindiTTS } from './HindiTTS';
import {
  detectSpokenLanguage,
  ttsPathFor,
  type LanguageId,
} from '../models/languages';

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
  /**
   * Drop buffered-but-unspoken stream text without speaking it (e.g. the
   * payload turned out to be mesh JSON, not chat). Already-queued speech
   * is untouched.
   */
  discardStream: () => void;
  stop: () => void;
  /**
   * Preload a voice on demand (call when BLE devices connect). Idempotent
   * per path. Per-message script detection may still switch to another
   * bundled voice at speak time — preloading only warms the cache.
   */
  ensureReady: (modelPath?: string) => Promise<void>;
  /** Destroy the TTS engine to free native RAM (call on BLE disconnect). */
  release: () => Promise<void>;
};

/**
 * Window for the whole-utterance echo guard (see lastUtteranceRef).
 */
const ECHO_WINDOW_MS = 2000;

/**
 * Lock the streaming voice once the buffered peek is decisive: any Indic
 * character, or enough Latin text to call it English. Locking on a tiny
 * prefix would miss an Indic body arriving one chunk later.
 */
function streamPeekLocks(peek: string): boolean {
  if (!peek) return false;
  for (const ch of peek) {
    const cp = ch.codePointAt(0) ?? 0;
    if (
      (cp >= 0x0900 && cp <= 0x097f) ||
      (cp >= 0x0c80 && cp <= 0x0cff)
    ) {
      return true;
    }
  }
  return peek.replace(/\s/g, '').length >= 12;
}

/**
 * Auto-speak controller for incoming BLE chat messages.
 *
 * RAM discipline: the Hindi VITS model (~114MB) is heavy. Pass
 * `{ autoInit: false }` on the chat screen so nothing loads until the two
 * devices connect — then call `ensureReady()` on connect and `release()`
 * on disconnect. Test screens can keep the default `autoInit: true`.
 *
 * Voice follows each message's script (sender's language): Devanagari →
 * Hindi voice, Kannada script → Kannada voice, Latin/anything else →
 * English voice. The token sets are disjoint (Hindi/Kannada models have
 * no Latin tokens and vice versa), so a Latin message through the Hindi
 * voice is silence — the fallback must be English, never the chat voice.
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
  // Bumped on release() so speaks queued before disconnect can't resurrect
  // the engine after it was freed.
  const sessionRef = useRef(0);
  const ensureInflightRef = useRef<{
    path: string;
    promise: Promise<void>;
  } | null>(null);
  // Serializes speak ops so a model switch can't cut off in-flight speech
  // and packet-streamed begin/push/end stay ordered across async switches.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * Echo guard — the Bluetooth mirror of wifi.tsx's seenIds dedup. WiFi
   * speaks each message id once; 1-to-1 BLE has no wire ids, so an
   * identical whole utterance requested within the window of the last one
   * actually spoken is dropped (stack-level double delivery lands
   * ~together; deliberate resends take longer). Streaming fragments are
   * exempt — they are partial by design.
   */
  const lastUtteranceRef = useRef<{
    text: string;
    path: string;
    at: number;
  } | null>(null);
  // Message-level language lock for one packet-streamed utterance. Fragments
  // are held until the script is decisive so the voice never switches
  // mid-utterance (a switch destroys queued speech).
  const streamLangRef = useRef<LanguageId | null>(null);
  const streamPendingRef = useRef<string[]>([]);

  /**
   * Ensure the model at `path` is resident (no-op when already correct).
   * Serializes concurrent ensures for the same path. Returns false when
   * the session ended (release/disconnect) or init failed — callers must
   * drop the pending speech instead of speaking through a wrong engine.
   */
  const ensureVoiceReady = useCallback(async (path: string): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    const session = sessionRef.current;
    if (
      hindiTTS.getStatus().isInitialized &&
      hindiTTS.getActiveModelPath() === path
    ) {
      return true;
    }
    const inflight = ensureInflightRef.current;
    if (inflight && inflight.path === path) {
      try {
        await inflight.promise;
      } catch {
        return false;
      }
    } else {
      const holder: { promise: Promise<void> | null } = { promise: null };
      holder.promise = (async () => {
        if (sessionRef.current !== session) return;
        setIsLoading(true);
        setError(null);
        console.log(`[TTS] Loading voice model ${path}…`);
        try {
          await hindiTTS.initialize({ debug: __DEV__, modelPath: path });
          if (sessionRef.current !== session) return;
          setIsReady(true);
          setError(null);
          console.log('[TTS] Voice model ready.');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error('[TTS] Model load failed:', msg);
          if (sessionRef.current === session) setError(msg);
          throw err;
        } finally {
          if (sessionRef.current === session) setIsLoading(false);
          if (
            holder.promise &&
            ensureInflightRef.current?.promise === holder.promise
          ) {
            ensureInflightRef.current = null;
          }
        }
      })();
      const task: Promise<void> = holder.promise;
      ensureInflightRef.current = { path, promise: task };
      try {
        await task;
      } catch {
        return false;
      }
    }
    if (sessionRef.current !== session) return false;
    return (
      hindiTTS.getStatus().isInitialized &&
      hindiTTS.getActiveModelPath() === path
    );
  }, []);

  const ensureReady = useCallback(
    async (modelPath?: string) => {
      if (Platform.OS === 'web') return;
      const path = modelPath ?? DEFAULT_TTS_MODEL_PATH;
      if (
        hindiTTS.getStatus().isInitialized &&
        hindiTTS.getActiveModelPath() === path
      ) {
        setIsReady(true);
        return;
      }
      await ensureVoiceReady(path);
    },
    [ensureVoiceReady],
  );

  const release = useCallback(async () => {
    sessionRef.current += 1;
    ensureInflightRef.current = null;
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

  /**
   * Queue an ordered task behind earlier speak ops. Skips tasks scheduled
   * before release() so disconnect can't resurrect the freed engine.
   */
  const chainTask = useCallback((task: () => void | Promise<void>) => {
    const session = sessionRef.current;
    chainRef.current = chainRef.current
      .then(async () => {
        if (sessionRef.current !== session) return;
        try {
          await task();
        } catch (err) {
          console.warn('[useAutoSpeak] speak chain failed:', err);
        }
      })
      .catch((err) => {
        console.warn('[useAutoSpeak] speak chain failed:', err);
      });
  }, []);

  /**
   * Speak `clean` text with the voice for `lang`, switching the shared
   * engine first when needed. Speech is delayed, never silently dropped
   * when the engine is still loading or was evicted by a mesh broadcast
   * in another language. An identical utterance spoken within the echo
   * window is dropped (double-delivery guard).
   */
  const runVoiced = useCallback(
    (label: string, lang: LanguageId, clean: string, speak: () => void) => {
      const session = sessionRef.current;
      chainTask(async () => {
        if (!enabledRef.current) return;
        if (Platform.OS === 'web') return;
        if (sessionRef.current !== session) return;
        const path = ttsPathFor(lang);
        const ok = await ensureVoiceReady(path);
        if (!ok) return;
        if (!enabledRef.current) return;
        if (sessionRef.current !== session) return;
        const prev = lastUtteranceRef.current;
        if (
          prev &&
          prev.text === clean &&
          prev.path === path &&
          Date.now() - prev.at < ECHO_WINDOW_MS
        ) {
          console.log('[useAutoSpeak] dropping echo duplicate');
          return;
        }
        try {
          speak();
          lastUtteranceRef.current = { text: clean, path, at: Date.now() };
        } catch (err) {
          console.warn(`[useAutoSpeak] ${label} failed:`, err);
        }
      });
    },
    [chainTask, ensureVoiceReady],
  );

  const speakFullMessage = useCallback(
    (text: string) => {
      if (!enabledRef.current) return;
      if (Platform.OS === 'web') return;
      if (!text?.trim()) return;
      const clean = text.trim();
      // Voice follows the message script (sender's language), not the
      // receiver's selected language — cross-script speech through the
      // wrong VITS model is silence (disjoint token sets).
      runVoiced('enqueueSpeak', detectSpokenLanguage(clean), clean, () =>
        hindiTTS.enqueueSpeak(clean),
      );
    },
    [runVoiced],
  );

  const beginStream = useCallback(() => {
    if (Platform.OS === 'web') return;
    chainTask(() => {
      streamLangRef.current = null;
      streamPendingRef.current = [];
      if (enabledRef.current) hindiTTS.startStreamingUtterance();
    });
  }, [chainTask]);

  const pushStreamText = useCallback(
    (newText: string) => {
      if (Platform.OS === 'web') return;
      if (!newText) return;
      const fresh = newText;
      chainTask(async () => {
        if (!enabledRef.current) return;
        streamPendingRef.current.push(fresh);
        let lang = streamLangRef.current;
        if (!lang) {
          // Hold fragments until the script is decisive — locking too
          // early on a tiny Latin prefix would miss the Indic body, and
          // switching later destroys already-queued speech.
          if (!streamPeekLocks(streamPendingRef.current.join(''))) return;
          lang = detectSpokenLanguage(streamPendingRef.current.join(''));
          streamLangRef.current = lang;
        }
        const ok = await ensureVoiceReady(ttsPathFor(lang));
        if (!ok) return;
        if (!enabledRef.current) return;
        const pending = streamPendingRef.current;
        streamPendingRef.current = [];
        for (const part of pending) {
          try {
            hindiTTS.appendStreamingText(part);
          } catch (err) {
            console.warn('[useAutoSpeak] pushStreamText failed:', err);
          }
        }
      });
    },
    [chainTask, ensureVoiceReady],
  );

  const endStream = useCallback(() => {
    if (Platform.OS === 'web') return;
    chainTask(async () => {
      if (!enabledRef.current) return;
      const pending = streamPendingRef.current;
      streamPendingRef.current = [];
      let lang = streamLangRef.current;
      streamLangRef.current = null;
      if (pending.length > 0) {
        // Tiny utterance that never locked: detect over what arrived.
        if (!lang) {
          lang = detectSpokenLanguage(pending.join(''));
        }
        const path = ttsPathFor(lang);
        const ok = await ensureVoiceReady(path);
        if (!ok) return;
        if (!enabledRef.current) return;
        const joined = pending.join('');
        const prev = lastUtteranceRef.current;
        if (
          prev &&
          prev.text === joined &&
          prev.path === path &&
          Date.now() - prev.at < ECHO_WINDOW_MS
        ) {
          console.log('[useAutoSpeak] dropping echo duplicate');
          return;
        }
        for (const part of pending) {
          try {
            hindiTTS.appendStreamingText(part);
          } catch (err) {
            console.warn('[useAutoSpeak] endStream flush failed:', err);
          }
        }
        lastUtteranceRef.current = { text: joined, path, at: Date.now() };
      } else if (lang) {
        const ok = await ensureVoiceReady(ttsPathFor(lang));
        if (!ok) return;
        if (!enabledRef.current) return;
      } else {
        return;
      }
      try {
        hindiTTS.finishStreamingUtterance();
      } catch (err) {
        console.warn('[useAutoSpeak] endStream failed:', err);
      }
    });
  }, [chainTask, ensureVoiceReady]);

  const discardStream = useCallback(() => {
    if (Platform.OS === 'web') return;
    // Ordered after earlier pushes (no engine ensure, runs even when
    // disabled) — a synchronous clear here would run BEFORE queued pushes
    // execute and let broadcast-JSON gibberish survive into speech.
    chainTask(() => {
      streamLangRef.current = null;
      streamPendingRef.current = [];
      hindiTTS.discardStreamingBuffer();
    });
  }, [chainTask]);

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
