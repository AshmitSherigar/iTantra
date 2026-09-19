import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  WIFI_MAX_MESSAGES,
  WIFI_MAX_PEERS,
  WIFI_STALE_AFTER_MS,
  WIFI_TCP_PORT,
  makeWifiMessageId,
  type WifiChatMessage,
  type WifiConnectionStatus,
  type WifiPeer,
} from './constants';
import { WifiChatTransport } from './WifiTransport';
import { startWifiDiscovery } from './discovery';

export type UseWifiChatOpts = {
  deviceName: string;
  /** Stable per-install id — generated once by the screen. */
  deviceId: string;
  lang?: string;
  autoHost?: boolean;
};

function mergePeer(prev: WifiPeer[], incoming: WifiPeer): WifiPeer[] {
  const byAddr = prev.findIndex((p) => p.address === incoming.address);
  if (byAddr !== -1) {
    const updated = [...prev];
    // Keep the freshest name, preserve manual edits never happen here.
    updated[byAddr] = { ...updated[byAddr], ...incoming };
    return updated;
  }
  // Same phone re-announced from a new DHCP address — collapse by deviceId.
  const byId = prev.findIndex((p) => p.deviceId === incoming.deviceId);
  if (byId !== -1) {
    const updated = [...prev];
    updated[byId] = { ...updated[byId], ...incoming };
    return updated;
  }
  if (prev.length >= WIFI_MAX_PEERS) return prev;
  return [...prev, incoming];
}

/**
 * WiFi LAN chat state — the hook screens actually import.
 *
 * - UDP discovery lists ALL phones on the same WiFi (no internet).
 * - TCP transport holds N simultaneous chats (multi-peer, unlike the
 *   single-socket `transport/` prototype).
 * - Bluetooth is untouched — this hook never imports from
 *   `features/bluetooth`.
 */
