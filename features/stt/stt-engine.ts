import { Platform } from 'react-native';
import { createSTT } from 'react-native-sherpa-onnx/stt';

type STTInstance = Awaited<ReturnType<typeof createSTT>>;

export class STTEngine {
  private stt: STTInstance | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.stt) return;

    if (this.initPromise) {
      return this.initPromise;
    }

    if (Platform.OS === 'web') {
      console.warn('STT is not supported on web.');
      return;
    }

    this.initPromise = (async () => {
      try {
        this.stt = await createSTT({
          modelPath: {
            type: 'asset',
            // Points to the named subdirectory under assets/models/
            path: 'models/indiconformer',
          },
          modelType: 'nemo_ctc',
          preferInt8: true,
          debug: true,
        });
        console.log('STT engine initialized successfully');
      } catch (e) {
        console.error('Failed to initialize STT:', e);
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  async transcribeFile(filePath: string): Promise<string> {
    if (!this.stt) {
      await this.init();
    }

    if (!this.stt) {
      throw new Error(
        'STT Engine not initialized. (Native module missing, running on Web, or init failed)'
      );
    }

    const result = await this.stt.transcribeFile(filePath);
    return result.text;
  }

  async cleanup(): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }

    if (this.stt) {
      await this.stt.destroy();
      this.stt = null;
    }
  }
}

export const sttEngine = new STTEngine();