import { Buffer } from 'buffer';
import {
  WIFI_HEARTBEAT_INTERVAL_MS,
  WIFI_HEARTBEAT_TIMEOUT_COUNT,
  WIFI_RECONNECT_BASE_DELAY_MS,
  WIFI_RECONNECT_MAX_DELAY_MS,
  WIFI_TCP_PORT,
  type WifiConnectionStatus,
} from './constants';
import {
  createWifiFrameDecoder,
  encodeWifiMessage,
  type WifiTransportMessage,
} from './protocol';

// Lazy, guarded import — `react-native-tcp-socket` is a native module. It
// is absent on web / Expo Go, so requiring it at module scope would crash
// those environments even when the WiFi tab is never opened.
function getTcpSocket(): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-tcp-socket');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

export type WifiInbound = {
  msg: WifiTransportMessage;
  fromAddress: string;
};

type MessageListener = (inbound: WifiInbound) => void;
type StatusListener = (status: WifiConnectionStatus) => void;
type PeersListener = (connectedAddresses: string[]) => void;

type ConnEntry = {
  socket: any;
  decode: (chunk: Buffer, onMessage: (payload: Buffer) => void) => void;
  missed: number;
  address: string;
  outbound: boolean;
};

function normalizeAddress(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && raw.trim().length > 0) {
    // Strip IPv6-mapped IPv4 prefix: ::ffff:192.168.1.5 -> 192.168.1.5
    return raw.trim().replace(/^::ffff:/, '');
  }
  return fallback;
}

function socketAddress(socket: any, fallback: string): string {
  return normalizeAddress(
    socket?.remoteAddress ?? socket?._host ?? socket?.remoteHost,
    fallback,
  );
}

/**
 * Multi-peer WiFi chat transport over TCP.
 *
 * Holds one socket per connected phone in a `Map<address, socket>` so a
 * single phone can chat with every device on the same WiFi network at
 * once.
 *
 * - `ensureServer` / `startAsHost` opens the TCP server that listens for
 *   inbound peers.
 * - `connectToHost` dials one outbound peer and retries with exponential
 *   backoff while it stays wanted.
 * - `sendTo` targets one peer (queues while offline); `broadcast` floods
 *   every open connection and reports per-link counts.
 * - A per-connection heartbeat prunes dead links; live ones are untouched.
 */
export class WifiChatTransport {
  private server: any | null = null;
  private conns = new Map<string, ConnEntry>();
  private status: WifiConnectionStatus = 'idle';
  private seq = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private reconnectAttempts = new Map<string, number>();
  private outboundHosts = new Set<string>();
  private pendingByPeer = new Map<string, WifiTransportMessage[]>();
  private messageListeners: MessageListener[] = [];
  private statusListeners: StatusListener[] = [];
  private peersListeners: PeersListener[] = [];
  private hosting = false;

  /** Subscribes to decoded inbound chat messages. Returns an unsubscribe fn. */
  onMessage(listener: MessageListener): () => void {
    this.messageListeners.push(listener);
    return () => {
      this.messageListeners = this.messageListeners.filter(
        (l) => l !== listener,
      );
    };
  }

  /** Subscribes to connection-status changes. Returns an unsubscribe fn. */
  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  /** Subscribes to the connected-address list. Returns an unsubscribe fn. */
  onPeersChange(listener: PeersListener): () => void {
    this.peersListeners.push(listener);
    return () => {
      this.peersListeners = this.peersListeners.filter((l) => l !== listener);
    };
  }

  /** Current lifecycle status derived from server + open connections. */
  getStatus(): WifiConnectionStatus {
    return this.status;
  }

  /** LAN addresses of every currently open connection. */
  getConnectedAddresses(): string[] {
    return [...this.conns.keys()];
  }

  /** Whether the TCP server is currently listening for inbound peers. */
  isHosting(): boolean {
    return this.hosting;
  }

  /**
   * Starts the TCP server if it isn't running so other LAN phones can
   * connect. Reuses the existing server when already hosting.
   * Returns false when the native TCP module is unavailable.
   */
  ensureServer(): boolean {
    const TcpSocket = getTcpSocket();
    if (!TcpSocket) {
      console.warn('[WiFi] react-native-tcp-socket unavailable (web/Expo Go?)');
      return false;
    }
    if (this.server) return true;
    try {
      this.hosting = true;
      this.server = TcpSocket.createServer((socket: any) => {
        this.attachSocket(
          socket,
          socketAddress(socket, `peer-${Date.now()}`),
          false,
        );
      });
      this.server.listen({ port: WIFI_TCP_PORT, host: '0.0.0.0' });
      this.server.on?.('error', (err: unknown) => {
        console.warn('[WiFi] server error', err);
      });
      this.refreshStatus();
      return true;
    } catch (e) {
      console.warn('[WiFi] ensureServer failed', e);
      this.hosting = false;
      this.server = null;
      return false;
    }
  }

