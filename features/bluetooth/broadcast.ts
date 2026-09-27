export const BROADCAST_MESSAGE_TYPE = 'broadcast' as const;

/** How many hops a mesh broadcast may travel (origin → relays). */
export const MESH_DEFAULT_TTL = 5;
/** How long the mesh waits for nearby devices per broadcast attempt. */
export const MESH_SCAN_WINDOW_MS = 10000;

export type SosMeta = {
  /** Epoch ms when the safety timer started. */
  startedAt: number;
  /** Epoch ms of the missed check-in deadline (auto SOS) or send time (manual). */
  deadlineAt: number;
  /** True when fired automatically by an expired timer, false when tapped manually. */
  isAuto: boolean;
  /** Optional free-text workspace label, e.g. "Night shift". */
  workspaceLabel?: string;
  /** Optional "lat,lon" + maps link already embedded in message; kept structured too. */
  lat?: number;
  lon?: number;
};

/**
 * Device-search proximity ping (Device Search Mode).
 *
 * Carried on the same flood mesh as chat/SOS so no new connection is needed:
 * the seeker pings ~every 2.5s while tracking a target, and the target's
 * phone replies with its own measurement — both sides show approximate
 * distance. Old app versions (no `range` support) display the benign
 * `message` text as a normal broadcast.
 */
export type RangeMeta = {
  /** Random per-screen-open id so replies match one tracking session. */
  sessionId: string;
  /** Display name of the phone being sought. */
  targetName: string;
  /** Display name of the seeker (author of this ping). */
  seekerName: string;
  /** Seeker's smoothed RSSI of the target, when it has one. */
  seekerRssi?: number;
  /** Final ping when tracking stops — peer clears its "being sought" card. */
  bye?: boolean;
};

export type BroadcastEnvelope = {
  type: typeof BROADCAST_MESSAGE_TYPE;
  id: string;
  senderName: string;
  message: string;
  language: string;
  /**
   * Remaining hops. Decremented on every relay; when it reaches 1 the
   * receiving phone shows the message but does NOT forward it further.
   * Older app versions omit this field — treat as MESH_DEFAULT_TTL.
   */
  ttl?: number;
  /**
   * Optional discriminator. Old app versions ignore it and still display
   * the message as a normal broadcast (forward compatible).
   */
  kind?: 'sos' | 'normal' | 'range';
  /** Present only when kind === 'sos'. */
  sos?: SosMeta;
  /** Present only when kind === 'range'. */
  range?: RangeMeta;
};

type BroadcastSender = (envelope: BroadcastEnvelope) => Promise<boolean>;

type BroadcastListener = (envelope: BroadcastEnvelope) => void;

type BroadcastRelay = (envelope: BroadcastEnvelope) => void;

let broadcastSender: BroadcastSender | null = null;
let broadcastRelay: BroadcastRelay | null = null;
const broadcastListeners = new Set<BroadcastListener>();
/**
 * Single shared de-dup set for the whole flood mesh.
 * Every id this phone has ORIGINATED or already DISPLAYED/RELAYED lives
 * here, so a message looping back over another path is dropped silently
 * instead of alerting twice or relaying forever.
 */
const seenBroadcastIds = new Set<string>();
/** Bound the de-dup set so long-lived runtimes don't grow without limit. */
const MAX_SEEN_BROADCAST_IDS = 1000;

function pruneSeenBroadcastIds(): void {
  if (seenBroadcastIds.size <= MAX_SEEN_BROADCAST_IDS) return;
  const overflow = seenBroadcastIds.size - MAX_SEEN_BROADCAST_IDS;
  const iterator = seenBroadcastIds.values();
  for (let i = 0; i < overflow; i++) {
    const next = iterator.next();
    if (next.done) break;
    seenBroadcastIds.delete(next.value);
  }
}

export function makeBroadcastId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeMeshEnvelope(input: {
  senderName: string;
  message: string;
  language: string;
}): BroadcastEnvelope {
  return {
    type: BROADCAST_MESSAGE_TYPE,
    id: makeBroadcastId(),
    senderName: input.senderName,
    message: input.message,
    language: input.language,
    ttl: MESH_DEFAULT_TTL,
    kind: 'normal',
  };
}

/** Prefix every SOS message carries so even old app versions visibly stand out. */
export const SOS_MESSAGE_PREFIX = '🆘 SOS';

