import { Platform } from 'react-native';
import { Buffer } from 'buffer';
import {
  WIFI_ANNOUNCE_INTERVAL_MS,
  WIFI_ANNOUNCE_KIND,
  WIFI_ANNOUNCE_KIND_LEGACY,
  WIFI_BROADCAST_ADDR,
  WIFI_DISCOVERY_PORT,
  type WifiPeer,
} from './constants';

type UdpSocketLike = {
  bind(port: number): void;
  close(): void;
  setBroadcast(flag: boolean): void;
  send(
    buffer: Buffer,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: (err: unknown) => void,
  ): void;
  on(
    event: 'message',
    listener: (msg: Buffer, rinfo: { address: string }) => void,
  ): void;
  on(event: 'error', listener: (err: unknown) => void): void;
  once(event: 'listening', listener: () => void): void;
};

function getUdp(): any | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-udp');
    return mod?.default ?? mod;
  } catch {
    return null;
  }
}

/**
 * UDP presence broadcast — every phone shouts "I'm here" once a second and
 * listens for the same from others on the LAN. No internet involved.
 *
 * Improvements over the `transport/discovery.ts` prototype:
 * - `deviceId` (stable per install) ignores self even when two phones share
 *   the same display name; legacy payloads without it fall back to name.
 * - Accepts both `vaanisetu-announce` and legacy `itantra-announce`.
 * - Never throws on web / missing native module — returns a noop stop fn
 *   and lets the hook surface a friendly error instead.
 */
export function startWifiDiscovery(
  deviceName: string,
  deviceId: string,
  tcpPort: number,
  onPeerFound: (peer: WifiPeer) => void,
): () => void {
  const noop = () => {};
  const dgram = getUdp();
  if (!dgram) {
    console.warn('[WiFi] discovery unavailable (native UDP module missing)');
    return noop;
  }

  let socket: UdpSocketLike | null = null;
  try {
    socket = dgram.createSocket({ type: 'udp4' }) as unknown as UdpSocketLike;
  } catch (e) {
    console.warn('[WiFi] discovery socket creation failed', e);
    return noop;
  }

  socket.once('listening', () => {
    try {
      socket?.setBroadcast(true);
    } catch (e) {
      console.warn('[WiFi] setBroadcast failed', e);
    }
  });

  socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (
        data.kind !== WIFI_ANNOUNCE_KIND &&
        data.kind !== WIFI_ANNOUNCE_KIND_LEGACY
      ) {
        return;
      }
      // Ignore our own broadcast.
      if (typeof data.deviceId === 'string' && data.deviceId === deviceId)
        return;
      if (!data.deviceId && data.name === deviceName) return;
      if (typeof data.name !== 'string' || !rinfo?.address) return;
      onPeerFound({
        name: String(data.name).slice(0, 32) || 'WiFi phone',
        deviceId:
          typeof data.deviceId === 'string' && data.deviceId
            ? data.deviceId
            : `${data.name}@${rinfo.address}`,
        address: rinfo.address,
        tcpPort:
          typeof data.tcpPort === 'number' ? data.tcpPort : WIFI_DISCOVERY_PORT,
        lastSeen: Date.now(),
      });
    } catch {
      // Not one of ours — ignore.
    }
  });

  socket.on('error', (err: unknown) => {
    console.warn('[WiFi] discovery socket error', err);
  });

  try {
    socket.bind(WIFI_DISCOVERY_PORT);
  } catch (e) {
    console.warn('[WiFi] discovery bind failed (another screen active?)', e);
    return () => {
      try {
        socket?.close();
      } catch {}
    };
  }

  const announce = () => {
    if (!socket) return;
    try {
      const payload = Buffer.from(
        JSON.stringify({
          kind: WIFI_ANNOUNCE_KIND,
          name: deviceName,
          deviceId,
          tcpPort,
        }),
        'utf8',
      );
      socket.send(
        payload,
        0,
        payload.length,
        WIFI_DISCOVERY_PORT,
        WIFI_BROADCAST_ADDR,
        (err: unknown) => {
          if (err) console.warn('[WiFi] discovery broadcast failed', err);
        },
      );
    } catch (e) {
      console.warn('[WiFi] announce failed', e);
    }
  };

  const timer = setInterval(announce, WIFI_ANNOUNCE_INTERVAL_MS);
  announce();

  return function stopWifiDiscovery() {
    clearInterval(timer);
    try {
      socket?.close();
    } catch {}
    socket = null;
  };
}
