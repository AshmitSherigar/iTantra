import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Killed-app / background coverage for the SOS timer.
 *
 * Honest architecture note (BLE mesh is offline, no server):
 * - While the app is alive (foreground OR backgrounded-not-killed),
 *   SosProvider's interval fires the SOS flood directly over BLE.
 * - When the OS kills the app, the BLE radio owner is gone too, so NO
 *   code on this phone can transmit. What DOES survive a kill:
 *   1. AsyncStorage deadline (restored on next launch → instant fire).
 *   2. OS-scheduled local notifications at T-15m/T-5m/T-0 (see notify.ts).
 *      Tapping them re-opens the app → SosProvider fires the flood.
 *   3. This BackgroundFetch task: Android re-launches it periodically
 *      (~15 min minimum) even after a swipe-away. It cannot do BLE, but
 *      it posts a loud "open app to broadcast SOS" notification the
 *      moment it sees an expired deadline.
 *
 * True transmit-while-dead needs a native ForegroundService keeping the
 * process alive — listed as Phase-2 in the plan. This file is the
 * Expo-managed best effort that works without ejecting.
 */

export const SOS_BG_TASK = 'sos-timer-check';

const ACTIVE_TIMER_KEY = 'sos:active-timer-v1';

async function checkDeadlineAndAlert(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
    if (!raw) return false;
    const timer = JSON.parse(raw) as { deadlineAt?: number; workspaceLabel?: string };
    if (typeof timer?.deadlineAt !== 'number') return false;
    if (Date.now() < timer.deadlineAt) return false;
    // Expired while we were dead/backgrounded → shout via notification.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Notifications = require('expo-notifications');
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🆘 SOS timer expired',
          body: 'Missed check-in. Open VaaniSetu now — SOS will broadcast to all nearby phones.',
          sound: true,
          priority: Notifications.AndroidNotificationPriority?.MAX,
        },
        trigger: null,
      });
    } catch {}
    return true;
  } catch {
    return false;
  }
}

export function defineSosBackgroundTask(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BackgroundFetch = require('expo-background-fetch');
    void BackgroundFetch;
    if (TaskManager?.hasStartedAsync && TaskManager?.isTaskDefined?.(SOS_BG_TASK)) return;
    TaskManager.defineTask(SOS_BG_TASK, async () => {
      try {
        await checkDeadlineAndAlert();
      } catch {}
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const BF = require('expo-background-fetch');
        return BF.BackgroundFetchResult.NewData;
      } catch {
        return undefined as never;
      }
    });
  } catch (e) {
    console.warn('[SOS] bg task define failed:', e);
  }
}

export async function registerSosBackgroundTask(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BackgroundFetch = require('expo-background-fetch');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const TaskManager = require('expo-task-manager');
    defineSosBackgroundTask();
    const registered = await TaskManager.isTaskRegisteredAsync(SOS_BG_TASK).catch(() => false);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(SOS_BG_TASK, {
        minimumInterval: 15 * 60, // OS minimum ~15 min
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch (e) {
    console.warn('[SOS] bg task register failed:', e);
  }
}
