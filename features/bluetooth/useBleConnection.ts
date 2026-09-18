import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  addEventListener,
  connect,
  createBond,
  disconnect,
  discoverServices,
  getBondState,
  requestMTU,
  stopAdvertising,
  stopScan,
  subscribeToCharacteristic,
  updateCharacteristicValue,
  writeCharacteristic,
} from 'react-native-bluetooth-ble';
import {
  RX_CHARACTERISTIC_UUID,
  SERVICE_UUID,
  TX_CHARACTERISTIC_UUID,
} from '@/features/bluetooth/constants';
import { textToHex } from '@/features/bluetooth/codec';
import { sendHexFramed } from '@/features/bluetooth/transport';
import { logger } from '@/utils/logger';

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
  const connectedDeviceIdRef = useRef<string | null>(null);
  const authorizedPeripheralCentralIdRef = useRef<string | null>(null);
  connectedDeviceIdRef.current = connectedDeviceId;

  const incomingHexRef = useRef(handleIncomingHex);
  useEffect(() => {
    incomingHexRef.current = handleIncomingHex;
  }, [handleIncomingHex]);

  const removeCentralValueListenersRef = useRef(new Map<string, () => void>());
  const connectingDeviceIdsRef = useRef(new Set<string>());
  const removePeripheralWriteListenerRef = useRef<(() => void) | undefined>(
    undefined,
  );
  const removePeripheralSubscribedListenerRef = useRef<
    (() => void) | undefined
  >(undefined);
  const removePeripheralUnsubscribedListenerRef = useRef<
    (() => void) | undefined
  >(undefined);
  const removeDeviceDisconnectedListenerRef = useRef<(() => void) | undefined>(
    undefined,
  );
  const sendQueueRef = useRef(Promise.resolve());

  const pruneCentralLinks = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const dead = new Set(ids);
    ids.forEach((id) => {
      try {
        removeCentralValueListenersRef.current.get(id)?.();
      } catch {}
      removeCentralValueListenersRef.current.delete(id);
    });
    setConnectedDeviceIds((current) => current.filter((d) => !dead.has(d)));
    setConnectedDeviceId((current) =>
      current && dead.has(current) ? null : current,
    );
  }, []);

  useEffect(() => {
    const centralListeners = removeCentralValueListenersRef.current;
    return () => {
      centralListeners.forEach((remove) => remove());
      centralListeners.clear();
    removeDeviceDisconnectedListenerRef.current = addEventListener(
      'deviceDisconnected',
      (event) => {
        if (connectedDeviceIdRef.current !== event.deviceId) return;
        logger.info('Bluetooth', 'Central device disconnected', {
          deviceId: event.deviceId,
        });
        removeCentralValueListenerRef.current?.();
        removeCentralValueListenerRef.current = undefined;
        setConnectedDeviceId(null);
        clearMessages();
        resetIncomingState();
      },
    );

    return () => {
      removeDeviceDisconnectedListenerRef.current?.();
      removeDeviceDisconnectedListenerRef.current = undefined;
      removeCentralValueListenerRef.current?.();
      removePeripheralWriteListenerRef.current?.();
      removePeripheralSubscribedListenerRef.current?.();
      removePeripheralUnsubscribedListenerRef.current?.();
      try {
        stopScan();
      } catch {}
      try {
        stopAdvertising();
      } catch {}
      const deviceId = connectedDeviceIdRef.current;
      if (deviceId) {
        try {
          disconnect(deviceId);
        } catch {}
      }
    };
  }, [clearMessages, resetIncomingState]);

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
    removeCentralValueListenerRef.current?.();
    removeCentralValueListenerRef.current = undefined;
    authorizedPeripheralCentralIdRef.current = null;
    setConnectedDeviceId(null);
    setPeripheralCentralIds([]);
    setPeripheralCentralId(null);
    clearMessages();
    resetIncomingState();
  }, [clearMessages, resetIncomingState]);

  const setupPeripheralListeners = useCallback(() => {
    if (removePeripheralWriteListenerRef.current) return;

    logger.debug('Bluetooth', 'Setting up peripheral listeners');

    removePeripheralWriteListenerRef.current = addEventListener(
      'peripheralWriteRequest',
      (event) => {
        logger.debug('Bluetooth', 'Peripheral write received');
        if (authorizedPeripheralCentralIdRef.current !== event.centralId)
          return;
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase())
          return;
        if (
          event.characteristicUUID.toLowerCase() !==
          RX_CHARACTERISTIC_UUID.toLowerCase()
        ) {
          logger.debug(
            'Bluetooth',
            'Ignoring peripheral write for unknown characteristic',
          );
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
        logger.info('Bluetooth', 'Peripheral subscribed');
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
        if (Platform.OS === 'android') {
          void (async () => {
            const bondState = await getBondState(event.centralId);
            const finalBondState =
              bondState === 'bonded'
                ? bondState
                : await createBond(event.centralId);
            if (finalBondState !== 'bonded') {
              await disconnect(event.centralId);
              return;
            }
            authorizedPeripheralCentralIdRef.current = event.centralId;
            setPeripheralCentralId(event.centralId);
            setMessages([]);
            resetIncomingState();
            logger.info('Bluetooth', 'Bonded peripheral chat is ready');
          })().catch((error) => {
            logger.warn('Bluetooth', 'Peripheral bonding failed', error);
            void disconnect(event.centralId);
          });
          return;
        }
        authorizedPeripheralCentralIdRef.current = event.centralId;
        setPeripheralCentralId(event.centralId);
        setMessages([]);
        resetIncomingState();
        logger.info('Bluetooth', 'Peripheral chat is ready');
      },
    );

    removePeripheralUnsubscribedListenerRef.current = addEventListener(
      'peripheralUnsubscribed',
      (event) => {
        logger.info('Bluetooth', 'Peripheral unsubscribed');
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
        setPeripheralCentralId(null);
        authorizedPeripheralCentralIdRef.current = null;
        setMessages([]);
        resetIncomingState();
      },
    );

    logger.debug('Bluetooth', 'Peripheral listeners ready');
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
        logger.info('Bluetooth', 'Connection started', { deviceId });
        // Screen stops scanning + clears the list first (keeps this hook
        // decoupled from the scanner).
        await preConnect?.();

        await connect(deviceId);
        logger.info('Bluetooth', 'Connected', { deviceId });
        if (Platform.OS === 'android') {
          const bondState = await getBondState(deviceId);
          const finalBondState =
            bondState === 'bonded' ? bondState : await createBond(deviceId);
          if (finalBondState !== 'bonded') {
            throw new Error('Bluetooth device pairing was not completed.');
          }
        }
        setConnectedDeviceId(deviceId);

        const services = await discoverServices(deviceId);
        const chatService = services.find(
          (s) => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase(),
        );

        if (!chatService) {
          logger.warn('Bluetooth', 'Chat service not found');
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
          logger.warn('Bluetooth', 'RX or TX characteristic not found');
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
          await requestMTU(deviceId, 512);
        } catch (e) {
          logger.warn(
            'Bluetooth',
            'MTU request failed; using 20-byte chunks',
            e,
          );
        }
        logger.info('Bluetooth', 'Connection complete', { deviceId });
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
        logger.error('Bluetooth', 'Connection failed', error);
        clearConnection();
      } finally {
        connectingDeviceIdsRef.current.delete(deviceId);
        setIsConnecting(false);
      }
    },
    [connectedDeviceIds, isLanguageInstalled, promptInstallLanguage],
  );

  const writeCentralPacket = useCallback(
    (deviceId: string, packetHex: string) => {
      if (!deviceId) return Promise.resolve();
      return writeCharacteristic(
        deviceId,
        SERVICE_UUID,
        RX_CHARACTERISTIC_UUID,
        packetHex,
        'write',
      );
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
        await sendHexFramed(
          textToHex(trimmed),
          (packetHex) =>
            writeCentralPacket(connectedDeviceId as string, packetHex),
          notifyPeripheralPacket,
          {
            isCentral: !!connectedDeviceId,
          },
        );
        addMessage(trimmed, 'me');
        return true;
      } catch (error) {
        logger.warn('Bluetooth', 'Cannot send without a connection');
        return false;
      }

      const sendOperation = sendQueueRef.current.then(async () => {
        if (!connectedDeviceId && !peripheralCentralId) {
          logger.warn('Bluetooth', 'Queued send skipped; connection ended');
          return false;
        }
        try {
          await sendHexFramed(
            textToHex(trimmed),
            writeCentralPacket,
            notifyPeripheralPacket,
            {
              isCentral: !!connectedDeviceId,
            },
          );
          addMessage(trimmed, 'me');
          return true;
        } catch (error) {
          logger.error('Bluetooth', 'Send failed', error);
          return false;
        }
      });

      sendQueueRef.current = sendOperation.then(
        () => undefined,
        () => undefined,
      );
      return sendOperation;
    },
    [
      addMessage,
      connectedDeviceId,
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
      // Snapshot: state may change mid-flight, count what we tried now.
      const centrals = [...connectedDeviceIds];
      const centralSubscribers = peripheralCentralIds.length > 0;
      const attempted = centrals.length + (centralSubscribers ? 1 : 0);
      if (attempted === 0) {
        console.log('No connection — cannot broadcast');
        return { delivered: 0, attempted: 0 };
  const disconnectFromDevice = useCallback(async () => {
    if (connectedDeviceId) {
      try {
        await disconnect(connectedDeviceId);
        logger.info('Bluetooth', 'Central disconnected');
      } catch (error) {
        logger.error('Bluetooth', 'Disconnect failed', error);
      }
      const payload = textToHex(encodeBroadcast(envelope));
      const centralOutcomes = await Promise.allSettled(
        centrals.map((deviceId) =>
          sendHexFramed(
            payload,
            (packetHex) => writeCentralPacket(deviceId, packetHex),
            notifyPeripheralPacket,
            { isCentral: true },
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
            },
          );
          delivered += 1;
        } catch (error) {
          console.log('Broadcast notify failed:', error);
        }
      }
      return { delivered, attempted };
    },
    [
      connectedDeviceIds,
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
