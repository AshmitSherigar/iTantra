/**
 *   assets/models/stt/stt-eng  (model.int8.onnx + tokens.txt)
 *   assets/models/stt/stt-hin
 *   assets/models/stt/stt-kan
 *   assets/models/tts/tts-eng  (model.onnx + config.json + tokens.txt)
 *   assets/models/tts/tts-hin
 *   assets/models/tts/tts-kan
 *   * * * * * * * * * * * * *
 */
export type LanguageId =
  'en' | 'hi' | 'kn' | 'gu' | 'mr' | 'ml' | 'ta' | 'te' | 'or' | 'bn';

export type LanguageModel = {
  id: LanguageId;
  label: string;
  sttAssetPath: string | null;
  ttsAssetPath: string | null;
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

export function isLanguageInstalled(lang: LanguageModel): boolean {
  return lang.bundled && lang.sttAssetPath != null && lang.ttsAssetPath != null;
}
