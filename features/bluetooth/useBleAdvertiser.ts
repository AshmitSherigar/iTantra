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
} from '@/features/bluetooth/constants';
import { ensureBleAdvertisePermissions } from '@/features/bluetooth/permissions';
import { logger } from '@/utils/logger';

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

/**
 * Peripheral role: GATT setup + advertising as a named chat peer.
 * Owns displayName / bluetoothReady / error state and the start/stop flow,
 * including the fixed Android permission request (BT + Location).
 */
export function useBleAdvertiser() {
  const [bluetoothReady, setBluetoothReady] = useState(false);
  // User-visible BLE name. Prefilled from the OS device name so peers see a
  // real name ("Rahul's Pixel") instead of the same "Bluetooth Chat" for all.
  const [displayName, setDisplayName] = useState('');
  const [advertisedName, setAdvertisedName] = useState<string | null>(null);
  const [btError, setBtError] = useState<string | null>(null);
  const [isStartingBt, setIsStartingBt] = useState(false);
  const advertisedNameRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  // Prefill an editable real device name (OS name -> model -> fallback).
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
      logger.warn('Bluetooth', 'Stop advertising failed', error);
    }
    advertisedNameRef.current = null;
    setAdvertisedName(null);
    setBluetoothReady(false);
    logger.info('Bluetooth', 'Advertising stopped');
  }, []);

  const startBluetooth = useCallback(async () => {
    // Guard double-taps: restarting advertising generates a NEW random
    // private BLE address, which is why the peer saw you "multiple times
    // with changed bluetooth address".
    if (startingRef.current || isStartingBt) return;
    const nameToAdvertise = getNameToAdvertise(undefined, displayName);
    if (bluetoothReady && advertisedNameRef.current === nameToAdvertise) {
      logger.debug('Bluetooth', 'Already advertising', {
        name: nameToAdvertise,
      });
      return;
    }
    // Name changed -> restart with the new name instead of stacking a second
    // advertiser.
    if (bluetoothReady) {
      logger.info('Bluetooth', 'Name changed; restarting advertising', {
        name: nameToAdvertise,
      });
      stopBluetooth();
    }

    startingRef.current = true;
    setIsStartingBt(true);
    setBtError(null);
    try {
      logger.info('Bluetooth', 'Starting advertising');
      // FIX: requests BT + Location (new Android needs both for scan AND
      // advertise); shows a Settings deep-link when permanently denied.
      const granted = await ensureBleAdvertisePermissions();
      if (!granted) {
        const msg =
          'Bluetooth permission denied. Allow Bluetooth + Location (and turn Location services ON) to advertise and scan.';
        setBtError(msg);
        logger.warn('Bluetooth', 'Advertising permission denied');
        return;
      }

      const enabled = await isBluetoothEnabled();
      if (!enabled) {
        // The library cannot turn on system Bluetooth itself (Android/iOS
        // require user consent) — guide the user to Settings instead.
        const msg =
          'Bluetooth is turned off. Turn it on in system settings, then tap Start again.';
        setBtError(msg);
        logger.warn('Bluetooth', 'Bluetooth is disabled');
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

      // Advertise the user's real name (not a fixed "Bluetooth Chat" for every
      // phone) twice — localName + advertisingData — for max cross-platform
      // visibility: Android puts it in the scan response, iOS only exposes
      // local name + service UUIDs.
      startAdvertising({
        serviceUUIDs: [SERVICE_UUID],
        localName: nameToAdvertise,
        advertisingData: { completeLocalName: nameToAdvertise } as never,
      });

      advertisedNameRef.current = nameToAdvertise;
      setAdvertisedName(nameToAdvertise);
      setBluetoothReady(true);
      logger.info('Bluetooth', 'Advertising ready', { name: nameToAdvertise });
    } catch (error) {
      const msg =
        'Bluetooth setup failed. Make sure Bluetooth is on and try again.';
      setBtError(msg);
      logger.error('Bluetooth', 'Advertising setup failed', error);
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
