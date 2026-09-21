import { Buffer } from 'buffer';

// Every message that travels over the WiFi link uses this shape.
// STT hands you a 'msg', alerts are 'alert', PTT and connection
// housekeeping use the rest.
export type MessageType =
  | 'msg'
  | 'alert'
  | 'ptt_start'
  | 'ptt_end'
  | 'heartbeat'
  | 'ack';

export interface TransportMessage {
  v: number; // protocol version
  seq: number; 
  type: MessageType;
  lang?: string; 
  text?: string; 
  ts: number; 
}

const HEADER_BYTES = 4; 


export function encodeMessage(message: TransportMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

// Stateful decoder. Create one per connection, feed it every raw chunk that
// arrives on the socket's 'data' event, and it calls onMessage(payload) once
// per complete frame -- however the bytes happened to be split by the network.
export function createFrameDecoder() {
  let buffer = Buffer.alloc(0);

  return function feed(chunk: Buffer, onMessage: (payload: Buffer) => void) {
    buffer = Buffer.concat([buffer, chunk]);

    
    while (true) {
      if (buffer.length < HEADER_BYTES) return; 
      const length = buffer.readUInt32BE(0);
      if (buffer.length < HEADER_BYTES + length) return; 

      const payload = Buffer.from(buffer.subarray(HEADER_BYTES, HEADER_BYTES + length));
      onMessage(payload);
      buffer = Buffer.from(buffer.subarray(HEADER_BYTES + length));
    }
  };
}