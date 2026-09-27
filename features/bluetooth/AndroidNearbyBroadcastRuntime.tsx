import { useCallback, useEffect, useRef } from 'react';

import {
  getMeshStatus,
  publishMeshStatus,
  registerBroadcastRelay,
  registerBroadcastSender,
  registerMeshDiscovery,
} from './broadcast';
import { registerRangeUnicast } from '../proximity/rangeBus';
import { registerSosPingControl } from './sosPing';
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
/** Filtered-scan window for cold-start origin sends (was 3500). */
const COLD_SCAN_MS = 2500;
/** Background top-up scan after a warm fast-path send. */
const TOPUP_SCAN_MS = 2500;
/** Max settle wait after a top-up scan before a second wave. */
const TOPUP_SETTLE_MAX_MS = 2000;
/** Max settle wait on the cold path (was MESH_SCAN_WINDOW_MS=10000). */
const COLD_SETTLE_MAX_MS = 3500;
/** Settle stability threshold: links unchanged for this long => send. */
const SETTLE_STABLE_MS = 800;
/** Background maintainer: keep links warm while the app lives. */
const MAINTAINER_INTERVAL_MS = 15000;
const MAINTAINER_SCAN_MS = 2500;
/** First warm-up scan shortly after startup so the first broadcast is fast. */
const WARMUP_DELAY_MS = 1500;
/** Failed connect attempts are retried after this long (warm-mesh throttle). */
const ATTEMPT_RETRY_MS = 30000;
/** Relay jitter: just enough to avoid air collisions (was 400-1000). */
const RELAY_JITTER_MIN_MS = 20;
const RELAY_JITTER_MAX_MS = 80;
/** SOS relay jitter: SOS alerts first, normal mesh backs off slightly. */
const SOS_RELAY_JITTER_MIN_MS = 0;
const SOS_RELAY_JITTER_MAX_MS = 20;

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
 * Latency model (P1 warm mesh):
 * - Warm links are maintained in the background, so origin/relay sends
 *   transmit IMMEDIATELY on existing GATT links (<500ms).
 * - Discovery only blocks the send on the cold path (no links yet).
 * - A background top-up scan after each warm send catches peers that
 *   arrived since the last maintainer round (second wave, dedup-safe).
 */
