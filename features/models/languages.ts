/**
 * Central registry for speech languages ↔ on-device model asset paths.
 *
 * On-disk layout (bundled under assets/models/, git-ignored but shipped
 * with the binary):
 *   assets/models/stt/stt-eng  (model.int8.onnx + tokens.txt)
 *   assets/models/stt/stt-hin
 *   assets/models/stt/stt-kan
 *   assets/models/tts/tts-eng  (model.onnx + config.json + tokens.txt)
 *   assets/models/tts/tts-hin
 *   assets/models/tts/tts-kan
 *
 * NOTE: the leaf dir name MUST be unique across every entry. The native
 * asset helper extracts `assets/<path>` to `<filesDir>/models/<leaf>` and
 * reuses that dir verbatim — two entries sharing a leaf (e.g. `stt/eng`
 * and `tts/eng` both → `files/models/eng`) would merge an STT and a TTS
 * model into one directory, clobber tokens.txt, and can natively crash
 * the model loader. That was the chat-connect crash.
 *
 * Only ONE STT model + ONE TTS model ever live in RAM at a time (see
 * stt-engine.ts / HindiTTS.ts). Callers must init ONLY the selected
 * language's paths when a chat opens, and release on disconnect.
 *
 * Languages without a bundled `sttAssetPath`/`ttsAssetPath` are shown in
 * Settings with an (intentionally placeholder) Install button — the
 * download flow is not implemented yet.
 */

export type LanguageId =
  'en' | 'hi' | 'kn' | 'gu' | 'mr' | 'ml' | 'ta' | 'te' | 'or' | 'bn';

export type LanguageModel = {
  id: LanguageId;
  /** Display name shown in Settings / chat header. */
  label: string;
  /**
   * Asset dir relative to `assets/` (e.g. 'models/stt/stt-eng').
   * `null` = not bundled yet → needs install.
   */
  sttAssetPath: string | null;
  ttsAssetPath: string | null;
  /** True when both STT + TTS dirs ship with the app binary. */
  bundled: boolean;
};

export const DEFAULT_LANGUAGE_ID: LanguageId = 'en';

export const SUPPORTED_LANGUAGES: LanguageModel[] = [
  {
    id: 'en',
    label: 'English',
    sttAssetPath: 'models/stt/stt-eng',
    ttsAssetPath: 'models/tts/tts-eng',
    bundled: true,
  },
  {
    id: 'hi',
    label: 'Hindi',
    sttAssetPath: 'models/stt/stt-hin',
    ttsAssetPath: 'models/tts/tts-hin',
    bundled: true,
  },
  {
    id: 'kn',
    label: 'Kannada',
    sttAssetPath: 'models/stt/stt-kan',
    ttsAssetPath: 'models/tts/tts-kan',
    bundled: true,
  },
  // Below: listed in Settings but no on-device model ships yet.
  {
    id: 'gu',
    label: 'Gujarati',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
  {
    id: 'mr',
    label: 'Marathi',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
  {
    id: 'ml',
    label: 'Malayalam',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
  {
    id: 'ta',
    label: 'Tamil',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
  {
    id: 'te',
    label: 'Telugu',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
  {
    id: 'or',
    label: 'Odia',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
  {
    id: 'bn',
    label: 'Bengali',
    sttAssetPath: null,
    ttsAssetPath: null,
    bundled: false,
  },
];

export function getLanguage(id: LanguageId): LanguageModel {
  return (
    SUPPORTED_LANGUAGES.find((l) => l.id === id) ??
    SUPPORTED_LANGUAGES.find((l) => l.id === DEFAULT_LANGUAGE_ID)!
  );
}

export function getLanguageByLabel(label: string): LanguageModel {
  const found = SUPPORTED_LANGUAGES.find(
    (l) => l.label.toLowerCase() === label.trim().toLowerCase(),
  );
  return found ?? getLanguage(DEFAULT_LANGUAGE_ID);
}

/**
 * A language is "installed" when its model dirs ship with the app.
 * (Future: also return true for OTA-downloaded models with a .ready marker.)
 */
export function isLanguageInstalled(lang: LanguageModel): boolean {
  return lang.bundled && lang.sttAssetPath != null && lang.ttsAssetPath != null;
}

/** STT asset path for the given language, falling back to English default. */
export function sttPathFor(id: LanguageId): string {
  return (
    getLanguage(id).sttAssetPath ??
    getLanguage(DEFAULT_LANGUAGE_ID).sttAssetPath!
  );
}

/** TTS asset path for the given language, falling back to English default. */
export function ttsPathFor(id: LanguageId): string {
  return (
    getLanguage(id).ttsAssetPath ??
    getLanguage(DEFAULT_LANGUAGE_ID).ttsAssetPath!
  );
}
