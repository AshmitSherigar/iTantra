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

  useEffect(() => {
    return () => {
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
    };
  }, []);

  const clearConnection = useCallback(() => {
    setConnectedDeviceId(null);
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
        setPeripheralCentralId(event.centralId);
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
        setPeripheralCentralId(null);
        setMessages([]);
        resetIncomingState();
      },
    );

    console.log('Peripheral listeners ready');
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
        console.log('CONNECT START — Device:', deviceId);
        // Screen stops scanning + clears the list first (keeps this hook
        // decoupled from the scanner).
        await preConnect?.();

        await connect(deviceId);
        console.log('Connected');
        setConnectedDeviceId(deviceId);

        const services = await discoverServices(deviceId);
        const chatService = services.find(
          (s) => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase(),
        );

        if (!chatService) {
          console.log('Chat service not found');
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
          console.log('RX or TX characteristic not found');
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
          console.log(
            'MTU request failed (non-fatal, using 20-byte chunks):',
            e,
          );
        }
        console.log('CONNECT COMPLETE');
      } catch (error) {
        console.log('CONNECT ERROR:', error);
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
        console.log('No connection — cannot send');
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

  const disconnectFromDevice = useCallback(async () => {
    if (connectedDeviceId) {
      try {
        await disconnect(connectedDeviceId);
        console.log('Central disconnected');
      } catch (error) {
        console.log('Disconnect error:', error);
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
