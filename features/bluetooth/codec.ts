import { Buffer } from 'buffer';
import { MAX_HEX_PER_PACKET } from './constants';

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const makeFrameId = () =>
  Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');

export function cleanHex(hex: string): string {
  return hex
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s_\-:]/g, '')
    .toLowerCase();
}

export function hexToText(hex: string | null | undefined): string | null {
  if (hex == null) return null;
  try {
    const clean = cleanHex(hex);
    if (!clean) return null;
    if (clean.length % 2 !== 0) {
      console.warn('Dropping odd-length hex payload');
      return null;
    }
    if (!/^[0-9a-f]*$/.test(clean)) {
      console.warn('Dropping non-hex payload');
      return null;
    }
    return Buffer.from(clean, 'hex').toString('utf-8');
  } catch (e) {
    console.warn('Failed to decode hex to text:', e);
    return null;
  }
}

export function textToHex(text: string): string {
  return Buffer.from(text, 'utf-8').toString('hex').toLowerCase();
}

export function splitHexIntoPackets(
  hex: string,
  maxHexPerPacket: number = MAX_HEX_PER_PACKET,
): string[] {
  const size =
    Number.isFinite(maxHexPerPacket) && maxHexPerPacket > 0
      ? Math.floor(maxHexPerPacket)
      : MAX_HEX_PER_PACKET;
  const packets: string[] = [];
  for (let i = 0; i < hex.length; i += size) {
    packets.push(hex.slice(i, i + size));
  }
  return packets;
}

export function cleanDataPacket(hex: string): string | null {
  const clean = cleanHex(hex);
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    return null;
  }
  return clean;
}
