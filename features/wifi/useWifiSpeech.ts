import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { hindiTTS } from '../tts/HindiTTS';
import { getLanguage, ttsPathFor, type LanguageId } from '../models/languages';

const IDLE_POLL_MS = 200;
const IDLE_TIMEOUT_MS = 60000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Waits until the shared TTS engine drains its queue (or times out). */
async function waitForTtsIdle(): Promise<void> {
  const started = Date.now();
  for (;;) {
    const s = hindiTTS.getStatus();
    if (!s.isSpeaking && (s.queueLength ?? 0) <= 0) return;
    if (Date.now() - started > IDLE_TIMEOUT_MS) return;
    await sleep(IDLE_POLL_MS);
  }
}

/** One message to speak: text plus the sender's language id. */
export type WifiIncomingSpeech = {
  text: string;
  /** BCP-47 / app lang id carried on the wire (`msg.lang`). */
  lang?: string;
};

/**
 * WiFi voice: speaks incoming messages in the sender's language.
 *
 * Loads the voice model matching each message's `lang` before speaking,
 * so Hindi arrives in a Hindi voice and English in an English voice.
 * Messages are spoken serially in arrival order; a language switch waits
 * for the current utterance to finish so voices never chop each other.
 * Model init is idempotent per path, so same-language bursts load once.
 * Shares the `hindiTTS` singleton with the rest of the app.
 *
 * @param defaultEnabled Initial on/off state for auto-speak.
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

  /** Toggles auto-speak; turning off stops any in-flight speech. */
  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    if (!v) {
      hindiTTS.stop().catch(() => {});
      if (mountedRef.current) setIsSpeaking(false);
    }
  }, []);

  /** Stops any in-flight speech immediately. */
  const stop = useCallback(() => {
    hindiTTS.stop().catch(() => {});
    if (mountedRef.current) setIsSpeaking(false);
  }, []);

  /**
   * Queues one incoming message for speech in its own language. Empty
   * texts and web platforms are no-ops. Never throws.
   */
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
