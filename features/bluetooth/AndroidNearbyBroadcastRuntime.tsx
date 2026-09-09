import { useCallback, useEffect, useRef } from 'react';

import {
  MESH_SCAN_WINDOW_MS,
  getEnvelopeKind,
  getMeshStatus,
  isSosAckEnvelope,
  isSosEnvelope,
  publishMeshStatus,
  registerBroadcastRelay,
  registerBroadcastSender,
  registerMeshDiscovery,
  subscribeToBroadcasts,
} from './broadcast';
import {
  getPendingSos,
  queuePendingSos,
  removePendingSos,
  resolvePendingSosWithAck,
} from './sos';
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
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Upper bound on simultaneous mesh central links (radio sanity). */
const MAX_MESH_LINKS = 6;
/** Fixed filtered-scan window per flood/discovery round. */
const SCAN_WINDOW_MS = 3500;
/** Min gap between automatic store-and-forward retry rounds. */
const RETRY_COOLDOWN_MS = 15000;
/** Max queued envelopes re-flooded per retry round (SOS goes first). */
const MAX_RETRY_PER_ROUND = 5;

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
          : 'No nearby VaaniSetu device was reachable. Message saved — it will send automatically when a phone appears.',
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
  // Store-and-forward: SOS is ALWAYS queued (it must survive until an
  // sos-ack or expiry — the victim may meet new phones later). Chat/ACK is
  // queued only when this round delivered to zero links.
  const sendWhenReady = useCallback(async (envelope: BroadcastEnvelope) => {
    try {
      const sent = await floodRoundRef.current(envelope, true);
      try {
        if (getEnvelopeKind(envelope) === 'sos') {
          await queuePendingSos(envelope);
        } else if (sent) {
          await removePendingSos(envelope.id);
        } else {
          await queuePendingSos(envelope);
        }
      } catch {}
      return sent;
    } catch (error) {
      console.warn('[Mesh] origin flood failed:', error);
      try {
        await queuePendingSos(envelope);
      } catch {}
      publishMeshStatus({
        lastResult:
          'No phones in range — message saved, it will send automatically when one appears.',
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

  // Incoming sos-ack resolves the matching queued SOS so this phone stops
  // re-flooding "help me" once rescue is confirmed.
  // Relay-side carry: every NEW incoming SOS/ACK is also persisted, so this
  // phone re-floods it to future peers even if the origin is gone (true
  // delay-tolerant carry). Own looped-back echoes never reach here —
  // emitBroadcast drops already-seen ids before notifying listeners — so the
  // origin can't re-queue itself. Chat is NOT carried, only SOS traffic.
  useEffect(
    () =>
      subscribeToBroadcasts((envelope) => {
        if (isSosAckEnvelope(envelope)) {
          void resolvePendingSosWithAck(envelope).catch(() => {});
          void queuePendingSos(envelope).catch(() => {});
        } else if (isSosEnvelope(envelope)) {
          void queuePendingSos(envelope).catch(() => {});
        }
      }),
    [],
  );

  // Store-and-forward retry: when genuinely NEW phones appear and unsent
  // envelopes are queued, re-flood (SOS first). Cooldown + per-round cap +
  // in-flight guard keep a crowded room from causing a retry storm.
  const seenPeerIdsRef = useRef(new Set<string>());
  const lastAutoRetryRef = useRef(0);
  const autoRetryActiveRef = useRef(false);
  useEffect(() => {
    const fresh = devices.filter((d) => !seenPeerIdsRef.current.has(d.id));
    devices.forEach((d) => {
      seenPeerIdsRef.current.add(d.id);
      if (seenPeerIdsRef.current.size > 500) {
        const first = seenPeerIdsRef.current.values().next().value;
        if (first !== undefined) seenPeerIdsRef.current.delete(first);
      }
    });
    if (fresh.length === 0 || autoRetryActiveRef.current) return;
    if (Date.now() - lastAutoRetryRef.current < RETRY_COOLDOWN_MS) return;
    autoRetryActiveRef.current = true;
    lastAutoRetryRef.current = Date.now();
    void (async () => {
      try {
        const pending = await getPendingSos();
        if (pending.length === 0) return;
        console.log(
          `[Mesh] ${fresh.length} new peer(s) — retrying ${Math.min(pending.length, MAX_RETRY_PER_ROUND)} queued message(s)`,
        );
        for (const env of pending.slice(0, MAX_RETRY_PER_ROUND)) {
          try {
            const sent = await floodRoundRef.current(env, false);
            // SOS stays queued until an sos-ack (more phones may still
            // arrive); chat/ack leaves the queue once delivered.
            if (sent && getEnvelopeKind(env) !== 'sos') {
              await removePendingSos(env.id);
            }
          } catch {}
        }
      } finally {
        autoRetryActiveRef.current = false;
      }
    })();
  }, [devices]);

  return null;
}
