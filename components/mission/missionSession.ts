import type { WifiChatMessage, WifiPeer } from '@/features/wifi';

export type BleMissionMessage = {
  id: string;
  senderName: string;
  text: string;
  ts: number;
  sender: 'me' | 'other';
};

type MissionSessionState = {
  deviceName: string;
  deviceId: string;
  languageId: string;
  wifiPeers: WifiPeer[];
  wifiConnectedAddresses: string[];
  wifiMessages: WifiChatMessage[];
  wifiSendToPeer: ((address: string, text: string) => boolean) | null;
  wifiBroadcast:
    | ((text: string) => { delivered: number; attempted: number })
    | null;
  bleMessages: BleMissionMessage[];
  bleBroadcastSend: ((text: string) => Promise<boolean>) | null;
};

let state: MissionSessionState = {
  deviceName: '',
  deviceId: '',
  languageId: 'en',
  wifiPeers: [],
  wifiConnectedAddresses: [],
  wifiMessages: [],
  wifiSendToPeer: null,
  wifiBroadcast: null,
  bleMessages: [],
  bleBroadcastSend: null,
};

// Plain module-level store (not React state): mission-mode.tsx stays the
// only component that ever calls useWifiChat(), so a second screen can read
// its live connections via useSyncExternalStore(subscribe, getMissionSession)
// without opening a second TCP server/socket set.
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function updateMissionSession(patch: Partial<MissionSessionState>) {
  state = { ...state, ...patch };
  notify();
}

export function appendBleMissionMessage(msg: BleMissionMessage) {
  state = { ...state, bleMessages: [...state.bleMessages, msg] };
  notify();
}

export function getMissionSession(): MissionSessionState {
  return state;
}

export function subscribeMissionSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
