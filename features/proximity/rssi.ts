/**
 * RSSI smoothing for device-search ranging.
 *
 * Raw BLE RSSI jitters ±10 dB between advertisements (multipath, body
 * blocking, antenna orientation), so distance must NEVER be computed from a
 * single sample. This EWMA filter keeps a small per-device state; callers
 * own one filter per peer id and drop it when the peer vanishes.
 */

export type RssiFilter = {
  /** Fold a new sample in; returns the updated smoothed value. */
  push(rssi: number): number;
  /** Current smoothed RSSI, or null before the first valid sample. */
  get(): number | null;
  /** Epoch ms of the last accepted sample, or null when empty. */
  lastUpdate: number | null;
  /** True when no sample arrived within `timeoutMs`. */
  isStale(now: number, timeoutMs: number): boolean;
};

/** Weight of each new sample (0-1). Higher = snappier, noisier. */
export const RSSI_EWMA_ALPHA = 0.35;
/** Samples outside this dBm window are radio garbage — ignore them. */
export const RSSI_MIN_DBM = -110;
export const RSSI_MAX_DBM = 0;

export function createRssiFilter(alpha: number = RSSI_EWMA_ALPHA): RssiFilter {
  const weight =
    Number.isFinite(alpha) && alpha > 0 && alpha <= 1 ? alpha : RSSI_EWMA_ALPHA;
  let smoothed: number | null = null;
  let updatedAt: number | null = null;

  return {
    push(rssi: number): number {
      if (!Number.isFinite(rssi) || rssi < RSSI_MIN_DBM || rssi > RSSI_MAX_DBM) {
        return smoothed ?? rssi;
      }
      smoothed = smoothed === null ? rssi : weight * rssi + (1 - weight) * smoothed;
      updatedAt = Date.now();
      return smoothed;
    },
    get(): number | null {
      return smoothed;
    },
    get lastUpdate(): number | null {
      return updatedAt;
    },
    isStale(now: number, timeoutMs: number): boolean {
      if (updatedAt === null) return true;
      return now - updatedAt > timeoutMs;
    },
  };
}
