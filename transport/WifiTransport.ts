import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';
import { encodeMessage, createFrameDecoder, TransportMessage } from './protocol';

export const TCP_PORT = 5050;

const HEARTBEAT_INTERVAL_MS = 2000;
const HEARTBEAT_TIMEOUT_COUNT = 3; // three missed heartbeats = link considered down
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 16000;

export type ConnectionStatus =
  | 'idle'
  | 'listening'
  | 'connecting'
  | 'connected'
  | 'disconnected';

type MessageListener = (msg: TransportMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

// This is the one class the STT and TTS code should ever touch. Everything
// about sockets, framing, and reconnect logic stays inside it.
export class WifiTransport {
  private server: ReturnType<typeof TcpSocket.createServer> | null = null;
  private socket: any = null;
  private role: 'server' | 'client' | null = null;
  private status: ConnectionStatus = 'idle';
  private seq = 0;
  private missedHeartbeats = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outgoingQueue: TransportMessage[] = [];
  private messageListeners: MessageListener[] = [];
  private statusListeners: StatusListener[] = [];
  private decodeFrame = createFrameDecoder();
  private lastPeerHost: string | null = null;

  // ---- public API ----

  onMessage(listener: MessageListener) {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter((l) => l !== listener);
    };
  }

  onStatusChange(listener: StatusListener) {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  getStatus() {
    return this.status;
  }

 
  startAsHost() {
    this.role = 'server';
    this.setStatus('listening');
    this.server = TcpSocket.createServer((socket: any) => {
      this.attachSocket(socket);
    });
    this.server.listen({ port: TCP_PORT, host: '0.0.0.0' });
    this.server.on('error', (err: unknown) => {
      console.warn('WifiTransport server error', err);
    });
  }

  
  connectToHost(host: string) {
    this.role = 'client';
    this.lastPeerHost = host;
    this.setStatus('connecting');
    const socket = TcpSocket.createConnection({ port: TCP_PORT, host }, () => {
      this.attachSocket(socket);
    });
    socket.on('error', (err: unknown) => {
      console.warn('WifiTransport connect error', err);
      this.scheduleReconnect();
    });
  }

  // Queues the message if not currently connected, so a message spoken
  // during a brief WiFi drop is not silently lost.
  send(partial: Omit<TransportMessage, 'v' | 'seq' | 'ts'>): TransportMessage {
    const message: TransportMessage = {
      v: 1,
      seq: this.seq++,
      ts: Date.now(),
      ...partial,
    };
    if (this.status === 'connected' && this.socket) {
      this.writeMessage(message);
    } else {
      this.outgoingQueue.push(message);
    }
    return message;
  }

  disconnect() {
    this.clearHeartbeat();
    this.clearReconnect();
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.role = null;
    this.lastPeerHost = null;
    this.reconnectAttempt = 0;
    this.setStatus('idle');
  }

 

  private attachSocket(socket: any) {
    this.socket = socket;
    this.setStatus('connected');
    this.missedHeartbeats = 0;
    this.reconnectAttempt = 0;
    this.decodeFrame = createFrameDecoder();
    this.flushQueue();
    this.startHeartbeat();

    socket.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      this.decodeFrame(chunk, (payload) => {
        try {
          const message: TransportMessage = JSON.parse(payload.toString('utf8'));
          this.handleIncoming(message);
        } catch (e) {
          console.warn('WifiTransport: failed to parse message', e);
        }
      });
    });

    socket.on('close', () => {
      this.socket = null;
      this.clearHeartbeat();
      this.setStatus('disconnected');
      if (this.role === 'client') {
        this.scheduleReconnect();
      }
    });

    socket.on('error', (err: unknown) => {
      console.warn('WifiTransport socket error', err);
    });
  }

  private handleIncoming(message: TransportMessage) {
    this.missedHeartbeats = 0;
    if (message.type === 'heartbeat') return; 
    this.messageListeners.forEach((l) => l(message));
  }

  private writeMessage(message: TransportMessage) {
    if (!this.socket) return;
    this.socket.write(encodeMessage(message));
  }

  private flushQueue() {
    while (this.outgoingQueue.length > 0 && this.socket) {
      const message = this.outgoingQueue.shift()!;
      this.writeMessage(message);
    }
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.socket) return;
      this.missedHeartbeats++;
      if (this.missedHeartbeats >= HEARTBEAT_TIMEOUT_COUNT) {
        console.warn('WifiTransport: heartbeat timeout, dropping connection');
        this.socket.destroy();
        return;
      }
      this.writeMessage({ v: 1, seq: this.seq++, type: 'heartbeat', ts: Date.now() });
    }, HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.lastPeerHost || this.role !== 'client') return;
    this.clearReconnect();
    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_DELAY_MS
    );
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      if (this.lastPeerHost) this.connectToHost(this.lastPeerHost);
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.statusListeners.forEach((l) => l(status));
  }
}
