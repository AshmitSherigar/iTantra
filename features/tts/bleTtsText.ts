import { Buffer } from 'buffer';

const REPLACEMENT_CHAR = '�';

export function decodeHexIncremental(joinedHex: string): {
  text: string;
  completeHexLength: number;
} {
  const clean = joinedHex
    .trim()
    .replace(/^0x/i, '')
    .replace(/[\s_\-:]/g, '')
    .toLowerCase();
  if (!clean) return { text: '', completeHexLength: 0 };

  const full = safeHexToText(clean);
  if (!full) return { text: '', completeHexLength: 0 };

  if (!full.endsWith(REPLACEMENT_CHAR)) {
    return { text: full, completeHexLength: clean.length };
  }

  for (let trimBytes = 1; trimBytes <= 3; trimBytes += 1) {
    const trimmedHex = clean.slice(0, clean.length - trimBytes * 2);
    if (!trimmedHex) return { text: '', completeHexLength: 0 };
    const decoded = safeHexToText(trimmedHex);
    if (decoded && !decoded.endsWith(REPLACEMENT_CHAR)) {
      return { text: decoded, completeHexLength: trimmedHex.length };
    }
  }

  return {
    text: full.slice(0, -1),
    completeHexLength: clean.length,
  };
}

function safeHexToText(hex: string): string | null {
  try {
    if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
    return Buffer.from(hex, 'hex').toString('utf-8');
  } catch {
    return null;
  }
}

export class BleIncomingTextTracker {
  private spokenText = '';
  private spokenHexLength = 0;

  reset(): void {
    this.spokenText = '';
    this.spokenHexLength = 0;
  }

  pushJoinedHex(joinedHex: string): string {
    const { text, completeHexLength } = decodeHexIncremental(joinedHex);
    if (completeHexLength <= this.spokenHexLength) return '';
    let fresh: string;
    if (text.startsWith(this.spokenText)) {
      fresh = text.slice(this.spokenText.length);
    } else {
      fresh = text;
    }
    this.spokenText = text;
    this.spokenHexLength = completeHexLength;
    return fresh;
  }
}
