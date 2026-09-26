const { withAndroidManifest } = require('expo/config-plugins');

const SPECIAL_USE_PERMISSION =
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE';
const FGS_TYPE = 'specialUse';
const PROPERTY_NAME = 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE';
const PROPERTY_VALUE =
  'Safety countdown: broadcasts SOS to nearby phones if the user misses check-in.';

function ensureUsesPermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] ?? [];
  const exists = manifest['uses-permission'].some(
    (entry) => entry?.$?.['android:name'] === name,
  );
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } });
  }
}

/**
 * Patches the react-native-background-actions foreground service for
 * Android 14+ (API 34): startForeground() without a declared type throws
 * MissingForegroundServiceTypeException and the app closes on timer start.
 * Declares the service as specialUse (correct bucket for a safety timer)
 * with the Play-required subtype property.
 */
module.exports = function withSosForegroundService(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    ensureUsesPermission(manifest, SPECIAL_USE_PERMISSION);

    const app = manifest.application?.[0];
    if (!app) return modConfig;
    app.service = app.service ?? [];

    let svc = app.service.find((entry) =>
      (entry?.$?.['android:name'] ?? '').endsWith('RNBackgroundActionsTask'),
    );
    if (!svc) {
      svc = {
        $: {
          'android:name':
            'com.asterinet.react.bgactions.RNBackgroundActionsTask',
        },
      };
      app.service.push(svc);
    }
    svc.$ = svc.$ ?? {};
    // Foreground services need android:exported on API 31+.
    if (svc.$['android:exported'] == null) {
      svc.$['android:exported'] = 'false';
    }
    const current = (svc.$['android:foregroundServiceType'] ?? '')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!current.includes(FGS_TYPE)) current.push(FGS_TYPE);
    svc.$['android:foregroundServiceType'] = current.join('|');

    svc.property = svc.property ?? [];
    if (!svc.property.some((p) => p?.$?.['android:name'] === PROPERTY_NAME)) {
      svc.property.push({
        $: { 'android:name': PROPERTY_NAME, 'android:value': PROPERTY_VALUE },
      });
    }
    return modConfig;
  });
};
