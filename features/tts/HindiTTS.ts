import { createStreamingTTS, detectTtsModel } from 'react-native-sherpa-onnx/tts';
import type { StreamingTtsEngine, TtsStreamController } from 'react-native-sherpa-onnx/tts';
import { ITTSService, HindiTTSConfig, TTSStatus } from './types';

/**
 * Split `buffer` into speakable chunks + remainder.
 *
 * - Complete sentences ending in । . ! ? \n are emitted immediately.
 * - If no sentence boundary is available yet but the buffer is long,
 *   split at the last space so speech can still start early
 *   (important for packet-streamed BLE messages without punctuation).
 */
export function extractSpeakableChunks(buffer: string): {
  chunks: string[];
  remainder: string;
} {
  const chunks: string[] = [];
  let rest = buffer;

  // Pull off complete sentences first.
  // Matches runs of chars terminated by a sentence ender.
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

  // No full sentence yet — but if the tail is getting long, speak up to
  // the last word boundary so playback still starts before END arrives.
  const MIN_CHUNK_CHARS = 40;
  if (rest.length >= MIN_CHUNK_CHARS) {
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

class HindiTTS implements ITTSService {
  private engine: StreamingTtsEngine | null = null;
  private currentStream: TtsStreamController | null = null;
  private status: TTSStatus = {
    isInitialized: false,
    isSpeaking: false,
    queueLength: 0,
  };

  // Sequential synthesis queue. Only one generateSpeechStream runs at a
  // time (native rejects concurrent streams); the PCM player stays open
  // across queued items so audio plays gaplessly.
  private queue: string[] = [];
  private isPumping = false;
  private pcmActive = false;
  // Resolver for the in-flight synthesizeOne — lets stop() force-resolve a
  // synthesis whose native end/error event never arrives after cancel().
  private currentDone: (() => void) | null = null;

  // Partial text for the current packet-streamed utterance that has not
  // yet formed a speakable chunk.
  private streamBuffer = '';

  private sid = DEFAULT_SID;
  private speed = DEFAULT_SPEED;

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
        queueLength: 0,
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

  setVoice(sid: number, speed = 1.0): void {
    this.sid = sid;
    this.speed = speed;
  }

  /** Interrupt everything and speak `text` right away. */
  async speak(text: string): Promise<void> {
    if (!this.engine || !this.status.isInitialized) {
      throw new Error('TTS Engine not initialized.');
    }
    const clean = text?.trim();
    if (!clean) return;

    // Interrupt: drop queued + buffered speech, cancel in-flight synthesis.
    await this.stop();

    this.queue = [clean];
    this.pumpQueue();
  }

  /** Queue a complete message behind anything currently playing. */
  enqueueSpeak(text: string): void {
    if (!this.engine || !this.status.isInitialized) return;
    const clean = text?.trim();
    if (!clean) return;
    // Split long messages into sentence chunks so each synthesis request
    // stays small and first audio starts fast.
    const { chunks, remainder } = extractSpeakableChunks(clean);
    for (const c of chunks) this.queue.push(c);
    if (remainder.trim()) this.queue.push(remainder.trim());
    this.syncStatus();
    this.pumpQueue();
  }

  /** Begin a new incremental utterance (e.g. a new BLE message). */
  startStreamingUtterance(): void {
    // Flush any leftover from a previous utterance that never got END.
    if (this.streamBuffer.trim()) {
      this.finishStreamingUtterance();
    }
    this.streamBuffer = '';
  }

  /**
   * Feed newly-decoded text from incoming BLE packets. Speakable units
   * are queued immediately — this is what makes speech start while later
   * packets are still in flight.
   */
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
      this.queue.push(tail);
      this.syncStatus();
      this.pumpQueue();
    }
  }

  private syncStatus(): void {
    this.status.isSpeaking = this.isPumping || this.queue.length > 0;
    this.status.queueLength = this.queue.length + (this.isPumping ? 1 : 0);
  }

  /**
   * Sequentially synthesize everything in `queue`. Resolves when drained;
   * concurrent callers are coalesced via `isPumping`.
   */
  private pumpQueue(): void {
    if (this.isPumping) return;
    if (!this.engine || !this.status.isInitialized) return;
    if (this.queue.length === 0) return;

    this.isPumping = true;
    this.syncStatus();

    void (async () => {
      try {
        while (this.queue.length > 0) {
          const text = this.queue.shift()!;
          this.syncStatus();
          try {
            await this.synthesizeOne(text);
          } catch (err) {
            console.error('[HindiTTS] Synthesis failed for chunk:', err);
            // Continue with the rest of the queue instead of stalling.
          }
        }
      } finally {
        this.isPumping = false;
        // Keep the player open only while there is work; otherwise stop
        // so the audio device is released (incoming mic recording, etc).
        if (this.queue.length === 0 && this.pcmActive) {
          try {
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

  /**
   * Synthesize a single chunk and stream its PCM to the player.
   * Resolves when native signals onEnd / onError / cancel.
   */
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
          this.currentStream = null;
          this.currentDone = null;
          resolve();
        }
      };
      this.currentDone = done;

      void (async () => {
        try {
          if (!this.pcmActive) {
            const sampleRate = await engine.getSampleRate();
            await engine.startPcmPlayer(sampleRate, 1);
            this.pcmActive = true;
          }

          this.currentStream = await engine.generateSpeechStream(
            text,
            { sid: this.sid, speed: this.speed },
            {
              onChunk: (chunk) => {
                engine.writePcmChunk(chunk.samples).catch((err) => {
                  console.error('[HindiTTS] Error writing PCM chunk:', err);
                });
              },
              onEnd: () => done(),
              onError: (event) => {
                console.error('[HindiTTS] Stream error:', event.message);
                this.status.error = event.message;
                done();
              },
            },
          );
        } catch (err) {
          console.error('[HindiTTS] generateSpeechStream failed:', err);
          done();
        }
      })();
    });
  }

  async stop(): Promise<void> {
    this.queue = [];
    this.streamBuffer = '';
    if (this.currentStream) {
      try {
        await this.currentStream.cancel();
      } catch {
        // ignore cancel errors (already ended)
      }
      this.currentStream = null;
    }
    // Force-resolve in-flight synthesis in case native never emits end/error
    // after cancel — prevents a hung pump loop + concurrent generations.
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
    this.status = {
      isInitialized: false,
      isSpeaking: false,
      queueLength: 0,
    };
  }

  getStatus(): TTSStatus {
    return this.status;
  }
}

export const hindiTTS = new HindiTTS();
