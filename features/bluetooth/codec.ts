import { Buffer } from 'buffer';
import { MAX_HEX_PER_PACKET } from './constants';

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const makeFrameId = () =>
  Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');

/** Normalise the various hex formats stacks emit (spaces, 0x, -, :, _). */
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
    // Native sides disagree on formatting: Android keeps spaces, iOS only
    // trims the ends and pads odd-length with "0" (corrupting data), and
    // some stacks add "0x" / separators. Normalise before decoding.
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

export function splitHexIntoPackets(hex: string): string[] {
  const packets: string[] = [];
  for (let i = 0; i < hex.length; i += MAX_HEX_PER_PACKET) {
    packets.push(hex.slice(i, i + MAX_HEX_PER_PACKET));
  }
  return packets;
}

/** Valid data packet during reassembly (byte-exact hex). Null when corrupt. */
export function cleanDataPacket(hex: string): string | null {
  const clean = cleanHex(hex);
  if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    return null;
  }
  return clean;
}
