import { Buffer } from 'buffer';

const REPLACEMENT_CHAR = '�';

/**
 * Decode joined hex to text, tolerating a trailing incomplete multi-byte
 * UTF-8 sequence (Hindi chars are 3 bytes and are routinely split across
 * 20-byte BLE packets).
 *
 * Returns the decodable text plus the number of hex chars that produced
 * complete characters, so callers can diff against the previous decode
 * and feed only *new* characters to streaming TTS.
 */
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

  // Trailing replacement char → last 1..3 bytes are an incomplete rune.
  // Trim trailing bytes until the decode is clean (max UTF-8 seq = 4 bytes).
  for (let trimBytes = 1; trimBytes <= 3; trimBytes += 1) {
    const trimmedHex = clean.slice(0, clean.length - trimBytes * 2);
    if (!trimmedHex) return { text: '', completeHexLength: 0 };
    const decoded = safeHexToText(trimmedHex);
    if (decoded && !decoded.endsWith(REPLACEMENT_CHAR)) {
      return { text: decoded, completeHexLength: trimmedHex.length };
    }
  }

  // Could not recover (genuinely corrupt) — drop the trailing char.
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

/**
 * Tracks one incoming BLE message's decode progress so each newly
 * completed slice of text can be pushed to streaming TTS exactly once.
 */
export class BleIncomingTextTracker {
  private spokenText = '';
  private spokenHexLength = 0;

  reset(): void {
    this.spokenText = '';
    this.spokenHexLength = 0;
  }

  /**
   * Feed the current joined-hex buffer; returns only the *new* complete
   * text since the last call ('' when nothing new is decodable yet).
   */
  pushJoinedHex(joinedHex: string): string {
    const { text, completeHexLength } = decodeHexIncremental(joinedHex);
    if (completeHexLength <= this.spokenHexLength) return '';
    // completeHexLength only moves forward on clean decodes, but guard
    // against any non-monotonic edge by slicing on the text prefix.
    let fresh: string;
    if (text.startsWith(this.spokenText)) {
      fresh = text.slice(this.spokenText.length);
    } else {
      // Reassembly restarted (new START) without reset — resync.
      fresh = text;
    }
    this.spokenText = text;
    this.spokenHexLength = completeHexLength;
    return fresh;
  }

  /** Text decoded & forwarded to TTS so far. */
  getSpokenText(): string {
    return this.spokenText;
  }
}
