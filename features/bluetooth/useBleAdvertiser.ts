import { useCallback, useEffect, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { Alert, Linking, Platform } from 'react-native';
import {
  isBluetoothEnabled,
  setServices,
  startAdvertising,
  stopAdvertising,
} from 'react-native-bluetooth-ble';
import {
  MAX_ADVERTISED_NAME_LEN,
  RX_CHARACTERISTIC_UUID,
  SERVICE_UUID,
  TX_CHARACTERISTIC_UUID,
} from './constants';
import { ensureBleAdvertisePermissions } from './permissions';

export function getNameToAdvertise(
  raw: string | undefined,
  displayName: string,
): string {
  const base =
    (raw ?? displayName).trim() ||
    Device.deviceName?.trim() ||
    Device.modelName?.trim() ||
    'Phone';
  return base.slice(0, MAX_ADVERTISED_NAME_LEN);
}

export function useBleAdvertiser() {
  const [bluetoothReady, setBluetoothReady] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [advertisedName, setAdvertisedName] = useState<string | null>(null);
  const [btError, setBtError] = useState<string | null>(null);
  const [isStartingBt, setIsStartingBt] = useState(false);
  const advertisedNameRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  useEffect(() => {
    const fallback =
      Device.deviceName?.trim() ||
      Device.modelName?.trim() ||
      (Platform.OS === 'ios' ? 'iPhone' : 'Android Phone');
    setDisplayName((prev) => prev || fallback.slice(0, 20));
  }, []);

  const stopBluetooth = useCallback(() => {
    try {
      stopAdvertising();
    } catch (error) {
      console.log('Stop advertising error:', error);
    }
    advertisedNameRef.current = null;
    setAdvertisedName(null);
    setBluetoothReady(false);
    console.log('BLUETOOTH STOPPED');
  }, []);

  const startBluetooth = useCallback(async () => {
    if (startingRef.current || isStartingBt) return;
    const nameToAdvertise = getNameToAdvertise(undefined, displayName);
    if (bluetoothReady && advertisedNameRef.current === nameToAdvertise) {
      console.log('Already advertising as', nameToAdvertise);
      return;
    }
    if (bluetoothReady) {
      console.log('Name changed, restarting advertising as', nameToAdvertise);
      stopBluetooth();
    }

    startingRef.current = true;
    setIsStartingBt(true);
    setBtError(null);
    try {
      console.log('BLUETOOTH START');
      const granted = await ensureBleAdvertisePermissions();
      if (!granted) {
        const msg =
          'Bluetooth permission denied. Allow Bluetooth + Location (and turn Location services ON) to advertise and scan.';
        setBtError(msg);
        console.log('Permission denied');
        return;
      }

      const enabled = await isBluetoothEnabled();
      if (!enabled) {
        const msg =
          'Bluetooth is turned off. Turn it on in system settings, then tap Start again.';
        setBtError(msg);
        console.log('Bluetooth disabled');
        Alert.alert(
          'Bluetooth is off',
          'This app cannot switch system Bluetooth on by itself. Please turn Bluetooth on, then tap Start Bluetooth again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      await setServices([
        {
          uuid: SERVICE_UUID,
          characteristics: [
            {
              uuid: RX_CHARACTERISTIC_UUID,
              properties: ['write', 'writeWithoutResponse'],
            },
            { uuid: TX_CHARACTERISTIC_UUID, properties: ['notify'] },
          ],
        },
      ]);

      startAdvertising({
        serviceUUIDs: [SERVICE_UUID],
        localName: nameToAdvertise,
        advertisingData: { completeLocalName: nameToAdvertise } as never,
      });

      advertisedNameRef.current = nameToAdvertise;
      setAdvertisedName(nameToAdvertise);
      setBluetoothReady(true);
      console.log('BLUETOOTH READY as', nameToAdvertise);
    } catch (error) {
      const msg =
        'Bluetooth setup failed. Make sure Bluetooth is on and try again.';
      setBtError(msg);
      console.log('Bluetooth setup failed:', error);
    } finally {
      startingRef.current = false;
      setIsStartingBt(false);
    }
  }, [bluetoothReady, displayName, isStartingBt, stopBluetooth]);

  return {
    displayName,
    setDisplayName,
    advertisedName,
    bluetoothReady,
    btError,
    isStartingBt,
    startBluetooth,
    stopBluetooth,
  };
}
