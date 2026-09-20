import {
  createStreamingTTS,
  detectTtsModel,
} from 'react-native-sherpa-onnx/tts';
import type {
  StreamingTtsEngine,
  TtsStreamController,
} from 'react-native-sherpa-onnx/tts';
import { ITTSService, HindiTTSConfig, TTSStatus } from './types';

// Target size for one smooth native synthesis. Fewer, larger generations
// = fewer inter-chunk pauses. Native streams PCM progressively inside a
// generation, so a 300-400 char request still starts playing quickly.
const MIN_STREAM_CHARS = 120;
const MAX_SYNTHESIS_CHARS = 400;

/**
 * Split `buffer` into speakable chunks + remainder.
 *
 * - Complete sentences ending in । . ! ? \n are emitted immediately.
 * - If no sentence boundary is available yet but the buffer is long,
 *   split at the last space so speech can still start early
 *   (important for packet-streamed BLE messages without punctuation).
 *
 * Chunk sizing matters for gapless playback: every emitted chunk becomes
 * (or joins) a separate native `generateSpeechStream` call, and each call
 * boundary can produce an audible pause (model setup + sentence silence
 * padding + PCM buffer drain). So we deliberately wait for fairly large
 * chunks (~120 chars) instead of tiny 30-40 char fragments — fewer
 * generations = fewer pauses. Native VITS already streams audio
 * sentence-by-sentence inside a single generation, so bigger requests
 * still start playing fast (low time-to-first-byte).
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

  // If we already have one or more complete sentences, coalesce small
  // sentences into fewer, larger chunks. Without this a big message like
  // "राम ...। श्याम ...। ..." becomes N tiny native generations with a
  // pause between each — the reported "reads few words then stops".
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
    // unless it is itself long enough to speak (handled below).
    if (!rest.trim()) {
      return { chunks, remainder: '' };
    }
  }

  // No full sentence yet — but if the tail is getting long, speak up to
  // the last word boundary so playback still starts before END arrives.
  // Threshold is intentionally large (~120 chars ≈ 8-12s of Hindi speech
  // per generation is still small for VITS) to avoid tiny fragments.
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

/** Default TTS asset dir (English). Kept in sync with features/models/languages.ts. */
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

  // Sequential synthesis queue. Only one generateSpeechStream runs at a
  // time (native rejects concurrent streams); the PCM player stays open
  // across queued items so audio plays gaplessly.
  private queue: string[] = [];
  private isPumping = false;
  private pcmActive = false;
  // Serializes AudioTrack writes so PCM chunks from native callbacks land
  // in order. Without this, fire-and-forget writes from rapid onChunk
  // events can interleave across chunk boundaries (stutter/gaps), and the
  // pump can start the next generation while the previous tail is still
  // being written.
  private pcmWriteChain: Promise<void> = Promise.resolve();
  // Resolver for the in-flight synthesizeOne — lets stop() force-resolve a
  // synthesis whose native end/error event never arrives after cancel().
  private currentDone: (() => void) | null = null;

  // Partial text for the current packet-streamed utterance that has not
  // yet formed a speakable chunk.
  private streamBuffer = '';

  private sid = DEFAULT_SID;
  private speed = DEFAULT_SPEED;

  async initialize(config?: HindiTTSConfig): Promise<void> {
    const modelPath = config?.modelPath ?? DEFAULT_TTS_MODEL_PATH;

    // Idempotent for the same language; switching languages frees the old
    // native engine FIRST so peak RAM never holds two (~228MB would OOM).
    if (this.status.isInitialized && this.activeModelPath === modelPath) {
      if (config?.debug)
        console.log(`[VoiceTTS] Already initialized (${modelPath}).`);
      return;
    }
    if (this.status.isInitialized && this.activeModelPath !== modelPath) {
      console.log(
        `[VoiceTTS] Switching model ${this.activeModelPath} -> ${modelPath}: releasing old engine first`,
      );
      await this.destroy();
    }

    try {
      const modelPathConfig = { type: 'asset', path: modelPath } as const;

      if (config?.debug) {
        console.log('[VoiceTTS] Detecting model...');
        const detection = await detectTtsModel(modelPathConfig);
        console.log('[VoiceTTS] Detection result:', detection);
      }

      // Staged markers: a native kill preserves already-flushed logs, so the
      // last visible marker pinpoints a native loader crash.
      console.log(`[VoiceTTS] step=create (${modelPath})`);
      this.engine = await createStreamingTTS({
        modelPath: modelPathConfig,
        modelType: 'vits',
        provider: 'cpu',
        // 4 threads keeps VITS synthesis ahead of realtime playback on
        // modern phones. With 2 threads long messages synthesize slower
        // than they play → PCM underrun → "few words, pause, few words".
        numThreads: 4,
        debug: config?.debug ?? false,
      });

      console.log(
        `[VoiceTTS] step=created (${modelPath}), reading model info…`,
      );
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
        console.log(
          `[VoiceTTS] Initialized successfully (${modelPath}). Sample Rate: ${sampleRate}, Speakers: ${numSpeakers}`,
        );
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.activeModelPath = null;
      this.status.error = errorMsg;
      if (config?.debug)
        console.error('[VoiceTTS] Initialization failed:', errorMsg);
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
    // Send big messages as ONE (or few large) native generations, not many
    // tiny ones. Native VITS already streams PCM sentence-by-sentence
    // inside a single generateSpeechStream, so a large request still starts
    // playing fast but has no inter-generation pauses. Splitting here was
    // the main cause of "reads few words then stops" on long messages.
    for (const part of this.splitForSynthesis(clean)) this.queue.push(part);
    this.syncStatus();
    this.pumpQueue();
  }

  /**
   * Split only when the text is very long, keeping each native request in
   * the smooth range (<= MAX_SYNTHESIS_CHARS) at sentence boundaries.
   * Short/medium messages always stay a single generation (gapless).
   */
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
        // A single sentence longer than max — hard-split at word boundary.
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

  /**
   * Drop buffered-but-unspoken stream text WITHOUT speaking it and without
   * touching already-queued speech. Used when a streamed payload turns out
   * to be something that must never be spoken (mesh broadcast JSON detected
   * mid-stream, corrupt bytes) — otherwise finishStreamingUtterance() would
   * speak the buffered gibberish as a tail.
   */
  discardStreamingBuffer(): void {
    this.streamBuffer = '';
  }

  /** Speak whatever partial text is left in the stream buffer. */
  finishStreamingUtterance(): void {    if (!this.engine || !this.status.isInitialized) {
      this.streamBuffer = '';
      return;
    }
    const tail = this.streamBuffer.trim();
    this.streamBuffer = '';
    if (tail) {
      // Merge a tiny tail into the last queued item when it fits — avoids
      // one extra short native generation (audible pause) at the end of
      // every long message.
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

  /**
   * Sequentially synthesize everything in `queue`. Resolves when drained;
   * concurrent callers are coalesced via `isPumping`.
   *
   * Pending items are coalesced into a single generation (up to
   * MAX_SYNTHESIS_CHARS) so a big message that arrived as several small
   * streaming pushes is still synthesized in few large requests — this is
   * what removes the pause-between-every-few-words on long messages.
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
          const text = this.takeNextBatch();
          this.syncStatus();
          try {
            await this.synthesizeOne(text);
          } catch (err) {
            console.error('[VoiceTTS] Synthesis failed for chunk:', err);
            // Continue with the rest of the queue instead of stalling.
          }
        }
      } finally {
        this.isPumping = false;
        // Keep the player open only while there is work; otherwise stop
        // so the audio device is released (incoming mic recording, etc).
        if (this.queue.length === 0 && this.pcmActive) {
          try {
            // Drain any in-flight PCM writes before releasing the player
            // so the tail of a long message is not cut off.
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

  /** Pop 1+ queued items merged into one smooth synthesis request. */
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

  /**
   * Synthesize a single chunk and stream its PCM to the player.
   * Resolves when native signals onEnd / onError / cancel — after all
   * queued PCM writes for this chunk have been flushed in order.
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
          // Ensure the last PCM tail is actually written before the pump
          // starts the next generation; otherwise the next chunk's audio
          // can race ahead and sound like a stutter/gap.
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
            { sid: this.sid, speed: this.speed },
            {
              onChunk: (chunk) => {
                if (!chunk.samples || chunk.samples.length === 0) return;
                // Chain writes to preserve order across rapid callbacks.
                // WRITE_BLOCKING on native applies backpressure so the
                // AudioTrack buffer stays fed without overlap.
                this.pcmWriteChain = this.pcmWriteChain
                  .then(() => engine.writePcmChunk(chunk.samples))
                  .catch((err) => {
                    console.error('[VoiceTTS] Error writing PCM chunk:', err);
                  });
              },
              onEnd: () => done(),
              onError: (event) => {
                console.error('[VoiceTTS] Stream error:', event.message);
                this.status.error = event.message;
                done();
              },
            },
          );
        } catch (err) {
          console.error('[VoiceTTS] generateSpeechStream failed:', err);
          done();
        }
      })();
    });
  }

  async stop(): Promise<void> {
    this.queue = [];
    this.streamBuffer = '';
    // Drop any chained PCM writes from the cancelled utterance so a new
    // speak() starts from a clean, resolved chain.
    this.pcmWriteChain = Promise.resolve();
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
    if (this.activeModelPath) {
      console.log(
        `[VoiceTTS] Engine released (was ${this.activeModelPath}), RAM freed`,
      );
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
