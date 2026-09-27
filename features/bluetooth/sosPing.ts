import { hexToText, textToHex } from './codec';
import type { BroadcastEnvelope } from './broadcast';

/**
 * Connectionless SOS ping: a ~14B `SOS:<shortId>:<ttl>` marker carried in
 * the legacy advertising packet (serviceData128 for our SERVICE_UUID), so
 * nearby phones see SOS in <1s with ZERO GATT connect.
 *
 * The full SOS envelope still travels over the warm-mesh GATT flood (same
 * id family) — the ping is a provisional tripwire, never the message
 * itself. GATT remains the source of truth; a ping without a follow-up
 * full envelope shows "detected nearby" but never a full alert.
 */

export const SOS_PING_PREFIX = 'SOS:';
/** Ping observations dedup window (adv repeats every ~100ms). */
const PING_SEEN_WINDOW_MS = 30000;
/** How long the ping stays in our advertising packet per SOS send. */
const PING_ACTIVE_MS = 20000;

export type SosPing = {
  shortId: string;
  ttl: number;
  deviceId: string;
  rssi?: number;
  at: number;
};

type SosPingListener = (ping: SosPing) => void;

const pingListeners = new Set<SosPingListener>();
const seenPingAt = new Map<string, number>();
/** Short ids whose FULL envelope already arrived (suppress provisional). */
const resolvedShortIds = new Set<string>();

/** `Date.now()-rand` envelope id → 8-char suffix the ping carries. */
export function shortIdForEnvelopeId(id: string): string {
  if (!id) return '';
  const dash = id.lastIndexOf('-');
  const tail = dash >= 0 ? id.slice(dash + 1) : id;
  return tail.slice(-8);
}

export function encodeSosPingForEnvelope(
  envelope: Pick<BroadcastEnvelope, 'id' | 'ttl'>,
): string {
  const shortId = shortIdForEnvelopeId(envelope.id);
  const ttl =
    typeof envelope.ttl === 'number' && Number.isFinite(envelope.ttl)
      ? Math.max(0, Math.min(9, Math.floor(envelope.ttl)))
      : 5;
  return textToHex(`${SOS_PING_PREFIX}${shortId}:${ttl}`);
}

function pruneSeenPings(now: number): void {
  for (const [key, at] of seenPingAt) {
    if (now - at > PING_SEEN_WINDOW_MS) seenPingAt.delete(key);
  }
  if (seenPingAt.size > 200) {
    const sorted = [...seenPingAt.entries()].sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < seenPingAt.size - 200; i++) {
      seenPingAt.delete(sorted[i][0]);
    }
  }
}

type PingCarrier = {
  advertisingData?: {
    serviceData128?: { uuid?: string; data?: string }[];
    serviceData32?: { uuid?: string; data?: string }[];
    serviceData16?: { uuid?: string; data?: string }[];
    manufacturerData?: string;
    [key: string]: unknown;
  };
  serviceData?: { uuid?: string; data?: string }[];
  manufacturerData?: string;
};

/**
 * Decode an SOS ping from any place the native scanner can surface
 * service/manufacturer data. Returns null when absent. Pure + safe to call
 * on every scan result.
 */
export function decodeSosPingFromDevice(
  device: PingCarrier | null | undefined,
  serviceUuid: string,
): { shortId: string; ttl: number } | null {
  if (!device) return null;
  const wanted = serviceUuid.trim().toLowerCase();
  const candidates: string[] = [];
  const adv = device.advertisingData ?? {};
  for (const bucket of [
    adv.serviceData128,
    adv.serviceData32,
    adv.serviceData16,
    device.serviceData,
  ]) {
    if (Array.isArray(bucket)) {
      for (const entry of bucket as { uuid?: string; data?: string }[]) {
        if (
          typeof entry?.data === 'string' &&
          (!entry.uuid || entry.uuid.trim().toLowerCase() === wanted)
        ) {
          candidates.push(entry.data);
        }
      }
    }
  }
  for (const mfg of [adv.manufacturerData, device.manufacturerData]) {
    if (typeof mfg === 'string' && mfg.length > 0) candidates.push(mfg);
  }
  for (const hex of candidates) {
    let text: string | null = null;
    try {
      text = hexToText(hex);
    } catch {
      text = null;
    }
    if (!text) continue;
    const trimmed = text.trim();
    if (!trimmed.startsWith(SOS_PING_PREFIX)) continue;
    const parts = trimmed.split(':');
    if (parts.length !== 3) continue;
    const shortId = parts[1].trim();
    const ttl = parseInt(parts[2].trim(), 10);
    if (!shortId || !Number.isFinite(ttl)) continue;
    return { shortId, ttl };
  }
  return null;
}

export function subscribeToSosPing(listener: SosPingListener): () => void {
  pingListeners.add(listener);
  return () => {
    pingListeners.delete(listener);
  };
}

/** Record a full SOS arrival so its (still-advertised) ping stays silent. */
export function markSosPingResolved(envelopeId: string): void {
  const shortId = shortIdForEnvelopeId(envelopeId);
  if (shortId) resolvedShortIds.add(shortId);
  if (resolvedShortIds.size > 200) {
    const first = resolvedShortIds.values().next();
    if (!first.done) resolvedShortIds.delete(first.value);
  }
}

export function isSosPingResolved(envelopeId: string): boolean {
  return resolvedShortIds.has(shortIdForEnvelopeId(envelopeId));
}

/** Called by the scanner for every VaaniSetu scan result. */
export function emitSosPingObserved(
  deviceId: string,
  rssi: number | undefined,
  decoded: { shortId: string; ttl: number },
): boolean {
  const now = Date.now();
  pruneSeenPings(now);
  const key = decoded.shortId;
  if (!key || resolvedShortIds.has(key)) return false;
  const last = seenPingAt.get(key);
  if (last !== undefined && now - last < PING_SEEN_WINDOW_MS) return false;
  seenPingAt.set(key, now);
  const ping: SosPing = {
    shortId: key,
    ttl: decoded.ttl,
    deviceId,
    rssi,
    at: now,
  };
  pingListeners.forEach((fn) => {
    try {
      fn(ping);
    } catch (error) {
      console.warn('[SosPing] listener failed:', error);
    }
  });
  return true;
}

// ---------------------------------------------------------------------------
// Ping transmit control. The mesh runtime (owner of the advertiser) registers
// its setSosPing; SOS senders publish hex without touching adv internals.
// ---------------------------------------------------------------------------

type PingControl = (hex: string | null) => void;

let pingControl: PingControl | null = null;
let pingClearTimer: ReturnType<typeof setTimeout> | null = null;

export function registerSosPingControl(fn: PingControl | null): () => void {
  if (fn) pingControl = fn;
  return () => {
    if (pingControl === fn) pingControl = null;
  };
}

/**
 * Advertise an SOS ping for PING_ACTIVE_MS (extended by overlapping sends).
 * Fire-and-forget; GATT flood remains the source of truth.
 */
export function activateSosPing(hex: string): void {
  if (!hex) return;
  try {
    pingControl?.(hex);
  } catch (error) {
    console.warn('[SosPing] activate failed:', error);
  }
  if (pingClearTimer) clearTimeout(pingClearTimer);
  pingClearTimer = setTimeout(() => {
    pingClearTimer = null;
    try {
      pingControl?.(null);
    } catch {}
  }, PING_ACTIVE_MS);
}

export function clearSosPing(): void {
  if (pingClearTimer) {
    clearTimeout(pingClearTimer);
    pingClearTimer = null;
  }
  try {
    pingControl?.(null);
  } catch {}
}
