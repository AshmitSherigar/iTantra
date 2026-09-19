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
  buildSosHelpText,
  cancelScheduled,
  clearActiveTimer,
  loadActiveTimer,
  registerSosBackgroundTask,
  saveActiveTimer,
  saveLastFired,
  scheduleTimerNotifications,
  showImmediate,
  tryGetLocation,
} from '../features/sos';
import {
  onSosKeeperExpire,
  startSosKeeper,
  stopSosKeeper,
} from '../features/sos/keeper';
import type { ReceivedSos, SosTimerState } from '../features/sos';

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
  return (
    Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu'
  );
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
  sendManualSos: (helpMessage: string, includeLocation: boolean) => Promise<boolean>;
  retryPendingSos: () => Promise<boolean>;
  clearInbox: () => void;
  clearResult: () => void;
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

  const langRef = useRef(selectedLanguage.id);
  useEffect(() => {
    langRef.current = selectedLanguage.id;
  }, [selectedLanguage.id]);

  const activeTimerRef = useRef<SosTimerState | null>(null);
  useEffect(() => {
    activeTimerRef.current = activeTimer;
  }, [activeTimer]);

  const firingRef = useRef(false);

  // ---- incoming SOS inbox (structured OR legacy prefix) ----
  useEffect(
    () =>
      subscribeToBroadcasts((envelope) => {
        if (!isSosEnvelope(envelope)) return;
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
              isAuto: envelope.sos?.isAuto ?? /missed check-in/i.test(envelope.message),
            },
            ...current,
          ].slice(0, 30);
        });
      }),
    [],
  );

  const floodSos = useCallback(
    async (message: string, sosMeta: { startedAt: number; deadlineAt: number; isAuto: boolean; workspaceLabel?: string; lat?: number; lon?: number }): Promise<boolean> => {
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
        const message = buildSosHelpText({
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
        if (ok) {
          setLastResult(`🆘 SOS broadcasted at ${new Date().toLocaleTimeString()}. Nearby phones relay it further.`);
          setPendingRetry(null);
          await saveLastFired({ at: Date.now(), message });
        } else {
          setLastResult('SOS timer expired but no nearby phones were reachable after 3 tries. Keep the app open — tap Re-send when phones are near.');
          setPendingRetry({ message, at: Date.now() });
          await saveLastFired({ at: Date.now(), message });
          await showImmediate('🆘 SOS not delivered', 'No nearby phones found. Tap Re-send in the SOS tab when phones are near.');
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
      void registerSosBackgroundTask().catch(() => {});
      const stored = await loadActiveTimer();
      if (cancelled || !stored) return;
      if (Date.now() >= stored.deadlineAt) {
        // Expired while dead → fire immediately on launch.
        await fireExpiredTimerRef.current(stored);
      } else {
        setActiveTimer(stored);
        setRemainingMs(stored.deadlineAt - Date.now());
        // Re-arm the keeper after a restart so background firing keeps working.
        void startSosKeeper({
          deadlineAt: stored.deadlineAt,
          workspaceLabel: stored.workspaceLabel,
        }).catch(() => {});
      }
    })();
    // Tapping the deadline notification re-opens the app — re-check expiry.
    let sub: { remove: () => void } | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications');
      sub = Notifications.addNotificationResponseReceivedListener?.(() => {
        const t = activeTimerRef.current;
        if (t && Date.now() >= t.deadlineAt) {
          void fireExpiredTimerRef.current(t);
        }
      });
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
      const startedAt = Date.now();
      const deadlineAt = startedAt + Math.max(60 * 1000, input.durationMs);
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
    void startSosKeeper({ deadlineAt, workspaceLabel: next.workspaceLabel }).catch(() => {});
    setLastResult(`Extended +${Math.round(extraMs / 60000)} min — new deadline ${new Date(deadlineAt).toLocaleTimeString()}.`);
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
          setLastResult(`🆘 SOS sent at ${new Date().toLocaleTimeString()}. Nearby phones relay it further.`);
          setPendingRetry(null);
          await saveLastFired({ at: now, message });
        } else {
          setLastResult('No nearby phones reachable after 3 tries. Tap Re-send when phones are near.');
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
        setLastResult(`🆘 SOS re-sent at ${new Date().toLocaleTimeString()}.`);
        setPendingRetry(null);
      } else {
        setLastResult('Still no nearby phones. Keep the app open and try Re-send again.');
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
    ],
  );

  return <SosContext.Provider value={value}>{children}</SosContext.Provider>;
}

export function useSos(): SosContextType {
  const ctx = useContext(SosContext);
  if (!ctx) throw new Error('useSos must be used inside SosProvider');
  return ctx;
}
