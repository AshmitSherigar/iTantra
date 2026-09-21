export type SosLocation = { lat: number; lon: number } | null;

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
    if (!pos?.coords) return null;
    const { latitude, longitude } = pos.coords;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { lat: latitude, lon: longitude };
  } catch (e) {
    console.warn('[SOS] location unavailable:', e);
    return null;
  }
}
