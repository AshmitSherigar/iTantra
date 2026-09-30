import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import * as Device from 'expo-device';

import {
  MESH_DEFAULT_TTL,
  activateSosPing,
  encodeSosPingForEnvelope,
  getEnvelopeTtl,
  isSosEnvelope,
  makeSosEnvelope,
  markSosPingResolved,
  requestMeshDiscovery,
  sendNearbyBroadcast,
  subscribeToBroadcasts,
  subscribeToSosPing,
} from '../features/bluetooth';
import type { BroadcastEnvelope } from '../features/bluetooth';
import { useLanguage } from './LanguageContext';
import {
  SOS_STOP_SIREN_ACTION_ID,
  buildSosHelpText,
  cancelScheduled,
  clearActiveTimer,
  ensureSosIncomingCategory,
  ensureSosLocationPermission,
  getCachedSosLocation,
  isKeeperKnownGood,
  loadActiveTimer,
  registerSosBackgroundTask,
  saveActiveTimer,
  saveLastFired,
  scheduleTimerNotifications,
  showImmediate,
  showSosIncoming,
  tryGetLocationFast,
  wasLastKeeperStartFatal,
} from '../features/sos';
import {
  onSirenPlayingChange,
  playSosSiren,
  preloadSosSiren,
  stopSosSiren,
} from '../features/sos/siren';
import {
  onSosKeeperExpire,
  startSosKeeper,
  stopSosKeeper,
} from '../features/sos/keeper';
import type { ReceivedSos, SosTimerState } from '../features/sos';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * SOS engine. Mounted once at the root so the safety timer survives tab
 * switches, backgrounding, and (via storage + notifications) app kills.
 *
 * Retry policy: 3 flood rounds, gaps 2s then 5s (worst ~7s, was 3x8s=16s).
 * Warm-mesh fast path makes round 1 land in <1s when links exist. If all 3
 * fail (no peers), the SOS is kept as `pendingRetry` with the exact
 * message so the user can one-tap re-send when phones are near. After a
 * successful send, 2 same-id background waves catch late joiners
 * (dedup-safe: receivers already holding the id drop them silently).
 */

const RETRY_ROUNDS = 3;
/** Gap BEFORE attempt N (attempt 1 fires immediately). */
const RETRY_GAPS_MS = [0, 2000, 5000];
/** Post-success late-joiner waves (fire-and-forget, same id). */
const LATE_WAVE_GAPS_MS = [3000, 8000];
/** Location budget on the send hot path (cached fix = 0ms). */
const SOS_LOCATION_FAST_MS = 1200;

function hopsOf(envelope: BroadcastEnvelope): number {
  return Math.max(0, MESH_DEFAULT_TTL - getEnvelopeTtl(envelope));
}

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function senderName(): string {
  return Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu';
}

type SosContextType = {
  activeTimer: SosTimerState | null;
  remainingMs: number;
  isFiring: boolean;
  lastResult: string | null;
  pendingRetry: { message: string; at: number } | null;
  inbox: ReceivedSos[];
  startTimer: (input: {
    durationMs: number;
    helpMessage: string;
    workspaceLabel: string;
    includeLocation: boolean;
  }) => Promise<void>;
  cancelTimer: () => Promise<void>;
  extendTimer: (extraMs: number) => Promise<void>;
  sendManualSos: (
    helpMessage: string,
    includeLocation: boolean,
  ) => Promise<boolean>;
  retryPendingSos: () => Promise<boolean>;
  clearInbox: () => void;
  clearResult: () => void;
  /** Loop the siren for incoming SOS. Persisted. */
  sirenEnabled: boolean;
  setSirenEnabled: (on: boolean) => void;
  sirenPlaying: boolean;
  stopSiren: () => Promise<void>;
  testSiren: () => Promise<void>;
};

const SosContext = createContext<SosContextType | null>(null);

