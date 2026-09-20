import { useCallback, useEffect, useRef } from 'react';

import {
  MESH_SCAN_WINDOW_MS,
  getMeshStatus,
  publishMeshStatus,
  registerBroadcastRelay,
  registerBroadcastSender,
  registerMeshDiscovery,
} from './broadcast';
import type { BroadcastEnvelope } from './broadcast';
import { useBleAdvertiser } from './useBleAdvertiser';
import { useBleConnection } from './useBleConnection';
import { useBleMessages } from './useBleMessages';
import { useBleScanner } from './useBleScanner';
import type { StreamTts } from './useBleMessages';
import { getDeviceDisplayName } from './devices';

const noopTts: StreamTts = {
  speakFullMessage: () => {},
  beginStream: () => {},
  pushText: () => {},
  endStream: () => {},
  discardStream: () => {},
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Upper bound on simultaneous mesh central links (radio sanity). */
const MAX_MESH_LINKS = 6;
/** Fixed filtered-scan window per flood/discovery round. */
const SCAN_WINDOW_MS = 3500;

/**
 * Homepage mesh runtime (flood broadcast, no manual pairing).
 *
 * Lives for the whole app lifetime (mounted in `_layout`). It is DELIBERATELY
 * separate from the 1-to-1 chat in `bluetooth.tsx`:
 * - 1-to-1 = user picks ONE device, taps Connect, chats (untouched).
 * - Mesh = homepage Broadcast fans out to ALL nearby VaaniSetu phones;
 *   every phone that receives it relays it once (TTL-limited) so phones
 *   beyond direct radio range still get it.
 *
 * How a flood round works (origin + relay share the same path):
 * 1. make sure we advertise + listen as peripheral (so others can reach us)
 * 2. scan with SERVICE_UUID filter → connect to every app device found
 * 3. send the envelope to all central links + all subscribed centrals
 */
export default function AndroidNearbyBroadcastRuntime() {
  const ttsRef = useRef<StreamTts>(noopTts);
  const attemptedDeviceIdsRef = useRef(new Set<string>());
  const runtimeStartedRef = useRef(false);
  // Serialises concurrent flood sends — BLE reassembly breaks if two framed
  // messages interleave on the same link, so origin + relay queue here.
  const sendChainRef = useRef<
    Promise<{ delivered: number; attempted: number }>
  >(Promise.resolve({ delivered: 0, attempted: 0 }));
  const scanActiveRef = useRef(false);

  const { startBluetooth, stopBluetooth } = useBleAdvertiser();
  const {
    setMessages,
    addMessage,
    clearMessages,
    handleIncomingHex,
    resetIncomingState,
  } = useBleMessages(ttsRef);
  // NOTE: isChatConnected:false on purpose — the mesh must keep scanning for
  // MORE peers even while it already holds mesh links. The 1-to-1 tab uses
  // its own scanner instance with the manual-connect guard.
  const { devices, scanForDevices, stopScanning } = useBleScanner({
    isChatConnected: false,
  });
  const {
    connectToDevice,
    ensurePeripheralListeners,
    sendBroadcastDetailed,
    connectedDeviceIds,
    peripheralCentralIds,
    isConnecting,
  } = useBleConnection({
    handleIncomingHex,
    addMessage,
    clearMessages,
    setMessages,
    resetIncomingState,
    // Mesh broadcast is a transport-level flood — it must not be gated on
    // heavy STT/TTS models or language installs (those belong to 1-to-1).
    isLanguageInstalled: true,
    promptInstallLanguage: () => {},
  });

  const startRuntime = useCallback(async () => {
    ensurePeripheralListeners();
    if (runtimeStartedRef.current) return;
    runtimeStartedRef.current = true;
    await startBluetooth();
    publishMeshStatus({ isAdvertising: true });
  }, [ensurePeripheralListeners, startBluetooth]);

  const startRuntimeRef = useRef(startRuntime);
  useEffect(() => {
    startRuntimeRef.current = startRuntime;
  }, [startRuntime]);

  // Keep the homepage "N nearby" + link count fresh.
  useEffect(() => {
    publishMeshStatus({
      peers: devices.map((d) => ({
        id: d.id,
        name: getDeviceDisplayName(d),
        rssi: d.rssi,
      })),
    });
  }, [devices]);

  useEffect(() => {
    publishMeshStatus({
      connectedCount: connectedDeviceIds.length + peripheralCentralIds.length,
    });
  }, [connectedDeviceIds, peripheralCentralIds]);

  useEffect(() => {
    void (async () => {
      await startRuntimeRef.current();
    })();

    return () => {
      try {
        void stopScanning();
      } catch {}
      try {
        stopBluetooth();
      } catch {}
      publishMeshStatus({ isAdvertising: false, isScanning: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live link-count snapshot for the settle-wait below.
  const linkCountRef = useRef(0);
  useEffect(() => {
    linkCountRef.current =
      connectedDeviceIds.length + peripheralCentralIds.length;
  }, [connectedDeviceIds, peripheralCentralIds]);

  const isConnectingRef = useRef(isConnecting);
  useEffect(() => {
    isConnectingRef.current = isConnecting;
  }, [isConnecting]);

  // Auto-connect to newly seen APP devices (scanner is already
  // service-UUID filtered, so everything here runs VaaniSetu). Capped so
  // one crowded room can't exhaust the radio with parallel GATT links.
  useEffect(() => {
    devices.forEach((device) => {
      if (attemptedDeviceIdsRef.current.has(device.id)) return;
      if (connectedDeviceIds.includes(device.id)) return;
      if (
        attemptedDeviceIdsRef.current.size + connectedDeviceIds.length >=
        MAX_MESH_LINKS
      ) {
        return;
      }
      attemptedDeviceIdsRef.current.add(device.id);
      void connectToDevice(device.id).catch(() => {});
    });
  }, [connectToDevice, connectedDeviceIds, devices]);

  const sendBroadcastDetailedRef = useRef(sendBroadcastDetailed);
  useEffect(() => {
    sendBroadcastDetailedRef.current = sendBroadcastDetailed;
  }, [sendBroadcastDetailed]);

  const scanForDevicesRef = useRef(scanForDevices);
  useEffect(() => {
    scanForDevicesRef.current = scanForDevices;
  }, [scanForDevices]);

  const stopScanningRef = useRef(stopScanning);
  useEffect(() => {
    stopScanningRef.current = stopScanning;
  }, [stopScanning]);

  const getMeshStatusSnapshot = useCallback(
    () => getMeshStatus().peers.length,
    [],
  );

  type FloodDetail = { delivered: number; attempted: number };

  const floodToAllLinks = useCallback(
    async (envelope: BroadcastEnvelope): Promise<FloodDetail> => {
      const chained = sendChainRef.current.then(() =>
        sendBroadcastDetailedRef.current(envelope),
      );
      // Keep the chain alive even if one round fails.
      sendChainRef.current = chained.then(
        () => ({ delivered: 0, attempted: 0 }),
        () => ({ delivered: 0, attempted: 0 }),
      );
      return chained.catch(() => ({ delivered: 0, attempted: 0 }));
    },
    [],
  );

  /**
   * Wait for freshly-started connects to settle before transmitting.
   * The old fixed 3.5s sleep often fired while GATT connects were still in
   * progress → "no device found" even though links landed a second later.
   */
  const waitForLinksToSettle = useCallback(async () => {
    const started = Date.now();
    let lastCount = linkCountRef.current;
    let stableSince = Date.now();
    // Always allow a minimum window for discovery callbacks to arrive.
    await sleep(1500);
    while (Date.now() - started < MESH_SCAN_WINDOW_MS) {
      const count = linkCountRef.current;
      const busy = isConnectingRef.current;
      if (count !== lastCount) {
        lastCount = count;
        stableSince = Date.now();
      }
      // Transmit once links exist AND nothing is changing anymore.
      if (!busy && count > 0 && Date.now() - stableSince >= 1200) return;
      // Give up waiting when nothing is even trying anymore.
      if (!busy && count === 0 && Date.now() - started >= SCAN_WINDOW_MS)
        return;
      await sleep(400);
    }
  }, []);

  const floodRound = useCallback(
    async (envelope: BroadcastEnvelope, freshScan: boolean) => {
      await startRuntimeRef.current();
      if (freshScan) attemptedDeviceIdsRef.current.clear();

      if (!scanActiveRef.current) {
        scanActiveRef.current = true;
        publishMeshStatus({ isScanning: true });
        try {
          await scanForDevicesRef.current();
        } catch {
          // Scan failures just mean fewer peers this round.
        }
        // Fixed discovery window, then stop the radio scan…
        await sleep(SCAN_WINDOW_MS);
        try {
          await stopScanningRef.current();
        } catch {
          // ignore stop errors
        }
        // …but GATT connects lag behind discovery, so wait for them to
        // land before transmitting.
        await waitForLinksToSettle();
        scanActiveRef.current = false;
        publishMeshStatus({ isScanning: false });
      } else {
        // Another round is already discovering — just let its connections
        // land, then transmit on the shared links.
        await waitForLinksToSettle();
      }

      const { delivered, attempted } = await floodToAllLinks(envelope);
      const sent = delivered > 0;
      publishMeshStatus({
        lastDelivered: delivered,
        lastAttempted: attempted,
        lastResult: sent
          ? delivered === attempted
            ? `Sent to ${delivered} nearby ${delivered === 1 ? 'phone' : 'phones'}.`
            : `Reached ${delivered} of ${attempted} links — the rest may still get it via relay.`
          : 'No nearby VaaniSetu device was reachable. Keep Bluetooth + Location on and try again.',
      });
      return sent;
    },
    [floodToAllLinks, waitForLinksToSettle],
  );

  const floodRoundRef = useRef(floodRound);
  useEffect(() => {
    floodRoundRef.current = floodRound;
  }, [floodRound]);

  // Origin path: homepage Broadcast button → flood to ALL nearby app phones.
  // No manual Connect needed; we discover + link on demand each time.
  const sendWhenReady = useCallback(async (envelope: BroadcastEnvelope) => {
    try {
      return await floodRoundRef.current(envelope, true);
    } catch (error) {
      console.warn('[Mesh] origin flood failed:', error);
      publishMeshStatus({
        lastResult: 'Broadcast failed. Check Bluetooth and try again.',
      });
      return false;
    }
  }, []);

  useEffect(() => registerBroadcastSender(sendWhenReady), [sendWhenReady]);

  // Discovery-only round for the homepage "Refresh" button: short filtered
  // scan that publishes peers WITHOUT transmitting anything.
  useEffect(
    () =>
      registerMeshDiscovery(async () => {
        try {
          await startRuntimeRef.current();
        } catch {
          return 0;
        }
        if (scanActiveRef.current) {
          // A flood round is already discovering — its results land in the
          // same shared peer list.
          return getMeshStatusSnapshot();
        }
        scanActiveRef.current = true;
        publishMeshStatus({ isScanning: true });
        try {
          await scanForDevicesRef.current();
        } catch {
          // Scan failures just mean an empty list this round.
        }
        await sleep(4000);
        try {
          await stopScanningRef.current();
        } catch {
          // ignore stop errors
        }
        scanActiveRef.current = false;
        publishMeshStatus({ isScanning: false });
        return getMeshStatusSnapshot();
      }),
    [getMeshStatusSnapshot],
  );

  // Relay path: invoked exactly once per never-seen id by `emitBroadcast`
  // (shared de-dup). Re-flood with ttl-1 so the wave keeps travelling while
  // TTL lasts. Fire-and-forget — never block the receiver.
  useEffect(
    () =>
      registerBroadcastRelay((nextEnvelope) => {
        void (async () => {
          // Small jitter avoids every phone re-transmitting the same instant
          // and colliding on air.
          await sleep(400 + Math.floor(Math.random() * 600));
          try {
            await floodRoundRef.current(nextEnvelope, false);
          } catch (error) {
            console.warn('[Mesh] relay flood failed:', error);
          }
        })();
      }),
    [],
  );

  return null;
}
