/**
 * WiFi LAN chat constants: ports, timers, limits and shared chat types.
 *
 * WiFi and Bluetooth use different transports, so these are separate from
 * `features/bluetooth/constants.ts` (BLE service UUIDs / MTUs). Nothing
 * here imports from bluetooth.
 */

/** TCP port the chat server listens on and clients dial. */
export const WIFI_TCP_PORT = 5050;
/** UDP port presence announcements are broadcast on. */
export const WIFI_DISCOVERY_PORT = 8888;
/** LAN-wide broadcast address announcements are sent to. */
export const WIFI_BROADCAST_ADDR = '255.255.255.255';
/** Announce packet kind this app sends. */
export const WIFI_ANNOUNCE_KIND = 'vaanisetu-announce';
/** Additional announce kind accepted on receive for compatibility. */
export const WIFI_ANNOUNCE_KIND_LEGACY = 'itantra-announce';

/** How often each phone announces its presence. */
export const WIFI_ANNOUNCE_INTERVAL_MS = 1000;
/** Peers not heard from within this window are pruned from the list. */
export const WIFI_STALE_AFTER_MS = 5000;

/** How often a heartbeat is sent on each open connection. */
export const WIFI_HEARTBEAT_INTERVAL_MS = 2000;
/** Missed heartbeats in a row before a connection is considered dead. */
export const WIFI_HEARTBEAT_TIMEOUT_COUNT = 3;
/** First reconnect delay after a dropped outbound connection. */
export const WIFI_RECONNECT_BASE_DELAY_MS = 1000;
/** Upper bound for the exponential reconnect delay. */
export const WIFI_RECONNECT_MAX_DELAY_MS = 16000;

/** Cap on discovered peers kept in state. */
export const WIFI_MAX_PEERS = 50;
/** Cap on chat messages kept in state (oldest are dropped). */
export const WIFI_MAX_MESSAGES = 200;

/** Lifecycle of the WiFi transport. */
export type WifiConnectionStatus =
  'idle' | 'listening' | 'connecting' | 'connected' | 'disconnected';

/** One phone discovered via UDP broadcast on the LAN. */
export type WifiPeer = {
  /** Display name shown in the peer list. */
  name: string;
  /** Stable per-install id to tell same-name phones apart + ignore self. */
  deviceId: string;
  /** LAN IP address used for the TCP connection. */
  address: string;
  /** TCP port the peer listens on. */
  tcpPort: number;
  /** `Date.now()` when this peer was last heard from. */
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

/** Builds a unique id for a chat message. */
export function makeWifiMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
