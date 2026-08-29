import { createStreamingTTS, detectTtsModel } from 'react-native-sherpa-onnx/tts';
import type { StreamingTtsEngine, TtsStreamController } from 'react-native-sherpa-onnx/tts';
import { ITTSService, HindiTTSConfig, TTSStatus } from './types';

class HindiTTS implements ITTSService {
  private engine: StreamingTtsEngine | null = null;
  private currentStream: TtsStreamController | null = null;
  private status: TTSStatus = {
    isInitialized: false,
    isSpeaking: false,
  };

  async initialize(config?: HindiTTSConfig): Promise<void> {
    if (this.status.isInitialized) {
      if (config?.debug) console.log('[HindiTTS] Already initialized.');
      return;
    }

    try {
      const modelPathConfig = { type: 'asset', path: 'models/tts' } as const;
      
      if (config?.debug) {
        console.log('[HindiTTS] Detecting model...');
        const detection = await detectTtsModel(modelPathConfig);
        console.log('[HindiTTS] Detection result:', detection);
      }

      this.engine = await createStreamingTTS({
        modelPath: modelPathConfig,
        modelType: 'vits',
        provider: 'cpu',
        numThreads: 2,
        debug: config?.debug ?? false,
      });

      const { sampleRate, numSpeakers } = await this.engine.getModelInfo();
      this.status = {
        isInitialized: true,
        isSpeaking: false,
        sampleRate,
        numSpeakers,
      };

      if (config?.debug) {
        console.log(`[HindiTTS] Initialized successfully. Sample Rate: ${sampleRate}, Speakers: ${numSpeakers}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.status.error = errorMsg;
      if (config?.debug) console.error('[HindiTTS] Initialization failed:', errorMsg);
      throw err;
    }
  }

  async speak(text: string): Promise<void> {
    if (!this.engine || !this.status.isInitialized) {
      throw new Error('TTS Engine not initialized.');
    }
    
    // Stop any ongoing speech
    await this.stop();

    try {
      this.status.isSpeaking = true;
      
      const sampleRate = await this.engine.getSampleRate();
      // Start the PCM player on Android. (Mono output)
      await this.engine.startPcmPlayer(sampleRate, 1);

      this.currentStream = await this.engine.generateSpeechStream(
        text,
        {
          sid: 0,
          speed: 1.0,
        },
        {
          onChunk: (chunk) => {
            if (this.engine) {
              this.engine.writePcmChunk(chunk.samples).catch(err => {
                console.error('[HindiTTS] Error writing PCM chunk:', err);
              });
            }
          },
          onEnd: () => {
            this.engine?.stopPcmPlayer().catch(console.error);
            this.status.isSpeaking = false;
            this.currentStream = null;
          },
          onError: (event) => {
            console.error('[HindiTTS] Stream error:', event.message);
            this.engine?.stopPcmPlayer().catch(console.error);
            this.status.isSpeaking = false;
            this.status.error = event.message;
            this.currentStream = null;
          }
        }
      );
    } catch (err) {
      this.status.isSpeaking = false;
      this.engine.stopPcmPlayer().catch(console.error);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (this.currentStream) {
      await this.currentStream.cancel();
      this.currentStream = null;
    }
    if (this.engine) {
      await this.engine.stopPcmPlayer();
    }
    this.status.isSpeaking = false;
  }

  async destroy(): Promise<void> {
    await this.stop();
    if (this.engine) {
      await this.engine.destroy();
      this.engine = null;
    }
    this.status = {
      isInitialized: false,
      isSpeaking: false,
    };
  }

  getStatus(): TTSStatus {
    return this.status;
  }
}

export const hindiTTS = new HindiTTS();
