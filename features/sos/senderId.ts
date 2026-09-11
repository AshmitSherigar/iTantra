import AsyncStorage from '@react-native-async-storage/async-storage';

const SENDER_ID_KEY = 'vaanisetu.sender_id.v1';

function newSenderId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Stable per-phone sender id. BLE MACs rotate (see the "Address rotated"
 * logs), so the SOS protocol keys identity on this persisted id instead —
 * NDRF can tell "same victim, new radio address" apart from two victims.
 */
export async function getOrCreateSenderId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(SENDER_ID_KEY);
    if (existing && existing.trim()) return existing.trim();
    const fresh = newSenderId();
    await AsyncStorage.setItem(SENDER_ID_KEY, fresh);
    return fresh;
  } catch {
    // Storage unavailable (rare) — fall back to an in-memory id. SOS still
    // sends; only cross-restart identity is lost.
    return newSenderId();
  }
}
