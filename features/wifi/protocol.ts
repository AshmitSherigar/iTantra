import { Buffer } from 'buffer';

/**
 * WiFi wire protocol: each message is framed as a 4-byte big-endian
 * length prefix followed by a JSON payload.
 *
 * `id`, `senderName` and `scope` are optional so payloads that omit them
 * still decode. The framing never changes regardless of fields present.
 */

export type WifiMessageType =
  'msg' | 'alert' | 'ptt_start' | 'ptt_end' | 'heartbeat' | 'ack';

export interface WifiTransportMessage {
  v: number;
  seq: number;
  type: WifiMessageType;
  lang?: string;
  text?: string;
  ts: number;
  /** Unique per message — used as React keys + de-dup. */
  id?: string;
  /** Display name of the sender phone. */
  senderName?: string;
  /**
   * Routing scope. `broadcast` = sent to everyone (shows on the global
   * WiFi page); `direct` (or omitted) = private 1-to-1 (shows only in
   * that peer's chat window).
   */
  scope?: 'broadcast' | 'direct';
}

const HEADER_BYTES = 4;
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** Serializes a message into a length-prefixed frame for the socket. */
export function encodeWifiMessage(message: WifiTransportMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/**
 * Creates a stateful frame decoder for one TCP connection. Feed every
 * `data` chunk into the returned function; `onMessage` fires once per
 * complete frame however the bytes were split across chunks.
 */
export function createWifiFrameDecoder() {
  let buffer = Buffer.alloc(0);

  return function feed(chunk: Buffer, onMessage: (payload: Buffer) => void) {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      if (buffer.length < HEADER_BYTES) return;
      const length = buffer.readUInt32BE(0);
      if (!Number.isFinite(length) || length > MAX_FRAME_BYTES) {
        // Corrupt header — drop everything, resync from next chunk.
        console.warn('[WiFi] corrupt frame header, resyncing');
        buffer = Buffer.alloc(0);
        return;
      }
      if (buffer.length < HEADER_BYTES + length) return;

      const payload = Buffer.from(
        buffer.subarray(HEADER_BYTES, HEADER_BYTES + length),
      );
      onMessage(payload);
      buffer = Buffer.from(buffer.subarray(HEADER_BYTES + length));
    }
  };
}