export function useWifiChat(opts: UseWifiChatOpts) {
  const { deviceName, deviceId, lang = 'en', autoHost = true } = opts;
  const transportRef = useRef<WifiChatTransport | null>(null);
  const nameRef = useRef(deviceName);
  const langRef = useRef(lang);
  nameRef.current = deviceName;
  langRef.current = lang;

  const [status, setStatus] = useState<WifiConnectionStatus>('idle');
  const [peers, setPeers] = useState<WifiPeer[]>([]);
  const [connectedAddresses, setConnectedAddresses] = useState<string[]>([]);
  const [messages, setMessages] = useState<WifiChatMessage[]>([]);
  const [ssid, setSsid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Best-effort SSID label so users can confirm "same WiFi". NetInfo is an
  // optional peer — if it isn't installed/linked yet, skip silently.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (Platform.OS === 'web') return;
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('@react-native-community/netinfo');
        const NetInfo = mod?.default ?? mod;
        const state = await NetInfo?.fetch?.();
        if (!cancelled && state?.type === 'wifi' && state?.details?.ssid) {
          setSsid(String(state.details.ssid));
        } else if (!cancelled) {
          setSsid(null);
        }
      } catch {
        if (!cancelled) setSsid(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const transport = new WifiChatTransport();
    transportRef.current = transport;
    setError(null);

    const offStatus = transport.onStatusChange(setStatus);
    const offPeers = transport.onPeersChange(setConnectedAddresses);
    const offMessage = transport.onMessage(({ msg, fromAddress }) => {
      const text = (msg.text ?? '').trim();
      if (!text) return;
      const peerName = (msg.senderName ?? '').trim() || fromAddress;
      // Broadcasts land on the global page; directs stay private.
      // Legacy peers omit `scope` → treated as direct (old behavior).
      const isBroadcast = msg.scope === 'broadcast';
      setMessages((prev) =>
        [
          ...prev,
          {
            id: msg.id || makeWifiMessageId(),
            text,
            sender: 'other' as const,
            peerAddress: isBroadcast ? 'broadcast' : fromAddress,
            peerName,
            timestamp: typeof msg.ts === 'number' ? msg.ts : Date.now(),
            lang: msg.lang,
          },
        ].slice(-WIFI_MAX_MESSAGES),
      );
    });

    let stopDiscovery: (() => void) | null = null;
    try {
      stopDiscovery = startWifiDiscovery(
        deviceName,
        deviceId,
        WIFI_TCP_PORT,
        (peer) => {
          setPeers((prev) => mergePeer(prev, peer));
        },
      );
    } catch (e) {
      console.warn('[WiFi] discovery failed to start', e);
      setError('WiFi discovery unavailable on this device / build.');
    }

    if (autoHost) {
      const ok = transport.ensureServer();
      if (!ok) {
        setError(
          'WiFi chat needs a dev build (react-native-tcp-socket). ' +
            'Run `expo run:android` — it does not work in Expo Go or web.',
        );
      }
    }

    const pruneTimer = setInterval(() => {
      const now = Date.now();
      setPeers((prev) =>
        prev.filter((p) => now - p.lastSeen < WIFI_STALE_AFTER_MS * 2),
      );
    }, 2000);

    return () => {
      clearInterval(pruneTimer);
      offStatus();
      offPeers();
      offMessage();
      try {
        stopDiscovery?.();
      } catch {}
      transport.disconnect();
      transportRef.current = null;
    };
    // Re-create only when identity changes — not on every keystroke of the
    // name field (the screen debounces that into deviceName).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, autoHost]);

  const startHosting = useCallback(() => {
    const ok = transportRef.current?.ensureServer() ?? false;
    if (!ok) {
      setError(
        'Could not start WiFi hosting. Use a dev build (`expo run:android`).',
      );
      return false;
    }
    setError(null);
    return true;
  }, []);

  const connectTo = useCallback((address: string) => {
    const target = address.trim();
    if (!target) return;
    setError(null);
    // Auto-host too — otherwise two dialling phones can't hear each other
    // back, and a third phone can't join via us later.
    transportRef.current?.ensureServer();
    transportRef.current?.connectToHost(target);
  }, []);

  const disconnectPeer = useCallback((address: string) => {
    transportRef.current?.disconnectPeer(address);
  }, []);

  const disconnectAll = useCallback(() => {
    transportRef.current?.disconnect();
    setMessages([]);
  }, []);

  const sendToPeer = useCallback(
    (address: string, text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const peer = peers.find((p) => p.address === address);
      transportRef.current?.sendTo(address, {
        type: 'msg',
        text: trimmed,
        lang: langRef.current,
        senderName: nameRef.current,
        id: makeWifiMessageId(),
        scope: 'direct',
      });
      setMessages((prev) =>
        [
          ...prev,
          {
            id: makeWifiMessageId(),
            text: trimmed,
            sender: 'me' as const,
            peerAddress: address,
            peerName: peer?.name ?? address,
            timestamp: Date.now(),
            lang: langRef.current,
          },
        ].slice(-WIFI_MAX_MESSAGES),
      );
      return true;
    },
    [peers],
  );

  const broadcast = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return { delivered: 0, attempted: 0 };
    const res = transportRef.current?.broadcast({
      type: 'msg',
      text: trimmed,
      lang: langRef.current,
      senderName: nameRef.current,
      id: makeWifiMessageId(),
      scope: 'broadcast',
    }) ?? { delivered: 0, attempted: 0 };
    setMessages((prev) =>
      [
        ...prev,
        {
          id: makeWifiMessageId(),
          text: trimmed,
          sender: 'me' as const,
          peerAddress: 'broadcast',
          peerName: 'Everyone',
          timestamp: Date.now(),
          lang: langRef.current,
        },
      ].slice(-WIFI_MAX_MESSAGES),
    );
    return res;
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  const connectedPeers = useMemo(
    () =>
      connectedAddresses
        .map((address) => peers.find((p) => p.address === address) ?? null)
        .filter((p): p is WifiPeer => p !== null),
    [connectedAddresses, peers],
  );

  const isConnected = connectedAddresses.length > 0;

  return {
    status,
    peers,
    connectedAddresses,
    connectedPeers,
    isConnected,
    messages,
    ssid,
    error,
    startHosting,
    connectTo,
    disconnectPeer,
    disconnectAll,
    sendToPeer,
    broadcast,
    clearMessages,
  };
}
