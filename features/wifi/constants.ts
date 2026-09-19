/**
 * WiFi LAN chat constants.
 *
 * Separate from `features/bluetooth/constants.ts` on purpose — Bluetooth
 * uses BLE GATT MTUs and service UUIDs, WiFi uses TCP/UDP ports. Nothing
 * here may import from bluetooth.
 */

export const WIFI_TCP_PORT = 5050;
export const WIFI_DISCOVERY_PORT = 8888;
export const WIFI_BROADCAST_ADDR = '255.255.255.255';
export const WIFI_ANNOUNCE_KIND = 'vaanisetu-announce';
/** Legacy kind from the `wifi` branch prototype — still accepted on receive. */
export const WIFI_ANNOUNCE_KIND_LEGACY = 'itantra-announce';

export const WIFI_ANNOUNCE_INTERVAL_MS = 1000;
/** Peers not heard from within this window are pruned from the list. */
export const WIFI_STALE_AFTER_MS = 5000;

export const WIFI_HEARTBEAT_INTERVAL_MS = 2000;
export const WIFI_HEARTBEAT_TIMEOUT_COUNT = 3;
export const WIFI_RECONNECT_BASE_DELAY_MS = 1000;
export const WIFI_RECONNECT_MAX_DELAY_MS = 16000;

export const WIFI_MAX_PEERS = 50;
export const WIFI_MAX_MESSAGES = 200;

export type WifiConnectionStatus =
  'idle' | 'listening' | 'connecting' | 'connected' | 'disconnected';

/** One phone discovered via UDP broadcast on the LAN. */
export type WifiPeer = {
  name: string;
  /** Stable per-install id to tell same-name phones apart + ignore self. */
  deviceId: string;
  address: string;
  tcpPort: number;
  lastSeen: number;
};

/** One chat bubble. `peerAddress` is the other side (or 'broadcast'). */
export type WifiChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'other';
  peerAddress: string;
  peerName: string;
  timestamp: number;
  lang?: string;
};

export function makeWifiMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
