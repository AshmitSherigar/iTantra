import { useState, useRef, useCallback } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';

/**
 * Recording configuration optimised for Sherpa ONNX STT:
 * - Mono channel (1)
 * - 16 kHz sample rate
 * - WAV / Linear PCM output
 */
const RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: false,
  android: {
    extension: '.wav',
    outputFormat: Audio.AndroidOutputFormat.DEFAULT,
    audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 256_000,
  },
  ios: {
    extension: '.wav',
    outputFormat: Audio.IOSOutputFormat.LINEARPCM,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 16_000,
    numberOfChannels: 1,
    bitRate: 256_000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/wav',
    bitsPerSecond: 256_000,
  },
};

export type AudioRecorderState = {
  /** Whether the microphone is currently recording. */
  isRecording: boolean;
  /** Last error message, if any. */
  error: string | null;
};

export type AudioRecorderActions = {
  /**
   * Request microphone permission and start recording audio.
   * Resolves once recording has started (or throws on error).
   */
  startRecording: () => Promise<void>;
  /**
   * Stop the current recording and return the local file URI of the WAV file.
   * Returns `null` if there was no active recording.
   */
  stopRecording: () => Promise<string | null>;
};

export type UseAudioRecorderReturn = AudioRecorderState & AudioRecorderActions;

/**
 * Hook that wraps `expo-av` to provide start / stop microphone recording.
 *
 * The output WAV is configured for Sherpa ONNX STT (16 kHz, mono, PCM).
 */
export function useAudioRecorder(): UseAudioRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  const startRecording = useCallback(async () => {
    if (Platform.OS === 'web') {
      setError('Audio recording is not supported on web.');
      return;
    }

    try {
      setError(null);

      // Request microphone permission
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setError('Microphone permission not granted.');
        return;
      }

      // Configure audio session for recording
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // Create and start a new recording
      const { recording } =
        await Audio.Recording.createAsync(RECORDING_OPTIONS);
      recordingRef.current = recording;
      setIsRecording(true);

      console.log('[useAudioRecorder] Recording started');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useAudioRecorder] Failed to start recording:', msg);
      setError(msg);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    const recording = recordingRef.current;
    if (!recording) {
      console.warn('[useAudioRecorder] No active recording to stop.');
      return null;
    }

    try {
      setError(null);
      await recording.stopAndUnloadAsync();

      // Reset audio mode so playback works normally again
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      console.log('[useAudioRecorder] Recording stopped, URI:', uri);
      return uri;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useAudioRecorder] Failed to stop recording:', msg);
      setError(msg);
      setIsRecording(false);
      recordingRef.current = null;
      return null;
    }
  }, []);

  return { isRecording, error, startRecording, stopRecording };
}
