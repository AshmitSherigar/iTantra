import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';

import { createPcmLiveStream } from 'react-native-sherpa-onnx/audio';
import type { PcmLiveStreamHandle } from 'react-native-sherpa-onnx/audio';
import { sttEngine } from '../stt/stt-engine';
import type { STTStatus } from '../stt/stt-engine';
import { benchmarkLogger } from '../benchmark/BenchmarkLogger';

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
  /**
   * Synchronous mic-activity check (native handle held OR start in flight).
   * Use from push-to-talk release handlers: React state (`isRecording`)
   * lags a render behind, so checking only state can miss a mic that is
   * already opening and leave it stuck open.
   */
  isVoiceActive: () => boolean;
  /**
   * Silently tear down the mic without transcribing and without setting an
   * error. For background/unmount safety stops. If a `startVoice()` is still
   * in flight it shuts itself back down after `mic.start()` resolves.
   */
  abortVoice: () => Promise<void>;
  /** Start recording the user's voice. */
  startVoice: () => Promise<void>;
  /**
   * Stop recording, perform transcription, and return the text.
   * Returns `null` when transcription fails or produces no output.
   */
  stopVoice: () => Promise<string | null>;
  /**
   * Preload the STT model for one language (call when BLE devices connect).
   * Idempotent per path — pass the selected language's `sttAssetPath` so
   * ONLY that model (~200MB) ever lives in RAM.
   */
  ensureSttReady: (modelPath?: string) => Promise<void>;
  /** Free STT native memory (call on BLE disconnect). */
  releaseStt: () => Promise<void>;
  /**
   * Synchronous snapshot of the native STT engine (no render lag).
   * `ensureSttReady()` reports failure via state AND resolves normally, so
   * callers that must branch on the outcome (push-to-talk) check this right
   * after awaiting it instead of relying on `sttReady`/`sttError` state.
   */
  getSttStatus: () => STTStatus;
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
  // Guards the async gap between tap and `mic.start()` resolving — a second
  // tap in that window would otherwise open a second native AudioRecord,
  // which hard-crashes the app on Android.
  const startingRef = useRef(false);
  // Set by abortVoice(); consumed by the in-flight startVoice() so a hold
  // released during mic warm-up still shuts the mic back down.
  const abortRef = useRef(false);
  // Cached mic grant. Re-requesting permission on EVERY hold can flash a
  // system permission UI on some OEM skins even when already granted — that
  // pauses the activity (AppState 'background') and used to kill PTT holds
  // mid-warm-up. getPermissionsAsync() never shows UI, so it is always
  // safe; requestPermissionsAsync() runs at most once until denied.
  const micPermissionGrantedRef = useRef<boolean | null>(null);
  // Mic lifecycle for the start/stop rendezvous: a release landing while
  // `starting` asks for a stand-down (pendingStop) instead of racing the
  // native AudioRecord open — the previous race stranded mics and produced
  // phantom warm-up aborts on touch churn.
  const micStateRef = useRef<'idle' | 'starting' | 'live'>('idle');
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const pendingStopRef = useRef(false);
  const currentTraceIdRef = useRef<string | null>(null);

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
    console.log(line);
  }, []);

  const refreshSttState = useCallback(() => {
    const s = sttEngine.getStatus();
    setSttReady(s.isInitialized);
    setSttLoading(s.isInitializing);
    setSttError(s.lastError);
  }, []);

  const getSttStatus = useCallback((): STTStatus => sttEngine.getStatus(), []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      try {
        removeDataListenerRef.current?.();
        removeErrorListenerRef.current?.();
      } catch {}
      const mic = micRef.current;
      micRef.current = null;
      // Tell an in-flight startVoice() (if any) to shut back down instead
      // of going live after unmount.
      abortRef.current = true;
      mic?.stop().catch(() => {});
    };
  }, []);

  const ensureSttReady = useCallback(
    async (modelPath?: string) => {
      if (Platform.OS === 'web') return;
      // Already holding the requested language — nothing to do.
      if (
        sttEngine.isInitialized() &&
        (!modelPath || sttEngine.getActiveModelPath() === modelPath)
      ) {
        refreshSttState();
        return;
      }
      setSttLoading(true);
      setSttError(null);
      const loadTraceId = benchmarkLogger.generateTraceId('stt-load');
      benchmarkLogger.logEvent('STT_MODEL_LOAD_START', loadTraceId, {
        extraInfo: modelPath ?? 'default',
      });
      pushLog(
        `[STT] Loading speech model ${modelPath ?? '(default)'} (after BLE connect)…`,
      );
      try {
        await sttEngine.ensureInitialized(modelPath as string | undefined);
        benchmarkLogger.logEvent('STT_MODEL_LOAD_END', loadTraceId, {
          extraInfo: 'success',
        });
        pushLog('[STT] Speech model ready.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        benchmarkLogger.logEvent('STT_MODEL_LOAD_END', loadTraceId, {
          extraInfo: `failure:${msg}`,
        });
        pushLog(`[STT] Model load FAILED: ${msg}`);
        setSttError(msg);
      } finally {
        refreshSttState();
      }
    },
    [pushLog, refreshSttState],
  );

  const releaseStt = useCallback(async () => {
    if (!sttEngine.isInitialized()) {
      refreshSttState();
      return;
    }
    const traceId = benchmarkLogger.generateTraceId('stt-unload');
    benchmarkLogger.logEvent('STT_MODEL_UNLOAD_START', traceId);
    try {
      await sttEngine.release();
      benchmarkLogger.logEvent('STT_MODEL_UNLOAD_END', traceId, {
        extraInfo: 'success',
      });
      pushLog('[STT] Speech model released (RAM freed).');
    } catch {
      benchmarkLogger.logEvent('STT_MODEL_UNLOAD_END', traceId, {
        extraInfo: 'failure',
      });
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
    // hard-crashes Android. If a previous launch is still warming up (e.g. a
    // tap that was just aborted), wait for it to settle and then continue
    // with THIS launch — returning early here strands push-to-talk holds
    // whose finger is still down with no mic and no retry.
    if (startingRef.current && !micRef.current) {
      pushLog('[Mic] waiting for in-flight mic launch to settle…');
      const deadline = Date.now() + 8000;
      while (startingRef.current && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 100));
      }
      pushLog('[Mic] previous launch settled — continuing');
    }
    if (startingRef.current || micRef.current) {
      return;
    }
    startingRef.current = true;
    abortRef.current = false;
    pendingStopRef.current = false;
    micStateRef.current = 'starting';

    // The launch runs as a tracked promise so a release landing mid-warm-up
    // (stopVoice) can wait for it to settle instead of racing it.
    const launch = (async () => {
      setError(null);
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;

      // Staged markers: a native kill preserves already-flushed Metro logs,
      // so the LAST visible marker tells us exactly which call died.
      // NOTE: check silently first — requestPermissionsAsync() can flash
      // system UI on some OEM skins (pausing the app), so it runs only when
      // the grant isn't already known.
      let granted = micPermissionGrantedRef.current;
      if (granted !== true) {
        try {
          granted = (await Audio.getPermissionsAsync()).granted;
        } catch {
          granted = false;
        }
        if (granted !== true) {
          pushLog('[Mic] step=permission-request');
          try {
            granted = (await Audio.requestPermissionsAsync()).granted;
          } catch {
            granted = false;
          }
        }
        micPermissionGrantedRef.current = granted;
        pushLog(`[Mic] step=permission-result granted=${granted}`);
      } else {
        pushLog('[Mic] step=permission-cached granted=true');
      }
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
        console.warn(
          '[useVoiceMessage] setAudioModeAsync failed (ignored):',
          e,
        );
      }
      pushLog('[Mic] step=create-stream');

      // 3. Open native mic capture at 16 kHz mono
      const mic = createPcmLiveStream({ sampleRate: 16_000, channelCount: 1 });
      micRef.current = mic;

      // 4. Accumulate PCM chunks in memory
      removeDataListenerRef.current = mic.onData(
        (samples: Float32Array, sampleRate: number) => {
          audioChunksRef.current.push(samples);
          totalSamplesRef.current += samples.length;
        },
      );

      removeErrorListenerRef.current = mic.onError((message: string) => {
        console.error('[useVoiceMessage] Mic error:', message);
        setError(`Mic error: ${message}`);
      });

      // 5. Start capture
      pushLog('[Mic] step=native-start');
      await mic.start();
      pushLog('[Mic] step=native-started');
    })();
    startPromiseRef.current = launch;

    try {
      await launch;
    } catch (err) {
      // Start failed — release everything so a later stop()/unmount never
      // calls native stop() on a stream that isn't running (also a native
      // crash vector) and a retry starts from a clean handle.
      teardownMicListeners();
      micRef.current = null;
      micStateRef.current = 'idle';
      pendingStopRef.current = false;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[useVoiceMessage] startVoice failed:', msg);
      pushLog(`[Mic] launch failed: ${msg}`);
      setError(msg);
      setIsRecording(false);
      return;
    } finally {
      startingRef.current = false;
      startPromiseRef.current = null;
    }

    // A release landed mid-warm-up and asked for a stand-down: shut the
    // just-opened mic back down but KEEP captured chunks — the already
    // waiting stopVoice() transcribes whatever arrived (possibly ~nothing
    // for a sub-second hold, which yields the usual empty-speech error,
    // never a stranded mic and never a phantom abort).
    // (Assertion: micRef.current was narrowed to null by the launch guard
    // above; at runtime it holds the just-opened mic or null.)
    const openedMic = micRef.current as PcmLiveStreamHandle | null;
    if (pendingStopRef.current) {
      pendingStopRef.current = false;
      pushLog('[Mic] launch handed to pending stop — shutting down');
      teardownMicListeners();
      micRef.current = null;
      if (openedMic) {
        try {
          await openedMic.stop();
        } catch (e) {
          console.warn('[useVoiceMessage] pending-stop mic stop failed:', e);
        }
      }
      micStateRef.current = 'idle';
      setIsRecording(false);
      return;
    }

    if (abortRef.current) {
      // True cancel (backgrounded/unmounted) while warming up: shut straight
      // back down with no owner and discard everything.
      pushLog('[Mic] start aborted before first frame — shutting down');
      teardownMicListeners();
      micRef.current = null;
      if (openedMic) {
        try {
          await openedMic.stop();
        } catch (e) {
          console.warn('[useVoiceMessage] aborted mic stop failed:', e);
        }
      }
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;
      micStateRef.current = 'idle';
      setIsRecording(false);
      return;
    }

    micStateRef.current = 'live';
    setIsRecording(true);
    const traceId = benchmarkLogger.generateTraceId('voice');
    currentTraceIdRef.current = traceId;
    benchmarkLogger.logEvent('AUDIO_RECORD_START', traceId);
    pushLog('[Mic] Recording started…');
  }, [pushLog, teardownMicListeners]);

  const stopVoice = useCallback(async (): Promise<string | null> => {
    setError(null);
    setIsTranscribing(true);
    setIsRecording(false);
    const traceId =
      currentTraceIdRef.current || benchmarkLogger.generateTraceId('voice');

    if (micStateRef.current === 'starting') {
      // Released while the mic was still opening: ask the in-flight launch
      // to stand down, wait for it to settle, then stop normally and
      // transcribe whatever arrived. Sub-second holds legitimately yield
      // ~nothing (usual empty-speech error) — never a stranded mic.
      pushLog('[Mic] stop during warm-up — waiting for launch to settle…');
      pendingStopRef.current = true;
      const pending = startPromiseRef.current;
      if (pending) {
        try {
          await pending;
        } catch {
          // Launch failure is handled inside startVoice; continue below.
        }
      }
    }

    try {
      // 1. Stop mic capture (never let a native stop() rejection escape —
      // it would surface as an unhandled rejection on some builds).
      teardownMicListeners();

      const mic = micRef.current;
      micRef.current = null;
      if (mic) {
        try {
          await mic.stop();
        } catch (e) {
          console.warn('[useVoiceMessage] mic stop failed (ignored):', e);
        }
      }

      if (totalSamplesRef.current === 0) {
        throw new Error('No audio captured.');
      }

      benchmarkLogger.logEvent('AUDIO_RECORD_STOP', traceId, {
        byteCount: totalSamplesRef.current * 2,
        extraInfo: `samples=${totalSamplesRef.current}`,
      });

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

      // 3. Transcribe using the offline engine (lazy-loads model if needed)
      if (!sttEngine.isInitialized()) {
        pushLog('[STT] Model not loaded yet — loading now (first use)…');
        setSttLoading(true);
        const loadTraceId = benchmarkLogger.generateTraceId('stt-load');
        benchmarkLogger.logEvent('STT_MODEL_LOAD_START', loadTraceId, {
          extraInfo: 'lazy-default',
        });
        try {
          await sttEngine.ensureInitialized();
          benchmarkLogger.logEvent('STT_MODEL_LOAD_END', loadTraceId, {
            extraInfo: 'success',
          });
          pushLog('[STT] Speech model ready.');
        } catch (err) {
          benchmarkLogger.logEvent('STT_MODEL_LOAD_END', loadTraceId, {
            extraInfo: `failure:${err instanceof Error ? err.message : String(err)}`,
          });
          throw err;
        } finally {
          refreshSttState();
        }
      }

      benchmarkLogger.logEvent('STT_INFERENCE_START', traceId, {
        byteCount: samplesArray.length * 4,
        extraInfo: `duration_s=${(samplesArray.length / 16000).toFixed(2)}`,
        metadata: {
          sampleRateHz: 16000,
          channels: 1,
          audioDurationMs: (samplesArray.length / 16000) * 1000,
          modelPath: sttEngine.getActiveModelPath() ?? 'unknown',
        },
      });

      const text = await sttEngine.transcribeSamples(samplesArray, 16000);

      const finalText = text.trim();
      benchmarkLogger.logEvent('STT_INFERENCE_END', traceId, {
        charCount: finalText.length,
        extraInfo: finalText ? 'ok' : 'empty',
        metadata: {
          audioDurationMs: (samplesArray.length / 16000) * 1000,
          sampleRateHz: 16000,
          channels: 1,
          outcome: finalText ? 'success' : 'empty',
          modelPath: sttEngine.getActiveModelPath() ?? 'unknown',
        },
      });

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
      benchmarkLogger.logEvent('BENCHMARK_FAILURE', traceId, {
        extraInfo: `stt:${msg}`,
      });
      pushLog(`[STT] Transcription FAILED: ${msg}`);
      setError(`Transcription failed: ${msg}`);
      refreshSttState();
      return null;
    } finally {
      setIsTranscribing(false);
      micStateRef.current = 'idle';
      pendingStopRef.current = false;
      audioChunksRef.current = [];
      totalSamplesRef.current = 0;
    }
  }, [pushLog, refreshSttState, teardownMicListeners]);

  /**
   * Synchronous mic-activity check for push-to-talk release handlers.
   * `isRecording` state lags a render behind `mic.start()` resolving, so a
   * release in that gap must still stop the mic.
   */
  const isVoiceActive = useCallback(
    () => startingRef.current || micRef.current != null,
    [],
  );

  /**
   * Silent teardown: release the mic without transcribing and without
   * setting an error. An in-flight `startVoice()` observes the abort flag
   * and shuts itself back down after `mic.start()` resolves.
   */
  const abortVoice = useCallback(async () => {
    abortRef.current = true;
    teardownMicListeners();
    const mic = micRef.current;
    micRef.current = null;
    if (mic) {
      try {
        await mic.stop();
      } catch (e) {
        console.warn('[useVoiceMessage] abort mic stop failed (ignored):', e);
      }
    }
    audioChunksRef.current = [];
    totalSamplesRef.current = 0;
    micStateRef.current = 'idle';
    setIsRecording(false);
  }, [teardownMicListeners]);

  return {
    isRecording,
    isTranscribing,
    partialText,
    error,
    sttReady,
    sttLoading,
    sttError,
    lastTranscript,
    isVoiceActive,
    abortVoice,
    startVoice,
    stopVoice,
    ensureSttReady,
    releaseStt,
    getSttStatus,
  };
}
