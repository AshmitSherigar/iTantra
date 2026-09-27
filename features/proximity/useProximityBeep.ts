import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';

import { isSirenPlaying } from '../sos/siren';
import type { DistanceBand } from './distance';

/**
 * Hot/cold guidance beeps for device search.
 *
 * Short bursts of the bundled siren asset: the interval AND volume map to
 * the distance band (faster + louder = closer). Separate from the SOS siren:
 * bursts never touch SOS playback — if the SOS siren is sounding, beeps are
 * skipped so an emergency stays unmistakable. Paused in background.
 */

const BEEP_ASSET = require('../../assets/sounds/siren.wav');
/** Audible slice per beep — the asset loops, we stop it for the pip effect. */
const BEEP_BURST_MS = 220;

const BEEP_BY_BAND: Record<DistanceBand, { intervalMs: number; volume: number }> = {
  immediate: { intervalMs: 250, volume: 1.0 },
  near: { intervalMs: 600, volume: 0.75 },
  mid: { intervalMs: 1000, volume: 0.5 },
  far: { intervalMs: 1500, volume: 0.3 },
  unknown: { intervalMs: 1800, volume: 0.3 },
};

export function useProximityBeep(opts: {
  /** True while a target is tracked. Everything tears down on false. */
  enabled: boolean;
  /** Current band — read live each beep, so callers pass plain state. */
  band: DistanceBand;
}): void {
  const { enabled, band } = opts;
  const bandRef = useRef(band);
  useEffect(() => {
    bandRef.current = band;
  }, [band ]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sound: Audio.Sound | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let appActive = true;

    const sub = AppState.addEventListener('change', (state) => {
      appActive = state === 'active';
    });

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = () => {
      if (cancelled) return;
      clearTimer();
      timer = setTimeout(() => {
        void tick();
      }, BEEP_BY_BAND[bandRef.current].intervalMs);
    };

    const tick = async () => {
      if (cancelled) return;
      try {
        // Never fight the SOS siren — skip this beat, keep the schedule.
        if (appActive && sound && !isSirenPlaying()) {
          const cfg = BEEP_BY_BAND[bandRef.current];
          try {
            await sound.setVolumeAsync(cfg.volume);
            await sound.replayAsync();
          } catch {}
          try {
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          } catch {}
          await new Promise<void>((resolve) =>
            setTimeout(resolve, BEEP_BURST_MS),
          );
          try {
            await sound.stopAsync();
          } catch {}
        }
      } catch {}
      scheduleNext();
    };

    void (async () => {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch {}
      try {
        const created = await Audio.Sound.createAsync(BEEP_ASSET, {
          shouldPlay: false,
          isLooping: true,
          volume: 0.5,
        });
        if (cancelled) {
          try {
            await created.sound.unloadAsync();
          } catch {}
          return;
        }
        sound = created.sound;
      } catch (e) {
        console.warn('[Search] beep preload failed:', e);
      }
      scheduleNext();
    })();

    return () => {
      cancelled = true;
      clearTimer();
      sub.remove();
      const current = sound;
      sound = null;
      void (async () => {
        try {
          await current?.stopAsync();
        } catch {}
        try {
          await current?.unloadAsync();
        } catch {}
      })();
    };
    // Band flows through bandRef — never restart the loop on approach.
  }, [enabled]);
}
