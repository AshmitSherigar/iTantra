import type {
  StreamingTtsEngine,
  TtsStreamController,
} from 'react-native-sherpa-onnx/tts';
import { getSherpaTts } from '@/utils/sherpaNative';
import { ITTSService, HindiTTSConfig, TTSStatus } from '@/features/tts/types';
import { logger } from '@/utils/logger';

const MIN_STREAM_CHARS = 120;
const MAX_SYNTHESIS_CHARS = 400;

export function extractSpeakableChunks(buffer: string): {
  chunks: string[];
  remainder: string;
} {
  const chunks: string[] = [];
  let rest = buffer;

  const sentenceRe = /[^।.!?\n]+[।.!?\n]+/g;
  let lastEnd = 0;
  let m: RegExpExecArray | null;
  sentenceRe.lastIndex = 0;
  while ((m = sentenceRe.exec(rest)) !== null) {
    const sentence = m[0].trim();
    if (sentence) chunks.push(sentence);
    lastEnd = m.index + m[0].length;
  }
  if (lastEnd > 0) {
    rest = rest.slice(lastEnd);
  }

  const coalesced: string[] = [];
  if (chunks.length > 0) {
    let current = '';
    for (const s of chunks) {
      const candidate = current ? `${current} ${s}` : s;
      // Keep chunks in a smooth range: flush once we reach target size.
      if (current && current.length >= MIN_STREAM_CHARS) {
        coalesced.push(current);
        current = s;
      } else if (candidate.length > MAX_SYNTHESIS_CHARS) {
        if (current) coalesced.push(current);
        current = s;
      } else {
        current = candidate;
      }
    }
    if (current) coalesced.push(current);
    chunks.length = 0;
    chunks.push(...coalesced);
    // Sentences were emitted — keep the (possibly empty) tail as remainder
    if (!rest.trim()) {
      return { chunks, remainder: '' };
    }
  }

  if (rest.length >= MIN_STREAM_CHARS) {
    // Prefer a secondary phrase boundary (comma/semicolon/colon/dash) in
    // the second half so mid-sentence cuts land on a natural pause.
    const secondaryRe = /[,;:—–\-–]/g;
    let secondaryCut = -1;
    let sm: RegExpExecArray | null;
    secondaryRe.lastIndex = 0;
    while ((sm = secondaryRe.exec(rest)) !== null) {
      if (sm.index > MIN_STREAM_CHARS * 0.5) secondaryCut = sm.index;
    }
    if (secondaryCut > 10 && rest.length - (secondaryCut + 1) > 5) {
      const head = rest.slice(0, secondaryCut + 1).trim();
      if (head) chunks.push(head);
      rest = rest.slice(secondaryCut + 1);
      return { chunks, remainder: rest };
    }
    const cutAt = rest.lastIndexOf(' ');
    // Keep at least a few chars of lookahead so we don't starve tiny tails.
    if (cutAt > 10) {
      const head = rest.slice(0, cutAt).trim();
      if (head) chunks.push(head);
      rest = rest.slice(cutAt + 1);
    }
  }

  return { chunks, remainder: rest };
}

const DEFAULT_SID = 0;
const DEFAULT_SPEED = 1.0;

export const DEFAULT_TTS_MODEL_PATH = 'models/tts/tts-eng';

class HindiTTS implements ITTSService {
  private engine: StreamingTtsEngine | null = null;
  private activeModelPath: string | null = null;
  private currentStream: TtsStreamController | null = null;
  private status: TTSStatus = {
    isInitialized: false,
    isSpeaking: false,
    queueLength: 0,
  };

  private queue: string[] = [];
  private isPumping = false;
  private pcmActive = false;
  private pcmWriteChain: Promise<void> = Promise.resolve();
  private currentDone: (() => void) | null = null;

  private streamBuffer = '';