export function SosProvider({ children }: { children: React.ReactNode }) {
  const { selectedLanguage } = useLanguage();
  const [activeTimer, setActiveTimer] = useState<SosTimerState | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [isFiring, setIsFiring] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState<{
    message: string;
    at: number;
  } | null>(null);
  const [inbox, setInbox] = useState<ReceivedSos[]>([]);
  const [sirenEnabled, setSirenEnabledState] = useState(true);
  const [sirenPlaying, setSirenPlaying] = useState(false);

  const langRef = useRef(selectedLanguage.id);
  useEffect(() => {
    langRef.current = selectedLanguage.id;
  }, [selectedLanguage.id]);

  const activeTimerRef = useRef<SosTimerState | null>(null);
  useEffect(() => {
    activeTimerRef.current = activeTimer;
  }, [activeTimer]);

  const firingRef = useRef(false);
  const sirenEnabledRef = useRef(true);
  useEffect(() => {
    sirenEnabledRef.current = sirenEnabled;
  }, [sirenEnabled]);
  // Mesh already de-dupes by id, but guard side effects (siren + heads-up)
  // against double-subscription in dev StrictMode.
  const alertedSosIdsRef = useRef(new Set<string>());

  // ---- incoming SOS inbox (structured OR legacy prefix) ----
  // New arrivals raise a heads-up notification with a "Stop siren" action
  // and loop the siren so nearby rescuers hear it.
  useEffect(
    () =>
      subscribeToBroadcasts((envelope) => {
        if (!isSosEnvelope(envelope)) return;
        const rawLat = envelope.sos?.lat;
        const rawLon = envelope.sos?.lon;
        const lat =
          typeof rawLat === 'number' && Number.isFinite(rawLat)
            ? rawLat
            : undefined;
        const lon =
          typeof rawLon === 'number' && Number.isFinite(rawLon)
            ? rawLon
            : undefined;
        setInbox((current) => {
          if (current.some((m) => m.id === envelope.id)) return current;
          return [
            {
              id: envelope.id,
              senderName: envelope.senderName,
              message: envelope.message,
              language: envelope.language,
              receivedAt: Date.now(),
              hops: hopsOf(envelope),
              isAuto:
                envelope.sos?.isAuto ??
                /missed check-in/i.test(envelope.message),
              ...(lat !== undefined ? { lat } : {}),
              ...(lon !== undefined ? { lon } : {}),
            },
            ...current,
          ].slice(0, 30);
        });
        try {
          markSosPingResolved(envelope.id);
        } catch {}
        if (alertedSosIdsRef.current.has(envelope.id)) return;
        alertedSosIdsRef.current.add(envelope.id);
        // Siren first (instant replay of preloaded sound), notification
        // second — the heads-up does sequential channel/category/schedule
        // calls that must not delay audible alert.
        if (sirenEnabledRef.current) {
          void playSosSiren();
        }
        void showSosIncoming(
          '🆘 SOS Emergency',
          `${envelope.senderName}: ${envelope.message}`.slice(0, 240),
        );
      }),
    [],
  );

  // Connectionless SOS tripwire: a ping arrives with zero GATT connect.
  // Show a provisional hint + accelerate GATT discovery so the full
  // envelope lands in ~1s. The full inbox/siren path (above) takes over
  // on arrival; pings never alert on their own.
  useEffect(
    () =>
      subscribeToSosPing((ping) => {
        console.log(
          `[SOS-Timing] ping provisional shortId=${ping.shortId} rssi=${ping.rssi}`,
        );
        setLastResult(
          '🆘 SOS detected nearby — receiving details… Keep the app open.',
        );
        try {
          void requestMeshDiscovery().catch(() => {});
        } catch {}
      }),
    [],
  );

  // "Stop siren" notification action (receiver taps it on the heads-up).
  useEffect(() => {
    try {
      void preloadSosSiren();
    } catch {}
    try {
      void ensureSosIncomingCategory();
    } catch {}
    let sub: { remove: () => void } | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications');
      sub = Notifications.addNotificationResponseReceivedListener?.(
        (response: { actionIdentifier?: string }) => {
          if (response?.actionIdentifier === SOS_STOP_SIREN_ACTION_ID) {
            void stopSosSiren();
          }
        },
      );
    } catch {}
    return () => {
      try {
        sub?.remove();
      } catch {}
    };
  }, []);

  // Persisted siren preference + live playing state for the SOS tab.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('sos:siren-enabled-v1');
        if (!cancelled && stored !== null) {
          const on = stored === '1';
          setSirenEnabledState(on);
          sirenEnabledRef.current = on;
        }
      } catch {}
    })();
    return onSirenPlayingChange((on) => {
      if (!cancelled) setSirenPlaying(on);
    });
  }, []);

  const setSirenEnabled = useCallback((on: boolean) => {
    setSirenEnabledState(on);
    sirenEnabledRef.current = on;
    try {
      void AsyncStorage.setItem('sos:siren-enabled-v1', on ? '1' : '0');
    } catch {}
    if (!on) {
      void stopSosSiren();
    }
  }, []);

  const stopSiren = useCallback(async () => {
    await stopSosSiren();
  }, []);

  const testSiren = useCallback(async () => {
    await playSosSiren();
  }, []);

  const floodSos = useCallback(
    async (
      message: string,
      sosMeta: {
        startedAt: number;
        deadlineAt: number;
        isAuto: boolean;
        workspaceLabel?: string;
        lat?: number;
        lon?: number;
      },
    ): Promise<boolean> => {
      const t0 = Date.now();
      const envelope = makeSosEnvelope({
        senderName: senderName(),
        message,
        language: langRef.current,
        sos: sosMeta,
      });
      // Connectionless tripwire first: nearby phones see SOS in <1s with
      // zero GATT connect while the full flood connects. Auto-clears.
      try {
        activateSosPing(encodeSosPingForEnvelope(envelope));
      } catch {}
      for (let attempt = 1; attempt <= RETRY_ROUNDS; attempt += 1) {
        if (attempt > 1) {
          const gap = RETRY_GAPS_MS[attempt - 1] ?? 5000;
          await new Promise((r) => setTimeout(r, gap));
        }
        try {
          const sent = await sendNearbyBroadcast(envelope);
          console.log(
            `[SOS-Timing] flood attempt=${attempt} sent=${sent} elapsedMs=${Date.now() - t0}`,
          );
          if (sent) {
            // Late-joiner waves: same id, dedup-safe. Catches peers that
            // arrived just after round 1 without blocking the caller.
            void (async () => {
              for (const gap of LATE_WAVE_GAPS_MS) {
                await new Promise((r) => setTimeout(r, gap));
                try {
                  await sendNearbyBroadcast(envelope);
                } catch {}
              }
            })();
            console.log(
              `[SOS-Timing] flood ok attempts=${attempt} totalMs=${Date.now() - t0}`,
            );
            return true;
          }
        } catch (e) {
          console.warn(`[SOS] flood attempt ${attempt} failed:`, e);
        }
      }
      console.log(`[SOS-Timing] flood failed totalMs=${Date.now() - t0}`);
      return false;
    },
    [],
  );

  const fireExpiredTimer = useCallback(
    async (timer: SosTimerState): Promise<void> => {
      if (firingRef.current) return;
      firingRef.current = true;
      setIsFiring(true);
      // Built before any await that can throw, so the SOS content is never
      // lost: even on unexpected failure the timer is cleared and the
      // message is kept as a re-sendable pending retry.
      let message: string | null = null;
      try {
        const fireT0 = Date.now();
        // Fast location: timer snapshot or module cache first (0ms), fresh
        // fix raced with a short budget — never the old 5s fire-time block.
        let lat = timer.lat;
        let lon = timer.lon;
        let locMs = 0;
        if (timer.includeLocation) {
          if (lat === undefined || lon === undefined) {
            const cached = getCachedSosLocation();
            if (cached) {
              lat = cached.lat;
              lon = cached.lon;
            }
          }
          if (lat === undefined || lon === undefined) {
            const locT0 = Date.now();
            try {
              const loc = await tryGetLocationFast(SOS_LOCATION_FAST_MS);
              if (loc) {
                lat = loc.lat;
                lon = loc.lon;
              }
            } catch {}
            locMs = Date.now() - locT0;
          }
        }
        message = buildSosHelpText({
          helpMessage: timer.helpMessage,
          workspaceLabel: timer.workspaceLabel,
          lat,
          lon,
          isAuto: true,
          startedAt: timer.startedAt,
          deadlineAt: timer.deadlineAt,
        });
        // Instant feedback: siren + sending state BEFORE awaiting the mesh.
        // A missed check-in may mean the user is incapacitated nearby;
        // noise draws rescuers even if the flood still needs seconds.
        if (sirenEnabledRef.current) {
          void playSosSiren();
        }
        setLastResult('🆘 SOS firing — broadcasting to nearby phones…');
        const floodPromise = floodSos(message, {
          startedAt: timer.startedAt,
          deadlineAt: timer.deadlineAt,
          isAuto: true,
          workspaceLabel: timer.workspaceLabel || undefined,
          lat,
          lon,
        });
        // Parallel cleanup: never gate the flood on storage/notification.
        void Promise.all([
          clearActiveTimer().catch(() => {}),
          cancelScheduled(timer.notificationIds ?? []).catch(() => {}),
          stopSosKeeper().catch(() => {}),
        ]);
        setActiveTimer(null);
        setRemainingMs(0);
        const ok = await floodPromise;
        console.log(
          `[SOS-Timing] auto-fire locMs=${locMs} totalMs=${Date.now() - fireT0} ok=${ok}`,
        );
        if (ok) {
          setLastResult(
            `🆘 SOS broadcasted at ${new Date().toLocaleTimeString()}. Nearby phones relay it further. Keep the app open.`,
          );
          setPendingRetry(null);
          await saveLastFired({ at: Date.now(), message });
        } else {
          setLastResult(
            'SOS timer expired but no nearby phones were reachable after 3 tries. Keep the app open - tap Re-send when phones are near.',
          );
          setPendingRetry({ message, at: Date.now() });
          await saveLastFired({ at: Date.now(), message });
          await showImmediate(
            '🆘 SOS not delivered',
            'No nearby phones found. Tap Re-send in the SOS tab when phones are near.',
          );
        }
      } catch (e) {
        // Never let an expired timer persist: a stuck timer + keeper
        // re-arm is exactly what caused the open-crash loop. Keep the
        // message (if built) as a manual re-send instead.
        console.warn('[SOS] fire expired timer failed:', e);
        try {
          await clearActiveTimer();
        } catch {}
        try {
          await cancelScheduled(timer.notificationIds ?? []);
        } catch {}
        try {
          await stopSosKeeper();
        } catch {}
        setActiveTimer(null);
        setRemainingMs(0);
        if (message) {
          setPendingRetry({ message, at: Date.now() });
          setLastResult(
            'SOS timer expired but auto-send failed. Tap Re-send when phones are near.',
          );
        } else {
          setLastResult('SOS timer expired.');
        }
      } finally {
        firingRef.current = false;
        setIsFiring(false);
      }
    },
    [floodSos],
  );

  const fireExpiredTimerRef = useRef(fireExpiredTimer);
  useEffect(() => {
    fireExpiredTimerRef.current = fireExpiredTimer;
  }, [fireExpiredTimer]);

  // ---- restore persisted timer (killed-app path) + register bg task ----
  // The foreground-service keeper is the primary background path: it keeps
  // the process alive so the deadline fires while backgrounded. Storage +
  // notifications remain as the reopen fallback.
  useEffect(() => {
    const removeKeeperExpire = onSosKeeperExpire(() => {
      const t = activeTimerRef.current;
      if (t && Date.now() >= t.deadlineAt) {
        void fireExpiredTimerRef.current(t);
      }
    });
    let cancelled = false;
    (async () => {
      try {
        await registerSosBackgroundTask();
      } catch {}
      let stored: SosTimerState | null = null;
      try {
        stored = await loadActiveTimer();
      } catch {
        stored = null;
      }
      if (cancelled || !stored) return;
      if (Date.now() >= stored.deadlineAt) {
        // Expired while dead -> fire immediately on launch.
        // fireExpiredTimer always clears the timer, even on failure, so a
        // broken fire path can never wedge the app into a crash loop.
        try {
          await fireExpiredTimerRef.current(stored);
        } catch (e) {
          console.warn('[SOS] restore fire failed:', e);
          try {
            await clearActiveTimer();
          } catch {}
        }
        return;
      }
      setActiveTimer(stored);
      setRemainingMs(stored.deadlineAt - Date.now());
      // Re-arm the keeper after a restart so background firing keeps
      // working - BUT only when this install has already run it
      // successfully and the last attempt wasn't fatal. A broken native
      // service config (e.g. stale android/ prebuild without the
      // specialUse declaration) crashes the process on start; auto
      // re-arming it on every cold start is what made the app
      // un-openable until the timer expired. Deferred past first render
      // so startup UI is never blocked by it either.
      const snapshot = stored;
      setTimeout(() => {
        if (cancelled) return;
        void (async () => {
          try {
            const [knownGood, fatal] = await Promise.all([
              isKeeperKnownGood(),
              wasLastKeeperStartFatal(),
            ]);
            if (cancelled) return;
            if (!knownGood || fatal) {
              if (fatal) {
                setLastResult(
                  'Background keeper unavailable on this build - timer still counts down while the app is open. Re-arm the timer after updating the app to restore background firing.',
                );
              }
              return;
            }
            await startSosKeeper({
              deadlineAt: snapshot.deadlineAt,
              workspaceLabel: snapshot.workspaceLabel,
            });
          } catch {}
        })();
      }, 2000);
    })();
    // Tapping the deadline notification re-opens the app - re-check expiry.
    // Also handles the "Stop siren" action as a fallback.
    let sub: { remove: () => void } | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications');
      sub = Notifications.addNotificationResponseReceivedListener?.(
        (response: { actionIdentifier?: string }) => {
          if (response?.actionIdentifier === SOS_STOP_SIREN_ACTION_ID) {
            void stopSosSiren();
            return;
          }
          const t = activeTimerRef.current;
          if (t && Date.now() >= t.deadlineAt) {
            void fireExpiredTimerRef.current(t);
          }
        },
      );
    } catch {}
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const t = activeTimerRef.current;
        if (t && Date.now() >= t.deadlineAt) {
          void fireExpiredTimerRef.current(t);
        }
      }
    });
    return () => {
      cancelled = true;
      try {
        removeKeeperExpire();
      } catch {}
      try {
        sub?.remove();
      } catch {}
      appSub.remove();
    };
  }, []);

  // ---- foreground tick + exact deadline timeout ----
  // 1s interval drives the countdown UI; an exact timeout removes the
  // 0-1s poll jitter so auto-fire starts within ms of the deadline.
  useEffect(() => {
    if (!activeTimer) return;
    const tick = () => {
      const left = activeTimer.deadlineAt - Date.now();
      setRemainingMs(Math.max(0, left));
      if (left <= 0) {
        void fireExpiredTimerRef.current(activeTimer);
      }
    };
    tick();
    const interval = setInterval(tick, 1000);
    const msToDeadline = activeTimer.deadlineAt - Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (msToDeadline > 0 && msToDeadline < 24 * 60 * 60 * 1000) {
      timeout = setTimeout(() => {
        void fireExpiredTimerRef.current(activeTimer);
      }, msToDeadline);
    }
    return () => {
      clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
  }, [activeTimer]);

  // ---- deadline warm-up ----
  // While a timer is armed, keep the BLE mesh warm so the deadline flood
  // transmits instantly. Aggressive only in the final 5 min to save radio.
  useEffect(() => {
    if (!activeTimer) return;
    const id = setInterval(() => {
      const t = activeTimerRef.current;
      if (!t) return;
      const msLeft = t.deadlineAt - Date.now();
      if (msLeft <= 0 || msLeft > 5 * 60 * 1000) return;
      try {
        void requestMeshDiscovery().catch(() => {});
      } catch {}
    }, 30000);
    return () => clearInterval(id);
  }, [activeTimer]);

  const startTimer = useCallback(
    async (input: {
      durationMs: number;
      helpMessage: string;
      workspaceLabel: string;
      includeLocation: boolean;
    }) => {
      // Cancel any previous timer first.
      const prev = activeTimerRef.current;
      if (prev) {
        await cancelScheduled(prev.notificationIds ?? []);
      }
      // Clamp defensively: a NaN/Infinity duration would persist a
      // never-firing timer and feed NaN into the countdown UI.
      const safeDurationMs = Number.isFinite(input.durationMs)
        ? Math.min(24 * 60 * 60 * 1000, Math.max(60 * 1000, input.durationMs))
        : 60 * 1000;
      const startedAt = Date.now();
      const deadlineAt = startedAt + safeDurationMs;
      // Arm instantly: location fetch (up to 5s) used to block the tap, so a
      // single press felt dead and users had to leave/reopen to see the
      // timer. Persist + publish the timer first, then patch location in
      // the background. Fire-time refresh (fireExpiredTimer) remains the
      // primary location source, so this snapshot is only a fallback.
      // Schedule OS notifications BEFORE persisting so a kill right after
      // Start still leaves warnings + deadline alert behind.
      const notificationIds = await scheduleTimerNotifications({
        deadlineAt,
        durationMs: deadlineAt - startedAt,
        workspaceLabel: input.workspaceLabel,
      });
      const timer: SosTimerState = {
        id: makeId(),
        startedAt,
        deadlineAt,
        durationMs: deadlineAt - startedAt,
        helpMessage: (input.helpMessage ?? '').trim(),
        workspaceLabel: (input.workspaceLabel ?? '').trim(),
        includeLocation: input.includeLocation,
        lat: undefined,
        lon: undefined,
        notificationIds,
      };
      await saveActiveTimer(timer);
      setActiveTimer(timer);
      setRemainingMs(timer.deadlineAt - Date.now());
      // Pre-warm everything the fire path needs: siren sound, location
      // permission, and BLE discovery — so deadline work is instant.
      try {
        preloadSosSiren();
      } catch {}
      if (input.includeLocation) {
        try {
          void ensureSosLocationPermission().catch(() => {});
        } catch {}
      }
      try {
        void requestMeshDiscovery().catch(() => {});
      } catch {}
      // Foreground service: keeps the countdown + BLE flood alive while
      // backgrounded so the deadline fires without reopening the app.
      const keeperOk = await startSosKeeper({
        deadlineAt,
        workspaceLabel: timer.workspaceLabel,
      }).catch(() => false);
      setLastResult(
        keeperOk
          ? `Timer armed - SOS auto-sends at ${new Date(deadlineAt).toLocaleTimeString()} unless you tap I'm Safe. Keep the "SOS timer armed" notification.`
          : `Timer armed - SOS auto-sends at ${new Date(deadlineAt).toLocaleTimeString()} unless you tap I'm Safe. (Background keeper unavailable - keep app open or tap the deadline notification.)`,
      );
      setPendingRetry(null);
      // Background location patch (SOS-only location): only applies while
      // this same timer is still active. Short budget — fire-time refresh
      // (tryGetLocationFast) is the primary source now.
      if (input.includeLocation) {
        try {
          const loc = await tryGetLocationFast(4000);
          if (loc && activeTimerRef.current?.id === timer.id) {
            const patched: SosTimerState = {
              ...timer,
              lat: loc.lat,
              lon: loc.lon,
            };
            await saveActiveTimer(patched);
            setActiveTimer(patched);
          }
        } catch {}
      }
    },
    [],
  );

  const cancelTimer = useCallback(async () => {
    const t = activeTimerRef.current;
    if (t) await cancelScheduled(t.notificationIds ?? []);
    await stopSosKeeper().catch(() => {});
    await clearActiveTimer();
    setActiveTimer(null);
    setRemainingMs(0);
    setLastResult("You're safe - timer cancelled, no SOS sent.");
  }, []);

  const extendTimer = useCallback(async (extraMs: number) => {
    const t = activeTimerRef.current;
    if (!t) return;
    await cancelScheduled(t.notificationIds ?? []);
    const deadlineAt = t.deadlineAt + extraMs;
    const notificationIds = await scheduleTimerNotifications({
      deadlineAt,
      durationMs: deadlineAt - t.startedAt,
      workspaceLabel: t.workspaceLabel,
    });
    const next: SosTimerState = {
      ...t,
      deadlineAt,
      durationMs: deadlineAt - t.startedAt,
      notificationIds,
    };
    await saveActiveTimer(next);
    setActiveTimer(next);
    setRemainingMs(deadlineAt - Date.now());
    void startSosKeeper({
      deadlineAt,
      workspaceLabel: next.workspaceLabel,
    }).catch(() => {});
    setLastResult(
      `Extended +${Math.round(extraMs / 60000)} min - new deadline ${new Date(deadlineAt).toLocaleTimeString()}.`,
    );
  }, []);

  const sendManualSos = useCallback(
    async (helpMessage: string, includeLocation: boolean): Promise<boolean> => {
      const tapT0 = Date.now();
      setIsFiring(true);
      setLastResult('🆘 Sending SOS to nearby phones…');
      try {
        // Fast location: cached fix first, fresh fix raced with a short
        // budget — never the old 5s tap-time block.
        let lat: number | undefined;
        let lon: number | undefined;
        if (includeLocation) {
          const cached = getCachedSosLocation();
          if (cached) {
            lat = cached.lat;
            lon = cached.lon;
          } else {
            try {
              const loc = await tryGetLocationFast(SOS_LOCATION_FAST_MS);
              if (loc) {
                lat = loc.lat;
                lon = loc.lon;
              }
            } catch {}
          }
        }
        const locMs = Date.now() - tapT0;
        const now = Date.now();
        const message = buildSosHelpText({
          helpMessage,
          workspaceLabel: '',
          lat,
          lon,
          isAuto: false,
          startedAt: now,
          deadlineAt: now,
        });
        const ok = await floodSos(message, {
          startedAt: now,
          deadlineAt: now,
          isAuto: false,
          lat,
          lon,
        });
        console.log(
          `[SOS-Timing] manual tap locMs=${locMs} totalMs=${Date.now() - tapT0} ok=${ok}`,
        );
        if (ok) {
          setLastResult(
            `🆘 SOS sent at ${new Date().toLocaleTimeString()}. Nearby phones relay it further. Keep the app open.`,
          );
          setPendingRetry(null);
          await saveLastFired({ at: now, message });
        } else {
          setLastResult(
            'No nearby phones reachable after 3 tries. Tap Re-send when phones are near.',
          );
          setPendingRetry({ message, at: now });
        }
        return ok;
      } finally {
        setIsFiring(false);
      }
    },
    [floodSos],
  );

  const retryPendingSos = useCallback(async (): Promise<boolean> => {
    const pending = pendingRetry;
    if (!pending) return false;
    setIsFiring(true);
    try {
      const now = Date.now();
      const ok = await floodSos(pending.message, {
        startedAt: now,
        deadlineAt: now,
        isAuto: true,
      });
      if (ok) {
        setLastResult(
          `🆘 SOS re-sent at ${new Date().toLocaleTimeString()}. Keep the app open.`,
        );
        setPendingRetry(null);
      } else {
        setLastResult(
          'Still no nearby phones. Keep the app open and try Re-send again.',
        );
      }
      return ok;
    } finally {
      setIsFiring(false);
    }
  }, [floodSos, pendingRetry]);

  const clearInbox = useCallback(() => setInbox([]), []);
  const clearResult = useCallback(() => setLastResult(null), []);

  const value = useMemo<SosContextType>(
    () => ({
      activeTimer,
      remainingMs,
      isFiring,
      lastResult,
      pendingRetry,
      inbox,
      startTimer,
      cancelTimer,
      extendTimer,
      sendManualSos,
      retryPendingSos,
      clearInbox,
      clearResult,
      sirenEnabled,
      setSirenEnabled,
      sirenPlaying,
      stopSiren,
      testSiren,
    }),
    [
      activeTimer,
      remainingMs,
      isFiring,
      lastResult,
      pendingRetry,
      inbox,
      startTimer,
      cancelTimer,
      extendTimer,
      sendManualSos,
      retryPendingSos,
      clearInbox,
      clearResult,
      sirenEnabled,
      setSirenEnabled,
      sirenPlaying,
      stopSiren,
      testSiren,
    ],
  );

  return <SosContext.Provider value={value}>{children}</SosContext.Provider>;
}

export function useSos(): SosContextType {
  const ctx = useContext(SosContext);
  if (!ctx) throw new Error('useSos must be used inside SosProvider');
  return ctx;
}
