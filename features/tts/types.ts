export interface HindiTTSConfig {
  debug?: boolean;
  modelPath?: string;
}

export interface TTSStatus {
  isInitialized: boolean;
  isSpeaking: boolean;
  error?: string;
  sampleRate?: number;
  numSpeakers?: number;
  queueLength?: number;
}

export interface ITTSService {
  initialize(config?: HindiTTSConfig): Promise<void>;
  speak(text: string): Promise<void>;
  enqueueSpeak(text: string): void;
  startStreamingUtterance(): void;
  appendStreamingText(partialText: string): void;
  finishStreamingUtterance(): void;
  /** Drop buffered-but-unspoken stream text without speaking it. */
  discardStreamingBuffer(): void;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): TTSStatus;
}
