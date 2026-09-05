import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDeviceFoundListener,
  startScan,
  stopScan,
} from 'react-native-bluetooth-ble';
import { SERVICE_UUID } from './constants';
import { ensureBleScanPermissions } from './permissions';
import {
  getDeviceDisplayName,
  mergeScannedDevice,
  type ScannedDevice,
} from './devices';

type UseBleScannerOpts = {
  isChatConnected: boolean;
};

/**
 * Central role — discovery only.
 * FIX: requests BT + Location before every scan (new Android returns zero
 * results without the location grant, even though the old code asked nothing).
 */
export function useBleScanner({ isChatConnected }: UseBleScannerOpts) {
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const removeDeviceListenerRef = useRef<(() => void) | undefined>(undefined);

  const stopScanning = useCallback(async () => {
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
  }, []);

  // Stop scanning when the screen unmounts.
  useEffect(() => {
    return () => {
      removeDeviceListenerRef.current?.();
      try {
        stopScan();
      } catch {}
    };
  }, []);

  const scanForDevices = useCallback(async () => {
    if (isScanning) return;
    if (isChatConnected) {
      console.log('Already connected');
      return;
    }
    setScanError(null);

    // NEW ANDROID FIX — without this the app never showed a location prompt
    // and `startScan` silently discovered nothing.
    const allowed = await ensureBleScanPermissions();
    if (!allowed) {
      setScanError(
        'Location permission is required for Bluetooth scanning. Grant it, turn Location services ON, then scan again.',
      );
      return;
    }

    setDevices([]);

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    removeDeviceListenerRef.current = addDeviceFoundListener((device) => {
      console.log('Device found:', JSON.stringify(device));
      const found = device as unknown as ScannedDevice;
      setDevices((currentDevices) => {
        const byId = currentDevices.findIndex((d) => d.id === found.id);
        if (byId !== -1) {
          // allowDuplicates delivers the same id again, often with the local
          // name filled in on the second callback — merge instead of dropping.
          const updated = [...currentDevices];
          updated[byId] = mergeScannedDevice(currentDevices[byId], found);
          return updated;
        }
        // BLE privacy: Android/iOS rotate the advertised MAC/UUID, so tapping
        // "Start Bluetooth" again on the peer shows up as a NEW id with the
        // SAME name. Collapse those instead of listing the phone N times.
        const incomingName = getDeviceDisplayName(found);
        if (incomingName !== 'Bluetooth Device') {
          const byName = currentDevices.findIndex(
            (d) => getDeviceDisplayName(d) === incomingName,
          );
          if (byName !== -1) {
            console.log(
              `Address rotated for "${incomingName}": ${currentDevices[byName].id} -> ${found.id}`,
            );
            const updated = [...currentDevices];
            updated[byName] = mergeScannedDevice(
              { ...currentDevices[byName], id: found.id },
              found,
            );
            updated[byName].id = found.id;
            return updated;
          }
        }
        // Cap growth in crowded areas.
        if (currentDevices.length >= 50) return currentDevices;
        return [...currentDevices, found];
      });
    });

    console.log('Starting scan...');
    // Filter by our chat service so random nameless BLE peripherals
    // (TVs, watches, beacons) don't fill the list. allowDuplicates must be
    // true: the first callback for a peer often has no name yet and the
    // scan-response carrying the local name arrives right after.
    try {
      await startScan({
        serviceUUIDs: [SERVICE_UUID],
        allowDuplicates: true,
        scanMode: 'lowLatency',
      });
    } catch (e) {
      // Fall back to an unfiltered scan if the device rejects the filter
      // (some Android stacks do) — names still resolve via merge logic.
      console.log('Filtered scan failed, retrying unfiltered:', e);
      await startScan({ allowDuplicates: true, scanMode: 'lowLatency' });
    }
    setIsScanning(true);
    console.log('Scan started');
  }, [isChatConnected, isScanning]);

  return {
    devices,
    setDevices,
    isScanning,
    scanError,
    scanForDevices,
    stopScanning,
  };
}
