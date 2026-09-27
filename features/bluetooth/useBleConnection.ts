import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addEventListener,
  connect,
  disconnect,
  discoverServices,
  requestMTU,
  setPreferredPhy,
  stopAdvertising,
  stopScan,
  subscribeToCharacteristic,
  updateCharacteristicValue,
  writeCharacteristic,
} from 'react-native-bluetooth-ble';
import {
  BLE_CHUNK_DELAY_FAST_MS,
  BLE_MTU_FALLBACK_BYTES,
  RX_CHARACTERISTIC_UUID,
  SERVICE_UUID,
  TX_CHARACTERISTIC_UUID,
  blePayloadBytesForMtu,
} from './constants';
import { textToHex } from './codec';
import { sendHexFramed } from './transport';
import { encodeBroadcast, type BroadcastEnvelope } from './broadcast';

type UseBleConnectionOpts = {
  handleIncomingHex: (
    hex: string | null | undefined,
    senderId?: string | null,
  ) => void;
  addMessage: (text: string, sender: 'me' | 'other') => void;
  clearMessages: () => void;
  setMessages: React.Dispatch<
    React.SetStateAction<{ id: string; text: string; sender: 'me' | 'other' }[]>
  >;
  resetIncomingState: () => void;
  isLanguageInstalled: boolean;
  promptInstallLanguage: () => void;
};

