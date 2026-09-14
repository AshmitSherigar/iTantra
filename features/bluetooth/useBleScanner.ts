import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDeviceFoundListener,
  startScan,
  stopScan,
} from 'react-native-bluetooth-ble';
import { SERVICE_UUID } from '@/features/bluetooth/constants';
import { ensureBleScanPermissions } from '@/features/bluetooth/permissions';
import {
  getDeviceDisplayName,
  mergeScannedDevice,
  type ScannedDevice,
} from '@/features/bluetooth/devices';
import { logger } from '@/utils/logger';

type UseBleScannerOpts = {
  isChatConnected: boolean;
};

export function useBleScanner({ isChatConnected }: UseBleScannerOpts) {
  const [devices, setDevices] = useState<ScannedDevice[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const removeDeviceListenerRef = useRef<(() => void) | undefined>(undefined);
  const scanStartingRef = useRef(false);
  const scanAttemptRef = useRef(0);

  const stopScanning = useCallback(async () => {
    scanAttemptRef.current += 1;
    try {
      await stopScan();
    } catch (error) {
      logger.warn('Bluetooth', 'Stop scan failed', error);
    }

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    setIsScanning(false);
    logger.info('Bluetooth', 'Scan stopped');
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
    if (isScanning || scanStartingRef.current) return;
    if (isChatConnected) {
      logger.debug('Bluetooth', 'Scan skipped because chat is connected');
      return;
    }
    scanStartingRef.current = true;
    const attempt = ++scanAttemptRef.current;

    try {
      setScanError(null);

      const allowed = await ensureBleScanPermissions();
      if (!allowed) {
        setScanError(
          'Location permission is required for Bluetooth scanning. Grant it, turn Location services ON, then scan again.',
        );
        return;
      }
      if (attempt !== scanAttemptRef.current) return;

      setDevices([]);

      if (removeDeviceListenerRef.current) {
        removeDeviceListenerRef.current();
        removeDeviceListenerRef.current = undefined;
      }

      removeDeviceListenerRef.current = addDeviceFoundListener((device) => {
        logger.debug('Bluetooth', 'Device found', {
          id: device.id,
          name: getDeviceDisplayName(device as unknown as ScannedDevice),
        });
        const found = device as unknown as ScannedDevice;
        setDevices((currentDevices) => {
          const byId = currentDevices.findIndex((d) => d.id === found.id);
          if (byId !== -1) {
            // allowDuplicates delivers the same id again, often with the local
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
              logger.info('Bluetooth', 'Device address rotated', {
                name: incomingName,
              });
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

      logger.info('Bluetooth', 'Starting scan');
      // Filter by our chat service so random nameless BLE peripherals
      try {
        await startScan({
          serviceUUIDs: [SERVICE_UUID],
          allowDuplicates: true,
          scanMode: 'lowLatency',
        });
      } catch (e) {
        // Fall back to an unfiltered scan if the device rejects the filter
        // (some Android stacks do) — names still resolve via merge logic.
        logger.warn(
          'Bluetooth',
          'Filtered scan failed; retrying unfiltered',
          e,
        );
        await startScan({ allowDuplicates: true, scanMode: 'lowLatency' });
      }
      if (attempt !== scanAttemptRef.current) {
        await stopScan();
        return;
      }
      setIsScanning(true);
      logger.info('Bluetooth', 'Scan started');
    } catch (error) {
      removeDeviceListenerRef.current?.();
      removeDeviceListenerRef.current = undefined;
      setIsScanning(false);
      setScanError('Bluetooth scan failed. Try again.');
      logger.error('Bluetooth', 'Scan failed', error);
    } finally {
      scanStartingRef.current = false;
    }
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
