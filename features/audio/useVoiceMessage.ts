import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import type { PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import { getSherpaAudio } from '@/utils/sherpaNative';
import { sttEngine } from '@/features/stt/STTEngine';
import { logger } from '@/utils/logger';

export type UseVoiceMessageReturn = {
  isRecording: boolean;
  isTranscribing: boolean;
  partialText: string;
  error: string | null;
  sttReady: boolean;
  sttLoading: boolean;
  sttError: string | null;
  lastTranscript: string;
  startVoice: () => Promise<void>;
  stopVoice: () => Promise<string | null>;
  ensureSttReady: (modelPath?: string) => Promise<boolean>;
  releaseStt: () => Promise<void>;
};

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
  const startingRef = useRef(false);

  const teardownMicListeners = useCallback(() => {
    removeDataListenerRef.current?.();
    removeDataListenerRef.current = null;
    removeErrorListenerRef.current?.();
    removeErrorListenerRef.current = null;
  }, []);

  // Accumulate PCM samples in memory
  const audioChunksRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);

  // Terminal-only logging (Metro/Logcat). Nothing is rendered in-app.
  const pushLog = useCallback((line: string) => {
    logger.info('Audio', line);
  }, []);

  const refreshSttState = useCallback(() => {
    const s = sttEngine.getStatus();
    setSttReady(s.isInitialized);
    setSttLoading(s.isInitializing);
    setSttError(s.lastError);
  }, []);

  useEffect(() => {
    return () => {
      try {
        removeDataListenerRef.current?.();
        removeErrorListenerRef.current?.();
      } catch {}
      const mic = micRef.current;
      micRef.current = null;
      mic?.stop().catch(() => {});
    };
  }, []);

  const ensureSttReady = useCallback(
    async (modelPath?: string) => {
      if (Platform.OS === 'web') return false;
      // Already holding the requested language — nothing to do.
      if (
        sttEngine.isInitialized() &&
        (!modelPath || sttEngine.getActiveModelPath() === modelPath)
      ) {
        refreshSttState();
        return true;
      }
      setSttLoading(true);
      setSttError(null);
      pushLog(
        `[STT] Loading speech model ${modelPath ?? '(default)'} (after BLE connect)…`,
      );
      try {
        await sttEngine.ensureInitialized(modelPath as string | undefined);
        pushLog('[STT] Speech model ready.');
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        pushLog(`[STT] Model load FAILED: ${msg}`);
        setSttError(msg);
        return false;
      } finally {
        refreshSttState();
      }
    },
    [pushLog, refreshSttState],
  );

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
    // No double-start: a second native AudioRecord while one is live
    if (startingRef.current || micRef.current) {
      return;
    }
    startingRef.current = true;

    try {
      setError(null);
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;

      pushLog('[Mic] step=permission-request');
      // 1. Request microphone permissions
      const { granted } = await Audio.requestPermissionsAsync();
      pushLog(`[Mic] step=permission-result granted=${granted}`);
      if (!granted) {
        throw new Error('Microphone permission not granted.');
      }

      // 2. Put the OS audio session in record mode first so the native
      // AudioRecord doesn't fight speaker playback for the audio route.
      pushLog('[Mic] step=audio-mode');
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: true,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        logger.warn('Audio', 'setAudioModeAsync failed (ignored)', e);
      }
      pushLog('[Mic] step=create-stream');

      // 3. Open native mic capture at 16 kHz mono
      const audioModule = getSherpaAudio();
      if (!audioModule) {
        throw new Error('Voice recording is not supported on this platform.');
      }
      const mic = audioModule.createPcmLiveStream({
        sampleRate: 16_000,
        channelCount: 1,
      });
      micRef.current = mic;

      // 4. Accumulate PCM chunks in memory
      removeDataListenerRef.current = mic.onData((samples: Float32Array) => {
        audioChunksRef.current.push(samples);
        totalSamplesRef.current += samples.length;
      });

      removeErrorListenerRef.current = mic.onError((message: string) => {
        logger.error('Audio', 'Microphone error', message);
        setError(`Mic error: ${message}`);
      });

      // 5. Start capture
      pushLog('[Mic] step=native-start');
      await mic.start();
      pushLog('[Mic] step=native-started');
      setIsRecording(true);
      pushLog('[Mic] Recording started…');
    } catch (err) {
      // Start failed — release everything so a later stop()/unmount never
      // calls native stop() on a stream that isn't running (also a native
      // crash vector) and a retry starts from a clean handle.
      const failedMic = micRef.current;
      teardownMicListeners();
      micRef.current = null;
      try {
        await failedMic?.stop();
      } catch (cleanupError) {
        logger.warn(
          'Audio',
          'Failed to clean up microphone after startup failure',
          cleanupError,
        );
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Audio', 'startVoice failed', msg);
      setError(msg);
      setIsRecording(false);
    } finally {
      startingRef.current = false;
    }
  }, [pushLog, teardownMicListeners]);

  const stopVoice = useCallback(async (): Promise<string | null> => {
    setError(null);
    setIsTranscribing(true);
    setIsRecording(false);

    try {
      // 1. Stop mic capture
      teardownMicListeners();

      const mic = micRef.current;
      micRef.current = null;
      if (mic) {
        try {
          await mic.stop();
        } catch (e) {
          logger.warn('Audio', 'Microphone stop failed (ignored)', e);
        }
      }

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
        `[STT] Captured ${samplesArray.length} samples (${(samplesArray.length / 16000).toFixed(1)}s). Transcribing…`,
      );

      // 3. Transcribe using the selected offline model.
      if (!sttEngine.isInitialized()) {
        const msg = 'Speech model is not ready.';
        setError(msg);
        refreshSttState();
        return null;
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
      logger.error('Audio', 'stopVoice failed', msg);
      pushLog(`[STT] Transcription FAILED: ${msg}`);
      setError(`Transcription failed: ${msg}`);
      refreshSttState();
      return null;
    } finally {
      setIsTranscribing(false);
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;
    }
  }, [pushLog, refreshSttState, teardownMicListeners]);

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
