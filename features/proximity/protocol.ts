/**
 * Device-search ranging protocol (rides the existing BLE flood mesh).
 *
 * No new connection is needed: while tracking, the seeker broadcasts a
 * `kind: 'range'` ping every RANGE_PING_INTERVAL_MS naming its target. Any
 * phone with Device Search open whose name matches replies (throttled) with
 * its own measurement — so BOTH sides show approximate distance.
 *
 * Identity is the advertised display name (BLE ids rotate on some phones and
 * the scanner already collapses rotations by name). Same-name collisions are
 * disambiguated seeker-side via sessionId.
 */

import {
  BROADCAST_MESSAGE_TYPE,
  isRangeEnvelope,
  makeBroadcastId,
  type BroadcastEnvelope,
  type RangeMeta,
} from '../bluetooth/broadcast';

/** Seeker ping cadence while tracking. Small JSON, TTL-limited — cheap. */
export const RANGE_PING_INTERVAL_MS = 2500;
/** Minimum gap between auto-replies (don't flood when Seek+Track overlap). */
export const RANGE_REPLY_THROTTLE_MS = 2000;
/** "Being sought" card expires after this long without a fresh ping. */
export const RANGE_SOUGHT_TIMEOUT_MS = 12000;
/** Drive a shared discovery round this often while tracking (fresh RSSI). */
export const RANGE_DISCOVERY_INTERVAL_MS = 5000;

/**
 * Benign display text so pre-search builds (which render unknown kinds as
 * normal broadcasts) show something harmless instead of JSON.
 */
export const RANGE_PING_MESSAGE =
  '📡 proximity ping — open Device Search to respond';

export type { RangeMeta };

export function makeRangeEnvelope(input: {
  senderName: string;
  language: string;
  range: RangeMeta;
}): BroadcastEnvelope {
  return {
    type: BROADCAST_MESSAGE_TYPE,
    id: makeBroadcastId(),
    senderName: input.senderName,
    message: RANGE_PING_MESSAGE,
    language: input.language,
    // Single-hop ONLY (ttl=1 → receivers never relay). Ranging is a
    // direct-neighbour measurement, and this keeps pings off the wider mesh
    // so uninvolved phones never see them.
    ttl: 1,
    kind: 'range',
    range: input.range,
  };
}

/** The structured ping, or null for non-range / malformed envelopes. */
export function parseRangePing(
  envelope: BroadcastEnvelope,
): RangeMeta | null {
  if (!isRangeEnvelope(envelope) || !envelope.range) return null;
  return envelope.range;
}

/** Case-insensitive display-name match (BLE ids rotate; names are stable). */
export function sameDeviceName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