export function makeSosEnvelope(input: {
  senderName: string;
  message: string;
  language: string;
  sos: SosMeta;
}): BroadcastEnvelope {
  return {
    type: BROADCAST_MESSAGE_TYPE,
    id: makeBroadcastId(),
    senderName: input.senderName,
    message: input.message,
    language: input.language,
    ttl: MESH_DEFAULT_TTL,
    kind: 'sos',
    sos: input.sos,
  };
}

/** True for structured SOS envelopes OR legacy prefix matches (old senders). */
export function isSosEnvelope(envelope: {
  kind?: string;
  message?: string;
}): boolean {
  if (!envelope) return false;
  if ((envelope as BroadcastEnvelope).kind === 'sos') return true;
  const msg = (envelope.message ?? '').trimStart();
  return msg.startsWith(SOS_MESSAGE_PREFIX) || msg.startsWith('🆘');
}

/**
 * True for device-search proximity pings. These must NEVER land in chat
 * inboxes, SOS inboxes, or TTS — every broadcast subscriber filters them
 * out first and only the search screen consumes them.
 */
export function isRangeEnvelope(envelope: { kind?: string }): boolean {
  if (!envelope) return false;
  return (envelope as BroadcastEnvelope).kind === 'range';
}

export function getEnvelopeTtl(envelope: { ttl?: number }): number {
  const ttl =
    typeof envelope?.ttl === 'number' && Number.isFinite(envelope.ttl)
      ? Math.floor(envelope.ttl)
      : MESH_DEFAULT_TTL;
  return Math.max(0, Math.min(ttl, MESH_DEFAULT_TTL));
}

/** Envelope to forward after consuming one hop. Null when TTL is exhausted. */
export function nextHopEnvelope(
  envelope: BroadcastEnvelope,
): BroadcastEnvelope | null {
  const ttl = getEnvelopeTtl(envelope);
  if (ttl <= 1) return null;
  return { ...envelope, ttl: ttl - 1 };
}

/**
 * Cheap prefix test for "this decoded text is (the start of) a mesh
 * broadcast envelope, not a 1-to-1 chat line".
 *
 * Used while packets are still streaming in: broadcast JSON must NEVER be
 * fed to streaming TTS (hearing `{"type":"broad…` spoken is the "gibberish"
 * bug). 1-to-1 chat is plain human text and essentially never starts with
 * `{`, so gating speech on this prefix is safe.
 */
export function looksLikeBroadcastJson(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return false;
  return (
    trimmed.includes('"broadcast"') ||
    trimmed.includes('"type"') ||
    trimmed.startsWith('{"type"')
  );
}

/** True when decoded text contains Unicode replacement chars (corrupt). */
export function containsReplacementChar(text: string): boolean {
  return text.includes('�');
}

export function hasSeenBroadcast(id: string): boolean {
  return seenBroadcastIds.has(id);
}

export function markBroadcastSeen(id: string): void {
  if (!id) return;
  seenBroadcastIds.add(id);
  pruneSeenBroadcastIds();
}

export function encodeBroadcast(envelope: BroadcastEnvelope): string {
  // Compact form: omit defaults the decoder already fills in (ttl=5,
  // kind='normal'). Saves ~25B (~1+ 20B packets) with zero wire break —
  // old builds ignore unknown/missing fields the same way.
  const out: Record<string, unknown> = {
    type: envelope.type,
    id: envelope.id,
    senderName: envelope.senderName,
    message: envelope.message,
    language: envelope.language,
  };
  if (
    typeof envelope.ttl === 'number' &&
    Number.isFinite(envelope.ttl) &&
    Math.floor(envelope.ttl) !== MESH_DEFAULT_TTL
  ) {
    out.ttl = Math.floor(envelope.ttl);
  }
  if (envelope.kind === 'sos' || envelope.kind === 'range') {
    out.kind = envelope.kind;
  }
  if (envelope.sos !== undefined) out.sos = envelope.sos;
  if (envelope.range !== undefined) out.range = envelope.range;
  return JSON.stringify(out);
}

