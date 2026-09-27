import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Device from 'expo-device';
import { readRSSI } from 'react-native-bluetooth-ble';

import {
  getMeshStatus,
  requestMeshDiscovery,
  sendNearbyBroadcast,
  subscribeToMeshStatus,
  type BroadcastEnvelope,
  type MeshStatus,
} from '../bluetooth/broadcast';
import { sendRangeUnicast, subscribeToRangePings } from './rangeBus';
import {
  startWifiDiscovery,
  WIFI_STALE_AFTER_MS,
  WIFI_TCP_PORT,
  type WifiPeer,
} from '../wifi';
import { useLanguage } from '../../context/LanguageContext';
import { createRssiFilter, type RssiFilter } from './rssi';
import {
  distanceBand,
  READING_STALE_AFTER_MS,
  rssiToMeters,
  TX_POWER_DBM_AT_1M,
  type DistanceBand,
} from './distance';
import {
  makeRangeEnvelope,
  parseRangePing,
  RANGE_DISCOVERY_INTERVAL_MS,
  RANGE_PING_INTERVAL_MS,
  RANGE_REPLY_THROTTLE_MS,
  RANGE_SOUGHT_TIMEOUT_MS,
  sameDeviceName,
} from './protocol';

export type SearchBleSighting = {
  id: string;
  rssi: number | null;
  meters: number | null;
  band: DistanceBand;
  lastSeen: number | null;
  /** Per-device calibrated Tx power from its advertisement, if provided. */
  txPower: number | null;
};

export type SearchWifiSighting = {
  address: string;
  deviceId: string;
  lastSeen: number;
};

export type SearchPeer = {
  /** Group key: normalised display name (one phone, both transports). */
  key: string;
  name: string;
  ble?: SearchBleSighting;
  wifi?: SearchWifiSighting;
  lastSeen: number;
};

export type TrackedTarget = {
  key: string;
  name: string;
  band: DistanceBand;
  meters: number | null;
  rssi: number | null;
  /** Their measurement of me (from their reply), if one arrived yet. */
  peerSeesMeMeters: number | null;
  peerSeesMeAt: number | null;
};

export type SoughtBy = {
  seekerName: string;
  sessionId: string;
  /** Their measurement of me (they sent it). */
  theirMeters: number | null;
  /** My measurement of them (from my scan results). */
  myMeters: number | null;
  lastSeen: number;
};

function mergeWifiPeer(prev: WifiPeer[], incoming: WifiPeer): WifiPeer[] {
  const byAddr = prev.findIndex((p) => p.address === incoming.address);
  if (byAddr !== -1) {
    const updated = [...prev];
    updated[byAddr] = { ...updated[byAddr], ...incoming };
    return updated;
  }
  const byId = prev.findIndex((p) => p.deviceId === incoming.deviceId);
  if (byId !== -1) {
    const updated = [...prev];
    updated[byId] = { ...updated[byId], ...incoming };
    return updated;
  }
  if (prev.length >= 50) return prev;
  return [...prev, incoming];
}

function makeSessionId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.slice(0, 16);
}

/**
 * Device-search state machine (screen-scoped).
 *
 * Conflict-free by design: BLE discovery/RSSI/ads come from the GLOBAL mesh
 * runtime (mounted at root — we only subscribe + trigger shared discovery
 * rounds). The ONLY thing this screen owns is a UDP WiFi-discovery socket
 * (no TCP server, so no clash with chat transports).
 */
