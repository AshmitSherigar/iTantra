/**
 * Point-to-point channel for device-search ranging pings.
 *
 * WHY THIS EXISTS: ranging is a 2-device exchange, so it must NOT ride the
 * flood mesh. Pings delivered here never touch `emitBroadcast` — meaning no
 * relay to other phones, no chat inboxes, no SOS inbox, no TTS, no global
 * alert popups. Only screens subscribed below ever see them.
 *
 * Two halves:
 * - Inbound: `useBleMessages` routes decoded `kind: 'range'` envelopes here
 *   instead of the flood bus. (Two hook instances exist app-wide; ids are
 *   de-duped so each ping is delivered once.)
 * - Outbound: `sendRangeUnicast` targets ONE open GATT link (registered by
 *   the root mesh runtime). Returns false when no link/sender exists and the
 *   caller falls back to a single-hop broadcast ping.
 */

import {
  isRangeEnvelope,
  type BroadcastEnvelope,
} from '../bluetooth/broadcast';

type RangeListener = (envelope: BroadcastEnvelope) => void;

const listeners = new Set<RangeListener>();

/** De-dupe across the runtime + bluetooth-tab reassembly instances. */
const seenRangeIds = new Set<string>();
const MAX_SEEN_RANGE_IDS = 200;

function pruneSeenRangeIds(): void {
  if (seenRangeIds.size <= MAX_SEEN_RANGE_IDS) return;
  const overflow = seenRangeIds.size - MAX_SEEN_RANGE_IDS;
  const iterator = seenRangeIds.values();
  for (let i = 0; i < overflow; i++) {
    const next = iterator.next();
    if (next.done) break;
    seenRangeIds.delete(next.value);
  }
}

export function subscribeToRangePings(listener: RangeListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Deliver a ranging ping to search screens only. True when first-seen. */
export function emitRangePing(envelope: BroadcastEnvelope): boolean {
  if (!isRangeEnvelope(envelope) || !envelope?.id) return false;
  if (seenRangeIds.has(envelope.id)) return false;
  seenRangeIds.add(envelope.id);
  pruneSeenRangeIds();
  listeners.forEach((listener) => {
    try {
      listener(envelope);
    } catch (error) {
      console.warn('[Range] listener failed:', error);
    }
  });
  return true;
}

export type RangeUnicastSender = (
  deviceId: string,
  envelope: BroadcastEnvelope,
) => Promise<boolean>;

let unicastSender: RangeUnicastSender | null = null;

/** Registered once by the root mesh runtime (owns the GATT links). */
export function registerRangeUnicast(sender: RangeUnicastSender | null): void {
  unicastSender = sender;
}

/**
 * Send a ranging envelope down ONE open link. Resolves false when there is
 * no sender or no link to that phone — caller then uses broadcast fallback.
 */
export function sendRangeUnicast(
  deviceId: string,
  envelope: BroadcastEnvelope,
): Promise<boolean> {
  if (!deviceId || !unicastSender) return Promise.resolve(false);
  try {
    return unicastSender(deviceId, envelope);
  } catch {
    return Promise.resolve(false);
  }
}
