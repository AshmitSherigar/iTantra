import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hindiTTS } from '../tts/HindiTTS';
import { getLanguage, ttsPathFor, type LanguageId } from '../models/languages';
import type { BroadcastEnvelope } from './broadcast';

const IDLE_POLL_MS = 200;
const IDLE_TIMEOUT_MS = 60000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Resolve once the shared TTS engine is idle (queue drained). */
async function waitForTtsIdle(): Promise<void> {
  const started = Date.now();
  for (;;) {
    const s = hindiTTS.getStatus();
    if (!s.isSpeaking && (s.queueLength ?? 0) <= 0) return;
    if (Date.now() - started > IDLE_TIMEOUT_MS) return;
    await sleep(IDLE_POLL_MS);
  }
}

/**
 * Homepage mesh voice: speaks incoming flood broadcasts in the SENDER's
 * language, not the receiver's selected language.
 *
 * Why this exists: the 1-to-1 chat loads ONE voice (the receiver's selected
 * language) and speaks everything with it. A Hindi broadcast spoken through
 * the English VITS model comes out as English-accented gibberish — the
 * reported "only english model speaks it" bug. This hook switches the shared
 * engine to `envelope.language` before speaking.
 *
 * - Serial queue: messages speak in arrival order; a language switch waits
 *   for the current utterance to finish so voices never chop each other.
 * - Shares the `hindiTTS` singleton with the 1-to-1 chat. Model init is
 *   idempotent per path, so same-language messages don't reload anything.
 * - Web / uninitialised engine = safe no-op.
 */
export function useMeshSpeech(defaultEnabled = true) {
  const [enabled, setEnabledState] = useState(defaultEnabled);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoadingVoice, setIsLoadingVoice] = useState(false);
  const [spokenLangLabel, setSpokenLangLabel] = useState<string | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Poll shared-engine state so the homepage "Speaking…" indicator is live.
  useEffect(() => {
    const id = setInterval(() => {
      const s = hindiTTS.getStatus();
      if (mountedRef.current) setIsSpeaking(s.isSpeaking);
    }, 500);
    return () => clearInterval(id);
  }, []);

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    if (!v) {
      hindiTTS.stop().catch(() => {});
      if (mountedRef.current) setIsSpeaking(false);
    }
  }, []);

  const stop = useCallback(() => {
    hindiTTS.stop().catch(() => {});
    if (mountedRef.current) setIsSpeaking(false);
  }, []);

  const speakBroadcast = useCallback((envelope: BroadcastEnvelope) => {
    if (Platform.OS === 'web') return;
    const text = envelope?.message?.trim();
    if (!text) return;
    const langId = (envelope.language ?? 'en') as LanguageId;

    chainRef.current = chainRef.current
      .then(async () => {
        if (!enabledRef.current) return;
        // Let any in-flight utterance (mesh or 1-to-1 chat) finish first so
        // a language switch can't cut it off mid-word.
        await waitForTtsIdle();
        if (!enabledRef.current) return;
        if (mountedRef.current) setIsLoadingVoice(true);
        try {
          // Idempotent per model path — same-language bursts load once.
          await hindiTTS.initialize({ modelPath: ttsPathFor(langId) });
        } catch (err) {
          console.warn('[MeshSpeech] voice load failed:', err);
          return;
        } finally {
          if (mountedRef.current) setIsLoadingVoice(false);
        }
        if (!enabledRef.current) return;
        if (mountedRef.current) {
          try {
            setSpokenLangLabel(getLanguage(langId).label);
          } catch {
            setSpokenLangLabel(langId);
          }
          setIsSpeaking(true);
        }
        try {
          hindiTTS.enqueueSpeak(text);
        } catch (err) {
          console.warn('[MeshSpeech] enqueue failed:', err);
          return;
        }
        // Hold the chain until playback drains so the NEXT message's
        // language switch happens after this one is heard, in order.
        await waitForTtsIdle();
      })
      .catch((err) => {
        console.warn('[MeshSpeech] speak chain failed:', err);
      });
  }, []);

  return {
    enabled,
    setEnabled,
    isSpeaking,
    isLoadingVoice,
    spokenLangLabel,
    speakBroadcast,
    stop,
  };
}
