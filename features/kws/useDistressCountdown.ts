import { useCallback, useEffect, useRef, useState } from 'react';
import { Vibration } from 'react-native';
import { DISTRESS_CANCEL_SECONDS } from './kwsConfig';

export type DistressConfirmation = {
  /** Detected phrase that started this countdown. */
  label: string;
  /** Whole seconds left before auto-send. */
  secondsLeft: number;
} | null;

type UseDistressCountdownOpts = {
  seconds?: number;
  onTimeout: (label: string) => void;
};

/**
 * Post-trigger 15s cancel window. `trigger()` starts the countdown (with a
 * vibration burst so a trapped user notices); `cancel()` aborts; at zero the
 * SOS auto-sends via `onTimeout`. Re-triggering while confirming restarts
 * the window for the latest phrase.
 */
export function useDistressCountdown(opts: UseDistressCountdownOpts) {
  const seconds = opts.seconds ?? DISTRESS_CANCEL_SECONDS;
  const [confirming, setConfirming] = useState<DistressConfirmation>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(opts.onTimeout);
  onTimeoutRef.current = opts.onTimeout;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearTimer();
    if (mountedRef.current) setConfirming(null);
  }, [clearTimer]);

  const trigger = useCallback(
    (label: string) => {
      clearTimer();
      const deadline = Date.now() + seconds * 1000;
      if (mountedRef.current) {
        setConfirming({ label, secondsLeft: seconds });
      }
      try {
        Vibration.vibrate([400, 200, 400, 200, 800]);
      } catch {}
      timerRef.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (left <= 0) {
          clearTimer();
          if (mountedRef.current) setConfirming(null);
          onTimeoutRef.current(label);
        } else if (mountedRef.current) {
          setConfirming({ label, secondsLeft: left });
        }
      }, 250);
    },
    [clearTimer, seconds],
  );

  return { confirming, trigger, cancel };
}
