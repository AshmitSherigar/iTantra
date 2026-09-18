import { Platform } from 'react-native';
import type { createSTT as CreateSTTType } from 'react-native-sherpa-onnx/stt';
import { getSherpaStt } from '@/utils/sherpaNative';
import { logger } from '@/utils/logger';

type STTInstance = Awaited<ReturnType<typeof CreateSTTType>>;

export type STTStatus = {
  isInitialized: boolean;
  isInitializing: boolean;
  activeModelPath: string | null;
  lastError: string | null;
};

const DEFAULT_MODEL_PATH = 'models/stt/stt-eng';

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

  getActiveModelPath(): string | null {
    return this.activeModelPath;
  }

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
      logger.warn('STT', msg);
      this.lastError = msg;
      return;
    }

    if (this.stt) {
      logger.info('STT', 'Switching model and releasing old engine first', {
        previousModel: this.activeModelPath,
        nextModel: modelPath,
      });
      await this.cleanup();
    }

    logger.info('STT', 'Initializing model', { modelPath });
    this.lastError = null;

    this.initPromise = (async () => {
      try {
        const sttModule = getSherpaStt();
        if (!sttModule) {
          throw new Error('STT is not supported on this platform.');
        }
        this.stt = await sttModule.createSTT({
          modelPath: {
            type: 'asset',
            path: modelPath,
          },
          modelType: 'nemo_ctc',
          preferInt8: true,
          debug: true,
        });
        this.activeModelPath = modelPath;
        this.lastError = null;
        logger.info('STT', 'Engine initialized successfully', { modelPath });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.lastError = msg;
        this.stt = null;
        this.activeModelPath = null;
        logger.error('STT', 'Failed to initialize', { modelPath, error: msg });
        throw e;
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async ensureInitialized(
    modelPath: string = DEFAULT_MODEL_PATH,
  ): Promise<void> {
    return this.init(modelPath);
  }

  private requireEngine(): STTInstance {
    if (!this.stt) {
      throw new Error(
        this.lastError
          ? `STT Engine not initialized (last error: ${this.lastError})`
          : 'STT Engine not initialized. Call ensureInitialized() after BLE connect first. (Native module missing, running on Web, or init failed)',
      );
    }
    return this.stt;
  }

  async transcribeSamples(
    samples: number[],
    sampleRate: number,
  ): Promise<string> {
    if (!this.stt) {
      await this.init();
    }
    const engine = this.requireEngine();
    const seconds = samples.length / sampleRate;
    logger.debug('STT', 'transcribeSamples started', {
      sampleCount: samples.length,
      sampleRate,
      durationSeconds: Number(seconds.toFixed(1)),
      modelPath: this.activeModelPath,
    });
    const result = await engine.transcribeSamples(samples, sampleRate);
    const text = (result.text ?? '').trim();
    if (text) {
      logger.info('STT', 'Transcription completed', {
        characterCount: text.length,
      });
    } else {
      logger.warn('STT', 'Model returned empty text');
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
        logger.warn('STT', 'destroy() failed (ignored)', e);
      }
      this.stt = null;
    }
    if (this.activeModelPath) {
      logger.info('STT', 'Engine released and RAM freed', {
        modelPath: this.activeModelPath,
      });
    }
    this.activeModelPath = null;
  }

  async release(): Promise<void> {
    return this.cleanup();
  }
}

export const sttEngine = new STTEngine();
