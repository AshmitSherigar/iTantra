import { Platform } from 'react-native';
import { createSTT } from 'react-native-sherpa-onnx/stt';

type STTInstance = Awaited<ReturnType<typeof createSTT>>;

export type STTStatus = {
  isInitialized: boolean;
  isInitializing: boolean;
  /** Active model path (e.g. 'models/indiconformer'). Only one model lives in RAM at a time. */
  activeModelPath: string | null;
  lastError: string | null;
};

const DEFAULT_MODEL_PATH = 'models/indiconformer';

/**
 * Singleton owner of the native STT recognizer.
 *
 * RAM discipline (important — each model is ~200MB native):
 * - NOTHING loads at import / app start. Call `ensureInitialized()` (e.g.
 *   when two BLE devices connect) to load, and `cleanup()` on disconnect
 *   to free the native memory.
 * - Only ONE model is ever resident: `init(modelPath)` with a different
 *   path destroys the previous engine first. Adding more languages later
 *   stays safe as long as callers switch via this class instead of
 *   creating extra engines.
 *
 * Every step logs with a `[STT]` prefix so the converted text is always
 * visible in Metro/Logcat even when the caller forgets to log.
 */
export class STTEngine {
  private stt: STTInstance | null = null;
  private initPromise: Promise<void> | null = null;
  private activeModelPath: string | null = null;
  private lastError: string | null = null;

  getStatus(): STTStatus {
    return {
      isInitialized: this.stt != null,
      isInitializing: this.initPromise != null,
      activeModelPath: this.activeModelPath,
      lastError: this.lastError,
    };
  }

  isInitialized(): boolean {
    return this.stt != null;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  /**
   * Load `modelPath` (defaults to IndicConformer). Idempotent: resolves
   * immediately if that exact model is already loaded; destroys the old
   * engine first when switching models so RAM never holds two.
   */
  async init(modelPath: string = DEFAULT_MODEL_PATH): Promise<void> {
    if (this.stt && this.activeModelPath === modelPath) return;

    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // fall through and retry below
      }
      if (this.stt && this.activeModelPath === modelPath) return;
    }

    if (Platform.OS === 'web') {
      const msg = 'STT is not supported on web.';
      console.warn(`[STT] ${msg}`);
      this.lastError = msg;
      return;
    }

    // Switching models: free the old native engine BEFORE allocating the
    // new one so peak RAM never holds both (~400MB would OOM low-end phones).
    if (this.stt) {
      console.log(
        `[STT] Switching model ${this.activeModelPath} -> ${modelPath}: releasing old engine first`
      );
      await this.cleanup();
    }

    console.log(`[STT] Initializing model: ${modelPath} ...`);
    this.lastError = null;

    this.initPromise = (async () => {
      try {
        this.stt = await createSTT({
          modelPath: {
            type: 'asset',
            // Points to the named subdirectory under assets/models/
            path: modelPath,
          },
          modelType: 'nemo_ctc',
          preferInt8: true,
          debug: true,
        });
        this.activeModelPath = modelPath;
        this.lastError = null;
        console.log(`[STT] Engine initialized successfully (${modelPath})`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.lastError = msg;
        this.stt = null;
        this.activeModelPath = null;
        console.error(`[STT] Failed to initialize (${modelPath}):`, msg);
        throw e;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /** Idempotent preload — safe to call on every BLE connect. */
  async ensureInitialized(modelPath: string = DEFAULT_MODEL_PATH): Promise<void> {
    return this.init(modelPath);
  }

  private requireEngine(): STTInstance {
    if (!this.stt) {
      throw new Error(
        this.lastError
          ? `STT Engine not initialized (last error: ${this.lastError})`
          : 'STT Engine not initialized. Call ensureInitialized() after BLE connect first. (Native module missing, running on Web, or init failed)'
      );
    }
    return this.stt;
  }

  async transcribeFile(filePath: string): Promise<string> {
    if (!this.stt) {
      await this.init();
    }
    const engine = this.requireEngine();
    console.log(`[STT] transcribeFile started: ${filePath}`);
    const result = await engine.transcribeFile(filePath);
    const text = (result.text ?? '').trim();
    if (text) {
      console.log(`[STT] transcribeFile result (${text.length} chars): "${text}"`);
    } else {
      console.warn('[STT] transcribeFile produced EMPTY text (no speech detected?)');
    }
    return result.text;
  }

  async transcribeSamples(samples: number[], sampleRate: number): Promise<string> {
    if (!this.stt) {
      await this.init();
    }
    const engine = this.requireEngine();
    const seconds = samples.length / sampleRate;
    console.log(
      `[STT] transcribeSamples started: ${samples.length} samples @ ${sampleRate}Hz (${seconds.toFixed(1)}s), model=${this.activeModelPath}`
    );
    const result = await engine.transcribeSamples(samples, sampleRate);
    const text = (result.text ?? '').trim();
    if (text) {
      console.log(`[STT] Transcribed text (${text.length} chars): "${text}"`);
    } else {
      console.warn('[STT] Model returned EMPTY text — no speech detected or audio too short/noisy.');
    }
    return result.text;
  }

  /** Free native memory. Call on BLE disconnect so RAM is released. */
  async cleanup(): Promise<void> {
    if (this.initPromise) {
      try {
        await this.initPromise;
      } catch {
        // init failed — still clear state below
      }
    }

    if (this.stt) {
      try {
        await this.stt.destroy();
      } catch (e) {
        console.warn('[STT] destroy() failed (ignored):', e);
      }
      this.stt = null;
    }
    if (this.activeModelPath) {
      console.log(`[STT] Engine released (was ${this.activeModelPath}), RAM freed`);
    }
    this.activeModelPath = null;
  }

  /** Alias for cleanup() — clearer at call sites. */
  async release(): Promise<void> {
    return this.cleanup();
  }
}

export const sttEngine = new STTEngine();
