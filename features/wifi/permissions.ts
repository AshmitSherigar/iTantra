import { Alert, Linking, PermissionsAndroid, Platform } from 'react-native';

function getApiLevel(): number {
  const v = Platform.Version;
  if (typeof v === 'number') return v;
  const parsed = parseInt(String(v), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type WifiPermissionResult = {
  granted: boolean;
  /** Raw Android permission strings still missing (empty when granted). */
  missing: string[];
  /** True when permanently denied (never ask again) — open Settings. */
  needsSettings: boolean;
};

/**
 * Runtime permissions for WiFi LAN chat.
 *
 * - UDP discovery + TCP sockets need no BT permissions, but Android still
 *   treats LAN scans as location-adjacent: `ACCESS_FINE_LOCATION` is
 *   required on API 23+.
 * - `NEARBY_WIFI_DEVICES` (API 33+) is best-effort: we request it for
 *   accurate SSID / peer visibility, but a denial must NOT block chat —
 *   otherwise users who grant Location yet skip Nearby get stuck in a
 *   re-prompt loop ("still asking even after giving permission").
 * - No internet permission prompt is needed at runtime (`INTERNET` is
 *   install-time). Chatting works with mobile data off — same WiFi only.
 */
export function getRequiredWifiPermissions(): string[] {
  if (Platform.OS !== 'android') return [];
  const perms = PermissionsAndroid?.PERMISSIONS as
    typeof PermissionsAndroid.PERMISSIONS | undefined;
  if (!perms) return [];
  const out: (string | undefined)[] = [
    perms.ACCESS_FINE_LOCATION as string | undefined,
  ];
  return out.filter((p): p is string => typeof p === 'string' && p.length > 0);
}

function getBestEffortWifiPermissions(): string[] {
  if (Platform.OS !== 'android') return [];
  if (getApiLevel() < 33) return [];
  const perms = PermissionsAndroid?.PERMISSIONS as
    Record<string, string | undefined> | undefined;
  const nearby = perms?.NEARBY_WIFI_DEVICES;
  return typeof nearby === 'string' && nearby.length > 0 ? [nearby] : [];
}

/** Silent check — no system dialog. True when LAN chat may proceed. */
export async function checkWifiPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const required = getRequiredWifiPermissions();
  if (required.length === 0) return true;
  try {
    const checks = await Promise.all(
      required.map((p) => PermissionsAndroid.check(p as never)),
    );
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

export async function ensureWifiPermissions(): Promise<WifiPermissionResult> {
  if (Platform.OS !== 'android')
    return { granted: true, missing: [], needsSettings: false };
  const required = getRequiredWifiPermissions();
  if (required.length === 0)
    return { granted: true, missing: [], needsSettings: false };
  try {
    // Fast path — already granted, never prompt again (breaks the loop).
    const checks = await Promise.all(
      required.map((p) => PermissionsAndroid.check(p as never)),
    );
    const missingBefore = required.filter((_, i) => !checks[i]);
    if (missingBefore.length === 0) {
      void requestBestEffortOnce();
      return { granted: true, missing: [], needsSettings: false };
    }

    const results = await PermissionsAndroid.requestMultiple(
      missingBefore as never[],
    );
    const stillMissing = missingBefore.filter(
      (p) => results[p as never] !== PermissionsAndroid.RESULTS.GRANTED,
    );
    const needsSettings = missingBefore.some(
      (p) => results[p as never] === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
    );

    if (stillMissing.length > 0) {
      return { granted: false, missing: stillMissing, needsSettings };
    }

    // Location granted — fire best-effort Nearby request without blocking.
    void requestBestEffortOnce();
    return { granted: true, missing: [], needsSettings: false };
  } catch (e) {
    console.warn('[WiFi] permission request failed', e);
    return { granted: false, missing: required, needsSettings: false };
  }
}

/** Best-effort Nearby request — never blocks, never alerts. */
let bestEffortRequested = false;
async function requestBestEffortOnce(): Promise<void> {
  if (bestEffortRequested || Platform.OS !== 'android') return;
  bestEffortRequested = true;
  const extra = getBestEffortWifiPermissions();
  if (extra.length === 0) return;
  try {
    const checks = await Promise.all(
      extra.map((p) => PermissionsAndroid.check(p as never)),
    );
    const missing = extra.filter((_, i) => !checks[i]);
    if (missing.length === 0) return;
    await PermissionsAndroid.requestMultiple(missing as never[]);
  } catch {
    // ignore — chat works without it
  }
}

export function showWifiPermissionDeniedAlert(result: WifiPermissionResult) {
  const names =
    result.missing.length > 0 ? result.missing.join(', ') : 'Location';
  Alert.alert(
    'Permission required',
    `WiFi chat needs Location permission to discover phones on the same WiFi network (${names}). No internet is used.` +
      (result.needsSettings
        ? ' You selected "Don\'t ask again" — enable it in Settings.'
        : ''),
    [
      { text: 'Cancel', style: 'cancel' },
      ...(result.needsSettings
        ? [{ text: 'Open Settings', onPress: () => Linking.openSettings() }]
        : []),
    ],
  );
}
