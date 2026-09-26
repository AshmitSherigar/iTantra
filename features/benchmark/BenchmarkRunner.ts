import { Buffer } from 'buffer';
import {
  cleanDataPacket,
  hexToText,
  splitHexIntoPackets,
  textToHex,
} from '../bluetooth/codec';
import { UTF8_BENCHMARK_CORPUS } from './utf8BenchmarkCorpus';
import { Utf8TestCase, Utf8TestResult } from './types';

export class BenchmarkRunner {
  /**
   * Run automated UTF-8 bit-for-bit and 20-byte boundary split benchmark.
   * Tests the exact codec and packetization routines used in live BLE transmission.
   */
  static runUtf8FramingBenchmark(
    corpus: Utf8TestCase[] = UTF8_BENCHMARK_CORPUS,
  ): {
    results: Utf8TestResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      corrupted: number;
      exactMatchPct: number;
      avgTimeMs: number;
    };
  } {
    const results: Utf8TestResult[] = [];
    let totalTimeMs = 0;
    let passedCount = 0;
    let corruptedCount = 0;

    for (const testCase of corpus) {
      const startTime =
        typeof performance !== 'undefined' &&
        typeof performance.now === 'function'
          ? performance.now()
          : Date.now();

      try {
        const originalBytes = Buffer.from(testCase.text, 'utf-8');
        const hex = textToHex(testCase.text);
        const packets = splitHexIntoPackets(hex);

        // Simulate payload packetization/reassembly. This deliberately does
        // not claim to exercise the BLE radio, delivery, or frame timers.
        const receivedChunks: string[] = [];
        for (const p of packets) {
          const cleaned = cleanDataPacket(p);
          if (cleaned) {
            receivedChunks.push(cleaned);
          }
        }

        const joinedHex = receivedChunks.join('');
        const reassembledText = hexToText(joinedHex) ?? '';
        const reassembledBytes = Buffer.from(reassembledText, 'utf-8');

        // Integrity checks
        const exactByteMatch = originalBytes.equals(reassembledBytes);
        const origNfc = testCase.text.normalize('NFC');
        const reassembledNfc = reassembledText.normalize('NFC');
        const unicodeNfcMatch = origNfc === reassembledNfc;
        const containsReplacementChar = reassembledText.includes('\uFFFD');

        const endTime =
          typeof performance !== 'undefined' &&
          typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        const executionTimeMs = Number((endTime - startTime).toFixed(3));
        totalTimeMs += executionTimeMs;

        const passed =
          exactByteMatch && unicodeNfcMatch && !containsReplacementChar;
        if (passed) passedCount++;
        if (containsReplacementChar) corruptedCount++;

        results.push({
          testCase,
          passed,
          originalByteLength: originalBytes.length,
          reassembledByteLength: reassembledBytes.length,
          packetsCount: packets.length,
          containsReplacementChar,
          exactByteMatch,
          unicodeNfcMatch,
          executionTimeMs,
        });
      } catch (err) {
        const endTime =
          typeof performance !== 'undefined' &&
          typeof performance.now === 'function'
            ? performance.now()
            : Date.now();
        results.push({
          testCase,
          passed: false,
          originalByteLength: 0,
          reassembledByteLength: 0,
          packetsCount: 0,
          containsReplacementChar: false,
          exactByteMatch: false,
          unicodeNfcMatch: false,
          executionTimeMs: Number((endTime - startTime).toFixed(3)),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const total = corpus.length;
    return {
      results,
      summary: {
        total,
        passed: passedCount,
        failed: total - passedCount,
        corrupted: corruptedCount,
        exactMatchPct:
          total > 0 ? Number(((passedCount / total) * 100).toFixed(2)) : 0,
        avgTimeMs: total > 0 ? Number((totalTimeMs / total).toFixed(3)) : 0,
      },
    };
  }
}
