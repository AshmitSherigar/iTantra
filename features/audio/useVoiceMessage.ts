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
  /** Start recording the user's voice. */
  startVoice: () => Promise<void>;
  /**
   * Stop recording, perform transcription, and return the text.
   * Returns `null` when transcription fails or produces no output.
   */
  stopVoice: () => Promise<string | null>;
};

/**
 * Hook that captures microphone audio via Sherpa ONNX's native PCM live stream
 * and performs offline STT using the IndicConformer model.
 */
export function useVoiceMessage(): UseVoiceMessageReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const partialText = ''; // Offline model doesn't support partial results

  const micRef = useRef<PcmLiveStreamHandle | null>(null);
  const removeDataListenerRef = useRef<(() => void) | null>(null);
  const removeErrorListenerRef = useRef<(() => void) | null>(null);
  
  // Accumulate PCM samples in memory
  const audioChunksRef = useRef<Float32Array[]>([]);
  const totalSamplesRef = useRef(0);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      removeDataListenerRef.current?.();
      removeErrorListenerRef.current?.();
      micRef.current?.stop().catch(() => {});
    };
  }, []);

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
      console.log('[useVoiceMessage] Recording started');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useVoiceMessage] startVoice failed:', msg);
      setError(msg);
      setIsRecording(false);
    }
  }, []);

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

      console.log(`[useVoiceMessage] Captured ${samplesArray.length} samples. Starting transcription...`);

      // 3. Transcribe using the offline engine
      const text = await sttEngine.transcribeSamples(samplesArray, 16000);
      
      const finalText = text.trim();
      if (!finalText) {
        setError('No speech detected.');
        return null;
      }

      console.log('[useVoiceMessage] Final transcription:', finalText);
      return finalText;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useVoiceMessage] stopVoice failed:', msg);
      setError(`Transcription failed: ${msg}`);
      return null;
    } finally {
      setIsTranscribing(false);
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;
    }
  }, []);

  return { isRecording, isTranscribing, partialText, error, startVoice, stopVoice };
}
