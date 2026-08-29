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
}

export interface ITTSService {
  initialize(config?: HindiTTSConfig): Promise<void>;
  speak(text: string): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): TTSStatus;
}
