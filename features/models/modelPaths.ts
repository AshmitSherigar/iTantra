import { Platform } from 'react-native';
import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import {
  deleteAsync,
  readDirectoryAsync,
} from 'expo-file-system/legacy';

/**
 * Play Asset Delivery pack holding the speech models (see
 * plugins/withSherpaModelAssets.js — pack mode is enabled on EAS
 * production builds via `SHERPA_ASSET_PACK=1`).
 */
export const SHERPA_ASSET_PACK = 'sherpa_models';

type SherpaUtils = {
  getAssetPackPath?: (pack: string) => Promise<string | null>;
  resolveModelPath?: (config: ModelPathConfig) => Promise<string>;
};

function loadSherpaUtils(): SherpaUtils | null {
  try {
    // Lazy require: the native module isn't present on web / Expo Go.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('react-native-sherpa-onnx') as SherpaUtils;
  } catch {
    return null;
  }
}

function toFileUri(absPath: string): string {
  return absPath.startsWith('file://') ? absPath : `file://${absPath}`;
}

/**
 * True when `dir` exists and holds at least one .onnx weight file.
 * Anything else (missing dir, empty dir, tokens-only leftovers from a
 * killed extraction) can never initialise a model.
 */
async function dirHasOnnx(dir: string): Promise<boolean> {
  try {
    const names = await readDirectoryAsync(toFileUri(dir));
    return names.some((n) => n.toLowerCase().endsWith('.onnx'));
  } catch {
    return false;
  }
}

async function removeDir(dir: string): Promise<void> {
  try {
    await deleteAsync(toFileUri(dir), { idempotent: true });
  } catch {}
}

/**
 * Resolve a logical model path (e.g. 'models/tts/tts-hin', as listed in
 * languages.ts) to a native ModelPathConfig.
 *
 * Prefers the PAD pack: `getAssetPackPath()` returns the pack's on-disk
 * `models/` dir (STORAGE_FILES), so `{ type: 'file', ... }` lets
 * onnxruntime mmap the weights directly — no extraction copy, i.e. the
 * model exists exactly ONCE on the device.
 *
 * Falls back to `{ type: 'asset', ... }` (APK assets + one-time filesDir
 * extraction) when the pack isn't present: local `expo run:android` APKs,
 * Expo Go, iOS, and dev builds.
 *
 * Every candidate dir is verified to actually contain weights before use.
 * The native extractor silently "succeeds" leaving an EMPTY dir behind
 * when the APK has no such asset (e.g. a pack-mode build installed without
 * Play, so the pack never arrived) or when a previous extraction was
 * killed mid-copy — and that empty dir then fails every later launch with
 * "model file not found". Corrupt dirs are deleted so the next resolve
 * re-extracts; if the APK genuinely has no models, a clear error is
 * thrown instead of the cryptic native one.
 *
 * Callers keep tracking the LOGICAL path as the model identity (cache keys,
 * activeModelPath) — this function only decides how native reaches it.
 */
export async function resolveSpeechModelConfig(
  logicalPath: string,
): Promise<ModelPathConfig> {
  const leaf = logicalPath.split('/').pop() || logicalPath;
  if (Platform.OS === 'web') {
    return { type: 'asset', path: logicalPath };
  }
  const utils = loadSherpaUtils();

  // 1. Play Asset Delivery pack (single on-disk copy).
  try {
    if (typeof utils?.getAssetPackPath === 'function') {
      const packModelsDir = await utils.getAssetPackPath(SHERPA_ASSET_PACK);
      if (typeof packModelsDir === 'string' && packModelsDir.length > 0) {
        const candidate = `${packModelsDir}/${leaf}`;
        if (await dirHasOnnx(candidate)) {
          return { type: 'file', path: candidate };
        }
        console.warn(
          `[Models] asset pack present but '${leaf}' has no weights — falling back to APK assets.`,
        );
      }
    }
  } catch (e) {
    console.warn('[Models] asset-pack lookup failed, using APK assets:', e);
  }

  // 2. APK assets (+ native extraction to filesDir).
  const assetConfig: ModelPathConfig = { type: 'asset', path: logicalPath };
  try {
    if (typeof utils?.resolveModelPath === 'function') {
      // Force the extraction NOW so we can verify it, instead of
      // discovering an empty dir later inside the model loader.
      let resolved = await utils.resolveModelPath(assetConfig);
      if (!(await dirHasOnnx(resolved))) {
        // Stale/empty extraction (killed copy, or APK without this asset):
        // drop it so re-resolving re-extracts from the APK.
        await removeDir(resolved);
        resolved = await utils.resolveModelPath(assetConfig);
      }
      if (await dirHasOnnx(resolved)) {
        return assetConfig;
      }
      await removeDir(resolved);
    } else {
      return assetConfig;
    }
  } catch (e) {
    console.warn('[Models] asset resolve failed:', e);
  }
  throw new Error(
    `Speech model '${leaf}' is missing from this install. ` +
      'If this is a production build, install it via the Play Store (internal track) — ' +
      'sideloaded Play builds do not include the model asset pack. ' +
      'Otherwise reinstall the app.',
  );
}
