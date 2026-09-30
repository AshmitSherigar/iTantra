import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Foreground-service keeper for the SOS timer.
 *
 * Why this exists: a plain JS `setInterval` stops firing minutes after the
 * app goes to background (Doze / app-standby), and `BackgroundFetch` only
 * runs ~every 15 min — so an SOS deadline used to fire only when the user
 * re-opened the app. A foreground service raises the process to foreground
 * priority with a persistent "SOS timer armed" notification, so:
 *  1. the OS does not throttle/kill our countdown, and
 *  2. this keeper's own 4s poll loop fires the SOS flood over BLE even
 *     while the screen is off / app is backgrounded.
 *
 * All functions are safe no-ops when `react-native-background-actions`
 * isn't available (web / Expo Go) — the old notification-tap fallback
 * in notify.ts / background.ts still applies.
 *
 * Crash-safety (read this before touching start logic):
 * `BG.start()` resolves in JS *before* Android actually launches the
 * service, so a broken native config (stale `android/` prebuild without
 * the `specialUse` service declaration/permission → e.g.
 * MissingForegroundServiceTypeException on API 34+) kills the process
 * AFTER the promise resolves — a JS try/catch cannot prevent it. Two
 * mechanisms keep that from becoming a crash-LOOP:
 *  1. KEEPER_ATTEMPT_KEY is written BEFORE native start and cleared only
 *     after a survival heartbeat. If the process died, the flag is still
 *     there on next launch → wasLastKeeperStartFatal() is true.
 *  2. SosContext only auto re-arms the keeper on cold start when
 *     isKeeperKnownGood() (a previous start survived on THIS install) and
 *     the last attempt wasn't fatal. Otherwise the timer is restored
 *     without the keeper and the app stays openable/cancellable.
 */

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Written before native start, cleared after the service survives. */
const KEEPER_ATTEMPT_KEY = 'sos:keeper-attempt-v1';
/** Set once a keeper start has survived its heartbeat on this install. */
const KEEPER_KNOWN_GOOD_KEY = 'sos:keeper-known-good-v1';
/** A stale attempt flag older than this is ignored (timer max is 24h). */
const ATTEMPT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
/** How long the service must stay alive to count as a good start. */
const SURVIVAL_HEARTBEAT_MS = 8000;

type BGActions = typeof import('react-native-background-actions').default;

let BG: BGActions | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BG = require('react-native-background-actions').default ?? null;
} catch {
  BG = null;
}

/**
 * True only when the native service module is linked into this build.
 * Guards old builds (pre-keeper) so we skip native instead of crashing.
 */
function hasKeeperNativeModule(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NativeModules } = require('react-native');
    const native = NativeModules?.RNBackgroundActions as
      { start?: unknown } | undefined;
    return !!native && typeof native.start === 'function';
  } catch {
    return false;
  }
}

const expireListeners = new Set<() => void>();

export function onSosKeeperExpire(listener: () => void): () => void {
  expireListeners.add(listener);
  return () => {
    expireListeners.delete(listener);
  };
}

function notifyExpired(): void {
  expireListeners.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[SOS] keeper expire listener failed:', e);
    }
  });
}

async function keeperTask(taskData?: { deadlineAt?: number }): Promise<void> {
  const deadline = taskData?.deadlineAt ?? 0;
  // Poll fast enough that SOS fires within seconds of the deadline,
  // slow enough to sip battery over an 8h shift. Tighten to 1s in the
  // final minute so background trigger jitter drops from 0-4s to 0-1s.
  for (;;) {
    try {
      if (!BG?.isRunning()) return;
    } catch {
      return;
    }
    if (deadline > 0 && Date.now() >= deadline) {
      notifyExpired();
      return;
    }
    const msLeft =
      deadline > 0 ? deadline - Date.now() : Number.MAX_SAFE_INTEGER;
    await sleep(msLeft < 60 * 1000 ? 1000 : 4000);
  }
}

export function isSosKeeperRunning(): boolean {
  try {
    return !!BG?.isRunning();
  } catch {
    return false;
  }
}

/**
 * True when a previous keeper start likely killed the process: the
 * pre-start attempt flag is still present and fresh. Callers must skip
 * native start in that case (safe mode) instead of crash-looping.
 */
export async function wasLastKeeperStartFatal(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(KEEPER_ATTEMPT_KEY);
    if (!raw) return false;
    const at = Number(raw);
    if (!Number.isFinite(at)) {
      await AsyncStorage.removeItem(KEEPER_ATTEMPT_KEY).catch(() => {});
      return false;
    }
    if (Date.now() - at > ATTEMPT_MAX_AGE_MS) {
      await AsyncStorage.removeItem(KEEPER_ATTEMPT_KEY).catch(() => {});
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** True once a keeper start has survived on this install/build. */
export async function isKeeperKnownGood(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEEPER_KNOWN_GOOD_KEY)) === '1';
  } catch {
    return false;
  }
}

