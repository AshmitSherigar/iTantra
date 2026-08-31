import { useRef, useState } from 'react';
import { Button, Text, TextInput, View } from 'react-native';

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
} from 'react-native-bluetooth-ble';

// Service UUID for our chat app
const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';

// Characteristic UUID used for messages
const CHARACTERISTIC_UUID =
  '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';

export default function HomeScreen() {
  const [devices, setDevices] = useState<any[]>([]);
  const [connectedDeviceId, setConnectedDeviceId] =
    useState<string | null>(null);

  const [message, setMessage] = useState('');
  const [receivedMessages, setReceivedMessages] = useState<string[]>([]);

  const removeDeviceListenerRef = useRef<
    (() => void) | undefined
  >(undefined);

  const removeCharacteristicListenerRef = useRef<
    (() => void) | undefined
  >(undefined);

  const stopScanning = async () => {
    await stopScan();

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    console.log('Scan stopped and listener removed!');
  };

  const scanForDevices = async () => {
    console.log('Starting scan...');

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    removeDeviceListenerRef.current = addDeviceFoundListener(
      (device) => {
        console.log('Chat device found:', device);

        setDevices((currentDevices) => {
          const alreadyExists = currentDevices.some(
            (currentDevice) => currentDevice.id === device.id,
          );

          if (alreadyExists) {
            return currentDevices;
          }

          return [...currentDevices, device];
        });
      },
    );

    await startScan({
      allowDuplicates: false,
      scanMode: 'balanced',
    });

    console.log('Scan started!');
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
      .map((character) =>
        character.charCodeAt(0).toString(16).padStart(2, '0'),
      )
      .join('');
  };

  const connectToDevice = async (deviceId: string) => {
  console.log('========== CONNECT START ==========');
  console.log('Device ID:', deviceId);

  try {
    console.log('1. Calling connect()...');

    await connect(deviceId);

    console.log('2. connect() completed successfully');
    console.log('3. Device is connected');

    setConnectedDeviceId(deviceId);

    console.log('4. Calling discoverServices()...');

    const services = await discoverServices(deviceId);

    console.log('5. discoverServices() completed');
    console.log('6. Services received:', services);

    console.log('7. Looking for Chat Service...');

    const chatService = services.find(
      (service) =>
        service.uuid.toLowerCase() ===
        SERVICE_UUID.toLowerCase(),
    );

    if (!chatService) {
      console.log('8. Chat Service NOT FOUND');
      console.log('Available service UUIDs:');

      services.forEach((service) => {
        console.log('Service:', service.uuid);
      });

      return;
    }

    console.log('8. Chat Service FOUND');
    console.log('Chat Service:', chatService);

    console.log('9. Looking for Message Characteristic...');

    const messageCharacteristic =
      chatService.characteristics.find(
        (characteristic) =>
          characteristic.uuid.toLowerCase() ===
          CHARACTERISTIC_UUID.toLowerCase(),
      );

    if (!messageCharacteristic) {
      console.log(
        '10. Message Characteristic NOT FOUND',
      );

      console.log('Available characteristics:');

      chatService.characteristics.forEach(
        (characteristic) => {
          console.log(
            'Characteristic:',
            characteristic.uuid,
          );
        },
      );

      return;
    }

    console.log(
      '10. Message Characteristic FOUND',
    );

    console.log(
      'Message Characteristic:',
      messageCharacteristic,
    );

    console.log(
      '11. Registering characteristic listener...',
    );

    if (removeCharacteristicListenerRef.current) {
      removeCharacteristicListenerRef.current();
      removeCharacteristicListenerRef.current =
        undefined;
    }

    removeCharacteristicListenerRef.current =
      addEventListener(
        'characteristicValueChanged',
        (event) => {
          console.log(
            '========== CHARACTERISTIC EVENT =========='
          );

          console.log('Event:', event);

          if (
            event.deviceId !== deviceId
          ) {
            console.log(
              'Ignoring event: wrong device',
            );
            return;
          }

          if (
            event.serviceUUID.toLowerCase() !==
            SERVICE_UUID.toLowerCase()
          ) {
            console.log(
              'Ignoring event: wrong service',
            );
            return;
          }

          if (
            event.characteristicUUID.toLowerCase() !==
            CHARACTERISTIC_UUID.toLowerCase()
          ) {
            console.log(
              'Ignoring event: wrong characteristic',
            );
            return;
          }

          const receivedText =
            hexToText(event.value);

          console.log(
            'Received message:',
            receivedText,
          );

          setReceivedMessages(
            (currentMessages) => [
              ...currentMessages,
              receivedText,
            ],
          );
        },
      );

    console.log(
      '12. Characteristic listener registered',
    );

    console.log(
      '13. Calling subscribeToCharacteristic()...',
    );

    await subscribeToCharacteristic(
      deviceId,
      SERVICE_UUID,
      CHARACTERISTIC_UUID,
    );

    console.log(
      '14. subscribeToCharacteristic() completed',
    );

    console.log(
      '========== CONNECT COMPLETE =========='
    );
  } catch (error) {
    console.log(
      '========== CONNECT ERROR =========='
    );

    console.log('Error:', error);

    console.log(
      'Error message:',
      error instanceof Error
        ? error.message
        : String(error),
    );

    console.log(
      'Error stack:',
      error instanceof Error
        ? error.stack
        : 'No stack available',
    );

    console.log(
      '========== CONNECT FAILED =========='
    );
  }
};

  const sendMessage = async () => {
    if (!connectedDeviceId) {
      console.log('No device connected');
      return;
    }

    if (!message.trim()) {
      console.log('Message is empty');
      return;
    }

    try {
      const hexMessage = textToHex(message);

      console.log('Sending:', message);
      console.log('Hex:', hexMessage);

      await writeCharacteristic(
        connectedDeviceId,
        SERVICE_UUID,
        CHARACTERISTIC_UUID,
        hexMessage,
        'write',
      );

      console.log('Message sent!');

      setMessage('');
    } catch (error) {
      console.log('Failed to send message:', error);
    }
  };

  const checkBluetooth = async () => {
    const granted = await requestBluetoothPermission();

    console.log('Bluetooth permission:', granted);

    if (!granted) {
      console.log('Bluetooth permission denied');
      return;
    }

    const enabled = await isBluetoothEnabled();

    console.log('Bluetooth enabled:', enabled);

    if (!enabled) {
      console.log('Please turn Bluetooth on');
      return;
    }

    console.log('Bluetooth is ready!');

    await setServices([
      {
        uuid: SERVICE_UUID,
        characteristics: [
          {
            uuid: CHARACTERISTIC_UUID,
            properties: [
              'read',
              'write',
              'writeWithoutResponse',
              'notify',
            ],
          },
        ],
      },
    ]);

    console.log('Chat service created!');

    startAdvertising({
      serviceUUIDs: [SERVICE_UUID],
      localName: 'Bluetooth Chat',
    });

    console.log('Now advertising!');
  };

  const disconnectFromDevice = async () => {
    if (!connectedDeviceId) {
      return;
    }

    try {
      await disconnect(connectedDeviceId);

      console.log('Disconnected!');

      if (removeCharacteristicListenerRef.current) {
        removeCharacteristicListenerRef.current();
        removeCharacteristicListenerRef.current = undefined;
      }

      setConnectedDeviceId(null);
    } catch (error) {
      console.log('Disconnect failed:', error);
    }
  };

  return (
    <View>
      <Text>Bluetooth Chat</Text>

      <Button
        title="Start Bluetooth"
        onPress={checkBluetooth}
      />

      <Button
        title="Scan for Devices"
        onPress={scanForDevices}
      />

      <Button
        title="Stop Scan"
        onPress={stopScanning}
      />

      {devices.map((device) => (
        <Button
          key={device.id}
          title={`Connect to ${device.name || device.id}`}
          onPress={() => connectToDevice(device.id)}
        />
      ))}

      {connectedDeviceId && (
        <View>
          <Text>
            Connected to: {connectedDeviceId}
          </Text>

          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Type a message"
          />

          <Button
            title="Send"
            onPress={sendMessage}
          />

          <Button
            title="Disconnect"
            onPress={disconnectFromDevice}
          />

          <Text>Received Messages:</Text>

          {receivedMessages.map((receivedMessage, index) => (
            <Text key={index}>
              {receivedMessage}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}