export default function AndroidNearbyBroadcastRuntime() {
  const ttsRef = useRef<StreamTts>(noopTts);
  // Last-attempt epoch per device id. Throttles reconnect storms while still
  // allowing periodic retry of failed links (warm-mesh self-healing).
  const attemptedAtRef = useRef(new Map<string, number>());
  const runtimeStartedRef = useRef(false);
  // Serialises concurrent flood sends — BLE reassembly breaks if two framed
  // messages interleave on the same link, so origin + relay queue here.
  const sendChainRef = useRef<
    Promise<{ delivered: number; attempted: number }>
  >(Promise.resolve({ delivered: 0, attempted: 0 }));
  const scanActiveRef = useRef(false);

  const { startBluetooth, stopBluetooth, setSosPing } = useBleAdvertiser();
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
    sendToDevice,
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

  // SOS ping transmit control: SOS senders publish adv hex without owning
  // the advertiser. Unregisters on unmount.
  useEffect(() => registerSosPingControl(setSosPing), [setSosPing]);

  // Keep the homepage "N nearby" + link count fresh.
  useEffect(() => {
    publishMeshStatus({
      peers: devices.map((d) => ({
        id: d.id,
        name: getDeviceDisplayName(d),
        rssi: d.rssi,
        txPower:
          typeof d.txPowerLevel === 'number' ? d.txPowerLevel : undefined,
      })),
    });
  }, [devices]);

  useEffect(() => {
    publishMeshStatus({
      connectedCount: connectedDeviceIds.length + peripheralCentralIds.length,
      connectedIds: [...connectedDeviceIds],
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

  const pruneStaleAttempts = useCallback(() => {
    const now = Date.now();
    const map = attemptedAtRef.current;
    for (const [id, ts] of map) {
      if (now - ts > ATTEMPT_RETRY_MS) map.delete(id);
    }
    // Hard cap so the map can't grow without bound in a crowd.
    if (map.size > 100) {
      const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < map.size - 100; i++) map.delete(sorted[i][0]);
    }
  }, []);

  // Auto-connect to newly seen APP devices (scanner is already
  // service-UUID filtered, so everything here runs VaaniSetu). Capped so
  // one crowded room can't exhaust the radio with parallel GATT links.
  // Failed attempts are throttled for ATTEMPT_RETRY_MS, then retried by the
  // maintainer or the next origin send.
  useEffect(() => {
    pruneStaleAttempts();
    devices.forEach((device) => {
      const lastAttempt = attemptedAtRef.current.get(device.id);
      if (
        lastAttempt !== undefined &&
        Date.now() - lastAttempt < ATTEMPT_RETRY_MS
      ) {
        return;
      }
      if (connectedDeviceIds.includes(device.id)) return;
      if (connectedDeviceIds.length >= MAX_MESH_LINKS) return;
      if (attemptedAtRef.current.size >= MAX_MESH_LINKS * 4) return;
      attemptedAtRef.current.set(device.id, Date.now());
      void connectToDevice(device.id).catch(() => {});
    });
  }, [connectToDevice, connectedDeviceIds, devices, pruneStaleAttempts]);

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

  const floodToAllLinksRef = useRef(floodToAllLinks);
  useEffect(() => {
    floodToAllLinksRef.current = floodToAllLinks;
  }, [floodToAllLinks]);

  /**
   * Bounded settle wait for freshly-started connects.
   * Resolves once links exist AND are stable, or when maxMs elapses.
   */
  const waitForLinksToSettleBounded = useCallback(
    async (maxMs: number, stableMs: number = SETTLE_STABLE_MS) => {
      const started = Date.now();
      let lastCount = linkCountRef.current;
      let stableSince = Date.now();
      // Minimum window for discovery callbacks to arrive.
      await sleep(Math.min(1000, maxMs));
      while (Date.now() - started < maxMs) {
        const count = linkCountRef.current;
        const busy = isConnectingRef.current;
        if (count !== lastCount) {
          lastCount = count;
          stableSince = Date.now();
        }
        if (!busy && count > 0 && Date.now() - stableSince >= stableMs) return;
        if (!busy && count === 0 && Date.now() - started >= maxMs) return;
        await sleep(300);
      }
    },
    [],
  );

  const waitForLinksRef = useRef(waitForLinksToSettleBounded);
  useEffect(() => {
    waitForLinksRef.current = waitForLinksToSettleBounded;
  }, [waitForLinksToSettleBounded]);

  /**
   * Background top-up after a warm send: peers that arrived since the last
   * maintainer round get a (dedup-safe) second wave without blocking the
   * first send. Fire-and-forget.
   */
  const topUpScanInBackground = useCallback(
    async (envelope: BroadcastEnvelope, beforeCount: number) => {
      if (scanActiveRef.current) return;
      if (linkCountRef.current >= MAX_MESH_LINKS) return;
      scanActiveRef.current = true;
      publishMeshStatus({ isScanning: true });
      try {
        await scanForDevicesRef.current();
      } catch {
        // Scan failures just mean no second wave.
      }
      await sleep(TOPUP_SCAN_MS);
      try {
        await stopScanningRef.current();
      } catch {
        // ignore stop errors
      }
      await waitForLinksToSettleBounded(TOPUP_SETTLE_MAX_MS);
      scanActiveRef.current = false;
      publishMeshStatus({ isScanning: false });
      if (linkCountRef.current > beforeCount) {
        try {
          const { delivered, attempted } = await floodToAllLinks(envelope);
          console.log(
            `[MeshTiming] topup id=${envelope.id} delivered=${delivered}/${attempted}`,
          );
          if (delivered > 0) {
            publishMeshStatus({
              lastDelivered: delivered,
              lastAttempted: attempted,
              lastResult: `Sent to ${delivered} nearby ${delivered === 1 ? 'phone' : 'phones'}.`,
            });
          }
        } catch (error) {
          console.warn('[Mesh] top-up flood failed:', error);
        }
      }
    },
    [floodToAllLinks, waitForLinksToSettleBounded],
  );

  const topUpRef = useRef(topUpScanInBackground);
  useEffect(() => {
    topUpRef.current = topUpScanInBackground;
  }, [topUpScanInBackground]);

  // Background maintainer: periodic short scans keep the warm-mesh link pool
  // fresh so broadcasts rarely pay discovery cost. Auto-connect (above)
  // turns newly seen devices into GATT links.
  useEffect(() => {
    let cancelled = false;
    const doMaintainerScan = async () => {
      if (cancelled || scanActiveRef.current) return;
      if (linkCountRef.current >= MAX_MESH_LINKS) {
        pruneStaleAttempts();
        return;
      }
      try {
        await startRuntimeRef.current();
      } catch {
        return;
      }
      if (cancelled || scanActiveRef.current) return;
      pruneStaleAttempts();
      scanActiveRef.current = true;
      publishMeshStatus({ isScanning: true });
      try {
        await scanForDevicesRef.current();
      } catch {
        // Scan failures just mean fewer peers this round.
      }
      await sleep(MAINTAINER_SCAN_MS);
      try {
        await stopScanningRef.current();
      } catch {
        // ignore stop errors
      }
      scanActiveRef.current = false;
      publishMeshStatus({ isScanning: false });
    };
    const warmup = setTimeout(() => {
      void doMaintainerScan();
    }, WARMUP_DELAY_MS);
    const interval = setInterval(() => {
      void doMaintainerScan();
    }, MAINTAINER_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(warmup);
      clearInterval(interval);
    };
  }, [pruneStaleAttempts]);

  const floodRound = useCallback(
    async (envelope: BroadcastEnvelope, freshScan: boolean) => {
      const totalStarted = Date.now();
      await startRuntimeRef.current();
      if (freshScan) {
        // User-initiated send: force retry of previously failed devices.
        attemptedAtRef.current.clear();
      } else {
        pruneStaleAttempts();
      }

      // FAST PATH: warm links exist — transmit immediately, no scan block.
      if (linkCountRef.current > 0) {
        const txStarted = Date.now();
        const { delivered, attempted } = await floodToAllLinks(envelope);
        const txMs = Date.now() - txStarted;
        const totalMs = Date.now() - totalStarted;
        const sent = delivered > 0;
        console.log(
          `[MeshTiming] origin-fast id=${envelope.id} delivered=${delivered}/${attempted} scanMs=0 txMs=${txMs} totalMs=${totalMs}`,
        );
        publishMeshStatus({
          lastDelivered: delivered,
          lastAttempted: attempted,
          lastScanMs: 0,
          lastTxMs: txMs,
          lastTotalMs: totalMs,
          lastResult: sent
            ? delivered === attempted
              ? `Sent to ${delivered} nearby ${delivered === 1 ? 'phone' : 'phones'}.`
              : `Reached ${delivered} of ${attempted} links — the rest may still get it via relay.`
            : 'No nearby VaaniSetu device was reachable. Keep Bluetooth + Location on and try again.',
        });
        if (sent) {
          // Catch late joiners without blocking this send.
          void topUpRef.current(envelope, linkCountRef.current).catch(() => {});
          return true;
        }
        // Fast path found only dead links — fall through to cold discovery.
      }

      // SLOW PATH (cold start or dead links): bounded discovery, then send.
      const scanStarted = Date.now();
      let ownedScan = false;
      if (!scanActiveRef.current) {
        ownedScan = true;
        scanActiveRef.current = true;
        publishMeshStatus({ isScanning: true });
        try {
          await scanForDevicesRef.current();
        } catch {
          // Scan failures just mean fewer peers this round.
        }
        await sleep(COLD_SCAN_MS);
        try {
          await stopScanningRef.current();
        } catch {
          // ignore stop errors
        }
        // GATT connects lag behind discovery — wait (bounded) for them.
        await waitForLinksToSettleBounded(COLD_SETTLE_MAX_MS);
        scanActiveRef.current = false;
        publishMeshStatus({ isScanning: false });
      } else {
        // Another round/maintainer is already discovering — just let its
        // connections land, then transmit on the shared links.
        await waitForLinksToSettleBounded(COLD_SETTLE_MAX_MS);
      }
      const scanMs = ownedScan ? Date.now() - scanStarted : 0;

      const txStarted = Date.now();
      const { delivered, attempted } = await floodToAllLinks(envelope);
      const txMs = Date.now() - txStarted;
      const totalMs = Date.now() - totalStarted;
      const sent = delivered > 0;
      console.log(
        `[MeshTiming] origin-cold id=${envelope.id} delivered=${delivered}/${attempted} scanMs=${scanMs} txMs=${txMs} totalMs=${totalMs}`,
      );
      publishMeshStatus({
        lastDelivered: delivered,
        lastAttempted: attempted,
        lastScanMs: scanMs,
        lastTxMs: txMs,
        lastTotalMs: totalMs,
        lastResult: sent
          ? delivered === attempted
            ? `Sent to ${delivered} nearby ${delivered === 1 ? 'phone' : 'phones'}.`
            : `Reached ${delivered} of ${attempted} links — the rest may still get it via relay.`
          : 'No nearby VaaniSetu device was reachable. Keep Bluetooth + Location on and try again.',
      });
      return sent;
    },
    [floodToAllLinks, pruneStaleAttempts, waitForLinksToSettleBounded],
  );

  const floodRoundRef = useRef(floodRound);
  useEffect(() => {
    floodRoundRef.current = floodRound;
  }, [floodRound]);

  // Origin path: homepage Broadcast button → flood to ALL nearby app phones.
  // Warm links send immediately; cold start falls back to bounded discovery.
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

  const sendToDeviceRef = useRef(sendToDevice);
  useEffect(() => {
    sendToDeviceRef.current = sendToDevice;
  }, [sendToDevice]);

  // Device-search unicast: pings travel down ONE open link, never the flood
  // bus. Unregisters on unmount.
  useEffect(() => {
    registerRangeUnicast((deviceId, envelope) =>
      sendToDeviceRef.current(deviceId, envelope),
    );
    return () => registerRangeUnicast(null);
  }, []);

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
        await sleep(COLD_SCAN_MS);
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
  // (shared de-dup). Fast relay re-floods on WARM links only — no scan block,
  // tiny jitter. Only when we hold zero links do we pay for one bounded
  // discovery round so orphan relays don't silently drop the wave.
  // Fire-and-forget — never block the receiver.
  useEffect(
    () =>
      registerBroadcastRelay((nextEnvelope) => {
        void (async () => {
          // SOS jumps the relay queue: 0-20ms vs 20-80ms for normal mesh.
          const isSos = nextEnvelope?.kind === 'sos';
          const jitterMin = isSos
            ? SOS_RELAY_JITTER_MIN_MS
            : RELAY_JITTER_MIN_MS;
          const jitterMax = isSos
            ? SOS_RELAY_JITTER_MAX_MS
            : RELAY_JITTER_MAX_MS;
          await sleep(
            jitterMin + Math.floor(Math.random() * (jitterMax - jitterMin)),
          );
          try {
            const relayStarted = Date.now();
            let { delivered, attempted } =
              await floodToAllLinksRef.current(nextEnvelope);
            if (attempted === 0 && !scanActiveRef.current) {
              // No warm links: one bounded discovery retry for coverage.
              scanActiveRef.current = true;
              publishMeshStatus({ isScanning: true });
              try {
                await scanForDevicesRef.current();
              } catch {
                // ignore scan errors
              }
              await sleep(COLD_SCAN_MS);
              try {
                await stopScanningRef.current();
              } catch {
                // ignore stop errors
              }
              await waitForLinksRef.current(COLD_SETTLE_MAX_MS);
              scanActiveRef.current = false;
              publishMeshStatus({ isScanning: false });
              const retry = await floodToAllLinksRef.current(nextEnvelope);
              delivered = retry.delivered;
              attempted = retry.attempted;
            }
            console.log(
              `[MeshTiming] relay id=${nextEnvelope.id} delivered=${delivered}/${attempted} relayMs=${Date.now() - relayStarted}`,
            );
          } catch (error) {
            console.warn('[Mesh] relay flood failed:', error);
          }
        })();
      }),
    [],
  );

  return null;
}
