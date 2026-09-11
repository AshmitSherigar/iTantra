import { PorcupineManager } from '@picovoice/porcupine-react-native';
import { KWS_SENSITIVITY } from './kwsConfig';

export type KwsHandle = {
  /** Start mic + detection (no-op if already listening). */
  start: () => Promise<void>;
  /** Stop mic + detection. */
  stop: () => Promise<void>;
  /** Stop and free native resources. */
  release: () => void;
};

type CreateKwsOpts = {
  accessKey: string;
  /** Relative (assets/bundle) or absolute keyword paths, order = index. */
  keywordPaths: string[];
  onDetect: (keywordIndex: number) => void;
  onError: (message: string) => void;
};

/**
 * Thin wrapper around PorcupineManager. Kept behind this interface so the
 * engine can be swapped (e.g. fully-open Vosk build) without touching hooks
 * or UI. Inference is fully on-device; no audio ever leaves the phone.
 */
export async function createKwsManager(
  opts: CreateKwsOpts,
): Promise<KwsHandle> {
  const sensitivities = opts.keywordPaths.map(() => KWS_SENSITIVITY);
  const manager = await PorcupineManager.fromKeywordPaths(
    opts.accessKey,
    opts.keywordPaths,
    opts.onDetect,
    (error) => {
      opts.onError(error?.message ?? String(error));
    },
    undefined,
    undefined,
    sensitivities,
  );
  let released = false;
  return {
    start: async () => {
      if (released) throw new Error('KWS engine was released.');
      await manager.start();
    },
    stop: async () => {
      try {
        await manager.stop();
      } catch {
        // Stopping an idle engine throws — harmless.
      }
    },
    release: () => {
      released = true;
      try {
        manager.delete();
      } catch {}
    },
  };
}
