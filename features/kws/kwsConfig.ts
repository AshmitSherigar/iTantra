import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Keyword-spotting setup (Porcupine, fully offline at runtime).
 *
 * ONE-TIME SETUP (needs internet once, at build time — never at runtime):
 * 1. Free account at the Picovoice Console → copy your AccessKey → paste it
 *    into `extra.porcupineAccessKey` in app.json (keep it out of git).
 * 2. Train two wake words in the console:
 *      "Help Help" (English)  → download *_android.ppn + *_ios.ppn
 *      "Bachao"     (English acoustic model is fine — it's phonetic)
 * 3. Drop the files into `assets/kws/` with the names below. The
 *    `withKwsAssets` plugin copies them into the native projects at
 *    prebuild time (Android: assets/, iOS: bundle resources — for iOS also
 *    confirm the files are in the Xcode target's "Copy Bundle Resources").
 *
 * Until the key + files are in place, the listener reports `missing-setup`
 * and the toggle stays disabled. Nothing phones home at detection time.
 */

export const KWS_SENSITIVITY = 0.6;
/** Seconds the user gets to cancel after a trigger before SOS auto-sends. */
export const DISTRESS_CANCEL_SECONDS = 15;

type KwsKeywordDef = {
  /** Spoken phrase, shown in UI ("Listening for …"). */
  label: string;
  /** File in assets/kws/ for Android (relative to the assets folder). */
  androidFile: string;
  /** File in assets/kws/ for iOS (relative to the bundle resources). */
  iosFile: string;
};

export const KWS_KEYWORDS: KwsKeywordDef[] = [
  {
    label: 'Help Help',
    androidFile: 'help-help_android.ppn',
    iosFile: 'help-help_ios.ppn',
  },
  {
    label: 'Bachao',
    androidFile: 'bachao_android.ppn',
    iosFile: 'bachao_ios.ppn',
  },
];

/** Picovoice AccessKey from app.json `extra` (empty until you paste yours). */
export function getPorcupineAccessKey(): string {
  const extra = Constants.expoConfig?.extra as
    { porcupineAccessKey?: unknown } | undefined;
  const key = extra?.porcupineAccessKey;
  return typeof key === 'string' ? key.trim() : '';
}

/** Relative keyword file paths for this platform, in KWS_KEYWORDS order. */
export function getKeywordPaths(): { label: string; path: string }[] {
  return KWS_KEYWORDS.map((k) => ({
    label: k.label,
    path: Platform.OS === 'ios' ? k.iosFile : k.androidFile,
  }));
}
