import * as Location from 'expo-location';

export type SosFix = {
  lat: number;
  lon: number;
  accuracy?: number;
};

const FIX_TIMEOUT_MS = 12000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function toFix(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): SosFix | null {
  const { latitude, longitude, accuracy } = coords;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  const fix: SosFix = { lat: latitude, lon: longitude };
  if (
    typeof accuracy === 'number' &&
    Number.isFinite(accuracy) &&
    accuracy > 0
  ) {
    fix.accuracy = accuracy;
  }
  return fix;
}

/**
 * Best-effort GPS fix for an SOS envelope.
 *
 * Returns null when permission is denied, location services are off, or no
 * fix arrives in time — callers MUST still send the SOS (text-only distress
 * is valid per protocol; a missing fix never blocks the send).
 */
export async function getSosFix(): Promise<SosFix | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) return null;
    } catch {
      // hasServicesEnabledAsync is Android-only — ignore elsewhere.
    }
    try {
      const pos = (await Promise.race([
        Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }),
        sleep(FIX_TIMEOUT_MS).then(() => null),
      ])) as Location.LocationObject | null;
      const fix = pos ? toFix(pos.coords) : null;
      if (fix) return fix;
    } catch {
      // Fresh fix failed — fall through to last-known below.
    }
    try {
      const last = await Location.getLastKnownPositionAsync();
      return last ? toFix(last.coords) : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
