import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addEventListener,
  connect,
  disconnect,
  discoverServices,
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
} from './constants';
import { textToHex } from './codec';
import { sendHexFramed } from './transport';
import { encodeBroadcast, type BroadcastEnvelope } from './broadcast';

type UseBleConnectionOpts = {
  handleIncomingHex: (hex: string | null | undefined) => void;
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

  const removeCentralValueListenersRef = useRef(
    new Map<string, () => void>(),
  );
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

  useEffect(() => {
    const centralListeners = removeCentralValueListenersRef.current;
    return () => {
      centralListeners.forEach((remove) => remove());
      centralListeners.clear();
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
        incomingHexRef.current(event.value);
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
            primary === event.centralId ? next[0] ?? null : primary,
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
            incomingHexRef.current(event.value);
          },
        );
        removeCentralValueListenersRef.current.set(deviceId, removeValueListener);

        await subscribeToCharacteristic(
          deviceId,
          SERVICE_UUID,
          TX_CHARACTERISTIC_UUID,
        );

        try {
          await requestMTU(deviceId, 512);
        } catch (e) {
          console.log(
            'MTU request failed (non-fatal, using 20-byte chunks):',
            e,
          );
        }
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
    [
      connectedDeviceIds,
      isLanguageInstalled,
      promptInstallLanguage,
    ],
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
        console.log('Send failed:', error);
        return false;
      }
    },
    [
      addMessage,
      connectedDeviceId,
      notifyPeripheralPacket,
      peripheralCentralId,
      writeCentralPacket,
    ],
  );

  const sendBroadcast = useCallback(
    async (envelope: BroadcastEnvelope) => {
      if (!envelope.message.trim()) return false;
      if (connectedDeviceIds.length === 0 && peripheralCentralIds.length === 0) {
        console.log('No connection — cannot broadcast');
        return false;
      }
      try {
        const payload = textToHex(encodeBroadcast(envelope));
        await Promise.all(
          connectedDeviceIds.map((deviceId) =>
            sendHexFramed(
              payload,
              (packetHex) => writeCentralPacket(deviceId, packetHex),
              notifyPeripheralPacket,
              { isCentral: true },
            ),
          ),
        );
        if (peripheralCentralIds.length > 0) {
          await sendHexFramed(payload, () => Promise.resolve(), notifyPeripheralPacket, {
            isCentral: false,
          });
        }
        if (connectedDeviceIds.length === 0 && peripheralCentralIds.length === 0) {
          return false;
        }
        return true;
      } catch (error) {
        console.log('Broadcast failed:', error);
        return false;
      }
    },
    [
      connectedDeviceIds,
      notifyPeripheralPacket,
      peripheralCentralIds,
      writeCentralPacket,
    ],
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
  };
}
