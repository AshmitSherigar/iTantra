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
 */

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
      | { start?: unknown }
      | undefined;
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
  // slow enough to sip battery over an 8h shift.
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
    await sleep(4000);
  }
}

export function isSosKeeperRunning(): boolean {
  try {
    return !!BG?.isRunning();
  } catch {
    return false;
  }
}

export async function startSosKeeper(input: {
  deadlineAt: number;
  workspaceLabel: string;
}): Promise<boolean> {
  if (!BG || !hasKeeperNativeModule()) {
    console.warn('[SOS] keeper native module missing — keeper disabled');
    return false;
  }
  const when = new Date(input.deadlineAt).toLocaleTimeString();
  const work = (input.workspaceLabel ?? '').trim();
  const desc = `Auto-SOS at ${when}${work ? ` (${work})` : ''}. Tap to open.`;
  try {
    if (BG.isRunning()) {
      try {
        await BG.updateNotification({
          taskTitle: '🆘 SOS timer armed',
          taskDesc: desc,
        });
      } catch {}
      return true;
    }
    await BG.start(keeperTask, {
      taskName: 'VaaniSetu SOS timer',
      taskTitle: '🆘 SOS timer armed',
      taskDesc: desc,
      taskIcon: { name: 'ic_launcher', type: 'mipmap' },
      color: '#DC2626',
      linkingURI: 'lowlatencysttapp://',
      // Required on Android 14+: startForeground() with no type throws
      // MissingForegroundServiceTypeException and the app closes.
      foregroundServiceType: ['specialUse'],
      parameters: { deadlineAt: input.deadlineAt },
    });
    return true;
  } catch (e) {
    console.warn('[SOS] keeper start failed:', e);
    return false;
  }
}

export async function stopSosKeeper(): Promise<void> {
  try {
    if (BG?.isRunning()) await BG.stop();
  } catch (e) {
    console.warn('[SOS] keeper stop failed:', e);
  }
}
