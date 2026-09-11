import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createKwsManager, type KwsHandle } from './kwsEngine';
import {
  KWS_KEYWORDS,
  getKeywordPaths,
  getPorcupineAccessKey,
} from './kwsConfig';

export type KwsStatus =
  'off' | 'starting' | 'listening' | 'error' | 'missing-setup' | 'unsupported';

const TOGGLE_KEY = 'vaanisetu.kws_enabled.v1';

type UseKeywordListenerOpts = {
  /** Pause detection while true (e.g. STT recording owns the mic). */
  paused?: boolean;
  onDetect: (label: string) => void;
};

/**
 * Foreground distress-word listener ("Help Help" / "Bachao").
 *
 * - Runs only while the app is open (foreground). True background always-on
 *   needs a native foreground service (Android) and is impossible on iOS —
 *   that plugs in behind this same hook later.
 * - PorcupineManager owns its own AudioRecord stream; while `paused` (voice
 *   recording, broadcast) the mic is released to avoid device contention.
 * - `missing-setup` until a Picovoice AccessKey + trained .ppn files exist.
 */
export function useKeywordListener(opts: UseKeywordListenerOpts) {
  const { paused = false } = opts;
  const [enabled, setEnabledState] = useState(false);
  const [status, setStatus] = useState<KwsStatus>('off');
  const [error, setError] = useState<string | null>(null);
  const [detections, setDetections] = useState(0);
  const managerRef = useRef<KwsHandle | null>(null);
  const onDetectRef = useRef(opts.onDetect);
  onDetectRef.current = opts.onDetect;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (Platform.OS === 'web') {
      setStatus('unsupported');
      return () => {
        mountedRef.current = false;
      };
    }
    void AsyncStorage.getItem(TOGGLE_KEY)
      .then((v) => {
        if (v === '1' && mountedRef.current) setEnabledState(true);
      })
      .catch(() => {});
    return () => {
      mountedRef.current = false;
      void managerRef.current?.stop().catch(() => {});
      managerRef.current?.release();
      managerRef.current = null;
    };
  }, []);

  const startEngine = useCallback(async () => {
    const accessKey = getPorcupineAccessKey();
    if (!accessKey) {
      setStatus('missing-setup');
      setError('Add your Picovoice AccessKey in app.json (see kwsConfig).');
      setEnabledState(false);
      return;
    }
    const keywords = getKeywordPaths();
    if (keywords.length === 0) {
      setStatus('missing-setup');
      setError('Drop trained .ppn files into assets/kws/ and rebuild.');
      setEnabledState(false);
      return;
    }
    setStatus('starting');
    setError(null);
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) throw new Error('Microphone permission denied.');
      const handle = await createKwsManager({
        accessKey,
        keywordPaths: keywords.map((k) => k.path),
        onDetect: (index) => {
          if (mountedRef.current) setDetections((n) => n + 1);
          const label = KWS_KEYWORDS[index]?.label ?? `keyword ${index}`;
          onDetectRef.current(label);
        },
        onError: (message) => {
          console.warn('[KWS] process error:', message);
        },
      });
      managerRef.current = handle;
      await handle.start();
      if (mountedRef.current) setStatus('listening');
      else {
        await handle.stop().catch(() => {});
        handle.release();
      }
    } catch (e) {
      managerRef.current?.release();
      managerRef.current = null;
      if (mountedRef.current) {
        const msg = e instanceof Error ? e.message : String(e);
        // Missing .ppn at runtime surfaces as a native load failure — say
        // what it actually means instead of the raw native text.
        setError(
          /keyword|model|asset|file|load/i.test(msg)
            ? 'Keyword files missing or invalid — add .ppn files to assets/kws/ and rebuild.'
            : msg,
        );
        setStatus('error');
        setEnabledState(false);
      }
    }
  }, []);

  const stopEngine = useCallback(async () => {
    const handle = managerRef.current;
    managerRef.current = null;
    if (handle) {
      await handle.stop().catch(() => {});
      handle.release();
    }
    if (mountedRef.current) setStatus('off');
  }, []);

  // Toggle + pause drive the engine. Pause releases the mic without
  // forgetting the toggle, so detection resumes automatically after.
  useEffect(() => {
    if (!enabled || paused) {
      if (managerRef.current) void stopEngine();
      return;
    }
    if (!managerRef.current && status !== 'starting') {
      void startEngine();
    }
  }, [enabled, paused, startEngine, stopEngine, status]);

  const setEnabled = useCallback(
    (v: boolean) => {
      setEnabledState(v);
      AsyncStorage.setItem(TOGGLE_KEY, v ? '1' : '0').catch(() => {});
      if (!v) void stopEngine();
    },
    [stopEngine],
  );

  return {
    enabled,
    setEnabled,
    status,
    /** Mic temporarily yielded (e.g. voice recording) — resumes after. */
    micPaused: enabled && paused,
    error,
    detections,
    keywordLabels: KWS_KEYWORDS.map((k) => k.label),
  };
}
