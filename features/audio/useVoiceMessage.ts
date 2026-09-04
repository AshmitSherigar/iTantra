import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';

// @ts-expect-error - TS doesn't resolve internal paths due to package exports
import { createPcmLiveStream } from 'react-native-sherpa-onnx/src/audio';
// @ts-expect-error
import type { PcmLiveStreamHandle } from 'react-native-sherpa-onnx/src/audio';
import { sttEngine } from '../stt/stt-engine';

export type UseVoiceMessageReturn = {
  /** Whether the microphone is actively recording. */
  isRecording: boolean;
  /** Whether the STT engine is finalising transcription after recording stops. */
  isTranscribing: boolean;
  /** Partial (live) transcript while recording. (Not supported with offline model, always empty) */
  partialText: string;
  /** Last error message, if any. */
  error: string | null;
  /** STT model loaded and ready (loaded lazily after BLE connect to save RAM). */
  sttReady: boolean;
  /** STT model is currently loading. */
  sttLoading: boolean;
  /** Last STT init/runtime error, if any. */
  sttError: string | null;
  /** Last successfully transcribed text (also returned by stopVoice). */
  lastTranscript: string;
  /** Start recording the user's voice. */
  startVoice: () => Promise<void>;
  /**
   * Stop recording, perform transcription, and return the text.
   * Returns `null` when transcription fails or produces no output.
   */
  stopVoice: () => Promise<string | null>;
  /** Preload the STT model (call when BLE devices connect). Idempotent. */
  ensureSttReady: () => Promise<void>;
  /** Free STT native memory (call on BLE disconnect). */
  releaseStt: () => Promise<void>;
};

/**
 * Hook that captures microphone audio via Sherpa ONNX's native PCM live stream
 * and performs offline STT using the IndicConformer model.
 *
 * The STT model (~200MB) is NOT loaded here — call `ensureSttReady()` after
 * the two BLE devices connect, and `releaseStt()` on disconnect, so RAM is
 * only held while a chat peer exists.
 */
export function useVoiceMessage(): UseVoiceMessageReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sttReady, setSttReady] = useState(sttEngine.isInitialized());
  const [sttLoading, setSttLoading] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState('');
  const partialText = ''; // Offline model doesn't support partial results

  const micRef = useRef<PcmLiveStreamHandle | null>(null);
  const removeDataListenerRef = useRef<(() => void) | null>(null);
  const removeErrorListenerRef = useRef<(() => void) | null>(null);
  
  // Accumulate PCM samples in memory
  const audioChunksRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);

  // Terminal-only logging (Metro/Logcat). Nothing is rendered in-app.
  const pushLog = useCallback((line: string) => {
    console.log(line);
  }, []);

  const refreshSttState = useCallback(() => {
    const s = sttEngine.getStatus();
    setSttReady(s.isInitialized);
    setSttLoading(s.isInitializing);
    setSttError(s.lastError);
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      removeDataListenerRef.current?.();
      removeErrorListenerRef.current?.();
      micRef.current?.stop().catch(() => {});
    };
  }, []);

  const ensureSttReady = useCallback(async () => {
    if (Platform.OS === 'web') return;
    if (sttEngine.isInitialized()) {
      refreshSttState();
      return;
    }
    setSttLoading(true);
    setSttError(null);
    pushLog('[STT] Loading speech model (after BLE connect)…');
    try {
      await sttEngine.ensureInitialized();
      pushLog('[STT] Speech model ready.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog(`[STT] Model load FAILED: ${msg}`);
      setSttError(msg);
    } finally {
      refreshSttState();
    }
  }, [pushLog, refreshSttState]);

  const releaseStt = useCallback(async () => {
    try {
      await sttEngine.release();
      pushLog('[STT] Speech model released (RAM freed).');
    } catch {
      // ignore
    } finally {
      refreshSttState();
    }
  }, [pushLog, refreshSttState]);

  const startVoice = useCallback(async () => {
    if (Platform.OS === 'web') {
      setError('Voice recording is not supported on web.');
      return;
    }

    try {
      setError(null);
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;

      // 1. Request microphone permissions
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        throw new Error('Microphone permission not granted.');
      }

      // 2. Open native mic capture at 16 kHz mono
      const mic = createPcmLiveStream({ sampleRate: 16_000, channelCount: 1 });
      micRef.current = mic;

      // 3. Accumulate PCM chunks in memory
      removeDataListenerRef.current = mic.onData(
        (samples: Float32Array, sampleRate: number) => {
          audioChunksRef.current.push(samples);
          totalSamplesRef.current += samples.length;
        }
      );

      removeErrorListenerRef.current = mic.onError((message: string) => {
        console.error('[useVoiceMessage] Mic error:', message);
        setError(`Mic error: ${message}`);
      });

      // 4. Start capture
      await mic.start();
      setIsRecording(true);
      pushLog('[Mic] Recording started…');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useVoiceMessage] startVoice failed:', msg);
      setError(msg);
      setIsRecording(false);
    }
  }, [pushLog]);

  const stopVoice = useCallback(async (): Promise<string | null> => {
    setError(null);
    setIsTranscribing(true);
    setIsRecording(false);

    try {
      // 1. Stop mic capture
      removeDataListenerRef.current?.();
      removeDataListenerRef.current = null;
      removeErrorListenerRef.current?.();
      removeErrorListenerRef.current = null;

      await micRef.current?.stop();
      micRef.current = null;

      if (totalSamplesRef.current === 0) {
        throw new Error('No audio captured.');
      }

      // 2. Combine all accumulated chunks into a single array
      const allSamples = new Float32Array(totalSamplesRef.current);
      let offset = 0;
      for (const chunk of audioChunksRef.current) {
        allSamples.set(chunk, offset);
        offset += chunk.length;
      }
      
      // Convert Float32Array to number[] for the bridge
      const samplesArray = Array.from(allSamples);

      pushLog(
        `[STT] Captured ${samplesArray.length} samples (${(samplesArray.length / 16000).toFixed(1)}s). Transcribing…`
      );

      // 3. Transcribe using the offline engine (lazy-loads model if needed)
      if (!sttEngine.isInitialized()) {
        pushLog('[STT] Model not loaded yet — loading now (first use)…');
        setSttLoading(true);
        try {
          await sttEngine.ensureInitialized();
          pushLog('[STT] Speech model ready.');
        } finally {
          refreshSttState();
        }
      }
      const text = await sttEngine.transcribeSamples(samplesArray, 16000);
      
      const finalText = text.trim();
      if (!finalText) {
        const msg = 'No speech detected.';
        pushLog(`[STT] Result: EMPTY — ${msg}`);
        setError(msg);
        return null;
      }

      pushLog(`[STT] Result (${finalText.length} chars): "${finalText}"`);
      setLastTranscript(finalText);
      refreshSttState();
      return finalText;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useVoiceMessage] stopVoice failed:', msg);
      pushLog(`[STT] Transcription FAILED: ${msg}`);
      setError(`Transcription failed: ${msg}`);
      refreshSttState();
      return null;
    } finally {
      setIsTranscribing(false);
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;
    }
  }, [pushLog, refreshSttState]);

  return {
    isRecording,
    isTranscribing,
    partialText,
    error,
    sttReady,
    sttLoading,
    sttError,
    lastTranscript,
    startVoice,
    stopVoice,
    ensureSttReady,
    releaseStt,
  };
}