  /** Alias for `ensureServer` used by the host button. */
  startAsHost(): boolean {
    return this.ensureServer();
  }

  /**
   * Dials one peer by LAN address. No-ops when already connected to it.
   * The peer stays wanted until `disconnectPeer`/`disconnect`, so drops
   * retry automatically with exponential backoff.
   */
  connectToHost(host: string): void {
    const target = host.trim();
    if (!target || this.conns.has(target)) return;
    const TcpSocket = getTcpSocket();
    if (!TcpSocket) {
      console.warn('[WiFi] cannot connect: TCP module unavailable');
      return;
    }
    this.outboundHosts.add(target);
    this.reconnectAttempts.set(target, 0);
    this.setStatus(this.conns.size > 0 ? 'connected' : 'connecting');
    try {
      const socket = TcpSocket.createConnection(
        { port: WIFI_TCP_PORT, host: target },
        () => {
          this.attachSocket(socket, target, true);
        },
      );
      socket.on?.('error', (err: unknown) => {
        console.warn('[WiFi] connect error', target, err);
        this.scheduleReconnect(target);
      });
    } catch (e) {
      console.warn('[WiFi] connectToHost failed', e);
      this.scheduleReconnect(target);
    }
  }

  /**
   * Sends one message to a single peer. Stamps version/sequence/timestamp
   * automatically. When offline for that peer, the message is queued and
   * flushed on reconnect so brief drops don't lose text.
   */
  sendTo(
    address: string,
    partial: Omit<WifiTransportMessage, 'v' | 'seq' | 'ts'>,
  ): WifiTransportMessage {
    const message: WifiTransportMessage = {
      v: 1,
      seq: this.seq++,
      ts: Date.now(),
      ...partial,
    };
    const conn = this.conns.get(address);
    if (conn) {
      this.writeTo(conn, message);
    } else {
      const q = this.pendingByPeer.get(address) ?? [];
      q.push(message);
      this.pendingByPeer.set(address, q);
      // Opportunistically dial so a queued message still delivers.
      if (this.outboundHosts.has(address)) this.connectToHost(address);
    }
    return message;
  }

  /**
   * Sends one message to every connected peer. Returns how many links
   * were tried and how many writes succeeded.
   */
  broadcast(partial: Omit<WifiTransportMessage, 'v' | 'seq' | 'ts'>): {
    delivered: number;
    attempted: number;
  } {
    const addresses = [...this.conns.keys()];
    if (addresses.length === 0) return { delivered: 0, attempted: 0 };
    const message: WifiTransportMessage = {
      v: 1,
      seq: this.seq++,
      ts: Date.now(),
      ...partial,
    };
    let delivered = 0;
    for (const address of addresses) {
      const conn = this.conns.get(address);
      if (!conn) continue;
      try {
        this.writeTo(conn, message);
        delivered += 1;
      } catch (e) {
        console.warn('[WiFi] broadcast write failed', address, e);
      }
    }
    return { delivered, attempted: addresses.length };
  }

  /**
   * Drops one peer: stops its reconnect timer, forgets its queued
   * messages and destroys its socket.
   */
  disconnectPeer(address: string): void {
    this.clearReconnect(address);
    this.outboundHosts.delete(address);
    this.reconnectAttempts.delete(address);
    this.pendingByPeer.delete(address);
    const conn = this.conns.get(address);
    if (conn) {
      try {
        conn.socket?.destroy?.();
      } catch {}
      this.conns.delete(address);
    }
    this.emitPeers();
    this.refreshStatus();
  }

  /**
   * Tears everything down: stops heartbeats/reconnects, destroys all
   * sockets, closes the server and resets status to idle.
   */
  disconnect(): void {
    this.clearHeartbeat();
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();
    this.reconnectAttempts.clear();
    this.outboundHosts.clear();
    this.pendingByPeer.clear();
    for (const conn of this.conns.values()) {
      try {
        conn.socket?.destroy?.();
      } catch {}
    }
    this.conns.clear();
    if (this.server) {
      try {
        this.server.close?.();
      } catch {}
      this.server = null;
    }
    this.hosting = false;
    this.emitPeers();
    this.setStatus('idle');
  }

  // ---- internals ----

