import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hindiTTS } from '../tts/HindiTTS';
import { getLanguage, ttsPathFor, type LanguageId } from '../models/languages';

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

export type WifiIncomingSpeech = {
  text: string;
  /** BCP-47 / app lang id carried on the wire (`msg.lang`). */
  lang?: string;
};

/**
 * WiFi voice: speaks incoming messages in the SENDER's language.
 *
 * Why this exists instead of `useAutoSpeak`: the 1-to-1 chat loads ONE
 * voice (the receiver's selected language) and speaks everything with it.
 * A Hindi message spoken through the English VITS model comes out as
 * English-accented gibberish — the reported "hindi tts not speaking
 * properly" bug. This hook switches the shared engine to `msg.lang`
 * before speaking, exactly like `useMeshSpeech` does for BLE broadcasts.
 *
 * - Serial queue: messages speak in arrival order; a language switch waits
 *   for the current utterance to finish so voices never chop each other.
 * - Shares the `hindiTTS` singleton. Init is idempotent per model path,
 *   so same-language bursts load once.
 */
export function useWifiSpeech(defaultEnabled = true) {
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

  const speakMessage = useCallback((incoming: WifiIncomingSpeech) => {
    if (Platform.OS === 'web') return;
    const text = incoming?.text?.trim();
    if (!text) return;
    const langId = ((incoming.lang ?? 'en').trim().toLowerCase() ||
      'en') as LanguageId;

    chainRef.current = chainRef.current
      .then(async () => {
        if (!enabledRef.current) return;
        await waitForTtsIdle();
        if (!enabledRef.current) return;
        if (mountedRef.current) setIsLoadingVoice(true);
        try {
          await hindiTTS.initialize({ modelPath: ttsPathFor(langId) });
        } catch (err) {
          console.warn('[WifiSpeech] voice load failed:', err);
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
          console.warn('[WifiSpeech] enqueue failed:', err);
          return;
        }
        await waitForTtsIdle();
      })
      .catch((err) => {
        console.warn('[WifiSpeech] speak chain failed:', err);
      });
  }, []);

  return {
    enabled,
    setEnabled,
    isSpeaking,
    isLoadingVoice,
    spokenLangLabel,
    speakMessage,
    stop,
  };
}
