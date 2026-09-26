import AsyncStorage from '@react-native-async-storage/async-storage';

import type { SosTimerState } from './types';

const ACTIVE_TIMER_KEY = 'sos:active-timer-v1';
const LAST_SOS_KEY = 'sos:last-fired-v1';

/** Timers are user-armable for 1 min – 24h; allow a small tolerance. */
const MAX_TIMER_MS = 24 * 60 * 60 * 1000 + 60 * 1000;

/**
 * Strict shape check for persisted timers. A corrupted entry (NaN lat/lon,
 * non-finite deadline, negative duration, …) must never reach the countdown
 * UI — e.g. `width: "NaN%"` can crash layout on every launch until expiry.
 */
export function isValidSosTimer(value: unknown): value is SosTimerState {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  if (typeof t.deadlineAt !== 'number' || !Number.isFinite(t.deadlineAt))
    return false;
  if (typeof t.startedAt !== 'number' || !Number.isFinite(t.startedAt))
    return false;
  if (typeof t.durationMs !== 'number' || !Number.isFinite(t.durationMs))
    return false;
  if (t.durationMs <= 0 || t.durationMs > MAX_TIMER_MS) return false;
  if (t.deadlineAt <= t.startedAt) return false;
  if (t.deadlineAt - t.startedAt > MAX_TIMER_MS) return false;
  if (typeof t.helpMessage !== 'string') return false;
  if (typeof t.workspaceLabel !== 'string') return false;
  if (typeof t.includeLocation !== 'boolean') return false;
  if (
    t.lat !== undefined &&
    (typeof t.lat !== 'number' || !Number.isFinite(t.lat))
  ) {
    return false;
  }
  if (
    t.lon !== undefined &&
    (typeof t.lon !== 'number' || !Number.isFinite(t.lon))
  ) {
    return false;
  }
  if (t.notificationIds !== undefined) {
    if (!Array.isArray(t.notificationIds)) return false;
    if (!t.notificationIds.every((id) => typeof id === 'string')) return false;
  }
  return true;
}

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
    const parsed: unknown = JSON.parse(raw);
    if (!isValidSosTimer(parsed)) {
      // Corrupted entry: drop it so it can't crash the countdown UI on
      // every launch. Fire-and-forget — loading must never throw.
      AsyncStorage.removeItem(ACTIVE_TIMER_KEY).catch(() => {});
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
