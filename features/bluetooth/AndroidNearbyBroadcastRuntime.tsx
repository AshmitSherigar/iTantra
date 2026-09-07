import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { registerBroadcastSender } from './broadcast';
import type { BroadcastEnvelope } from './broadcast';
import { useBleAdvertiser } from './useBleAdvertiser';
import { useBleConnection } from './useBleConnection';
import { useBleMessages } from './useBleMessages';
import { useBleScanner } from './useBleScanner';
import type { StreamTts } from './useBleMessages';

const noopTts: StreamTts = {
  speakFullMessage: () => {},
  beginStream: () => {},
  pushText: () => {},
  endStream: () => {},
};

export default function AndroidNearbyBroadcastRuntime() {
  const ttsRef = useRef<StreamTts>(noopTts);
  const attemptedDeviceIdsRef = useRef(new Set<string>());
  const runtimeStartedRef = useRef(false);
  const scanRequestedRef = useRef(false);
  const pendingBroadcastRef = useRef<{
    envelope: BroadcastEnvelope;
    resolve: (sent: boolean) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null>(null);

  const { startBluetooth, stopBluetooth } = useBleAdvertiser();
  const {
    setMessages,
    addMessage,
    clearMessages,
    handleIncomingHex,
    resetIncomingState,
  } = useBleMessages(ttsRef);
  const { devices, scanForDevices, stopScanning } = useBleScanner({
    isChatConnected: false,
  });
  const {
    connectToDevice,
    ensurePeripheralListeners,
    sendBroadcast,
    connectedDeviceIds,
    peripheralCentralIds,
  } = useBleConnection({
    handleIncomingHex,
    addMessage,
    clearMessages,
    setMessages,
    resetIncomingState,
    isLanguageInstalled: true,
    promptInstallLanguage: () => {},
  });

  const startRuntime = useCallback(async () => {
    if (runtimeStartedRef.current) return;
    runtimeStartedRef.current = true;
    ensurePeripheralListeners();
    await startBluetooth();
  }, [ensurePeripheralListeners, startBluetooth]);

  const startRuntimeRef = useRef(startRuntime);
  useEffect(() => {
    startRuntimeRef.current = startRuntime;
  }, [startRuntime]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    void (async () => {
      await startRuntimeRef.current();
    })();

    return () => {
      const pending = pendingBroadcastRef.current;
      if (pending) {
        clearTimeout(pending.timeout);
        pending.resolve(false);
        pendingBroadcastRef.current = null;
      }
      void stopScanning();
      stopBluetooth();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android' || !scanRequestedRef.current) return;

    devices.forEach((device) => {
      if (attemptedDeviceIdsRef.current.has(device.id)) return;
      attemptedDeviceIdsRef.current.add(device.id);
      void connectToDevice(device.id);
    });
  }, [connectToDevice, devices]);

  useEffect(() => {
    if (
      !pendingBroadcastRef.current ||
      (connectedDeviceIds.length === 0 && peripheralCentralIds.length === 0)
    ) {
      return;
    }

    const pending = pendingBroadcastRef.current;
    pendingBroadcastRef.current = null;
    clearTimeout(pending.timeout);
    void sendBroadcast(pending.envelope).then(pending.resolve);
  }, [connectedDeviceIds, peripheralCentralIds, sendBroadcast]);

  const sendWhenReady = useCallback(
    async (envelope: BroadcastEnvelope) => {
      if (Platform.OS !== 'android') return false;

      await startRuntime();
      scanRequestedRef.current = true;
      attemptedDeviceIdsRef.current.clear();
      await scanForDevices();

      if (connectedDeviceIds.length > 0 || peripheralCentralIds.length > 0) {
        return sendBroadcast(envelope);
      }

      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          if (pendingBroadcastRef.current?.envelope.id !== envelope.id) {
            return;
          }
          pendingBroadcastRef.current = null;
          resolve(false);
        }, 10000);
        pendingBroadcastRef.current = { envelope, resolve, timeout };
      });
    },
    [
      connectedDeviceIds,
      peripheralCentralIds,
      scanForDevices,
      sendBroadcast,
      startRuntime,
    ],
  );

  useEffect(() => registerBroadcastSender(sendWhenReady), [sendWhenReady]);

  return null;
}