import dgram from 'react-native-udp';
import { Buffer } from 'buffer';

const DISCOVERY_PORT = 8888;
const BROADCAST_ADDR = '255.255.255.255';
const ANNOUNCE_INTERVAL_MS = 1000;
const STALE_AFTER_MS = 5000;
export interface DiscoveredPeer {
  name: string;
  address: string;
  tcpPort: number;
  lastSeen: number;
}


interface UdpSocketLike {
  bind(port: number): void;
  close(): void;
  setBroadcast(flag: boolean): void;
  send(
    buffer: Buffer,
    offset: number,
    length: number,
    port: number,
    address: string,
    callback?: (err: unknown) => void
  ): void;
  on(event: 'message', listener: (msg: Buffer, rinfo: { address: string }) => void): void;
  on(event: 'error', listener: (err: unknown) => void): void;
  once(event: 'listening', listener: () => void): void;
}

// Both phones run this. Each one broadcasts "I'm here" once a second and
// listens for the same broadcast from anyone else on the network. Returns a
// stop function -- call it when the screen using discovery unmounts.
export function startDiscovery(
  deviceName: string,
  tcpPort: number,
  onPeerFound: (peer: DiscoveredPeer) => void
) {
  const socket = dgram.createSocket({ type: 'udp4' }) as unknown as UdpSocketLike;

  socket.once('listening', () => {
    socket.setBroadcast(true);
  });

  socket.on('message', (msg: Buffer, rinfo: { address: string }) => {
    try {
      const data = JSON.parse(msg.toString('utf8'));
      if (data.kind !== 'itantra-announce') return;
      if (data.name === deviceName) return; // don't discover ourselves
      onPeerFound({
        name: data.name,
        address: rinfo.address,
        tcpPort: data.tcpPort,
        lastSeen: Date.now(),
      });
    } catch {
      // not one of our packets, ignore
    }
  });

  socket.on('error', (err: unknown) => {
    console.warn('discovery socket error', err);
  });

  socket.bind(DISCOVERY_PORT);

  const announce = () => {
    const payload = Buffer.from(
      JSON.stringify({ kind: 'itantra-announce', name: deviceName, tcpPort }),
      'utf8'
    );
    socket.send(payload, 0, payload.length, DISCOVERY_PORT, BROADCAST_ADDR, (err: unknown) => {
      if (err) console.warn('discovery broadcast failed', err);
    });
  };

  const timer = setInterval(announce, ANNOUNCE_INTERVAL_MS);
  announce();

  return function stopDiscovery() {
    clearInterval(timer);
    socket.close();
  };
}

export { STALE_AFTER_MS };