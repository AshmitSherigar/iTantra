import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';
import { requestBluetoothPermission } from 'react-native-bluetooth-ble';
import { logger } from '@/utils/logger';

export type BlePermissionResult = {
  granted: boolean;
  /** Android permissions that are still missing. */
  missing: string[];
  /** Whether a permission was permanently denied. */
  needsSettings: boolean;
};

function getApiLevel(): number {
  const version = Platform.Version;
  if (typeof version === 'number') return version;

  const parsed = parseInt(String(version), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Android 12+ needs Bluetooth permissions; BLE scanning also requires location.
export function getRequiredAndroidPermissions(): string[] {
  const permissions = PermissionsAndroid?.PERMISSIONS as
    typeof PermissionsAndroid.PERMISSIONS | undefined;

  if (!permissions) return [];

  const apiLevel = getApiLevel();

  if (apiLevel >= 31) {
    const required: (string | undefined)[] = [
      permissions.BLUETOOTH_SCAN as string | undefined,
      permissions.BLUETOOTH_CONNECT as string | undefined,
      (permissions as Record<string, string | undefined>).BLUETOOTH_ADVERTISE,
      permissions.ACCESS_FINE_LOCATION as string | undefined,
    ];

    return required.filter(
      (permission): permission is string =>
        typeof permission === 'string' && permission.length > 0,
    );
  }

  if (apiLevel >= 23) {
    const required: (string | undefined)[] = [
      permissions.ACCESS_FINE_LOCATION as string | undefined,
    ];

    return required.filter(
      (permission): permission is string =>
        typeof permission === 'string' && permission.length > 0,
    );
  }

  return [];
}

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
    // Check first so already-granted permissions don't trigger another request.
    const checkResults = await Promise.all(
      required.map((permission) =>
        PermissionsAndroid.check(permission as never),
      ),
    );

    const missingBefore = required.filter((_, index) => !checkResults[index]);

    if (missingBefore.length === 0) {
      const libGranted = await requestBluetoothPermission().catch(() => true);
      return { granted: libGranted, missing: [], needsSettings: !libGranted };
    }

    const results = await PermissionsAndroid.requestMultiple(
      missingBefore as never[],
    );

    const missing = missingBefore.filter(
      (permission) =>
        results[permission as never] !== PermissionsAndroid.RESULTS.GRANTED,
    );

    const needsSettings = missingBefore.some(
      (permission) =>
        results[permission as never] ===
        PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
    );

    if (missing.length > 0) {
      return { granted: false, missing, needsSettings };
    }

    const libGranted = await requestBluetoothPermission().catch(() => true);

    if (!libGranted) {
      return { granted: false, missing: [], needsSettings: false };
    }

    return { granted: true, missing: [], needsSettings: false };
  } catch (error) {
    logger.warn('Bluetooth', 'Permission request failed', error);
    return { granted: false, missing: required, needsSettings: false };
  }
}

export async function ensureBleScanPermissions(): Promise<boolean> {
  const result = await ensureBlePermissions();

  if (!result.granted) {
    showBlePermissionDeniedAlert(result);
  }

  return result.granted;
}

export async function ensureBleAdvertisePermissions(): Promise<boolean> {
  return ensureBleScanPermissions();
}

export function showBlePermissionDeniedAlert(result: BlePermissionResult) {
  const permissionNames =
    result.missing.length > 0
      ? result.missing.join(', ')
      : 'Bluetooth / Location';

  Alert.alert(
    'Permission required',
    `This app needs Bluetooth and Location permission to find nearby phones over BLE (${permissionNames}). ` +
      'On Android, Location services must also be enabled for BLE scanning.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ],
  );
}
