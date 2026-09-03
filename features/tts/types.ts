export interface HindiTTSConfig {
  /** Should provide useful logging in __DEV__ */
  debug?: boolean;
}

export interface TTSStatus {
  isInitialized: boolean;
  isSpeaking: boolean;
  error?: string;
  sampleRate?: number;
  numSpeakers?: number;
  /** Number of utterances waiting in the queue (including the one playing). */
  queueLength?: number;
}

export interface ITTSService {
  initialize(config?: HindiTTSConfig): Promise<void>;
  /** Interrupt current speech and speak immediately. */
  speak(text: string): Promise<void>;
  /** Queue a complete message behind anything currently playing. */
  enqueueSpeak(text: string): void;
  /**
   * Begin a new incremental (packet-streamed) utterance.
   * Any unfinished stream buffer is flushed first.
   */
  startStreamingUtterance(): void;
  /**
   * Append newly-arrived text for the current streaming utterance.
   * Complete sentences / long-enough fragments are queued for
   * synthesis immediately so playback starts before the full
   * message has arrived.
   */
  appendStreamingText(partialText: string): void;
  /** Flush whatever is left in the stream buffer into the queue. */
  finishStreamingUtterance(): void;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): TTSStatus;
}
