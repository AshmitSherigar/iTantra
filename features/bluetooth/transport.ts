import {
  CHUNK_DELAY_MS,
  MAX_HEX_PER_PACKET,
} from '@/features/bluetooth/constants';
import {
  delay,
  makeFrameId,
  splitHexIntoPackets,
  textToHex,
} from '@/features/bluetooth/codec';

export type PacketWriter = (packetHex: string) => Promise<void>;

const US = String.fromCharCode(0x1f);

export function buildStartFrame(id: string, total: number): string {
  return textToHex(`${US}BLK:S:${id}:${total}${US}`);
}

export function buildEndFrame(id: string): string {
  return textToHex(`${US}BLK:E:${id}${US}`);
}

/**
 * Low-level send: fragments the hex payload into 20-byte BLE packets.
 * Short messages use a single packet (backward compatible). Long messages
 * use START -> data packets -> END framing so the peer can reassemble
 * byte-exact UTF-8 regardless of MTU.
 */
export async function sendHexFramed(
  hexPayload: string,
  writeCentral: PacketWriter,
  notifyPeripheral: PacketWriter,
  opts: { isCentral: boolean },
): Promise<void> {
  if (!hexPayload) return;
  if (hexPayload.length <= MAX_HEX_PER_PACKET) {
    if (opts.isCentral) await writeCentral(hexPayload);
    else await notifyPeripheral(hexPayload);
    return;
  }

  const chunks = splitHexIntoPackets(hexPayload);
  const id = makeFrameId();
  const startHex = buildStartFrame(id, chunks.length);
  const endHex = buildEndFrame(id);

  const send = opts.isCentral ? writeCentral : notifyPeripheral;
  await send(startHex);
  for (const chunk of chunks) {
    await delay(CHUNK_DELAY_MS);
    await send(chunk);
  }
  await delay(CHUNK_DELAY_MS);
  await send(endHex);
}
