import {
  BLE_MTU_FALLBACK_BYTES,
  CHUNK_DELAY_MS,
  MAX_HEX_PER_PACKET,
} from './constants';
import { delay, makeFrameId, splitHexIntoPackets, textToHex } from './codec';

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
  opts: {
    isCentral: boolean;
    /** GATT payload ceiling for this link (default: 20B fallback). */
    maxBytesPerPacket?: number;
    /** Inter-chunk pacing (default: CHUNK_DELAY_MS legacy 30ms). */
    chunkDelayMs?: number;
  },
): Promise<void> {
  if (!hexPayload) return;
  const maxBytes =
    Number.isFinite(opts.maxBytesPerPacket) &&
    (opts.maxBytesPerPacket as number) > 0
      ? Math.floor(opts.maxBytesPerPacket as number)
      : BLE_MTU_FALLBACK_BYTES;
  const maxHex = Math.max(MAX_HEX_PER_PACKET, maxBytes * 2);
  // Single-packet fast path: no START/END framing overhead.
  if (hexPayload.length <= maxHex) {
    if (opts.isCentral) await writeCentral(hexPayload);
    else await notifyPeripheral(hexPayload);
    return;
  }

  const chunks = splitHexIntoPackets(hexPayload, maxHex);
  const id = makeFrameId();
  const startHex = buildStartFrame(id, chunks.length);
  const endHex = buildEndFrame(id);
  const gap =
    Number.isFinite(opts.chunkDelayMs) && (opts.chunkDelayMs as number) >= 0
      ? (opts.chunkDelayMs as number)
      : CHUNK_DELAY_MS;

  const send = opts.isCentral ? writeCentral : notifyPeripheral;
  await send(startHex);
  for (const chunk of chunks) {
    if (gap > 0) await delay(gap);
    await send(chunk);
  }
  if (gap > 0) await delay(gap);
  await send(endHex);
}
