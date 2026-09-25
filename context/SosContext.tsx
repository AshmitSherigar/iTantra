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
  getEnvelopeTtl,
  isSosEnvelope,
  makeSosEnvelope,
  sendNearbyBroadcast,
  subscribeToBroadcasts,
} from '../features/bluetooth';
import type { BroadcastEnvelope } from '../features/bluetooth';
import { useLanguage } from './LanguageContext';
import {
  SOS_STOP_SIREN_ACTION_ID,
  buildSosHelpText,
  cancelScheduled,
  clearActiveTimer,
  ensureSosIncomingCategory,
  isKeeperKnownGood,
  loadActiveTimer,
  registerSosBackgroundTask,
  saveActiveTimer,
  saveLastFired,
  scheduleTimerNotifications,
  showImmediate,
  showSosIncoming,
  tryGetLocation,
  wasLastKeeperStartFatal,
} from '../features/sos';
import {
  onSirenPlayingChange,
  playSosSiren,
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
 * Retry policy (chosen): 3 flood rounds, 8s apart. Each round already
 * scans + settles + transmits via AndroidNearbyBroadcastRuntime. If all 3
 * fail (no peers), the SOS is kept as `pendingRetry` with the exact
 * message so the user can one-tap re-send when phones are near.
 */

const RETRY_ROUNDS = 3;
const RETRY_GAP_MS = 8000;

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
        if (alertedSosIdsRef.current.has(envelope.id)) return;
        alertedSosIdsRef.current.add(envelope.id);
        void showSosIncoming(
          '🆘 SOS Emergency',
          `${envelope.senderName}: ${envelope.message}`.slice(0, 240),
        );
        if (sirenEnabledRef.current) {
          void playSosSiren();
        }
      }),
    [],
  );

  // "Stop siren" notification action (receiver taps it on the heads-up).
  useEffect(() => {
    try {
      void ensureSosIncomingCategory();
    } catch {}
    let sub: { remove: () => void } | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications');
      sub = Notifications.addNotificationResponseReceivedListener?.(
        (response: { actionIdentifier?: string }) => {
          if (
            response?.actionIdentifier === SOS_STOP_SIREN_ACTION_ID
          ) {
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
      const envelope = makeSosEnvelope({
        senderName: senderName(),
        message,
        language: langRef.current,
        sos: sosMeta,
      });
      for (let attempt = 1; attempt <= RETRY_ROUNDS; attempt += 1) {
        try {
          const sent = await sendNearbyBroadcast(envelope);
          if (sent) return true;
        } catch (e) {
          console.warn(`[SOS] flood attempt ${attempt} failed:`, e);
        }
        if (attempt < RETRY_ROUNDS) {
          await new Promise((r) => setTimeout(r, RETRY_GAP_MS));
        }
      }
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
        // Refresh location at fire time when the user opted in.
        let lat = timer.lat;
        let lon = timer.lon;
        if (timer.includeLocation) {
          try {
            const loc = await tryGetLocation(5000);
            if (loc) {
              lat = loc.lat;
              lon = loc.lon;
            }
          } catch {}
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
        const ok = await floodSos(message, {
          startedAt: timer.startedAt,
          deadlineAt: timer.deadlineAt,
          isAuto: true,
          workspaceLabel: timer.workspaceLabel || undefined,
          lat,
          lon,
        });
        await clearActiveTimer();
        await cancelScheduled(timer.notificationIds ?? []);
        await stopSosKeeper().catch(() => {});
        setActiveTimer(null);
        setRemainingMs(0);
        // Sound the siren on the sender's phone too — a missed check-in
        // means the user may be incapacitated nearby; noise draws rescuers.
        if (sirenEnabledRef.current) {
          void playSosSiren();
        }
        if (ok) {
          setLastResult(
            `🆘 SOS broadcasted at ${new Date().toLocaleTimeString()}. Nearby phones relay it further. Keep the app open.`,
          );
          setPendingRetry(null);
          await saveLastFired({ at: Date.now(), message });
        } else {
          setLastResult(
            'SOS timer expired but no nearby phones were reachable after 3 tries. Keep the app open — tap Re-send when phones are near.',
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
        // Expired while dead → fire immediately on launch.
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
      // working — BUT only when this install has already run it
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
                  'Background keeper unavailable on this build — timer still counts down while the app is open. Re-arm the timer after updating the app to restore background firing.',
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
    // Tapping the deadline notification re-opens the app — re-check expiry.
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

  // ---- foreground tick ----
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
    const id = setInterval(tick, 1000);
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
      let lat: number | undefined;
      let lon: number | undefined;
      if (input.includeLocation) {
        try {
          const loc = await tryGetLocation(5000);
          if (loc) {
            lat = loc.lat;
            lon = loc.lon;
          }
        } catch {}
      }
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
        lat,
        lon,
        notificationIds,
      };
      await saveActiveTimer(timer);
      setActiveTimer(timer);
      setRemainingMs(timer.deadlineAt - Date.now());
      // Foreground service: keeps the countdown + BLE flood alive while
      // backgrounded so the deadline fires without reopening the app.
      const keeperOk = await startSosKeeper({
        deadlineAt,
        workspaceLabel: timer.workspaceLabel,
      }).catch(() => false);
      setLastResult(
        keeperOk
          ? `Timer armed — SOS auto-sends at ${new Date(deadlineAt).toLocaleTimeString()} unless you tap I'm Safe. Keep the "SOS timer armed" notification.`
          : `Timer armed — SOS auto-sends at ${new Date(deadlineAt).toLocaleTimeString()} unless you tap I'm Safe. (Background keeper unavailable — keep app open or tap the deadline notification.)`,
      );
      setPendingRetry(null);
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
    setLastResult("You're safe — timer cancelled, no SOS sent.");
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
      `Extended +${Math.round(extraMs / 60000)} min — new deadline ${new Date(deadlineAt).toLocaleTimeString()}.`,
    );
  }, []);

  const sendManualSos = useCallback(
    async (helpMessage: string, includeLocation: boolean): Promise<boolean> => {
      setIsFiring(true);
      try {
        let lat: number | undefined;
        let lon: number | undefined;
        if (includeLocation) {
          try {
            const loc = await tryGetLocation(5000);
            if (loc) {
              lat = loc.lat;
              lon = loc.lon;
            }
          } catch {}
        }
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
