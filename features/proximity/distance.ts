/**
 * RSSI → approximate-distance mapping for device search.
 *
 * Log-distance path-loss model: d = 10 ^ ((txPower - rssi) / (10 * n)).
 *
 * HONEST LIMITS (show bands + "≈" in UI, never fake precision):
 * - ±50% error is normal indoors (walls, bodies, reflections).
 * - Different phone models transmit at different powers; TX_POWER_DBM_1M is
 *   a fleet average. A per-model calibration table can tighten this later.
 * - Orientation alone swings readings 2-3x (phone in pocket vs. in hand).
 */

export type DistanceBand = 'immediate' | 'near' | 'mid' | 'far' | 'unknown';

/** Expected RSSI at 1 metre — fleet-average calibration point. */
export const TX_POWER_DBM_AT_1M = -59;
/** Path-loss exponent: 2.0 = open air. Indoors is 2.5-3.5 (reads LONGER). */
export const PATH_LOSS_EXPONENT = 2.0;

/** Upper metre bounds per band. Anything above MID_MAX_M is 'far'. */
export const IMMEDIATE_MAX_M = 1.5;
export const NEAR_MAX_M = 4;
export const MID_MAX_M = 12;
/** Smoothed readings older than this have no band ('unknown'). */
export const READING_STALE_AFTER_MS = 6000;

export function rssiToMeters(
  rssi: number | null | undefined,
  txPowerDbm: number = TX_POWER_DBM_AT_1M,
  pathLoss: number = PATH_LOSS_EXPONENT,
): number | null {
  if (rssi === null || rssi === undefined || !Number.isFinite(rssi)) return null;
  if (!Number.isFinite(txPowerDbm) || !Number.isFinite(pathLoss) || pathLoss <= 0) {
    return null;
  }
  const meters = Math.pow(10, (txPowerDbm - rssi) / (10 * pathLoss));
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.min(meters, 100);
}

export function distanceBand(meters: number | null | undefined): DistanceBand {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return 'unknown';
  }
  if (meters < IMMEDIATE_MAX_M) return 'immediate';
  if (meters < NEAR_MAX_M) return 'near';
  if (meters < MID_MAX_M) return 'mid';
  return 'far';
}

/** Short human label for each band (UI chip / big readout). */
export function bandLabel(band: DistanceBand): string {
  switch (band) {
    case 'immediate':
      return 'Very close';
    case 'near':
      return 'Near';
    case 'mid':
      return 'A bit away';
    case 'far':
      return 'Far';
    case 'unknown':
      return 'No signal';
  }
}

/** "~3 m" style label. Values over 30 m are capped ("30+ m"). */
export function formatApproxMeters(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) {
    return '—';
  }
  if (meters >= 30) return '30+ m';
  return `≈ ${Math.max(1, Math.round(meters))} m`;
}

/** 0-4 signal bars for a band (UI dots). Unknown renders 0. */
export function bandBars(band: DistanceBand): number {
  switch (band) {
    case 'immediate':
      return 4;
    case 'near':
      return 3;
    case 'mid':
      return 2;
    case 'far':
      return 1;
    case 'unknown':
      return 0;
  }
}
