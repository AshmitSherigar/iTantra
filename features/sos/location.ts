export type SosLocation = { lat: number; lon: number } | null;

// Last good fix shared across SOS sends. Updated by every successful
// lookup so the fire path can transmit instantly (0ms) instead of
// blocking up to 5s on GPS at deadline/tap time.
let cachedSosLocation: SosLocation = null;
let cachedSosLocationAt = 0;

/** Freshness window for reusing the cached fix on the SOS hot path. */
const SOS_LOCATION_CACHE_MS = 5 * 60 * 1000;

function noteSosLocation(loc: SosLocation): void {
  if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon)) {
    cachedSosLocation = loc;
    cachedSosLocationAt = Date.now();
  }
}

/** Synchronous cached fix (null when stale/missing). Never throws. */
export function getCachedSosLocation(
  maxAgeMs: number = SOS_LOCATION_CACHE_MS,
): SosLocation {
  if (!cachedSosLocation) return null;
  if (Date.now() - cachedSosLocationAt > maxAgeMs) return null;
  return cachedSosLocation;
}

/**
 * Request foreground location permission early (timer-arm time), so the
 * fire path never pays the permission-prompt cost. Returns granted flag.
 */
export async function ensureSosLocationPermission(): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Location = require('expo-location');
    const perms = await Location.requestForegroundPermissionsAsync();
    return perms?.status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Best-effort foreground location. Never throws, never blocks SOS:
 * returns null when permission denied, timed out, or expo-location
 * isn't available. SOS senders must NOT await this longer than ~6s.
 */
export async function tryGetLocation(timeoutMs = 6000): Promise<SosLocation> {
  try {
    // Lazy-require so the SOS tab still works on web / old builds
    // where expo-location isn't installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Location = require('expo-location');
    const perms = await Location.requestForegroundPermissionsAsync();
    if (perms?.status !== 'granted') return null;
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    if (!pos?.coords) return getCachedSosLocation();
    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      return getCachedSosLocation();
    const loc: SosLocation = { lat: latitude, lon: longitude };
    noteSosLocation(loc);
    return loc;
  } catch (e) {
    console.warn('[SOS] location unavailable:', e);
    return getCachedSosLocation();
  }
}

/**
 * Fast SOS location for the send hot path: last-known fix first (0ms),
 * then a short fresh-fix race, then the module cache. Awaits at most
 * `timeoutMs` (default 1.2s — never the 5s fire-time block).
 */
export async function tryGetLocationFast(
  timeoutMs = 1200,
): Promise<SosLocation> {
  const cached = getCachedSosLocation();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Location = require('expo-location');
    try {
      const last = await Location.getLastKnownPositionAsync?.().catch(
        () => null,
      );
      const c = last?.coords;
      if (Number.isFinite(c?.latitude) && Number.isFinite(c?.longitude)) {
        const loc: SosLocation = {
          lat: c.latitude,
          lon: c.longitude,
        };
        noteSosLocation(loc);
        return loc;
      }
    } catch {}
    if (cached) {
      // Return stale-usable fix immediately in the background while a
      // fresh fix races below? Callers already hold `cached`, so just
      // race fresh here and fall back to it.
    }
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      }).catch(() => null),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    if (!pos?.coords) return cached;
    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
      return cached;
    const loc: SosLocation = { lat: latitude, lon: longitude };
    noteSosLocation(loc);
    return loc;
  } catch (e) {
    console.warn('[SOS] fast location unavailable:', e);
    return cached;
  }
}
