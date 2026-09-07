import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDeviceFoundListener,
  startScan,
  stopScan,
} from 'react-native-bluetooth-ble';
import { ensureBleScanPermissions } from './permissions';
import {
  getDeviceDisplayName,
  mergeScannedDevice,
  type ScannedDevice,
} from './devices';

type UseBleScannerOpts = {
  isChatConnected: boolean;
};

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
          const updated = [...currentDevices];
          updated[byId] = mergeScannedDevice(currentDevices[byId], found);
          return updated;
        }
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
        if (currentDevices.length >= 50) return currentDevices;
        return [...currentDevices, found];
      });
    });

    console.log('Starting scan...');
    startScan({ allowDuplicates: true, scanMode: 'lowLatency' });
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
