import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDeviceFoundListener,
  startScan,
  stopScan,
} from 'react-native-bluetooth-ble';
import { ensureBleScanPermissions } from './permissions';
import { SERVICE_UUID } from './constants';
import { benchmarkLogger } from '../benchmark/BenchmarkLogger';
import {
  getDeviceDisplayName,
  isVaaniSetuDevice,
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
  const scanTraceIdRef = useRef<string | null>(null);
  const firstDeviceRef = useRef(false);

  const stopScanning = useCallback(async () => {
    const traceId = scanTraceIdRef.current;
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
    if (traceId) {
      benchmarkLogger.logEvent('BLE_DISCOVERY_END', traceId, {
        extraInfo: `unique_devices=${devices.length}`,
        metadata: { foundAny: firstDeviceRef.current },
      });
      scanTraceIdRef.current = null;
    }
    console.log('Scan stopped');
  }, [devices.length]);

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
    const traceId = benchmarkLogger.generateTraceId('ble-scan');
    scanTraceIdRef.current = traceId;
    firstDeviceRef.current = false;
    benchmarkLogger.logEvent('BLE_DISCOVERY_START', traceId);

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    removeDeviceListenerRef.current = addDeviceFoundListener((device) => {
      const found = device as unknown as ScannedDevice;
      // Show ONLY devices running this app. The native scan already filters
      // by SERVICE_UUID, but some platforms still deliver extras — drop any
      // result that doesn't advertise our service so random
      // headphones/speakers/watches never appear in the list.
      if (!isVaaniSetuDevice(found, SERVICE_UUID)) {
        return;
      }
      if (!firstDeviceRef.current) {
        firstDeviceRef.current = true;
        benchmarkLogger.logEvent('BLE_DISCOVERY_END', traceId, {
          extraInfo: 'first_matching_device_found',
          metadata: { firstDevice: true },
        });
      }
      console.log(
        'VaaniSetu device found:',
        getDeviceDisplayName(found),
        found.id,
      );
      setDevices((currentDevices) => {
        const byId = currentDevices.findIndex((d) => d.id === found.id);
        if (byId !== -1) {
          const updated = [...currentDevices];
          updated[byId] = mergeScannedDevice(currentDevices[byId], found);
          return updated;
        }
        const incomingName = getDeviceDisplayName(found);
        if (!incomingName.startsWith('VaaniSetu •')) {
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

    console.log('Starting scan (VaaniSetu service only)...');
    // Native OS-level filter: only wake us for devices advertising our
    // chat service. This is what hides every non-app BLE device AND is what
    // lets the OS deliver the scan-response (device name) reliably.
    startScan({
      serviceUUIDs: [SERVICE_UUID],
      allowDuplicates: true,
      scanMode: 'lowLatency',
    });
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
