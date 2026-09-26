import {
  BenchmarkEvent,
  BenchmarkStage,
  BenchmarkStats,
  TraceSummary,
} from './types';

const MAX_EVENT_BUFFER = 2000;
const TAG = 'ITANTRA_BENCHMARK';

export class BenchmarkLogger {
  private static instance: BenchmarkLogger | null = null;
  private events: BenchmarkEvent[] = [];
  private listeners: Set<(event: BenchmarkEvent) => void> = new Set();
  private enabled: boolean = true;

  private constructor() {}

  static getInstance(): BenchmarkLogger {
    if (!BenchmarkLogger.instance) {
      BenchmarkLogger.instance = new BenchmarkLogger();
    }
    return BenchmarkLogger.instance;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  subscribe(listener: (event: BenchmarkEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  generateTraceId(prefix: string = 'msg'): string {
    const ts = Date.now().toString(36);
    const rand = Math.floor(Math.random() * 0xffff).toString(36);
    return `${prefix}_${ts}_${rand}`;
  }

  logEvent(
    stage: BenchmarkStage,
    traceId: string,
    opts?: {
      seqIndex?: number;
      charCount?: number;
      byteCount?: number;
      extraInfo?: string;
      metadata?: Record<string, string | number | boolean | null>;
    },
  ): BenchmarkEvent {
    const timestampMillis = Date.now();
    const perfNow =
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
        ? performance.now()
        : timestampMillis;
    const timestampNanos = Math.floor(perfNow * 1_000_000);

    const seqIndex = opts?.seqIndex ?? -1;
    const charCount = opts?.charCount ?? -1;
    const byteCount = opts?.byteCount ?? -1;
    const extraInfo = opts?.extraInfo ?? '';

    const event: BenchmarkEvent = {
      timestampNanos,
      timestampMillis,
      traceId,
      stage,
      ...(seqIndex >= 0 ? { seqIndex } : {}),
      ...(charCount >= 0 ? { charCount } : {}),
      ...(byteCount >= 0 ? { byteCount } : {}),
      ...(extraInfo ? { extraInfo } : {}),
      ...(opts?.metadata ? { metadata: opts.metadata } : {}),
    };

    if (this.enabled) {
      // JSON avoids delimiter corruption when fields contain commas/quotes.
      console.log(`${TAG}:${JSON.stringify(event)}`);

      this.events.push(event);
      if (this.events.length > MAX_EVENT_BUFFER) {
        this.events.shift();
      }

      this.listeners.forEach((listener) => {
        try {
          listener(event);
        } catch (e) {
          console.warn('[BenchmarkLogger] Listener error:', e);
        }
      });
    }

    return event;
  }

  getEvents(): BenchmarkEvent[] {
    return [...this.events];
  }

  clearEvents(): void {
    this.events = [];
  }

  getTraceEvents(traceId: string): BenchmarkEvent[] {
    return this.events.filter((e) => e.traceId === traceId);
  }

  getTraceSummary(traceId: string): TraceSummary | null {
    const traceEvents = this.getTraceEvents(traceId);
    if (traceEvents.length === 0) return null;

    const findStage = (s: BenchmarkStage) =>
      traceEvents.find((e) => e.stage === s);

    const sttStart = findStage('STT_INFERENCE_START');
    const sttEnd = findStage('STT_INFERENCE_END');
    const blePktStart = findStage('BLE_PACKETIZE_START');
    const bleTxComplete = findStage('BLE_TX_COMPLETE');
    const bleStartRcvd = findStage('BLE_START_FRAME_RCVD');
    const bleReassemblyEnd = findStage('BLE_REASSEMBLY_COMPLETE');
    const ttsStart = findStage('TTS_SYNTH_START');
    const ttsFirstChunk = findStage('TTS_FIRST_CHUNK_READY');
    const ttsFirstWrite = findStage('AUDIOTRACK_FIRST_WRITE');
    const ttsComplete = findStage('TTS_SYNTH_COMPLETE');
    const connectStart = findStage('BLE_CONNECT_START');
    const connectEnd = findStage('BLE_CONNECT_END');
    const discoveryStart = findStage('BLE_DISCOVERY_START');
    const discoveryEnd = findStage('BLE_DISCOVERY_END');
    const sttLoadStart = findStage('STT_MODEL_LOAD_START');
    const sttLoadEnd = findStage('STT_MODEL_LOAD_END');
    const ttsLoadStart = findStage('TTS_MODEL_LOAD_START');
    const ttsLoadEnd = findStage('TTS_MODEL_LOAD_END');

    const elapsedMs = (start?: BenchmarkEvent, end?: BenchmarkEvent) =>
      start && end && end.timestampNanos >= start.timestampNanos
        ? (end.timestampNanos - start.timestampNanos) / 1_000_000
        : undefined;

    const sttDurationMs =
      sttStart && sttEnd ? elapsedMs(sttStart, sttEnd) : undefined;

    const bleTxDurationMs =
      blePktStart && bleTxComplete
        ? elapsedMs(blePktStart, bleTxComplete)
        : undefined;

    const bleReassemblyDurationMs =
      bleStartRcvd && bleReassemblyEnd
        ? elapsedMs(bleStartRcvd, bleReassemblyEnd)
        : undefined;

    const ttsTtfaMs =
      ttsStart && ttsFirstChunk
        ? elapsedMs(ttsStart, ttsFirstChunk)
        : undefined;

    const ttsTotalDurationMs =
      ttsStart && ttsComplete ? elapsedMs(ttsStart, ttsComplete) : undefined;

    // Cross-device wall-clock stages cannot be safely subtracted without
    // clock synchronization. Do not synthesize an end-to-end number here.

    return {
      traceId,
      sttDurationMs,
      bleTxDurationMs,
      bleReassemblyDurationMs,
      bleConnectDurationMs: elapsedMs(connectStart, connectEnd),
      bleDiscoveryToFirstDeviceMs: elapsedMs(discoveryStart, discoveryEnd),
      sttModelLoadMs: elapsedMs(sttLoadStart, sttLoadEnd),
      ttsModelLoadMs: elapsedMs(ttsLoadStart, ttsLoadEnd),
      ttsTtfaMs,
      ttsFirstPcmWriteMs: elapsedMs(ttsStart, ttsFirstWrite),
      ttsTotalDurationMs,
      eventsCount: traceEvents.length,
      startTimeMillis: traceEvents[0].timestampMillis,
    };
  }

  getAllTraceSummaries(): TraceSummary[] {
    const traceIds = Array.from(new Set(this.events.map((e) => e.traceId)));
    return traceIds
      .map((id) => this.getTraceSummary(id))
      .filter((s): s is TraceSummary => s !== null);
  }

  calculateStats(values: number[]): BenchmarkStats {
    if (values.length === 0) {
      return {
        mean: 0,
        median: 0,
        p90: 0,
        p95: 0,
        min: 0,
        max: 0,
        stdDev: 0,
        count: 0,
      };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const mean = sum / n;

    const variance =
      n > 1
        ? sorted.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / (n - 1)
        : 0;
    const stdDev = Math.sqrt(variance);

    const percentile = (p: number) => {
      // Linear interpolation (type 7), commonly used by spreadsheet tools.
      const rank = (p / 100) * (n - 1);
      const lower = Math.floor(rank);
      const fraction = rank - lower;
      return (
        sorted[lower] +
        (sorted[Math.min(lower + 1, n - 1)] - sorted[lower]) * fraction
      );
    };

    return {
      mean: Number(mean.toFixed(2)),
      median: Number(percentile(50).toFixed(2)),
      p90: Number(percentile(90).toFixed(2)),
      p95: Number(percentile(95).toFixed(2)),
      min: Number(sorted[0].toFixed(2)),
      max: Number(sorted[n - 1].toFixed(2)),
      stdDev: Number(stdDev.toFixed(2)),
      count: n,
    };
  }

  exportCsv(): string {
    const header =
      'monotonic_nanos,epoch_millis,trace_id,stage,seq,chars,bytes,extra,metadata_json\n';
    const rows = this.events.map((e) =>
      [
        e.timestampNanos,
        e.timestampMillis,
        e.traceId,
        e.stage,
        e.seqIndex ?? -1,
        e.charCount ?? -1,
        e.byteCount ?? -1,
        `"${(e.extraInfo ?? '').replace(/"/g, '""')}"`,
        `"${JSON.stringify(e.metadata ?? {}).replace(/"/g, '""')}"`,
      ].join(','),
    );
    return header + rows.join('\n');
  }

  exportJson(): string {
    return JSON.stringify(this.events, null, 2);
  }
}

export const benchmarkLogger = BenchmarkLogger.getInstance();
