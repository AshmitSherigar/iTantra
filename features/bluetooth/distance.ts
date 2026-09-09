/**
 * RSSI → estimated distance.
 *
 * Uses the log-distance path-loss model:
 *
 *   distance = 10 ^ ((TxPower - RSSI) / (10 * N))
 *
 * - `TxPower` = RSSI measured at 1 metre (dBm). -59 is a sane BLE default.
 * - `N` = path-loss exponent (2.0 = free space, 2.5–3.5 = indoors w/ walls).
 *
 * This is an ESTIMATE — BLE RSSI fluctuates ±5–10 dBm due to orientation,
 * bodies, walls and radio noise, so expect ±30–50% error. Good for
 * "next to me / a few metres / across the room", not for tape-measure use.
 */

/** RSSI (dBm) expected at 1m distance. Recalibrate per device if needed. */
export const TX_POWER_AT_1M = -59;

/** Environment factor: 2.0 open space, ~2.5–3.0 typical indoors. */
export const PATH_LOSS_EXPONENT = 2.0;

export type Proximity = 'Immediate' | 'Near' | 'Far' | 'Very far';

/**
 * Convert an RSSI reading to estimated metres.
 * Returns null when the reading is missing/invalid.
 */
export function estimateDistanceMeters(
  rssi: number | null | undefined,
  txPower: number = TX_POWER_AT_1M,
  n: number = PATH_LOSS_EXPONENT,
): number | null {
  if (rssi === null || rssi === undefined) return null;
  if (!Number.isFinite(rssi) || !Number.isFinite(txPower) || !Number.isFinite(n))
    return null;
  if (rssi >= 0 || rssi < -120) return null; // 0 / positive = invalid BLE RSSI
  if (n <= 0) return null;
  const distance = Math.pow(10, (txPower - rssi) / (10 * n));
  if (!Number.isFinite(distance)) return null;
  // Clamp to a sane display range (1 cm … 100 m).
  return Math.min(100, Math.max(0.01, distance));
}

/** Rough proximity bucket for an estimated distance in metres. */
export function getProximity(distanceMeters: number | null): Proximity | null {
  if (distanceMeters === null || !Number.isFinite(distanceMeters)) return null;
  if (distanceMeters <= 0.5) return 'Immediate';
  if (distanceMeters <= 3) return 'Near';
  if (distanceMeters <= 12) return 'Far';
  return 'Very far';
}

/**
 * Human-friendly distance, e.g. "45 cm", "2.4 m", "12 m".
 * Returns "—" when unknown.
 */
export function formatDistance(distanceMeters: number | null): string {
  if (distanceMeters === null || !Number.isFinite(distanceMeters)) return '—';
  if (distanceMeters < 1) return `${Math.max(1, Math.round(distanceMeters * 100))} cm`;
  if (distanceMeters < 10) return `${distanceMeters.toFixed(1)} m`;
  return `${Math.round(distanceMeters)} m`;
}

/**
 * One-liner for lists: "≈ 2.4 m • Near".
 * Returns "Distance unknown" when RSSI is missing/invalid.
 */
export function distanceLabelForRssi(
  rssi: number | null | undefined,
  txPower: number = TX_POWER_AT_1M,
  n: number = PATH_LOSS_EXPONENT,
): string {
  const distance = estimateDistanceMeters(rssi, txPower, n);
  if (distance === null) return 'Distance unknown';
  const proximity = getProximity(distance);
  const formatted = formatDistance(distance);
  return proximity ? `≈ ${formatted} • ${proximity}` : `≈ ${formatted}`;
}
