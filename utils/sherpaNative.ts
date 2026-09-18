import { Platform } from 'react-native';

/**
 * Web-safe lazy access to `react-native-sherpa-onnx` subpath modules.
 *
 * These are native (TurboModule) modules and crash when imported during
 * `expo export` static rendering. Always use these getters instead of
 * top-level `import ... from 'react-native-sherpa-onnx/...'`.
 * `import type` is fine (erased at build time) — only runtime imports break.
 */

type SttModule = typeof import('react-native-sherpa-onnx/stt');
type TtsModule = typeof import('react-native-sherpa-onnx/tts');
type AudioModule = typeof import('react-native-sherpa-onnx/audio');

export function getSherpaStt(): SttModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-sherpa-onnx/stt') as SttModule;
  } catch {
    return null;
  }
}

export function getSherpaTts(): TtsModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-sherpa-onnx/tts') as TtsModule;
  } catch {
    return null;
  }
}

export function getSherpaAudio(): AudioModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-sherpa-onnx/audio') as AudioModule;
  } catch {
    return null;
  }
}