export function useDeviceSearch() {
  const { selectedLanguage } = useLanguage();
  const [deviceName] = useState(
    () =>
      Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu',
  );
  const [sessionId] = useState(makeSessionId);
  const [wifiDeviceId] = useState(
    () => `search-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  const [mesh, setMesh] = useState<MeshStatus>(() => getMeshStatus());
  const [wifiPeers, setWifiPeers] = useState<WifiPeer[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [trackedKey, setTrackedKey] = useState<string | null>(null);
  const [peerSeesMe, setPeerSeesMe] = useState<{
    meters: number | null;
    at: number;
  } | null>(null);
  const [soughtBy, setSoughtBy] = useState<SoughtBy | null>(null);

  const langRef = useRef(selectedLanguage.id);
  useEffect(() => {
    langRef.current = selectedLanguage.id;
  }, [selectedLanguage.id]);

  const filtersRef = useRef(
    new Map<string, { filter: RssiFilter; name: string; pushedAt: number }>(),
  );
  const trackedRef = useRef<string | null>(null);
  useEffect(() => {
    trackedRef.current = trackedKey;
  }, [trackedKey]);
  const lastReplyAtRef = useRef(0);
  const ignoredSeekersRef = useRef(new Map<string, number>());

  const deviceNameRef = useRef(deviceName);
  useEffect(() => {
    deviceNameRef.current = deviceName;
  }, [deviceName]);
  const sessionIdRef = useRef(sessionId);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Name + BLE-id lookups for reply matching (refs keep subscribers stable).
  const peersByKeyRef = useRef(new Map<string, string>());
  const bleIdByKeyRef = useRef(new Map<string, string>());
  const bleIdByNameRef = useRef(new Map<string, string>());
  const meshRef = useRef(mesh);
  useEffect(() => {
    meshRef.current = mesh;
  }, [mesh]);

  // ---- global BLE mesh status (peers carry live RSSI) ----
  useEffect(() => {
    setMesh(getMeshStatus());
    return subscribeToMeshStatus(setMesh);
  }, []);

  // ---- 1s ticker: staleness, sought expiry, filter/wifi pruning ----
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      for (const [peerId, entry] of filtersRef.current) {
        if (t - entry.pushedAt > 90000) filtersRef.current.delete(peerId);
      }
      if (filtersRef.current.size > 120) {
        const oldest = [...filtersRef.current.entries()].sort(
          (a, b) => a[1].pushedAt - b[1].pushedAt,
        );
        for (let i = 0; i < filtersRef.current.size - 120; i++) {
          filtersRef.current.delete(oldest[i][0]);
        }
      }
      setWifiPeers((prev) =>
        prev.filter((p) => t - p.lastSeen < WIFI_STALE_AFTER_MS * 2),
      );
      setSoughtBy((current) =>
        current && t - current.lastSeen > RANGE_SOUGHT_TIMEOUT_MS
          ? null
          : current,
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // ---- fold scan RSSI samples into per-device filters ----
  useEffect(() => {
    const t = Date.now();
    for (const peer of mesh.peers) {
      if (typeof peer.rssi !== 'number') continue;
      let entry = filtersRef.current.get(peer.id);
      if (!entry) {
        entry = { filter: createRssiFilter(), name: peer.name, pushedAt: 0 };
        filtersRef.current.set(peer.id, entry);
      }
      entry.name = peer.name;
      entry.filter.push(peer.rssi);
      entry.pushedAt = t;
    }
  }, [mesh.peers]);

  // ---- WiFi presence discovery (UDP only — no TCP server here) ----
  useEffect(() => {
    let stop: (() => void) | null = null;
    try {
      stop = startWifiDiscovery(deviceName, wifiDeviceId, WIFI_TCP_PORT, (peer) => {
        setWifiPeers((prev) => mergeWifiPeer(prev, peer));
      });
    } catch {
      stop = null;
    }
    return () => {
      try {
        stop?.();
      } catch {}
    };
  }, [deviceName, wifiDeviceId]);

  const smoothedForName = useCallback((name: string): number | null => {
    let best: number | null = null;
    let bestAt = 0;
    for (const entry of filtersRef.current.values()) {
      if (!sameDeviceName(entry.name, name)) continue;
      const v = entry.filter.get();
      if (v !== null && entry.pushedAt >= bestAt) {
        best = v;
        bestAt = entry.pushedAt;
      }
    }
    return best;
  }, []);

  /**
   * Point-to-point first: try the open GATT link, fall back to a single-hop
   * broadcast ping only when no link exists. Either way the exchange stays
   * between the two phones — range envelopes never enter the flood bus.
   */
  const deliverRange = useCallback(
    async (envelope: BroadcastEnvelope, bleId: string | null) => {
      if (bleId) {
        try {
          if (await sendRangeUnicast(bleId, envelope)) return;
        } catch {}
      }
      try {
        await sendNearbyBroadcast(envelope);
      } catch {}
    },
    [],
  );

  // ---- ranging exchange: replies to seekers + answers to my tracking ----
  // Range-only bus (never the flood): only the two phones involved exchange.
  useEffect(
    () =>
      subscribeToRangePings((envelope) => {
        const ping = parseRangePing(envelope);
        if (!ping) return;
        const me = deviceNameRef.current;
        const t = Date.now();
        // Not for me at all.
        if (!sameDeviceName(ping.targetName, me)) return;

        // A reply to MY tracking session (session echo + seeker is my target).
        if (ping.sessionId === sessionIdRef.current) {
          const trackedName = trackedRef.current
            ? peersByKeyRef.current.get(trackedRef.current) ?? null
            : null;
          if (
            trackedName &&
            sameDeviceName(ping.seekerName, trackedName) &&
            !ping.bye
          ) {
            setPeerSeesMe({
              meters: rssiToMeters(ping.seekerRssi ?? null),
              at: t,
            });
          }
          return;
        }

        // Someone seeks ME.
        if (ping.bye) {
          setSoughtBy((current) =>
            current && current.sessionId === ping.sessionId ? null : current,
          );
          return;
        }
        const ignoredUntil = ignoredSeekersRef.current.get(
          ping.seekerName.toLowerCase(),
        );
        if (ignoredUntil !== undefined && t < ignoredUntil) return;
        const myRssi = smoothedForName(ping.seekerName);
        setSoughtBy({
          seekerName: ping.seekerName,
          sessionId: ping.sessionId,
          theirMeters: rssiToMeters(ping.seekerRssi ?? null),
          myMeters: rssiToMeters(myRssi),
          lastSeen: t,
        });
        // Throttled reply with my measurement of them (unicast-first).
        if (t - lastReplyAtRef.current < RANGE_REPLY_THROTTLE_MS) return;
        lastReplyAtRef.current = t;
        const seekerBleId =
          bleIdByNameRef.current.get(ping.seekerName.trim().toLowerCase()) ??
          null;
        void deliverRange(
          makeRangeEnvelope({
            senderName: me,
            language: langRef.current,
            range: {
              sessionId: ping.sessionId,
              targetName: ping.seekerName,
              seekerName: me,
              ...(myRssi !== null ? { seekerRssi: Math.round(myRssi) } : {}),
            },
          }),
          seekerBleId,
        );
      }),
    [smoothedForName, deliverRange],
  );

  // ---- unified, name-grouped peer list ----
  const peers: SearchPeer[] = useMemo(() => {
    const byKey = new Map<string, SearchPeer>();
    for (const peer of mesh.peers) {
      // Hide our own echoes (our other screens announce under our name too).
      // Same-named OTHER phones are hidden as well — rename to tell apart.
      if (sameDeviceName(peer.name, deviceName)) continue;
      const key = peer.name.trim().toLowerCase();
      let smoothed: number | null = null;
      let pushedAt: number | null = null;
      for (const entry of filtersRef.current.values()) {
        if (sameDeviceName(entry.name, peer.name)) {
          const v = entry.filter.get();
          if (v !== null && (pushedAt === null || entry.pushedAt >= pushedAt)) {
            smoothed = v;
            pushedAt = entry.pushedAt;
          }
        }
      }
      const txPower =
        typeof peer.txPower === 'number' && Number.isFinite(peer.txPower)
          ? peer.txPower
          : null;
      const meters =
        smoothed !== null
          ? rssiToMeters(smoothed, txPower ?? TX_POWER_DBM_AT_1M)
          : null;
      const stale =
        pushedAt === null || now - pushedAt > READING_STALE_AFTER_MS;
      const band = stale ? 'unknown' : distanceBand(meters);
      const row: SearchPeer = {
        key: `n:${key}`,
        name: peer.name,
        ble: {
          id: peer.id,
          rssi: stale ? null : smoothed,
          meters: stale ? null : meters,
          band,
          lastSeen: pushedAt,
          txPower,
        },
        lastSeen: pushedAt ?? 0,
      };
      const existing = byKey.get(row.key);
      if (existing) {
        existing.ble = row.ble;
        existing.lastSeen = Math.max(existing.lastSeen, row.lastSeen);
      } else {
        byKey.set(row.key, row);
      }
    }
    for (const wp of wifiPeers) {
      if (sameDeviceName(wp.name, deviceName)) continue;
      const key = `n:${wp.name.trim().toLowerCase()}`;
      const existing = byKey.get(key);
      const sighting: SearchWifiSighting = {
        address: wp.address,
        deviceId: wp.deviceId,
        lastSeen: wp.lastSeen,
      };
      if (existing) {
        existing.wifi = sighting;
        existing.lastSeen = Math.max(existing.lastSeen, wp.lastSeen);
      } else {
        byKey.set(key, {
          key,
          name: wp.name,
          wifi: sighting,
          lastSeen: wp.lastSeen,
        });
      }
    }
    const list = [...byKey.values()];
    list.sort((a, b) => {
      const aRanged = a.ble?.meters ?? null;
      const bRanged = b.ble?.meters ?? null;
      if (aRanged !== null && bRanged !== null) return aRanged - bRanged;
      if (aRanged !== null) return -1;
      if (bRanged !== null) return 1;
      return b.lastSeen - a.lastSeen;
    });
    return list;
  }, [mesh.peers, wifiPeers, deviceName, now]);

  useEffect(() => {
    peersByKeyRef.current = new Map(peers.map((p) => [p.key, p.name]));
    bleIdByKeyRef.current = new Map(
      peers.flatMap((p) => (p.ble ? [[p.key, p.ble.id] as const] : [])),
    );
    bleIdByNameRef.current = new Map(
      peers.flatMap((p) =>
        p.ble ? [[p.name.trim().toLowerCase(), p.ble.id] as const] : [],
      ),
    );
  }, [peers]);

  // Active RSSI reads for the tracked target. Scan-result RSSI can be
  // absent or sparse on some stacks — but the mesh auto-connects to nearby
  // app phones, and a connected link answers readRSSI on demand. Both
  // sources feed the same EWMA filters, so tracking works either way.
  useEffect(() => {
    if (!trackedKey) return;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      try {
        const bleId = bleIdByKeyRef.current.get(trackedKey);
        if (!bleId) return;
        if (!meshRef.current.connectedIds.includes(bleId)) return;
        const rssi = await readRSSI(bleId);
        if (cancelled) return;
        if (typeof rssi !== 'number' || !Number.isFinite(rssi)) return;
        const t = Date.now();
        const entry = filtersRef.current.get(bleId);
        if (entry) {
          entry.filter.push(rssi);
          entry.pushedAt = t;
        } else {
          const name = peersByKeyRef.current.get(trackedKey);
          if (!name) return;
          const filter = createRssiFilter();
          filter.push(rssi);
          filtersRef.current.set(bleId, { filter, name, pushedAt: t });
        }
      } catch {}
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [trackedKey]);

  // ---- tracking loops: discovery drive + ping transmit ----
  // Pings go unicast-first (one open link); broadcast only as fallback.
  useEffect(() => {
    if (!trackedKey) return;
    const name = peersByKeyRef.current.get(trackedKey);
    if (!name) return;
    const bleId = bleIdByKeyRef.current.get(trackedKey) ?? null;
    let cancelled = false;

    const sendPing = (bye: boolean) => {
      const rssi = smoothedForName(name);
      void deliverRange(
        makeRangeEnvelope({
          senderName: deviceNameRef.current,
          language: langRef.current,
          range: {
            sessionId: sessionIdRef.current,
            targetName: name,
            seekerName: deviceNameRef.current,
            ...(rssi !== null && !bye ? { seekerRssi: Math.round(rssi) } : {}),
            ...(bye ? { bye: true as const } : {}),
          },
        }),
        bleId,
      );
    };

    void requestMeshDiscovery().catch(() => {});
    sendPing(false);
    const discoveryTimer = setInterval(() => {
      if (!cancelled) void requestMeshDiscovery().catch(() => {});
    }, RANGE_DISCOVERY_INTERVAL_MS);
    const pingTimer = setInterval(() => {
      if (!cancelled) sendPing(false);
    }, RANGE_PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(discoveryTimer);
      clearInterval(pingTimer);
    };
  }, [trackedKey, smoothedForName, deliverRange]);

  const sendByeForKey = useCallback(
    (key: string) => {
      const name = peersByKeyRef.current.get(key);
      if (!name) return;
      const bleId = bleIdByKeyRef.current.get(key) ?? null;
      void deliverRange(
        makeRangeEnvelope({
          senderName: deviceNameRef.current,
          language: langRef.current,
          range: {
            sessionId: sessionIdRef.current,
            targetName: name,
            seekerName: deviceNameRef.current,
            bye: true,
          },
        }),
        bleId,
      );
    },
    [deliverRange],
  );

  const startTracking = useCallback((key: string) => {
    setPeerSeesMe(null);
    setTrackedKey(key);
  }, []);

  const stopTracking = useCallback(() => {
    const key = trackedRef.current;
    if (key) sendByeForKey(key);
    setTrackedKey(null);
    setPeerSeesMe(null);
  }, [sendByeForKey]);

  // Send the bye if the screen unmounts mid-track.
  useEffect(
    () => () => {
      const key = trackedRef.current;
      if (key) sendByeForKey(key);
    },
    [sendByeForKey],
  );

  const dismissSought = useCallback(() => {
    setSoughtBy((current) => {
      if (current) {
        // My silence expires their card; ignore re-pings for a minute so
        // Dismiss actually dismisses.
        ignoredSeekersRef.current.set(
          current.seekerName.toLowerCase(),
          Date.now() + 60000,
        );
      }
      return null;
    });
  }, []);

  const refresh = useCallback(() => {
    void requestMeshDiscovery().catch(() => {});
  }, []);

  const tracked: TrackedTarget | null = useMemo(() => {
    if (!trackedKey) return null;
    const peer = peers.find((p) => p.key === trackedKey);
    if (!peer) return null;
    return {
      key: peer.key,
      name: peer.name,
      band: peer.ble?.band ?? 'unknown',
      meters: peer.ble?.meters ?? null,
      rssi: peer.ble?.rssi ?? null,
      peerSeesMeMeters: peerSeesMe?.meters ?? null,
      peerSeesMeAt: peerSeesMe?.at ?? null,
    };
  }, [trackedKey, peers, peerSeesMe]);

  return {
    deviceName,
    isScanning: mesh.isScanning,
    isAdvertising: mesh.isAdvertising,
    connectedCount: mesh.connectedCount,
    peers,
    tracked,
    soughtBy,
    startTracking,
    stopTracking,
    dismissSought,
    refresh,
  };
}