export function useBleConnection(opts: UseBleConnectionOpts) {
  const {
    handleIncomingHex,
    addMessage,
    clearMessages,
    setMessages,
    resetIncomingState,
    isLanguageInstalled,
    promptInstallLanguage,
  } = opts;

  const [connectedDeviceIds, setConnectedDeviceIds] = useState<string[]>([]);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(
    null,
  );
  const [peripheralCentralId, setPeripheralCentralId] = useState<string | null>(
    null,
  );
  const [peripheralCentralIds, setPeripheralCentralIds] = useState<string[]>(
    [],
  );
  const [isConnecting, setIsConnecting] = useState(false);

  const incomingHexRef = useRef(handleIncomingHex);
  useEffect(() => {
    incomingHexRef.current = handleIncomingHex;
  }, [handleIncomingHex]);

  const removeCentralValueListenersRef = useRef(new Map<string, () => void>());
  const connectingDeviceIdsRef = useRef(new Set<string>());
  // Negotiated GATT payload ceiling per central link (bytes). Links that
  // never negotiate stay at the 20B fallback; negotiated links use up to
  // 240B → ~12x fewer packets for the same envelope.
  const mtuBytesByDeviceRef = useRef(new Map<string, number>());

  const getMaxBytesForDevice = useCallback((deviceId: string): number => {
    return mtuBytesByDeviceRef.current.get(deviceId) ?? BLE_MTU_FALLBACK_BYTES;
  }, []);
  const removePeripheralWriteListenerRef = useRef<(() => void) | undefined>(
    undefined,
  );
  const removePeripheralSubscribedListenerRef = useRef<
    (() => void) | undefined
  >(undefined);
  const removePeripheralUnsubscribedListenerRef = useRef<
    (() => void) | undefined
  >(undefined);

  const pruneCentralLinks = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const dead = new Set(ids);
    ids.forEach((id) => {
      try {
        removeCentralValueListenersRef.current.get(id)?.();
      } catch {}
      removeCentralValueListenersRef.current.delete(id);
      mtuBytesByDeviceRef.current.delete(id);
    });
    setConnectedDeviceIds((current) => current.filter((d) => !dead.has(d)));
    setConnectedDeviceId((current) =>
      current && dead.has(current) ? null : current,
    );
  }, []);

  useEffect(() => {
    const centralListeners = removeCentralValueListenersRef.current;
    const mtuMap = mtuBytesByDeviceRef.current;
    return () => {
      centralListeners.forEach((remove) => remove());
      centralListeners.clear();
      mtuMap.clear();
      removePeripheralWriteListenerRef.current?.();
      removePeripheralSubscribedListenerRef.current?.();
      removePeripheralUnsubscribedListenerRef.current?.();
      try {
        stopScan();
      } catch {}
      try {
        stopAdvertising();
      } catch {}
    };
  }, []);

  // Drop links the OS reports as gone (out of range / radio drop). Without
  // this the link counters keep showing "connected" phones that left long
  // ago — the reported phantom mesh links.
  useEffect(() => {
    return addEventListener('deviceDisconnected', (event) => {
      console.log('BLE link lost:', event.deviceId);
      pruneCentralLinks([event.deviceId]);
    });
  }, [pruneCentralLinks]);

  const clearConnection = useCallback(() => {
    setConnectedDeviceIds([]);
    setConnectedDeviceId(null);
    setPeripheralCentralIds([]);
    setPeripheralCentralId(null);
    clearMessages();
    resetIncomingState();
  }, [clearMessages, resetIncomingState]);

  const setupPeripheralListeners = useCallback(() => {
    if (removePeripheralWriteListenerRef.current) return;

    console.log('Setting up peripheral listeners');

    removePeripheralWriteListenerRef.current = addEventListener(
      'peripheralWriteRequest',
      (event) => {
        console.log('PERIPHERAL WRITE — Central:', event.centralId);
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase())
          return;
        if (
          event.characteristicUUID.toLowerCase() !==
          RX_CHARACTERISTIC_UUID.toLowerCase()
        ) {
          console.log('Ignoring peripheral write: not RX');
          return;
        }
        // Per-sender key: concurrent mesh floods from different phones must
        // reassemble in isolated buffers, not one shared buffer.
        incomingHexRef.current(event.value, `peri:${event.centralId}`);
      },
    );

    removePeripheralSubscribedListenerRef.current = addEventListener(
      'peripheralSubscribed',
      (event) => {
        console.log('PERIPHERAL SUBSCRIBED — Central:', event.centralId);
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase())
          return;
        if (
          event.characteristicUUID.toLowerCase() !==
          TX_CHARACTERISTIC_UUID.toLowerCase()
        )
          return;
        setPeripheralCentralIds((current) =>
          current.includes(event.centralId)
            ? current
            : [...current, event.centralId],
        );
        setPeripheralCentralId((current) => current ?? event.centralId);
        setMessages([]);
        resetIncomingState();
        console.log('Peripheral chat is ready');
      },
    );

    removePeripheralUnsubscribedListenerRef.current = addEventListener(
      'peripheralUnsubscribed',
      (event) => {
        console.log('PERIPHERAL UNSUBSCRIBED');
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase())
          return;
        if (
          event.characteristicUUID.toLowerCase() !==
          TX_CHARACTERISTIC_UUID.toLowerCase()
        )
          return;
        setPeripheralCentralIds((current) => {
          const next = current.filter((id) => id !== event.centralId);
          setPeripheralCentralId((primary) =>
            primary === event.centralId ? (next[0] ?? null) : primary,
          );
          return next;
        });
        setMessages([]);
        resetIncomingState();
      },
    );

    console.log('Peripheral listeners ready');
  }, [resetIncomingState, setMessages]);

  const ensurePeripheralListeners = useCallback(() => {
    setupPeripheralListeners();
  }, [setupPeripheralListeners]);

  const connectToDevice = useCallback(
    async (deviceId: string, preConnect?: () => Promise<void> | void) => {
      if (
        connectingDeviceIdsRef.current.has(deviceId) ||
        connectedDeviceIds.includes(deviceId)
      ) {
        return;
      }
      if (!isLanguageInstalled) {
        promptInstallLanguage();
        return;
      }
      connectingDeviceIdsRef.current.add(deviceId);
      setIsConnecting(true);

      try {
        console.log('CONNECT START — Device:', deviceId);
        await preConnect?.();

        await connect(deviceId);
        console.log('Connected');
        setConnectedDeviceIds((current) =>
          current.includes(deviceId) ? current : [...current, deviceId],
        );
        setConnectedDeviceId((current) => current ?? deviceId);

        const services = await discoverServices(deviceId);
        const chatService = services.find(
          (s) => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase(),
        );

        if (!chatService) {
          console.log('Chat service not found');
          await disconnect(deviceId);
          setConnectedDeviceIds((current) =>
            current.filter((id) => id !== deviceId),
          );
          setConnectedDeviceId((current) =>
            current === deviceId ? null : current,
          );
          return;
        }

        const rxCharacteristic = chatService.characteristics.find(
          (c) => c.uuid.toLowerCase() === RX_CHARACTERISTIC_UUID.toLowerCase(),
        );
        const txCharacteristic = chatService.characteristics.find(
          (c) => c.uuid.toLowerCase() === TX_CHARACTERISTIC_UUID.toLowerCase(),
        );

        if (!rxCharacteristic || !txCharacteristic) {
          console.log('RX or TX characteristic not found');
          await disconnect(deviceId);
          setConnectedDeviceIds((current) =>
            current.filter((id) => id !== deviceId),
          );
          setConnectedDeviceId((current) =>
            current === deviceId ? null : current,
          );
          return;
        }

        const removeValueListener = addEventListener(
          'characteristicValueChanged',
          (event) => {
            if (event.deviceId !== deviceId) return;
            if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase())
              return;
            if (
              event.characteristicUUID.toLowerCase() !==
              TX_CHARACTERISTIC_UUID.toLowerCase()
            )
              return;
            incomingHexRef.current(event.value, `central:${event.deviceId}`);
          },
        );
        removeCentralValueListenersRef.current.set(
          deviceId,
          removeValueListener,
        );

        await subscribeToCharacteristic(
          deviceId,
          SERVICE_UUID,
          TX_CHARACTERISTIC_UUID,
        );

        try {
          const negotiated = await requestMTU(deviceId, 512);
          const usable = blePayloadBytesForMtu(
            typeof negotiated === 'number' ? negotiated : 23,
          );
          mtuBytesByDeviceRef.current.set(deviceId, usable);
          console.log(`[BLE] link MTU ready: ${deviceId} payload=${usable}B`);
        } catch (e) {
          mtuBytesByDeviceRef.current.set(deviceId, BLE_MTU_FALLBACK_BYTES);
          console.log(
            'MTU request failed (non-fatal, using 20-byte chunks):',
            e,
          );
        }
        // Best-effort 2M PHY for 2x air speed. Rejects on iOS/older
        // chipsets — caught and ignored, link stays on 1M.
        try {
          await setPreferredPhy(deviceId, 'le2m', 'le2m');
          console.log(`[BLE] 2M PHY requested: ${deviceId}`);
        } catch {}
        console.log('CONNECT COMPLETE');
      } catch (error) {
        console.log('CONNECT ERROR:', error);
        removeCentralValueListenersRef.current.get(deviceId)?.();
        removeCentralValueListenersRef.current.delete(deviceId);
        setConnectedDeviceIds((current) =>
          current.filter((id) => id !== deviceId),
        );
        setConnectedDeviceId((current) =>
          current === deviceId ? null : current,
        );
      } finally {
        connectingDeviceIdsRef.current.delete(deviceId);
        setIsConnecting(false);
      }
    },
    [connectedDeviceIds, isLanguageInstalled, promptInstallLanguage],
  );

  const writeCentralPacket = useCallback(
    async (deviceId: string, packetHex: string) => {
      if (!deviceId) return;
      // writeWithoutResponse skips the GATT ACK round trip (~30-50ms per
      // packet). Fall back to acknowledged write when the stack rejects it.
      try {
        await writeCharacteristic(
          deviceId,
          SERVICE_UUID,
          RX_CHARACTERISTIC_UUID,
          packetHex,
          'writeWithoutResponse',
        );
      } catch (e) {
        console.log('[BLE] WOR write failed, retrying with response:', e);
        await writeCharacteristic(
          deviceId,
          SERVICE_UUID,
          RX_CHARACTERISTIC_UUID,
          packetHex,
          'write',
        );
      }
    },
    [],
  );

  const notifyPeripheralPacket = useCallback((packetHex: string) => {
    return updateCharacteristicValue(
      SERVICE_UUID,
      TX_CHARACTERISTIC_UUID,
      packetHex,
      true,
    );
  }, []);

  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (!connectedDeviceId && !peripheralCentralId) {
        console.log('No connection — cannot send');
        return false;
      }
      try {
        const mtuBytes = connectedDeviceId
          ? getMaxBytesForDevice(connectedDeviceId)
          : BLE_MTU_FALLBACK_BYTES;
        await sendHexFramed(
          textToHex(trimmed),
          (packetHex) =>
            writeCentralPacket(connectedDeviceId as string, packetHex),
          notifyPeripheralPacket,
          {
            isCentral: !!connectedDeviceId,
            maxBytesPerPacket: mtuBytes,
            chunkDelayMs: BLE_CHUNK_DELAY_FAST_MS,
          },
        );
        addMessage(trimmed, 'me');
        return true;
      } catch (error) {
        console.log('Send failed:', error);
        return false;
      }
    },
    [
      addMessage,
      connectedDeviceId,
      getMaxBytesForDevice,
      notifyPeripheralPacket,
      peripheralCentralId,
      writeCentralPacket,
    ],
  );

  /**
   * Flood one envelope to every open link. Uses allSettled (not all) so one
   * dead link can't fail the whole round — the old Promise.all reported
   * failure even when other phones HAD received the message (the "says not
   * found but it sends" bug). Returns per-link counts for honest UI.
   */
  const sendBroadcastDetailed = useCallback(
    async (
      envelope: BroadcastEnvelope,
    ): Promise<{ delivered: number; attempted: number }> => {
      if (!envelope.message.trim()) return { delivered: 0, attempted: 0 };
      const txStarted = Date.now();
      // Snapshot: state may change mid-flight, count what we tried now.
      const centrals = [...connectedDeviceIds];
      const centralSubscribers = peripheralCentralIds.length > 0;
      const attempted = centrals.length + (centralSubscribers ? 1 : 0);
      if (attempted === 0) {
        console.log('No connection — cannot broadcast');
        return { delivered: 0, attempted: 0 };
      }
      const payload = textToHex(encodeBroadcast(envelope));
      const centralOutcomes = await Promise.allSettled(
        centrals.map((deviceId) =>
          sendHexFramed(
            payload,
            (packetHex) => writeCentralPacket(deviceId, packetHex),
            notifyPeripheralPacket,
            {
              isCentral: true,
              maxBytesPerPacket: getMaxBytesForDevice(deviceId),
              chunkDelayMs: BLE_CHUNK_DELAY_FAST_MS,
            },
          ),
        ),
      );
      let delivered = 0;
      const failedIds: string[] = [];
      centralOutcomes.forEach((outcome, i) => {
        if (outcome.status === 'fulfilled') delivered += 1;
        else failedIds.push(centrals[i]);
      });
      if (failedIds.length > 0) {
        // Self-healing: a link that rejects writes is dead (phone walked
        // away without a clean disconnect event). Prune so counters and
        // future rounds stop counting it; discovery re-adds it if back.
        console.log('Pruning dead mesh links:', failedIds.join(', '));
        pruneCentralLinks(failedIds);
      }
      if (centralSubscribers) {
        try {
          await sendHexFramed(
            payload,
            () => Promise.resolve(),
            notifyPeripheralPacket,
            {
              isCentral: false,
              // Remote central MTU is unknown on the peripheral side —
              // stay at the 20B fallback for reliability, but drop the
              // legacy 30ms pacing to the fast gap.
              maxBytesPerPacket: BLE_MTU_FALLBACK_BYTES,
              chunkDelayMs: BLE_CHUNK_DELAY_FAST_MS,
            },
          );
          delivered += 1;
        } catch (error) {
          console.log('Broadcast notify failed:', error);
        }
      }
      const mtuSummary = centrals
        .map((id) => `${id.slice(-4)}:${getMaxBytesForDevice(id)}B`)
        .join(',');
      console.log(
        `[MeshTiming] tx id=${envelope.id} delivered=${delivered}/${attempted} txMs=${Date.now() - txStarted} mtu=[${mtuSummary}]`,
      );
      return { delivered, attempted };
    },
    [
      connectedDeviceIds,
      getMaxBytesForDevice,
      notifyPeripheralPacket,
      peripheralCentralIds,
      pruneCentralLinks,
      writeCentralPacket,
    ],
  );

  const sendBroadcast = useCallback(
    async (envelope: BroadcastEnvelope) => {
      const { delivered } = await sendBroadcastDetailed(envelope);
      return delivered > 0;
    },
    [sendBroadcastDetailed],
  );

  const disconnectFromDevice = useCallback(async () => {
    if (connectedDeviceIds.length > 0) {
      await Promise.all(
        connectedDeviceIds.map(async (deviceId) => {
          try {
            await disconnect(deviceId);
          } catch (error) {
            console.log('Disconnect error:', error);
          }
        }),
      );
      removeCentralValueListenersRef.current.forEach((remove) => remove());
      removeCentralValueListenersRef.current.clear();
      clearConnection();
      return;
    }

    if (peripheralCentralIds.length > 0) {
      setPeripheralCentralIds([]);
      setPeripheralCentralId(null);
      setMessages([]);
      resetIncomingState();
    }
  }, [
    clearConnection,
    connectedDeviceIds,
    peripheralCentralIds,
    resetIncomingState,
    setMessages,
  ]);

  const isChatConnected =
    connectedDeviceIds.length > 0 || peripheralCentralIds.length > 0;

  return {
    connectedDeviceId,
    connectedDeviceIds,
    peripheralCentralId,
    peripheralCentralIds,
    isConnecting,
    isChatConnected,
    connectToDevice,
    disconnectFromDevice,
    clearConnection,
    ensurePeripheralListeners,
    sendText,
    sendTextOverBLE: sendText,
    sendBroadcast,
    sendBroadcastDetailed,
  };
}
