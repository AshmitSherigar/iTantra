import { useCallback, useEffect, useRef, useState } from 'react';
import { WifiTransport, ConnectionStatus, TCP_PORT } from './WifiTransport';
import { startDiscovery, DiscoveredPeer } from './discovery';
import type { TransportMessage } from './protocol';

// This is the hook the STT and TTS screens should actually import. It hides
// the WifiTransport class and the discovery module behind a small API:
// status, messages, peers, and a handful of functions to act on them.
export function useWifiTransport(deviceName: string) {
  const transportRef = useRef<WifiTransport | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [messages, setMessages] = useState<TransportMessage[]>([]);
  const [peers, setPeers] = useState<DiscoveredPeer[]>([]);

  useEffect(() => {
    const transport = new WifiTransport();
    transportRef.current = transport;

    const offStatus = transport.onStatusChange(setStatus);
    const offMessage = transport.onMessage((msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    const stopDiscovery = startDiscovery(deviceName, TCP_PORT, (peer) => {
      setPeers((prev) => {
        const withoutThisPeer = prev.filter((p) => p.address !== peer.address);
        return [...withoutThisPeer, peer];
      });
    });

    return () => {
      offStatus();
      offMessage();
      stopDiscovery();
      transport.disconnect();
    };
  }, [deviceName]);

  const startHosting = useCallback(() => {
    transportRef.current?.startAsHost();
  }, []);

  const connectTo = useCallback((address: string) => {
    transportRef.current?.connectToHost(address);
  }, []);

  const sendText = useCallback(
    (text: string, type: TransportMessage['type'] = 'msg', lang = 'en') => {
      return transportRef.current?.send({ type, text, lang });
    },
    []
  );

  const disconnect = useCallback(() => {
    transportRef.current?.disconnect();
  }, []);

  return { status, messages, peers, startHosting, connectTo, sendText, disconnect };
}