export function decodeBroadcast(text: string): BroadcastEnvelope | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<BroadcastEnvelope>;
    if (
      candidate.type !== BROADCAST_MESSAGE_TYPE ||
      typeof candidate.id !== 'string' ||
      candidate.id.trim().length === 0 ||
      typeof candidate.senderName !== 'string' ||
      typeof candidate.message !== 'string' ||
      candidate.message.trim().length === 0 ||
      typeof candidate.language !== 'string'
    ) {
      return null;
    }
    const ttl =
      typeof candidate.ttl === 'number' && Number.isFinite(candidate.ttl)
        ? Math.max(0, Math.min(Math.floor(candidate.ttl), MESH_DEFAULT_TTL))
        : MESH_DEFAULT_TTL;
    const kind =
      candidate.kind === 'sos' ||
      candidate.kind === 'normal' ||
      candidate.kind === 'range'
        ? candidate.kind
        : undefined;
    // Preserve structured SOS meta when present; drop it when malformed so
    // one bad sender can't break the inbox. Prefix fallback in
    // isSosEnvelope() still catches unstructured SOS text.
    let sos: SosMeta | undefined;
    const rawSos = candidate.sos as Partial<SosMeta> | undefined;
    if (kind === 'sos' && rawSos && typeof rawSos === 'object') {
      const startedAt =
        typeof rawSos.startedAt === 'number' ? rawSos.startedAt : Date.now();
      const deadlineAt =
        typeof rawSos.deadlineAt === 'number' ? rawSos.deadlineAt : Date.now();
      sos = {
        startedAt,
        deadlineAt,
        isAuto: rawSos.isAuto !== false,
        workspaceLabel:
          typeof rawSos.workspaceLabel === 'string'
            ? rawSos.workspaceLabel.slice(0, 60)
            : undefined,
        lat: typeof rawSos.lat === 'number' ? rawSos.lat : undefined,
        lon: typeof rawSos.lon === 'number' ? rawSos.lon : undefined,
      };
    }
    // Preserve structured range meta when present; drop it when malformed so
    // one bad sender can't wedge the search screen.
    let range: RangeMeta | undefined;
    const rawRange = candidate.range as Partial<RangeMeta> | undefined;
    if (kind === 'range' && rawRange && typeof rawRange === 'object') {
      const sessionId =
        typeof rawRange.sessionId === 'string'
          ? rawRange.sessionId.slice(0, 16)
          : '';
      const targetName =
        typeof rawRange.targetName === 'string'
          ? rawRange.targetName.slice(0, 32)
          : '';
      const seekerName =
        typeof rawRange.seekerName === 'string'
          ? rawRange.seekerName.slice(0, 32)
          : '';
      if (sessionId && targetName && seekerName) {
        range = {
          sessionId,
          targetName,
          seekerName,
          ...(typeof rawRange.seekerRssi === 'number' &&
          Number.isFinite(rawRange.seekerRssi)
            ? {
                seekerRssi: Math.max(
                  -100,
                  Math.min(0, Math.round(rawRange.seekerRssi)),
                ),
              }
            : {}),
          ...(rawRange.bye === true ? { bye: true as const } : {}),
        };
      }
    }
    return { ...(candidate as BroadcastEnvelope), ttl, kind, sos, range };
  } catch {
    return null;
  }
}

export function registerBroadcastSender(sender: BroadcastSender): () => void {
  broadcastSender = sender;
  return () => {
    if (broadcastSender === sender) broadcastSender = null;
  };
}

export function sendNearbyBroadcast(
  envelope: BroadcastEnvelope,
): Promise<boolean> {
  // Mark OUR OWN id as seen BEFORE transmitting so that when our message
  // loops back via another phone's relay we recognise it and stay silent
  // instead of showing ourselves our own broadcast.
  if (envelope?.id) markBroadcastSeen(envelope.id);
  return broadcastSender?.(envelope) ?? Promise.resolve(false);
}

/**
 * Mesh relay hook. The mesh runtime registers a function that re-floods a
 * freshly received broadcast (with ttl-1) to all OTHER nearby phones.
 * `useBleMessages` invokes it exactly once per never-seen id.
 */
export function registerBroadcastRelay(relay: BroadcastRelay): () => void {
  broadcastRelay = relay;
  return () => {
    if (broadcastRelay === relay) broadcastRelay = null;
  };
}

export function subscribeToBroadcasts(listener: BroadcastListener): () => void {
  broadcastListeners.add(listener);
  return () => broadcastListeners.delete(listener);
}

