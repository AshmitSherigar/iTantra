import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { requestBluetoothPermission } from 'react-native-bluetooth-ble';

export type BlePermissionResult = {
  granted: boolean;
  /** Raw Android permission strings that are still missing (empty on iOS). */
  missing: string[];
  /** True when the user permanently denied at least one permission. */
  needsSettings: boolean;
};

function getApiLevel(): number {
  const v = Platform.Version;
  if (typeof v === 'number') return v;
  const parsed = parseInt(String(v), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Permissions the OS requires for BLE on this device.
 *
 * WHY LOCATION IS HERE (the bug being fixed):
 * - The `react-native-bluetooth-ble` native helper only requests
 *   BLUETOOTH_SCAN/CONNECT/ADVERTISE on API 31+ and ACCESS_FINE_LOCATION
 *   below that. Its manifest entry does NOT set `neverForLocation`, so on
 *   new Android (12/13/14+) the OS still treats a BLE scan as
 *   location-derived and silently returns zero results unless
 *   ACCESS_FINE_LOCATION is also granted AND location services are on.
 * - The old screen only called the library helper (for advertising) and
 *   requested NOTHING before scanning, so the app never showed a location
 *   prompt and scanning appeared "broken" on new phones.
 *
 * Fix: always request location alongside the Bluetooth runtime permissions
 * on Android, on every API level >= 23, before both advertising and
 * scanning.
 */
export function getRequiredAndroidPermissions(): string[] {
  const perms = PermissionsAndroid?.PERMISSIONS as
    typeof PermissionsAndroid.PERMISSIONS | undefined;
  if (!perms) return [];
  const apiLevel = getApiLevel();

  if (apiLevel >= 31) {
    // Android 12+: new Bluetooth runtime permissions + location (scan
    // still needs it because we do NOT assert neverForLocation — we show
    // device names, which the OS considers location-adjacent).
    const all: (string | undefined)[] = [
      perms.BLUETOOTH_SCAN as string | undefined,
      perms.BLUETOOTH_CONNECT as string | undefined,
      // BLUETOOTH_ADVERTISE may be missing from very old RN typings.
      (perms as Record<string, string | undefined>).BLUETOOTH_ADVERTISE,
      perms.ACCESS_FINE_LOCATION as string | undefined,
    ];
    return all.filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
  }

  if (apiLevel >= 23) {
    // Android 6–11: BLE scan requires fine location, nothing else.
    const all: (string | undefined)[] = [
      perms.ACCESS_FINE_LOCATION as string | undefined,
    ];
    return all.filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
  }

  return [];
}

/**
 * Request every runtime permission BLE needs on this device.
 * Safe to call before advertising AND before scanning — already-granted
 * permissions resolve silently without re-prompting.
 */
export async function ensureBlePermissions(): Promise<BlePermissionResult> {
  if (Platform.OS !== 'android') {
    try {
      const granted = await requestBluetoothPermission();
      return { granted, missing: [], needsSettings: !granted };
    } catch {
      return { granted: false, missing: [], needsSettings: false };
    }
  }

  const required = getRequiredAndroidPermissions();
  if (required.length === 0) {
    return { granted: true, missing: [], needsSettings: false };
  }

  try {
    // Fast path — everything already granted, no prompt.
    const checkResults = await Promise.all(
      required.map((p) => PermissionsAndroid.check(p as never)),
    );
    const missingBefore = required.filter((_, i) => !checkResults[i]);
    if (missingBefore.length === 0) {
      // Still run the library helper: it is a no-op when nothing is
      // missing but covers native-side edge cases.
      const libGranted = await requestBluetoothPermission().catch(() => true);
      return { granted: libGranted, missing: [], needsSettings: !libGranted };
    }

    const results = await PermissionsAndroid.requestMultiple(
      missingBefore as never[],
    );
    const missing = missingBefore.filter(
      (p) => results[p as never] !== PermissionsAndroid.RESULTS.GRANTED,
    );
    const needsSettings = missingBefore.some(
      (p) => results[p as never] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
    );

    if (missing.length > 0) {
      return { granted: false, missing, needsSettings };
    }

    // Location (+ BT) granted — confirm the native module agrees.
    const libGranted = await requestBluetoothPermission().catch(() => true);
    if (!libGranted) {
      return { granted: false, missing: [], needsSettings: false };
    }
    return { granted: true, missing: [], needsSettings: false };
  } catch (e) {
    console.warn('[BLE] Permission request failed:', e);
    return { granted: false, missing: required, needsSettings: false };
  }
}

/** Convenience wrapper for the scan button — returns true when allowed. */
export async function ensureBleScanPermissions(): Promise<boolean> {
  const res = await ensureBlePermissions();
  if (!res.granted) {
    showBlePermissionDeniedAlert(res);
  }
  return res.granted;
}

/** Convenience wrapper for the advertise/start button. */
export async function ensureBleAdvertisePermissions(): Promise<boolean> {
  return ensureBleScanPermissions();
}

export function showBlePermissionDeniedAlert(result: BlePermissionResult) {
  const names =
    result.missing.length > 0
      ? result.missing.join(', ')
      : 'Bluetooth / Location';
  Alert.alert(
    'Permission required',
    `This app needs Bluetooth AND Location permission to find nearby phones over BLE (${names}). ` +
      'On new Android, a BLE scan silently returns nothing without Location — and Location services must be switched ON in system settings.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}