  async initialize(config?: HindiTTSConfig): Promise<void> {
    const modelPath = config?.modelPath ?? DEFAULT_TTS_MODEL_PATH;

    if (this.status.isInitialized && this.activeModelPath === modelPath) {
      if (config?.debug)
        logger.debug('TTS', 'Already initialized', { modelPath });
      return;
    }
    if (this.status.isInitialized && this.activeModelPath !== modelPath) {
      logger.info('TTS', 'Switching model and releasing old engine first', {
        previousModel: this.activeModelPath,
        nextModel: modelPath,
      });
      await this.destroy();
    }

    try {
      const ttsModule = getSherpaTts();
      if (!ttsModule) {
        throw new Error('TTS is not supported on this platform.');
      }
      const modelPathConfig = { type: 'asset', path: modelPath } as const;

      if (config?.debug) {
        logger.debug('TTS', 'Detecting model');
        const detection = await ttsModule.detectTtsModel(modelPathConfig);
        logger.debug('TTS', 'Model detection completed', detection);
      }

      logger.info('TTS', 'Creating voice engine', { modelPath });
      this.engine = await ttsModule.createStreamingTTS({
        modelPath: modelPathConfig,
        modelType: 'vits',
        provider: 'cpu',
        numThreads: 4,
        debug: config?.debug ?? false,
      });

      logger.debug('TTS', 'Voice engine created; reading model info', {
        modelPath,
      });
      const { sampleRate, numSpeakers } = await this.engine.getModelInfo();
      this.activeModelPath = modelPath;
      this.status = {
        isInitialized: true,
        isSpeaking: false,
        queueLength: 0,
        sampleRate,
        numSpeakers,
      };

      if (config?.debug) {
        logger.info('TTS', 'Initialized successfully', {
          modelPath,
          sampleRate,
          numSpeakers,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.activeModelPath = null;
      this.status.error = errorMsg;
      if (config?.debug) logger.error('TTS', 'Initialization failed', errorMsg);
      throw err;
    }
  }

  /** Interrupt everything and speak `text` right away. */
  async speak(text: string): Promise<void> {
    if (!this.engine || !this.status.isInitialized) {
      throw new Error('TTS Engine not initialized.');
    }
    const clean = text?.trim();
    if (!clean) return;

    await this.stop();

    this.queue = [clean];
    this.pumpQueue();
  }

  enqueueSpeak(text: string): void {
    if (!this.engine || !this.status.isInitialized) return;
    const clean = text?.trim();
    if (!clean) return;
    for (const part of this.splitForSynthesis(clean)) this.queue.push(part);
    this.syncStatus();
    this.pumpQueue();
  }
  private splitForSynthesis(text: string): string[] {
    if (text.length <= MAX_SYNTHESIS_CHARS) return [text];
    const { chunks, remainder } = extractSpeakableChunks(text);
    const parts: string[] = [];
    let current = '';
    const flush = () => {
      if (current.trim()) parts.push(current.trim());
      current = '';
    };
    for (const c of [
      ...chunks,
      ...(remainder.trim() ? [remainder.trim()] : []),
    ]) {
      const candidate = current ? `${current} ${c}` : c;
      if (candidate.length > MAX_SYNTHESIS_CHARS) {
        flush();
        current = c;
        while (current.length > MAX_SYNTHESIS_CHARS) {
          const cut = current.lastIndexOf(' ', MAX_SYNTHESIS_CHARS);
          const at = cut > 10 ? cut : MAX_SYNTHESIS_CHARS;
          parts.push(current.slice(0, at).trim());
          current = current.slice(at).trim();
        }
      } else {
        current = candidate;
      }
    }
    flush();
    return parts.length > 0 ? parts : [text];
  }

  startStreamingUtterance(): void {
    if (this.streamBuffer.trim()) {
      this.finishStreamingUtterance();
    }
    this.streamBuffer = '';
  }

  appendStreamingText(partialText: string): void {
    if (!this.engine || !this.status.isInitialized) return;
    if (!partialText) return;
    this.streamBuffer += partialText;
    const { chunks, remainder } = extractSpeakableChunks(this.streamBuffer);
    this.streamBuffer = remainder;
    for (const c of chunks) {
      if (c.trim()) this.queue.push(c.trim());
    }
    if (chunks.length > 0) {
      this.syncStatus();
      this.pumpQueue();
    }
  }

  /** Speak whatever partial text is left in the stream buffer. */
  finishStreamingUtterance(): void {
    if (!this.engine || !this.status.isInitialized) {
      this.streamBuffer = '';
      return;
    }
    const tail = this.streamBuffer.trim();
    this.streamBuffer = '';
    if (tail) {
      const last = this.queue[this.queue.length - 1];
      if (last && `${last} ${tail}`.length <= MAX_SYNTHESIS_CHARS) {
        this.queue[this.queue.length - 1] = `${last} ${tail}`;
      } else {
        this.queue.push(tail);
      }
      this.syncStatus();
      this.pumpQueue();
    }
  }

  private syncStatus(): void {
    this.status.isSpeaking = this.isPumping || this.queue.length > 0;
    this.status.queueLength = this.queue.length + (this.isPumping ? 1 : 0);
  }

  private pumpQueue(): void {
    if (this.isPumping) return;
    if (!this.engine || !this.status.isInitialized) return;
    if (this.queue.length === 0) return;

    this.isPumping = true;
    this.syncStatus();

    void (async () => {
      try {
        while (this.queue.length > 0) {
          const text = this.takeNextBatch();
          this.syncStatus();
          try {
            await this.synthesizeOne(text);
          } catch (err) {
            logger.error('TTS', 'Synthesis failed for chunk', err);
            // Continue with the rest of the queue instead of stalling.
          }
        }
      } finally {
        this.isPumping = false;
        // Keep the player open only while there is work; otherwise stop
        if (this.queue.length === 0 && this.pcmActive) {
          try {
            await this.pcmWriteChain;
            await this.engine?.stopPcmPlayer();
          } catch {
            // ignore — player may already be stopped
          }
          this.pcmActive = false;
        }
        this.syncStatus();
      }
    })();
  }

  private takeNextBatch(): string {
    const first = this.queue.shift()!;
    let batch = first;
    while (this.queue.length > 0) {
      const next = this.queue[0];
      const candidate = `${batch} ${next}`;
      if (candidate.length > MAX_SYNTHESIS_CHARS) break;
      batch = candidate;
      this.queue.shift();
    }
    return batch;
  }

  private synthesizeOne(text: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const engine = this.engine;
      if (!engine) {
        resolve();
        return;
      }

      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          void this.pcmWriteChain.then(() => {
            this.currentStream = null;
            this.currentDone = null;
            resolve();
          });
        }
      };
      this.currentDone = () => {
        if (!settled) {
          settled = true;
          this.currentStream = null;
          this.currentDone = null;
          resolve();
        }
      };

      void (async () => {
        try {
          if (!this.pcmActive) {
            const sampleRate = await engine.getSampleRate();
            await engine.startPcmPlayer(sampleRate, 1);
            this.pcmActive = true;
          }

          this.currentStream = await engine.generateSpeechStream(
            text,
            { sid: DEFAULT_SID, speed: DEFAULT_SPEED },
            {
              onChunk: (chunk) => {
                if (!chunk.samples || chunk.samples.length === 0) return;
                this.pcmWriteChain = this.pcmWriteChain
                  .then(() => engine.writePcmChunk(chunk.samples))
                  .catch((err) => {
                    logger.error('TTS', 'Error writing PCM chunk', err);
                  });
              },
              onEnd: () => done(),
              onError: (event) => {
                logger.error('TTS', 'Stream error', event.message);
                this.status.error = event.message;
                done();
              },
            },
          );
        } catch (err) {
          logger.error('TTS', 'generateSpeechStream failed', err);
          done();
        }
      })();
    });
  }

  async stop(): Promise<void> {
    this.queue = [];
    this.streamBuffer = '';
    this.pcmWriteChain = Promise.resolve();
    if (this.currentStream) {
      try {
        await this.currentStream.cancel();
      } catch {
        // ignore cancel errors (already ended)
      }
      this.currentStream = null;
    }
    this.currentDone?.();
    this.currentDone = null;
    if (this.engine && this.pcmActive) {
      try {
        await this.engine.stopPcmPlayer();
      } catch {
        // ignore
      }
      this.pcmActive = false;
    }
    this.isPumping = false;
    this.status.isSpeaking = false;
    this.status.queueLength = 0;
  }

  async destroy(): Promise<void> {
    await this.stop();
    if (this.engine) {
      await this.engine.destroy();
      this.engine = null;
    }
    if (this.activeModelPath) {
      logger.info('TTS', 'Engine released and RAM freed', {
        modelPath: this.activeModelPath,
      });
    }
    this.activeModelPath = null;
    this.status = {
      isInitialized: false,
      isSpeaking: false,
      queueLength: 0,
    };
  }

  getStatus(): TTSStatus {
    return this.status;
  }

  getActiveModelPath(): string | null {
    return this.activeModelPath;
  }
}

export const hindiTTS = new HindiTTS();