  private attachSocket(socket: any, address: string, outbound: boolean): void {
    // Replace stale entry for the same address (e.g. phone re-dialled).
    const prev = this.conns.get(address);
    if (prev && prev.socket !== socket) {
      try {
        prev.socket?.destroy?.();
      } catch {}
    }
    const entry: ConnEntry = {
      socket,
      decode: createWifiFrameDecoder(),
      missed: 0,
      address,
      outbound,
    };
    this.conns.set(address, entry);
    if (outbound) {
      this.clearReconnect(address);
      this.reconnectAttempts.set(address, 0);
    }
    this.flushQueue(address);
    this.startHeartbeat();
    this.emitPeers();
    this.setStatus('connected');

    socket.on?.('data', (data: any) => {
      const chunk = Buffer.isBuffer(data)
        ? data
        : Buffer.from(String(data), 'utf8');
      entry.decode(chunk, (payload) => {
        try {
          const msg = JSON.parse(
            payload.toString('utf8'),
          ) as WifiTransportMessage;
          entry.missed = 0;
          if (msg.type === 'heartbeat') return;
          this.messageListeners.forEach((l) =>
            l({ msg, fromAddress: address }),
          );
        } catch (e) {
          console.warn('[WiFi] failed to parse message', e);
        }
      });
    });

    socket.on?.('close', () => {
      if (this.conns.get(address)?.socket === socket) {
        this.conns.delete(address);
        this.emitPeers();
        this.refreshStatus();
      }
      if (outbound && this.outboundHosts.has(address)) {
        this.scheduleReconnect(address);
      }
    });

    socket.on?.('error', (err: unknown) => {
      console.warn('[WiFi] socket error', address, err);
    });
  }

  private writeTo(conn: ConnEntry, message: WifiTransportMessage): void {
    conn.socket?.write?.(encodeWifiMessage(message));
  }

  private flushQueue(address: string): void {
    const q = this.pendingByPeer.get(address);
    if (!q || q.length === 0) return;
    const conn = this.conns.get(address);
    if (!conn) return;
    while (q.length > 0) {
      const m = q.shift()!;
      this.writeTo(conn, m);
    }
    this.pendingByPeer.delete(address);
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (this.conns.size === 0) return;
      const dead: string[] = [];
      for (const [address, conn] of this.conns) {
        conn.missed += 1;
        if (conn.missed >= WIFI_HEARTBEAT_TIMEOUT_COUNT) {
          dead.push(address);
          continue;
        }
        try {
          this.writeTo(conn, {
            v: 1,
            seq: this.seq++,
            type: 'heartbeat',
            ts: Date.now(),
          });
        } catch {
          dead.push(address);
        }
      }
      for (const address of dead) {
        console.warn('[WiFi] heartbeat timeout, dropping', address);
        const conn = this.conns.get(address);
        try {
          conn?.socket?.destroy?.();
        } catch {}
        this.conns.delete(address);
        if (conn?.outbound && this.outboundHosts.has(address)) {
          this.scheduleReconnect(address);
        }
      }
      if (dead.length > 0) {
        this.emitPeers();
        this.refreshStatus();
      }
    }, WIFI_HEARTBEAT_INTERVAL_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(host: string): void {
    if (!this.outboundHosts.has(host)) return;
    if (this.reconnectTimers.has(host)) return;
    if (this.conns.has(host)) return;
    const attempt = this.reconnectAttempts.get(host) ?? 0;
    const delay = Math.min(
      WIFI_RECONNECT_BASE_DELAY_MS * 2 ** attempt,
      WIFI_RECONNECT_MAX_DELAY_MS,
    );
    this.reconnectAttempts.set(host, attempt + 1);
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(host);
      if (!this.outboundHosts.has(host) || this.conns.has(host)) return;
      this.connectToHostDirect(host);
    }, delay);
    this.reconnectTimers.set(host, timer);
  }

  private connectToHostDirect(host: string): void {
    const TcpSocket = getTcpSocket();
    if (!TcpSocket) return;
    try {
      const socket = TcpSocket.createConnection(
        { port: WIFI_TCP_PORT, host },
        () => this.attachSocket(socket, host, true),
      );
      socket.on?.('error', (err: unknown) => {
        console.warn('[WiFi] reconnect error', host, err);
        this.scheduleReconnect(host);
      });
    } catch {
      this.scheduleReconnect(host);
    }
  }

  private clearReconnect(host: string): void {
    const t = this.reconnectTimers.get(host);
    if (t) {
      clearTimeout(t);
      this.reconnectTimers.delete(host);
    }
  }

  private emitPeers(): void {
    const addrs = [...this.conns.keys()];
    this.peersListeners.forEach((l) => {
      try {
        l(addrs);
      } catch (e) {
        console.warn('[WiFi] peers listener failed', e);
      }
    });
  }

  private refreshStatus(): void {
    if (this.conns.size > 0) this.setStatus('connected');
    else if (this.hosting) this.setStatus('listening');
    else this.setStatus('idle');
  }

  private setStatus(status: WifiConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.statusListeners.forEach((l) => {
      try {
        l(status);
      } catch (e) {
        console.warn('[WiFi] status listener failed', e);
      }
    });
  }
}
