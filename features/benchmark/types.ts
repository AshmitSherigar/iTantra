/**
 * iTantra Automated Telemetry & Benchmarking Types
 * Standardized across React Native, native modules, and ADB host scripts.
 */

export type BenchmarkStage =
  | 'AUDIO_RECORD_START'
  | 'AUDIO_RECORD_STOP'
  | 'STT_MODEL_LOAD_START'
  | 'STT_MODEL_LOAD_END'
  | 'STT_MODEL_UNLOAD_START'
  | 'STT_MODEL_UNLOAD_END'
  | 'STT_INFERENCE_START'
  | 'STT_INFERENCE_END'
  | 'BLE_PACKETIZE_START'
  | 'BLE_PACKETIZE_COMPLETE'
  | 'BLE_CHUNK_SENT'
  | 'BLE_TX_COMPLETE'
  | 'BLE_DISCOVERY_START'
  | 'BLE_DISCOVERY_END'
  | 'BLE_CONNECT_START'
  | 'BLE_CONNECT_END'
  | 'BLE_START_FRAME_RCVD'
  | 'BLE_CHUNK_RCVD'
  | 'BLE_REASSEMBLY_COMPLETE'
  | 'TTS_SYNTH_START'
  | 'TTS_FIRST_CHUNK_READY'
  | 'TTS_CHUNK_END'
  | 'TTS_SYNTH_COMPLETE'
  | 'TTS_MODEL_LOAD_START'
  | 'TTS_MODEL_LOAD_END'
  | 'TTS_MODEL_UNLOAD_START'
  | 'TTS_MODEL_UNLOAD_END'
  | 'AUDIOTRACK_FIRST_WRITE'
  | 'TTS_PLAYBACK_COMPLETE'
  | 'BENCHMARK_FAILURE';

export type BenchmarkEvent = {
  timestampNanos: number;
  timestampMillis: number;
  traceId: string;
  stage: BenchmarkStage;
  seqIndex?: number;
  charCount?: number;
  byteCount?: number;
  extraInfo?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type BenchmarkStats = {
  mean: number;
  median: number;
  p90: number;
  p95: number;
  min: number;
  max: number;
  stdDev: number;
  count: number;
};

export type TraceSummary = {
  traceId: string;
  sttDurationMs?: number;
  bleTxDurationMs?: number;
  bleReassemblyDurationMs?: number;
  bleConnectDurationMs?: number;
  bleDiscoveryToFirstDeviceMs?: number;
  sttModelLoadMs?: number;
  ttsModelLoadMs?: number;
  ttsTtfaMs?: number;
  ttsFirstPcmWriteMs?: number;
  ttsTotalDurationMs?: number;
  /** End-to-end only when valid matching lifecycle events share the trace. */
  endToEndLatencyMs?: number;
  eventsCount: number;
  startTimeMillis: number;
};

export type Utf8TestCase = {
  id: string;
  category:
    'ascii' | 'hindi' | 'kannada' | 'mixed' | 'boundary' | 'emoji' | 'stress';
  text: string;
  description: string;
};

export type Utf8TestResult = {
  testCase: Utf8TestCase;
  passed: boolean;
  originalByteLength: number;
  reassembledByteLength: number;
  packetsCount: number;
  containsReplacementChar: boolean;
  exactByteMatch: boolean;
  unicodeNfcMatch: boolean;
  executionTimeMs: number;
  error?: string;
};

export type SttBenchmarkResult = {
  audioFile: string;
  language: string;
  audioDurationMs: number;
  inferenceMs: number;
  rtf: number;
  transcribedText: string;
};
