// export JAVA_HOME=/usr/lib/jvm/java-17-temurin-jdk
// export ANDROID_HOME=$HOME/Android/Sdk

import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  requestBluetoothPermission,
  isBluetoothEnabled,
  setServices,
  startAdvertising,
  startScan,
  stopScan,
  addDeviceFoundListener,
  addEventListener,
  connect,
  disconnect,
  discoverServices,
  subscribeToCharacteristic,
  writeCharacteristic,
  updateCharacteristicValue,
} from 'react-native-bluetooth-ble';

const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';

const RX_CHARACTERISTIC_UUID = '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';

const TX_CHARACTERISTIC_UUID = '8b3e8c1f-5d42-4f77-a91d-6c3e2b8a5f19';

type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'other';
};

export default function HomeScreen() {
  const [devices, setDevices] = useState<any[]>([]);

  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(
    null,
  );

  const [peripheralCentralId, setPeripheralCentralId] = useState<string | null>(
    null,
  );

  const [message, setMessage] = useState('');

  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [isScanning, setIsScanning] = useState(false);

  const [isConnecting, setIsConnecting] = useState(false);

  const [bluetoothReady, setBluetoothReady] = useState(false);

  const removeDeviceListenerRef = useRef<(() => void) | undefined>(undefined);

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

  const stopScanning = async () => {
    try {
      await stopScan();
    } catch (error) {
      console.log('Stop scan error:', error);
    }

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();

      removeDeviceListenerRef.current = undefined;
    }

    setIsScanning(false);

    console.log('Scan stopped');
  };

  const scanForDevices = async () => {
    if (isScanning) {
      return;
    }

    if (connectedDeviceId || peripheralCentralId) {
      console.log('Already connected');

      return;
    }

    setDevices([]);

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();

      removeDeviceListenerRef.current = undefined;
    }

    removeDeviceListenerRef.current = addDeviceFoundListener((device) => {
      console.log('Device found:', device);

      setDevices((currentDevices) => {
        const exists = currentDevices.some(
          (currentDevice) => currentDevice.id === device.id,
        );

        if (exists) {
          return currentDevices;
        }

        return [...currentDevices, device];
      });
    });

    console.log('Starting scan...');

    await startScan({
      allowDuplicates: false,
      scanMode: 'balanced',
    });

    setIsScanning(true);

    console.log('Scan started');
  };

  const hexToText = (hex: string) => {
    let text = '';

    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substring(i, i + 2), 16);

      text += String.fromCharCode(byte);
    }

    return text;
  };

  const textToHex = (text: string) => {
    return Array.from(text)
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');
  };

  const addMessage = (text: string, sender: 'me' | 'other') => {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: Date.now().toString() + Math.random().toString(),
        text,
        sender,
      },
    ]);
  };

  const clearConnection = () => {
    setConnectedDeviceId(null);
    setPeripheralCentralId(null);
    setMessages([]);
    setMessage('');
  };

  const setupPeripheralListeners = () => {
    if (removePeripheralWriteListenerRef.current) {
      return;
    }

    console.log('Setting up peripheral listeners');

    removePeripheralWriteListenerRef.current = addEventListener(
      'peripheralWriteRequest',
      (event) => {
        console.log('========== PERIPHERAL WRITE ==========');

        console.log('Central ID:', event.centralId);

        console.log('Service:', event.serviceUUID);

        console.log('Characteristic:', event.characteristicUUID);

        console.log('Hex:', event.value);

        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) {
          return;
        }

        /*
         * Only RX is allowed to receive writes.
         */
        if (
          event.characteristicUUID.toLowerCase() !==
          RX_CHARACTERISTIC_UUID.toLowerCase()
        ) {
          console.log('Ignoring peripheral write: not RX');

          return;
        }

        const receivedText = hexToText(event.value);

        console.log('Received message:', receivedText);

        /*
         * Display the message.
         *
         * IMPORTANT:
         *
         * We do NOT update the TX characteristic
         * here.
         *
         * Therefore the receiver will NOT
         * automatically send the message back.
         */
        addMessage(receivedText, 'other');
      },
    );

    removePeripheralSubscribedListenerRef.current = addEventListener(
      'peripheralSubscribed',
      (event) => {
        console.log('========== PERIPHERAL SUBSCRIBED ==========');

        console.log('Central ID:', event.centralId);

        console.log('Service:', event.serviceUUID);

        console.log('Characteristic:', event.characteristicUUID);

        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) {
          return;
        }

        /*
         * The central should subscribe
         * to TX, not RX.
         */
        if (
          event.characteristicUUID.toLowerCase() !==
          TX_CHARACTERISTIC_UUID.toLowerCase()
        ) {
          return;
        }

        setPeripheralCentralId(event.centralId);

        setMessages([]);

        console.log('Central subscribed to TX');

        console.log('Peripheral chat is ready');
      },
    );

    removePeripheralUnsubscribedListenerRef.current = addEventListener(
      'peripheralUnsubscribed',
      (event) => {
        console.log('========== PERIPHERAL UNSUBSCRIBED ==========');

        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) {
          return;
        }

        if (
          event.characteristicUUID.toLowerCase() !==
          TX_CHARACTERISTIC_UUID.toLowerCase()
        ) {
          return;
        }

        setPeripheralCentralId(null);

        setMessages([]);

        console.log('Central unsubscribed from TX');
      },
    );

    console.log('Peripheral listeners ready');
  };

  const connectToDevice = async (deviceId: string) => {
    if (isConnecting) {
      return;
    }

    if (connectedDeviceId || peripheralCentralId) {
      return;
    }

    setIsConnecting(true);

    try {
      console.log('========== CONNECT START ==========');

      console.log('Device ID:', deviceId);

      /*
       * Stop scanning immediately.
       */
      console.log('1. Stopping scan...');

      await stopScanning();

      /*
       * Clear old devices.
       */
      setDevices([]);

      /*
       * Connect.
       */
      console.log('2. Calling connect()...');

      await connect(deviceId);

      console.log('3. Connected');

      setConnectedDeviceId(deviceId);

      /*
       * Discover services.
       */
      console.log('4. Discovering services...');

      const services = await discoverServices(deviceId);

      console.log('5. Services:', services);

      /*
       * Find our service.
       */
      const chatService = services.find(
        (service) => service.uuid.toLowerCase() === SERVICE_UUID.toLowerCase(),
      );

      if (!chatService) {
        console.log('Chat service not found');

        await disconnect(deviceId);

        clearConnection();

        return;
      }

      console.log('6. Chat service found');

      /*
       * Find RX.
       */
      const rxCharacteristic = chatService.characteristics.find(
        (characteristic) =>
          characteristic.uuid.toLowerCase() ===
          RX_CHARACTERISTIC_UUID.toLowerCase(),
      );

      /*
       * Find TX.
       */
      const txCharacteristic = chatService.characteristics.find(
        (characteristic) =>
          characteristic.uuid.toLowerCase() ===
          TX_CHARACTERISTIC_UUID.toLowerCase(),
      );

      if (!rxCharacteristic) {
        console.log('RX characteristic not found');

        await disconnect(deviceId);

        clearConnection();

        return;
      }

      if (!txCharacteristic) {
        console.log('TX characteristic not found');

        await disconnect(deviceId);

        clearConnection();

        return;
      }

      console.log('7. RX characteristic found:', rxCharacteristic);

      console.log('8. TX characteristic found:', txCharacteristic);

      /*
       * Listen ONLY to TX notifications.
       */
      if (removeCentralValueListenerRef.current) {
        removeCentralValueListenerRef.current();

        removeCentralValueListenerRef.current = undefined;
      }

      console.log('9. Registering TX listener...');

      removeCentralValueListenerRef.current = addEventListener(
        'characteristicValueChanged',
        (event) => {
          console.log('========== TX NOTIFICATION ==========');

          console.log('Device:', event.deviceId);

          console.log('Service:', event.serviceUUID);

          console.log('Characteristic:', event.characteristicUUID);

          console.log('Hex:', event.value);

          if (event.deviceId !== deviceId) {
            return;
          }

          if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) {
            return;
          }

          /*
           * ONLY TX notifications are
           * incoming messages.
           *
           * A write to RX cannot become
           * an incoming message anymore.
           */
          if (
            event.characteristicUUID.toLowerCase() !==
            TX_CHARACTERISTIC_UUID.toLowerCase()
          ) {
            console.log('Ignoring notification: not TX');

            return;
          }

          const receivedText = hexToText(event.value);

          console.log('Incoming TX message:', receivedText);

          addMessage(receivedText, 'other');
        },
      );

      console.log('10. TX listener registered');

      /*
       * Subscribe ONLY to TX.
       */
      console.log('11. Subscribing to TX...');

      await subscribeToCharacteristic(
        deviceId,
        SERVICE_UUID,
        TX_CHARACTERISTIC_UUID,
      );

      console.log('12. TX subscription complete');

      console.log('========== CONNECT COMPLETE ==========');
    } catch (error) {
      console.log('========== CONNECT ERROR ==========');

      console.log('Error:', error);

      console.log(
        'Error message:',
        error instanceof Error ? error.message : String(error),
      );

      clearConnection();
    } finally {
      setIsConnecting(false);
    }
  };

  const sendMessage = async () => {
    const trimmedMessage = message.trim();

    if (!trimmedMessage) {
      return;
    }

    const hexMessage = textToHex(trimmedMessage);

    try {
      /*
       * CENTRAL
       *
       * Central sends through RX.
       */
      if (connectedDeviceId) {
        console.log('========== CENTRAL SEND ==========');

        console.log('Message:', trimmedMessage);

        console.log('Writing to RX...');

        await writeCharacteristic(
          connectedDeviceId,
          SERVICE_UUID,
          RX_CHARACTERISTIC_UUID,
          hexMessage,
          'write',
        );

        console.log('RX write successful');

        /*
         * Add it locally exactly ONCE.
         *
         * It cannot come back through
         * TX because we are using separate
         * characteristics.
         */
        addMessage(trimmedMessage, 'me');

        setMessage('');

        console.log('========== CENTRAL SEND COMPLETE ==========');

        return;
      }

      /*
       * PERIPHERAL
       *
       * Peripheral sends through TX.
       */
      if (peripheralCentralId) {
        console.log('========== PERIPHERAL SEND ==========');

        console.log('Message:', trimmedMessage);

        console.log('Updating TX characteristic...');

        updateCharacteristicValue(
          SERVICE_UUID,
          TX_CHARACTERISTIC_UUID,
          hexMessage,
          true,
        );

        console.log('TX notification sent');

        /*
         * Add locally exactly ONCE.
         */
        addMessage(trimmedMessage, 'me');

        setMessage('');

        console.log('========== PERIPHERAL SEND COMPLETE ==========');

        return;
      }

      console.log('No connection');
    } catch (error) {
      console.log('Send failed:', error);
    }
  };

  const checkBluetooth = async () => {
    try {
      console.log('========== BLUETOOTH START ==========');

      const granted = await requestBluetoothPermission();

      console.log('Bluetooth permission:', granted);

      if (!granted) {
        console.log('Bluetooth permission denied');

        return;
      }

      const enabled = await isBluetoothEnabled();

      console.log('Bluetooth enabled:', enabled);

      if (!enabled) {
        console.log('Bluetooth is disabled');

        return;
      }

      /*
       * IMPORTANT:
       *
       * We now create TWO characteristics.
       */
      await setServices([
        {
          uuid: SERVICE_UUID,

          characteristics: [
            {
              /*
               * RX:
               *
               * Central writes here.
               */
              uuid: RX_CHARACTERISTIC_UUID,

              properties: ['write', 'writeWithoutResponse'],
            },

            {
              /*
               * TX:
               *
               * Peripheral notifies here.
               */
              uuid: TX_CHARACTERISTIC_UUID,

              properties: ['notify'],
            },
          ],
        },
      ]);

      console.log('Chat service created');

      setupPeripheralListeners();

      startAdvertising({
        serviceUUIDs: [SERVICE_UUID],

        localName: 'Bluetooth Chat',
      });

      console.log('Now advertising');

      setBluetoothReady(true);

      console.log('========== BLUETOOTH READY ==========');
    } catch (error) {
      console.log('Bluetooth setup failed:', error);
    }
  };

  const disconnectFromDevice = async () => {
    if (connectedDeviceId) {
      try {
        console.log('Disconnecting central...');

        await disconnect(connectedDeviceId);

        console.log('Central disconnected');
      } catch (error) {
        console.log('Disconnect error:', error);
      }

      clearConnection();

      return;
    }

    if (peripheralCentralId) {
      console.log('Closing peripheral chat...');

      setPeripheralCentralId(null);

      setMessages([]);
      setMessage('');
    }
  };

  const isChatConnected =
    connectedDeviceId !== null || peripheralCentralId !== null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Bluetooth Chat</Text>

        <View
          style={[
            styles.status,
            bluetoothReady ? styles.statusReady : styles.statusNotReady,
          ]}
        >
          <Text style={styles.statusText}>
            {bluetoothReady ? 'Bluetooth Ready' : 'Bluetooth Not Started'}
          </Text>
        </View>
      </View>

      {!isChatConnected ? (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
        >
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Bluetooth</Text>

            <Text style={styles.description}>
              Start Bluetooth to advertise this device, then scan for another
              Bluetooth Chat device.
            </Text>

            <TouchableOpacity
              style={styles.primaryButton}
              onPress={checkBluetooth}
            >
              <Text style={styles.primaryButtonText}>Start Bluetooth</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>Nearby Devices</Text>

                <Text style={styles.deviceCount}>
                  {devices.length} device
                  {devices.length === 1 ? '' : 's'} found
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.scanButton,
                  isScanning && styles.scanButtonActive,
                ]}
                onPress={isScanning ? stopScanning : scanForDevices}
              >
                <Text style={styles.scanButtonText}>
                  {isScanning ? 'Stop' : 'Scan'}
                </Text>
              </TouchableOpacity>
            </View>

            {devices.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyStateTitle}>No devices found</Text>

                <Text style={styles.emptyStateText}>
                  Start a scan to find another Bluetooth Chat device.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {devices.map((device) => (
                  <View key={device.id} style={styles.deviceCard}>
                    <View style={styles.deviceInfo}>
                      <Text style={styles.deviceName} numberOfLines={1}>
                        {device.name || device.localName || 'Bluetooth Device'}
                      </Text>

                      <Text style={styles.deviceId}>{device.id}</Text>

                      {device.rssi !== undefined && (
                        <Text style={styles.deviceRssi}>
                          Signal: {device.rssi}
                        </Text>
                      )}
                    </View>

                    <TouchableOpacity
                      style={styles.connectButton}
                      disabled={isConnecting}
                      onPress={() => connectToDevice(device.id)}
                    >
                      {isConnecting ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Text style={styles.connectButtonText}>Connect</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.chatContainer}>
          <View style={styles.connectionBar}>
            <View style={styles.connectionInfo}>
              <View style={styles.connectedDot} />

              <View>
                <Text style={styles.connectedTitle}>Connected</Text>

                <Text style={styles.connectedRole}>
                  {connectedDeviceId ? 'Central' : 'Peripheral'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.disconnectButton}
              onPress={disconnectFromDevice}
            >
              <Text style={styles.disconnectText}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
          >
            {messages.length === 0 ? (
              <View style={styles.emptyChat}>
                <Text style={styles.emptyChatTitle}>
                  Start the conversation
                </Text>

                <Text style={styles.emptyChatText}>
                  Messages sent from either phone will appear here.
                </Text>
              </View>
            ) : (
              messages.map((chatMessage) => (
                <View
                  key={chatMessage.id}
                  style={[
                    styles.messageRow,
                    chatMessage.sender === 'me'
                      ? styles.messageRowMe
                      : styles.messageRowOther,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      chatMessage.sender === 'me'
                        ? styles.messageBubbleMe
                        : styles.messageBubbleOther,
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        chatMessage.sender === 'me'
                          ? styles.messageTextMe
                          : styles.messageTextOther,
                      ]}
                    >
                      {chatMessage.text}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View style={styles.inputContainer}>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Type a message..."
              placeholderTextColor="#888888"
              style={styles.input}
              multiline
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                !message.trim() && styles.sendButtonDisabled,
              ]}
              disabled={!message.trim()}
              onPress={sendMessage}
            >
              <Text style={styles.sendButtonText}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },

  header: {
    paddingHorizontal: 20,
    paddingTop: 55,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
  },

  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 10,
  },

  status: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },

  statusReady: {
    backgroundColor: '#E6F6EA',
  },

  statusNotReady: {
    backgroundColor: '#EEEEEE',
  },

  statusText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333333',
  },

  content: {
    flex: 1,
  },

  contentContainer: {
    padding: 20,
    paddingBottom: 40,
  },

  section: {
    marginBottom: 25,
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },

  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111111',
  },

  description: {
    fontSize: 15,
    lineHeight: 22,
    color: '#666666',
    marginTop: 8,
    marginBottom: 18,
  },

  deviceCount: {
    marginTop: 4,
    fontSize: 13,
    color: '#888888',
  },

  primaryButton: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },

  scanButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#111111',
  },

  scanButtonActive: {
    backgroundColor: '#555555',
  },

  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  emptyState: {
    padding: 30,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },

  emptyStateTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 6,
  },

  emptyStateText: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
    lineHeight: 20,
  },

  deviceList: {
    gap: 10,
  },

  deviceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },

  deviceInfo: {
    flex: 1,
    marginRight: 12,
  },

  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
    marginBottom: 4,
  },

  deviceId: {
    fontSize: 11,
    color: '#888888',
  },

  deviceRssi: {
    fontSize: 12,
    color: '#777777',
    marginTop: 4,
  },

  connectButton: {
    minWidth: 82,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 9,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },

  connectButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  chatContainer: {
    flex: 1,
  },

  connectionBar: {
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E5E5',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  connectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#31A24C',
    marginRight: 9,
  },

  connectedTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },

  connectedRole: {
    fontSize: 11,
    color: '#888888',
    marginTop: 2,
  },

  disconnectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#EEEEEE',
  },

  disconnectText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333333',
  },

  messagesContainer: {
    flex: 1,
  },

  messagesContent: {
    padding: 18,
    paddingBottom: 25,
  },

  emptyChat: {
    alignItems: 'center',
    paddingTop: 100,
  },

  emptyChatTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 6,
  },

  emptyChatText: {
    fontSize: 14,
    color: '#888888',
    textAlign: 'center',
  },

  messageRow: {
    width: '100%',
    marginBottom: 10,
  },

  messageRowMe: {
    alignItems: 'flex-end',
  },

  messageRowOther: {
    alignItems: 'flex-start',
  },

  messageBubble: {
    maxWidth: '78%',
    paddingHorizontal: 15,
    paddingVertical: 11,
    borderRadius: 17,
  },

  messageBubbleMe: {
    backgroundColor: '#111111',
    borderBottomRightRadius: 5,
  },

  messageBubbleOther: {
    backgroundColor: '#FFFFFF',
    borderBottomLeftRadius: 5,
    borderWidth: 1,
    borderColor: '#E5E5E5',
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },

  messageTextMe: {
    color: '#FFFFFF',
  },

  messageTextOther: {
    color: '#222222',
  },

  inputContainer: {
    padding: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E5E5',
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },

  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: '#F2F2F2',
    color: '#111111',
    fontSize: 15,
  },

  sendButton: {
    height: 46,
    paddingHorizontal: 18,
    borderRadius: 13,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },

  sendButtonDisabled: {
    backgroundColor: '#CCCCCC',
  },

  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
