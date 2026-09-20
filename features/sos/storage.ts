import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SosTimerState } from './types';

const ACTIVE_TIMER_KEY = 'sos:active-timer-v1';
const LAST_SOS_KEY = 'sos:last-fired-v1';

export async function saveActiveTimer(timer: SosTimerState): Promise<void> {
  try {
    await AsyncStorage.setItem(ACTIVE_TIMER_KEY, JSON.stringify(timer));
  } catch (e) {
    console.warn('[SOS] save timer failed:', e);
  }
}

export async function loadActiveTimer(): Promise<SosTimerState | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_TIMER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SosTimerState;
    if (
      typeof parsed?.deadlineAt !== 'number' ||
      typeof parsed?.startedAt !== 'number'
    ) {
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn('[SOS] load timer failed:', e);
    return null;
  }
}

export async function clearActiveTimer(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_TIMER_KEY);
  } catch (e) {
    console.warn('[SOS] clear timer failed:', e);
  }
}

export async function saveLastFired(payload: {
  at: number;
  message: string;
}): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SOS_KEY, JSON.stringify(payload));
  } catch {}
}

export async function loadLastFired(): Promise<{
  at: number;
  message: string;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SOS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
