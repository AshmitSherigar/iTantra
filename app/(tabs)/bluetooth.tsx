import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

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

import { useTheme } from '../../context/ThemeContext';
import { FontSize, Radius, Spacing } from '../../constants/theme';

const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';
const RX_CHARACTERISTIC_UUID = '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';
const TX_CHARACTERISTIC_UUID = '8b3e8c1f-5d42-4f77-a91d-6c3e2b8a5f19';

type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'other';
};

export default function BluetoothScreen() {
  const { colors } = useTheme();

  const [devices, setDevices] = useState<any[]>([]);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [peripheralCentralId, setPeripheralCentralId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [bluetoothReady, setBluetoothReady] = useState(false);

  const removeDeviceListenerRef = useRef<(() => void) | undefined>(undefined);
  const removeCentralValueListenerRef = useRef<(() => void) | undefined>(undefined);
  const removePeripheralWriteListenerRef = useRef<(() => void) | undefined>(undefined);
  const removePeripheralSubscribedListenerRef = useRef<(() => void) | undefined>(undefined);
  const removePeripheralUnsubscribedListenerRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    return () => {
      removeDeviceListenerRef.current?.();
      removeCentralValueListenerRef.current?.();
      removePeripheralWriteListenerRef.current?.();
      removePeripheralSubscribedListenerRef.current?.();
      removePeripheralUnsubscribedListenerRef.current?.();
    };
  }, []);

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
    if (isScanning) return;
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
        const exists = currentDevices.some((d) => d.id === device.id);
        if (exists) return currentDevices;
        return [...currentDevices, device];
      });
    });

    console.log('Starting scan...');
    await startScan({ allowDuplicates: false, scanMode: 'balanced' });
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

  const textToHex = (text: string) =>
    Array.from(text)
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('');

  const addMessage = (text: string, sender: 'me' | 'other') => {
    setMessages((current) => [
      ...current,
      { id: Date.now().toString() + Math.random().toString(), text, sender },
    ]);
  };

  const clearConnection = () => {
    setConnectedDeviceId(null);
    setPeripheralCentralId(null);
    setMessages([]);
    setMessage('');
  };

  const setupPeripheralListeners = () => {
    if (removePeripheralWriteListenerRef.current) return;

    console.log('Setting up peripheral listeners');

    removePeripheralWriteListenerRef.current = addEventListener(
      'peripheralWriteRequest',
      (event) => {
        console.log('PERIPHERAL WRITE — Central:', event.centralId);
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
        if (event.characteristicUUID.toLowerCase() !== RX_CHARACTERISTIC_UUID.toLowerCase()) {
          console.log('Ignoring peripheral write: not RX');
          return;
        }
        addMessage(hexToText(event.value), 'other');
      },
    );

    removePeripheralSubscribedListenerRef.current = addEventListener(
      'peripheralSubscribed',
      (event) => {
        console.log('PERIPHERAL SUBSCRIBED — Central:', event.centralId);
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
        if (event.characteristicUUID.toLowerCase() !== TX_CHARACTERISTIC_UUID.toLowerCase()) return;
        setPeripheralCentralId(event.centralId);
        setMessages([]);
        console.log('Peripheral chat is ready');
      },
    );

    removePeripheralUnsubscribedListenerRef.current = addEventListener(
      'peripheralUnsubscribed',
      (event) => {
        console.log('PERIPHERAL UNSUBSCRIBED');
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
        if (event.characteristicUUID.toLowerCase() !== TX_CHARACTERISTIC_UUID.toLowerCase()) return;
        setPeripheralCentralId(null);
        setMessages([]);
      },
    );

    console.log('Peripheral listeners ready');
  };

  const connectToDevice = async (deviceId: string) => {
    if (isConnecting || connectedDeviceId || peripheralCentralId) return;
    setIsConnecting(true);

    try {
      console.log('CONNECT START — Device:', deviceId);
      await stopScanning();
      setDevices([]);

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
          if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
          if (event.characteristicUUID.toLowerCase() !== TX_CHARACTERISTIC_UUID.toLowerCase()) return;
          addMessage(hexToText(event.value), 'other');
        },
      );

      await subscribeToCharacteristic(deviceId, SERVICE_UUID, TX_CHARACTERISTIC_UUID);
      console.log('CONNECT COMPLETE');
    } catch (error) {
      console.log('CONNECT ERROR:', error);
      clearConnection();
    } finally {
      setIsConnecting(false);
    }
  };

  const sendMessage = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;
    const hexMessage = textToHex(trimmedMessage);

    try {
      if (connectedDeviceId) {
        await writeCharacteristic(
          connectedDeviceId,
          SERVICE_UUID,
          RX_CHARACTERISTIC_UUID,
          hexMessage,
          'write',
        );
        addMessage(trimmedMessage, 'me');
        setMessage('');
        return;
      }

      if (peripheralCentralId) {
        updateCharacteristicValue(SERVICE_UUID, TX_CHARACTERISTIC_UUID, hexMessage, true);
        addMessage(trimmedMessage, 'me');
        setMessage('');
        return;
      }

      console.log('No connection');
    } catch (error) {
      console.log('Send failed:', error);
    }
  };

  const checkBluetooth = async () => {
    try {
      console.log('BLUETOOTH START');
      const granted = await requestBluetoothPermission();
      if (!granted) { console.log('Permission denied'); return; }

      const enabled = await isBluetoothEnabled();
      if (!enabled) { console.log('Bluetooth disabled'); return; }

      await setServices([
        {
          uuid: SERVICE_UUID,
          characteristics: [
            { uuid: RX_CHARACTERISTIC_UUID, properties: ['write', 'writeWithoutResponse'] },
            { uuid: TX_CHARACTERISTIC_UUID, properties: ['notify'] },
          ],
        },
      ]);

      setupPeripheralListeners();
      startAdvertising({ serviceUUIDs: [SERVICE_UUID], localName: 'Bluetooth Chat' });

      setBluetoothReady(true);
      console.log('BLUETOOTH READY');
    } catch (error) {
      console.log('Bluetooth setup failed:', error);
    }
  };

  const disconnectFromDevice = async () => {
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
      setMessage('');
    }
  };

  const isChatConnected = connectedDeviceId !== null || peripheralCentralId !== null;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>BLUETOOTH</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Chat</Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            { backgroundColor: bluetoothReady ? '#DCFCE7' : colors.inputBackground },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: bluetoothReady ? colors.success : colors.textSecondary },
            ]}
          />
          <Text style={[styles.statusText, { color: bluetoothReady ? colors.success : colors.textSecondary }]}>
            {bluetoothReady ? 'Ready' : 'Not started'}
          </Text>
        </View>
      </View>

      {!isChatConnected ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Setup</Text>
            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
              Start Bluetooth to advertise this device, then scan for another Bluetooth Chat device nearby.
            </Text>
            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: colors.primary }]}
              onPress={checkBluetooth}
              activeOpacity={0.82}
            >
              <Ionicons name="bluetooth" size={18} color="#FFFFFF" style={styles.buttonIcon} />
              <Text style={styles.primaryButtonText}>Start Bluetooth</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Nearby Devices</Text>
                <Text style={[styles.deviceCount, { color: colors.textSecondary }]}>
                  {devices.length} device{devices.length === 1 ? '' : 's'} found
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.scanButton,
                  {
                    backgroundColor: isScanning ? colors.error : colors.primary,
                  },
                ]}
                onPress={isScanning ? stopScanning : scanForDevices}
                activeOpacity={0.82}
              >
                <Text style={styles.scanButtonText}>{isScanning ? 'Stop' : 'Scan'}</Text>
              </TouchableOpacity>
            </View>

            {devices.length === 0 ? (
              <View
                style={[
                  styles.emptyState,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Ionicons name="search-outline" size={32} color={colors.textSecondary} style={{ marginBottom: Spacing.sm }} />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>No devices found</Text>
                <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                  Start a scan to find another Bluetooth Chat device.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {devices.map((device) => (
                  <View
                    key={device.id}
                    style={[
                      styles.deviceCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.deviceInfo}>
                      <Text style={[styles.deviceName, { color: colors.text }]} numberOfLines={1}>
                        {device.name || device.localName || 'Bluetooth Device'}
                      </Text>
                      <Text style={[styles.deviceId, { color: colors.textSecondary }]}>
                        {device.id}
                      </Text>
                      {device.rssi !== undefined && (
                        <Text style={[styles.deviceRssi, { color: colors.textSecondary }]}>
                          Signal: {device.rssi} dBm
                        </Text>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[styles.connectButton, { backgroundColor: colors.primary }]}
                      disabled={isConnecting}
                      onPress={() => connectToDevice(device.id)}
                      activeOpacity={0.82}
                    >
                      {isConnecting ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
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
        <View style={styles.flex}>
          <View
            style={[
              styles.connectionBar,
              { backgroundColor: colors.surface, borderBottomColor: colors.border },
            ]}
          >
            <View style={styles.connectionInfo}>
              <View style={[styles.connectedDot, { backgroundColor: colors.success }]} />
              <View>
                <Text style={[styles.connectedTitle, { color: colors.text }]}>Connected</Text>
                <Text style={[styles.connectedRole, { color: colors.textSecondary }]}>
                  {connectedDeviceId ? 'Central (scanner)' : 'Peripheral (advertiser)'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.disconnectButton, { backgroundColor: colors.inputBackground }]}
              onPress={disconnectFromDevice}
              activeOpacity={0.8}
            >
              <Text style={[styles.disconnectText, { color: colors.text }]}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={styles.emptyChat}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={48}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyChatTitle, { color: colors.text }]}>
                  Start the conversation
                </Text>
                <Text style={[styles.emptyChatText, { color: colors.textSecondary }]}>
                  Messages from either device will appear here.
                </Text>
              </View>
            ) : (
              messages.map((chatMessage) => (
                <View
                  key={chatMessage.id}
                  style={[
                    styles.messageRow,
                    chatMessage.sender === 'me' ? styles.messageRowMe : styles.messageRowOther,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      chatMessage.sender === 'me'
                        ? [styles.messageBubbleMe, { backgroundColor: colors.primary }]
                        : [
                          styles.messageBubbleOther,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        chatMessage.sender === 'me'
                          ? styles.messageTextMe
                          : [styles.messageTextOther, { color: colors.text }],
                      ]}
                    >
                      {chatMessage.text}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}
          >
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Type a message..."
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { backgroundColor: colors.inputBackground, color: colors.text },
              ]}
              multiline
            />

            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor: message.trim() ? colors.primary : colors.inputBackground,
                },
              ]}
              disabled={!message.trim()}
              onPress={sendMessage}
              activeOpacity={0.82}
            >
              <Ionicons
                name="send"
                size={18}
                color={message.trim() ? '#FFFFFF' : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  flex: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },

  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  headerTitle: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.round,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },

  scrollContent: {
    padding: Spacing.md,
  },

  section: {
    marginBottom: Spacing.lg,
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },

  sectionTitle: {
    fontSize: FontSize.medium,
    fontWeight: '700',
  },

  sectionDescription: {
    fontSize: FontSize.small + 2,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: Spacing.md,
  },

  deviceCount: {
    marginTop: 3,
    fontSize: FontSize.small,
  },

  primaryButton: {
    height: 52,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonIcon: {
    marginRight: 8,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.body,
    fontWeight: '700',
  },

  scanButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },

  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  emptyState: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 1,
  },

  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },

  emptyStateText: {
    fontSize: FontSize.small,
    textAlign: 'center',
    lineHeight: 18,
  },

  deviceList: {
    gap: 10,
  },

  deviceCard: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },

  deviceInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },

  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },

  deviceId: {
    fontSize: 11,
  },

  deviceRssi: {
    fontSize: 12,
    marginTop: 3,
  },

  connectButton: {
    minWidth: 82,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  connectButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  connectionBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  connectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },

  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  connectedTitle: {
    fontSize: 15,
    fontWeight: '700',
  },

  connectedRole: {
    fontSize: 11,
    marginTop: 2,
  },

  disconnectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  disconnectText: {
    fontSize: 13,
    fontWeight: '600',
  },

  messagesContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    flexGrow: 1,
  },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },

  emptyChatTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },

  emptyChatText: {
    fontSize: FontSize.small,
    textAlign: 'center',
    lineHeight: 20,
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 17,
  },

  messageBubbleMe: {
    borderBottomRightRadius: 5,
  },

  messageBubbleOther: {
    borderBottomLeftRadius: 5,
    borderWidth: 1,
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },

  messageTextMe: {
    color: '#FFFFFF',
  },

  messageTextOther: {},

  inputContainer: {
    padding: Spacing.sm + 4,
    borderTopWidth: 1,
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
    borderRadius: Radius.md,
    fontSize: 15,
  },

  sendButton: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
