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

/**
 * GATT connection state machine — central (scanner connects) + peripheral
 * (advertiser gets subscribed). Owns connect/disconnect, listeners and all
 * outbound sends (typed + voice share one framed path).
 */
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

  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(
    null,
  );
  const [peripheralCentralId, setPeripheralCentralId] = useState<string | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const connectedDeviceIdRef = useRef<string | null>(null);
  const authorizedPeripheralCentralIdRef = useRef<string | null>(null);
  connectedDeviceIdRef.current = connectedDeviceId;

  // Latest handler for use inside BLE event listeners (registered once per
  // connection, would otherwise capture stale closures).
  const incomingHexRef = useRef(handleIncomingHex);
  useEffect(() => {
    incomingHexRef.current = handleIncomingHex;
  }, [handleIncomingHex]);

  const removeCentralValueListenerRef = useRef<(() => void) | undefined>(
    undefined,
  );
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

  useEffect(() => {
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

  const clearConnection = useCallback(() => {
    removeCentralValueListenerRef.current?.();
    removeCentralValueListenerRef.current = undefined;
    authorizedPeripheralCentralIdRef.current = null;
    setConnectedDeviceId(null);
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
        incomingHexRef.current(event.value);
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
        setPeripheralCentralId(null);
        authorizedPeripheralCentralIdRef.current = null;
        setMessages([]);
        resetIncomingState();
      },
    );

    logger.debug('Bluetooth', 'Peripheral listeners ready');
  }, [resetIncomingState, setMessages]);

  // Exposed so the chat screen can register peripheral listeners when it
  // starts advertising.
  const ensurePeripheralListeners = useCallback(() => {
    setupPeripheralListeners();
  }, [setupPeripheralListeners]);

  const connectToDevice = useCallback(
    async (deviceId: string, preConnect?: () => Promise<void> | void) => {
      if (isConnecting || connectedDeviceId || peripheralCentralId) return;
      // Require the selected language's models before opening a chat.
      if (!isLanguageInstalled) {
        promptInstallLanguage();
        return;
      }
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
          clearConnection();
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
          clearConnection();
          return;
        }

        if (removeCentralValueListenerRef.current) {
          removeCentralValueListenerRef.current();
          removeCentralValueListenerRef.current = undefined;
        }

        removeCentralValueListenerRef.current = addEventListener(
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

        await subscribeToCharacteristic(
          deviceId,
          SERVICE_UUID,
          TX_CHARACTERISTIC_UUID,
        );

        // Best effort: raise ATT MTU so fewer packets are needed. Chunking to
        // 20 bytes still keeps us safe when negotiation fails (e.g. iOS).
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
        logger.error('Bluetooth', 'Connection failed', error);
        clearConnection();
      } finally {
        setIsConnecting(false);
      }
    },
    [
      clearConnection,
      connectedDeviceId,
      isConnecting,
      isLanguageInstalled,
      peripheralCentralId,
      promptInstallLanguage,
    ],
  );

  const writeCentralPacket = useCallback(
    (packetHex: string) => {
      if (!connectedDeviceId) return Promise.resolve();
      return writeCharacteristic(
        connectedDeviceId,
        SERVICE_UUID,
        RX_CHARACTERISTIC_UUID,
        packetHex,
        'write',
      );
    },
    [connectedDeviceId],
  );

  const notifyPeripheralPacket = useCallback((packetHex: string) => {
    return updateCharacteristicValue(
      SERVICE_UUID,
      TX_CHARACTERISTIC_UUID,
      packetHex,
      true,
    );
  }, []);

  /** Send an arbitrary text string over BLE (typed + voice share this path). */
  const sendText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      if (!connectedDeviceId && !peripheralCentralId) {
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

  const disconnectFromDevice = useCallback(async () => {
    if (connectedDeviceId) {
      try {
        await disconnect(connectedDeviceId);
        logger.info('Bluetooth', 'Central disconnected');
      } catch (error) {
        logger.error('Bluetooth', 'Disconnect failed', error);
      }
      clearConnection();
      return;
    }

    if (peripheralCentralId) {
      setPeripheralCentralId(null);
      setMessages([]);
      resetIncomingState();
    }
  }, [
    clearConnection,
    connectedDeviceId,
    peripheralCentralId,
    resetIncomingState,
    setMessages,
  ]);

  const isChatConnected =
    connectedDeviceId !== null || peripheralCentralId !== null;

  return {
    connectedDeviceId,
    peripheralCentralId,
    isConnecting,
    isChatConnected,
    connectToDevice,
    disconnectFromDevice,
    clearConnection,
    ensurePeripheralListeners,
    sendText,
    sendTextOverBLE: sendText,
  };
}
