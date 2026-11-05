import { CHUNK_DELAY_MS, MAX_HEX_PER_PACKET } from './constants';
import { delay, makeFrameId, splitHexIntoPackets, textToHex } from './codec';
import { benchmarkLogger } from '../benchmark/BenchmarkLogger';

export type PacketWriter = (packetHex: string) => Promise<void>;

const US = String.fromCharCode(0x1f);

export function buildStartFrame(id: string, total: number): string {
  return textToHex(`${US}BLK:S:${id}:${total}${US}`);
}

export function buildEndFrame(id: string): string {
  return textToHex(`${US}BLK:E:${id}${US}`);
}

export async function sendHexFramed(
  hexPayload: string,
  writeCentral: PacketWriter,
  notifyPeripheral: PacketWriter,
  opts: { isCentral: boolean; traceId?: string },
): Promise<void> {
  if (!hexPayload) return;
  const traceId = opts.traceId || makeFrameId();
  benchmarkLogger.logEvent('BLE_PACKETIZE_START', traceId, {
    byteCount: Math.floor(hexPayload.length / 2),
  });

  try {
    if (hexPayload.length <= MAX_HEX_PER_PACKET) {
      if (opts.isCentral) await writeCentral(hexPayload);
      else await notifyPeripheral(hexPayload);
      benchmarkLogger.logEvent('BLE_TX_COMPLETE', traceId, {
        byteCount: Math.floor(hexPayload.length / 2),
        extraInfo: 'single_packet',
      });
      return;
    }

    const chunks = splitHexIntoPackets(hexPayload);
    const id = traceId;
    const startHex = buildStartFrame(id, chunks.length);
    const endHex = buildEndFrame(id);

    benchmarkLogger.logEvent('BLE_PACKETIZE_COMPLETE', id, {
      byteCount: Math.floor(hexPayload.length / 2),
      extraInfo: `chunks=${chunks.length}`,
    });

    const send = opts.isCentral ? writeCentral : notifyPeripheral;
    await send(startHex);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      await delay(CHUNK_DELAY_MS);
      await send(chunk);
      benchmarkLogger.logEvent('BLE_CHUNK_SENT', id, {
        seqIndex: i,
        byteCount: Math.floor(chunk.length / 2),
      });
    }
    await delay(CHUNK_DELAY_MS);
    await send(endHex);
    benchmarkLogger.logEvent('BLE_TX_COMPLETE', id, {
      extraInfo: `chunks_sent=${chunks.length}`,
    });
  } catch (error) {
    benchmarkLogger.logEvent('BENCHMARK_FAILURE', traceId, {
      extraInfo: `ble_send:${error instanceof Error ? error.message : String(error)}`,
    });
    throw error;
  }
}
