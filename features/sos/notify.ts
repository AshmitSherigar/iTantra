/**
 * Local-notification scheduling for the SOS timer.
 * All functions are safe no-ops when expo-notifications is missing
 * (e.g. web) — the in-app countdown + restore-on-launch still work.
 */

let NotificationsRef: typeof import('expo-notifications') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  NotificationsRef = require('expo-notifications');
} catch {
  NotificationsRef = null;
}

export async function ensureSosNotificationChannel(): Promise<void> {
  try {
    if (!NotificationsRef?.setNotificationChannelAsync) return;
    await NotificationsRef.setNotificationChannelAsync('sos', {
      name: 'SOS alerts',
      importance: NotificationsRef.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#DC2626',
    });
  } catch {}
}

export async function requestSosNotificationPermission(): Promise<boolean> {
  try {
    if (!NotificationsRef) return false;
    const current = await NotificationsRef.getPermissionsAsync();
    if (current.granted) return true;
    const next = await NotificationsRef.requestPermissionsAsync();
    return !!next.granted;
  } catch {
    return false;
  }
}

/** Schedule a one-shot local notification at an absolute epoch-ms time. */
export async function scheduleAt(
  epochMs: number,
  title: string,
  body: string,
): Promise<string | null> {
  try {
    if (!NotificationsRef) return null;
    const now = Date.now();
    const seconds = Math.max(1, Math.round((epochMs - now) / 1000));
    const id = await NotificationsRef.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: true,
        priority: NotificationsRef.AndroidNotificationPriority.MAX,
      },
      // SDK 54 trigger form: { type: 'timeInterval', seconds }.
      trigger: { type: 'timeInterval', seconds, repeats: false } as never,
    });
    return id;
  } catch (e) {
    console.warn('[SOS] schedule notification failed:', e);
    return null;
  }
}

export async function cancelScheduled(
  ids: (string | null | undefined)[],
): Promise<void> {
  try {
    if (!NotificationsRef) return;
    await Promise.all(
      (ids ?? [])
        .filter(Boolean)
        .map((id) =>
          NotificationsRef!
            .cancelScheduledNotificationAsync(id as string)
            .catch(() => {}),
        ),
    );
  } catch {}
}

/** Category + action ids for the incoming-SOS notification. */
export const SOS_INCOMING_CATEGORY_ID = 'sos-incoming';
export const SOS_STOP_SIREN_ACTION_ID = 'STOP_SIREN';

/** Registers the "Stop siren" action button (Android + iOS). Safe no-op on web. */
export async function ensureSosIncomingCategory(): Promise<void> {
  try {
    if (!NotificationsRef?.setNotificationCategoryAsync) return;
    await NotificationsRef.setNotificationCategoryAsync(
      SOS_INCOMING_CATEGORY_ID,
      [
        {
          identifier: SOS_STOP_SIREN_ACTION_ID,
          buttonTitle: 'Stop siren',
          options: { opensAppToForeground: false },
        },
      ] as never,
    );
  } catch {}
}

export async function showImmediate(
  title: string,
  body: string,
  options?: { categoryIdentifier?: string; sound?: boolean },
): Promise<void> {
  try {
    if (!NotificationsRef) return;
    if (options?.categoryIdentifier) {
      await ensureSosIncomingCategory();
    }
    await NotificationsRef.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: options?.sound ?? true,
        priority: NotificationsRef?.AndroidNotificationPriority?.MAX,
        ...(options?.categoryIdentifier
          ? { categoryIdentifier: options.categoryIdentifier }
          : {}),
      },
      trigger: null,
    });
  } catch {}
}

/** Incoming SOS heads-up: siren is the alert, notification carries Stop action. */
export async function showSosIncoming(title: string, body: string): Promise<void> {
  await ensureSosNotificationChannel();
  await ensureSosIncomingCategory();
  await showImmediate(title, body, {
    categoryIdentifier: SOS_INCOMING_CATEGORY_ID,
    sound: true,
  });
}

/**
 * Warning + deadline notifications. Returns ids to cancel on safe-check-in.
 * - deadline always scheduled
 * - 5-min warning when duration > 6 min
 * - 15-min warning when duration > 16 min
 * These fire via the OS even if the app was swiped away (killed) — tapping
 * them re-opens the app, which then immediately floods the SOS mesh.
 */
export async function scheduleTimerNotifications(input: {
  deadlineAt: number;
  durationMs: number;
  workspaceLabel: string;
}): Promise<string[]> {
  const ids: string[] = [];
  const work = (input.workspaceLabel ?? '').trim();
  const suffix = work ? ` (${work})` : '';
  await ensureSosNotificationChannel();
  await requestSosNotificationPermission();

  if (input.durationMs > 16 * 60 * 1000) {
    const id = await scheduleAt(
      input.deadlineAt - 15 * 60 * 1000,
      'SOS check-in in 15 min',
      `Tap I'm Safe in the SOS tab${suffix} or SOS auto-sends at expiry.`,
    );
    if (id) ids.push(id);
  }
  if (input.durationMs > 6 * 60 * 1000) {
    const id = await scheduleAt(
      input.deadlineAt - 5 * 60 * 1000,
      'SOS check-in in 5 min',
      `Open SOS tab and tap I'm Safe${suffix} to stop auto-SOS.`,
    );
    if (id) ids.push(id);
  }
  const deadlineId = await scheduleAt(
    input.deadlineAt,
    '🆘 SOS timer expired',
    `Missed check-in${suffix}. Open the app — SOS is broadcasting to nearby phones.`,
  );
  if (deadlineId) ids.push(deadlineId);
  return ids;
}