/**
 * Called for every fully reassembled incoming broadcast packet.
 * Returns true when this is a NEW message (display + relay it),
 * false when it is a duplicate/own echo (drop silently).
 */
export function emitBroadcast(envelope: BroadcastEnvelope): boolean {
  if (!envelope?.id || seenBroadcastIds.has(envelope.id)) return false;
  seenBroadcastIds.add(envelope.id);
  pruneSeenBroadcastIds();
  broadcastListeners.forEach((listener) => {
    try {
      listener(envelope);
    } catch (error) {
      console.warn('[Broadcast] listener failed:', error);
    }
  });
  // Flood-mesh relay: every phone forwards a new message (with one hop
  // consumed) so phones beyond direct radio range still get it.
  const next = nextHopEnvelope(envelope);
  if (next && broadcastRelay) {
    try {
      broadcastRelay(next);
    } catch (error) {
      console.warn('[Broadcast] relay failed:', error);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Lightweight mesh status store (no React dependency).
// The mesh runtime publishes here; the homepage subscribes to render
// "N nearby • scanning…" without owning the BLE scanner itself.
// ---------------------------------------------------------------------------

export type MeshPeerInfo = {
  id: string;
  name: string;
  rssi?: number;
  /** Calibrated Tx power from the advertisement, when the sender provides it. */
  txPower?: number;
};

export type MeshStatus = {
  /** Advertising our presence so nearby phones can find us. */
  isAdvertising: boolean;
  /** Actively scanning / connecting for a flood round. */
  isScanning: boolean;
  /** App-device peers seen in the latest scan round. */
  peers: MeshPeerInfo[];
  /** Connected mesh links (central + peripheral sides combined). */
  connectedCount: number;
  /** BLE ids with an open central (GATT) link — for live readRSSI ranging. */
  connectedIds: string[];
  /** Last mesh broadcast result for the homepage hint line. */
  lastResult: string | null;
  /** Links confirmed delivered in the last flood round. */
  lastDelivered: number;
  /** Links attempted in the last flood round. */
  lastAttempted: number;
  /** Wall-clock ms spent scanning in the last flood round (P0 timing). */
  lastScanMs: number | null;
  /** Wall-clock ms spent transmitting in the last flood round (P0 timing). */
  lastTxMs: number | null;
  /** Total wall-clock ms for the last flood round (scan+settle+tx). */
  lastTotalMs: number | null;
};

type MeshStatusListener = (status: MeshStatus) => void;

let meshStatus: MeshStatus = {
  isAdvertising: false,
  isScanning: false,
  peers: [],
  connectedCount: 0,
  connectedIds: [],
  lastResult: null,
  lastDelivered: 0,
  lastAttempted: 0,
  lastScanMs: null,
  lastTxMs: null,
  lastTotalMs: null,
};

const meshStatusListeners = new Set<MeshStatusListener>();

export function getMeshStatus(): MeshStatus {
  return meshStatus;
}

export function subscribeToMeshStatus(
  listener: MeshStatusListener,
): () => void {
  meshStatusListeners.add(listener);
  return () => meshStatusListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// On-demand mesh discovery (homepage "Refresh").
// The mesh runtime registers a scan-only round (no transmit); the homepage
// nearby list calls `requestMeshDiscovery()` so users can SEE neighbours
// before broadcasting.
// ---------------------------------------------------------------------------

type MeshDiscoveryFn = () => Promise<number>;

let meshDiscoveryFn: MeshDiscoveryFn | null = null;

export function registerMeshDiscovery(fn: MeshDiscoveryFn): () => void {
  meshDiscoveryFn = fn;
  return () => {
    if (meshDiscoveryFn === fn) meshDiscoveryFn = null;
  };
}

/** Run a short scan-only round; resolves to the peer count found. */
export function requestMeshDiscovery(): Promise<number> {
  return meshDiscoveryFn?.() ?? Promise.resolve(0);
}

export function publishMeshStatus(patch: Partial<MeshStatus>): void {
  meshStatus = { ...meshStatus, ...patch };
  meshStatusListeners.forEach((listener) => {
    try {
      listener(meshStatus);
    } catch (error) {
      console.warn('[Mesh] status listener failed:', error);
    }
  });
}