async function markKeeperAttempt(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEEPER_ATTEMPT_KEY, String(Date.now()));
  } catch {}
}

async function clearKeeperAttempt(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEEPER_ATTEMPT_KEY);
  } catch {}
}

async function markKeeperKnownGood(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEEPER_KNOWN_GOOD_KEY, '1');
    await AsyncStorage.removeItem(KEEPER_ATTEMPT_KEY);
  } catch {}
}

// Single-flight so concurrent Start/Extend taps can't double-start.
// The stored promise never rejects (resolves false on any failure).
let startInflight: Promise<boolean> | null = null;
// Deadline the currently-running keeper task is polling. The native task
// captures its deadline at start, so a new/extended deadline needs a
// restart — a notification update alone would leave the old countdown.
let runningKeeperDeadline = 0;

function scheduleSurvivalHeartbeat(): void {
  setTimeout(() => {
    try {
      if (BG?.isRunning()) {
        void markKeeperKnownGood();
      }
    } catch {}
  }, SURVIVAL_HEARTBEAT_MS);
}

export async function startSosKeeper(input: {
  deadlineAt: number;
  workspaceLabel: string;
}): Promise<boolean> {
  if (!BG || !hasKeeperNativeModule()) {
    console.warn('[SOS] keeper native module missing — keeper disabled');
    return false;
  }
  if (!Number.isFinite(input.deadlineAt) || input.deadlineAt <= Date.now()) {
    return false;
  }
  if (startInflight) return startInflight;
  startInflight = doStartSosKeeper(input).finally(() => {
    startInflight = null;
  });
  return startInflight;
}

async function doStartSosKeeper(input: {
  deadlineAt: number;
  workspaceLabel: string;
}): Promise<boolean> {
  const when = new Date(input.deadlineAt).toLocaleTimeString();
  const work = (input.workspaceLabel ?? '').trim();
  const desc = `Auto-SOS at ${when}${work ? ` (${work})` : ''}. Tap to open.`;
  try {
    if (BG!.isRunning()) {
      if (runningKeeperDeadline === input.deadlineAt) {
        try {
          await BG!.updateNotification({
            taskTitle: '🆘 SOS timer armed',
            taskDesc: desc,
          });
        } catch {}
        // A running service proves this build's native config works.
        await clearKeeperAttempt();
        return true;
      }
      // Deadline changed (extend / re-arm) but the running task still
      // polls the old one — restart so the new deadline is honoured.
      try {
        await BG!.stop();
      } catch {}
      runningKeeperDeadline = 0;
    }
    // Don't re-attempt a start that previously killed the process.
    // (The flag survives because the crash happens after JS resolves.)
    if (await wasLastKeeperStartFatal()) {
      console.warn(
        '[SOS] keeper skipped — previous start was fatal (safe mode)',
      );
      return false;
    }
    // Record the attempt BEFORE native start: if the service config in
    // this build is broken (stale prebuild without the specialUse
    // declaration), the process dies here and the flag breaks the loop.
    await markKeeperAttempt();
    await BG!.start(keeperTask, {
      taskName: 'VaaniSetu SOS timer',
      taskTitle: '🆘 SOS timer armed',
      taskDesc: desc,
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#DC2626',
      linkingURI: 'lowlatencysttapp://',
      // Required on Android 14+: startForeground() with no type throws
      // MissingForegroundServiceTypeException and the app closes.
      // NOTE: this needs the manifest entry + FOREGROUND_SERVICE_SPECIAL_USE
      // permission from plugins/withSosForegroundService (applied on
      // prebuild). A stale android/ without them crashes AFTER this
      // resolves — hence the attempt flag above.
      foregroundServiceType: ['specialUse'],
      parameters: { deadlineAt: input.deadlineAt },
    });
    runningKeeperDeadline = input.deadlineAt;
    scheduleSurvivalHeartbeat();
    // If already proven good on this build, a survived start is near
    // certain — clear a stale flag immediately; the heartbeat confirms.
    if (Platform.OS !== 'android' || (await isKeeperKnownGood())) {
      await clearKeeperAttempt();
    }
    return true;
  } catch (e) {
    console.warn('[SOS] keeper start failed:', e);
    runningKeeperDeadline = 0;
    return false;
  }
}

export async function stopSosKeeper(): Promise<void> {
  try {
    if (BG?.isRunning()) await BG.stop();
  } catch (e) {
    console.warn('[SOS] keeper stop failed:', e);
  } finally {
    runningKeeperDeadline = 0;
    // Explicit stop means no fatal loop is in progress.
    await clearKeeperAttempt();
  }
}
