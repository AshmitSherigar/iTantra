export const BROADCAST_MESSAGE_TYPE = 'broadcast' as const;

/** How many hops a regular chat broadcast may travel (origin → relays). */
export const MESH_DEFAULT_TTL = 5;
/** How many hops an SOS broadcast may travel. Larger because in a disaster
 *  the mesh is sparse — each extra hop is ~30-50m of extra reach. */
export const MESH_SOS_TTL = 12;
/** TTL ceiling for SOS acknowledgements (rescue team → victim). */
export const MESH_SOS_ACK_TTL = 12;
/** How long the mesh waits for nearby devices per broadcast attempt. */
export const MESH_SCAN_WINDOW_MS = 10000;

export type MeshMessageKind = 'chat' | 'sos' | 'sos-ack';

export type SosSeverity = 'critical' | 'urgent';

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
   * Message kind. Optional for backward compat: envelopes from older app
   * versions have no `kind` and are treated as `'chat'`.
   * - 'chat': regular nearby broadcast (TTL 5)
   * - 'sos': survivor distress with GPS (TTL 12, relayed first)
   * - 'sos-ack': rescuer acknowledgement travelling back (TTL 12)
   */
  kind?: MeshMessageKind;
  /** Stable sender id (BLE MACs rotate — this survives address changes). */
  senderId?: string;
  /** Origin wall-clock time, epoch ms. Used to sort SOS lists + expire old. */
  createdAt?: number;
  /** GPS latitude in degrees, -90…90. Present on 'sos' when fix available. */
  lat?: number;
  /** GPS longitude in degrees, -180…180. Present on 'sos' when fix available. */
  lon?: number;
  /** GPS accuracy radius in metres, when known. */
  accuracy?: number;
  /** Sender battery 0…100, helps NDRF triage dying phones first. */
  battery?: number;
  /** People count with the sender, when known. */
  peopleCount?: number;
  /** SOS urgency. Defaults to 'critical'. */
  severity?: SosSeverity;
  /** For 'sos-ack': the SOS `id` being acknowledged. */
  ackFor?: string;
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
    kind: 'chat',
    createdAt: Date.now(),
  };
}

/** Kind of an envelope; missing `kind` (old app versions) means 'chat'. */
export function getEnvelopeKind(envelope: { kind?: unknown }): MeshMessageKind {
  const kind = (envelope as { kind?: unknown })?.kind;
  if (kind === 'sos' || kind === 'sos-ack') return kind;
  return 'chat';
}

export function isSosEnvelope(envelope: { kind?: unknown }): boolean {
  return getEnvelopeKind(envelope) === 'sos';
}

export function isSosAckEnvelope(envelope: { kind?: unknown }): boolean {
  return getEnvelopeKind(envelope) === 'sos-ack';
}

/** TTL ceiling for a kind: chat travels short, SOS/ACK travel far. */
export function maxTtlForKind(kind: MeshMessageKind): number {
  if (kind === 'sos') return MESH_SOS_TTL;
  if (kind === 'sos-ack') return MESH_SOS_ACK_TTL;
  return MESH_DEFAULT_TTL;
}

/** Lower number = transmit/relay first. SOS always beats chat. */
export function meshPriority(envelope: { kind?: unknown }): number {
  const kind = getEnvelopeKind(envelope);
  if (kind === 'sos') return 0;
  if (kind === 'sos-ack') return 1;
  return 2;
}

/** Sort a batch so SOS goes out before ACKs, ACKs before chat. Stable. */
export function sortByMeshPriority<T extends { kind?: unknown }>(
  envelopes: T[],
): T[] {
  return [...envelopes].sort((a, b) => meshPriority(a) - meshPriority(b));
}

export function getEnvelopeTtl(envelope: {
  ttl?: number;
  kind?: unknown;
}): number {
  const ceiling = maxTtlForKind(getEnvelopeKind(envelope));
  const ttl =
    typeof envelope?.ttl === 'number' && Number.isFinite(envelope.ttl)
      ? Math.floor(envelope.ttl)
      : ceiling;
  return Math.max(0, Math.min(ttl, ceiling));
}

/** Hops already consumed, kind-aware (a relayed SOS and chat differ in max). */
export function envelopeHopsUsed(envelope: {
  ttl?: number;
  kind?: unknown;
}): number {
  return Math.max(
    0,
    maxTtlForKind(getEnvelopeKind(envelope)) - getEnvelopeTtl(envelope),
  );
}

export type MakeSosInput = {
  senderName: string;
  /** Voice-transcribed or typed distress text. May be empty if GPS only. */
  message: string;
  language: string;
  senderId?: string;
  lat?: number;
  lon?: number;
  accuracy?: number;
  battery?: number;
  peopleCount?: number;
  severity?: SosSeverity;
};

/**
 * Build an SOS envelope. GPS is optional (may be unavailable in rubble) —
 * the envelope is still valid with text only. Callers should pass whatever
 * fix they have; NDRF triages GPS-tagged first via `hasSosLocation`.
 */
export function makeSosEnvelope(input: MakeSosInput): BroadcastEnvelope {
  return {
    type: BROADCAST_MESSAGE_TYPE,
    id: makeBroadcastId(),
    senderName: input.senderName,
    message: input.message,
    language: input.language,
    ttl: MESH_SOS_TTL,
    kind: 'sos',
    senderId: input.senderId?.trim() || undefined,
    createdAt: Date.now(),
    lat: input.lat,
    lon: input.lon,
    accuracy: input.accuracy,
    battery: input.battery,
    peopleCount: input.peopleCount,
    severity: input.severity ?? 'critical',
  };
}

/** Build an NDRF acknowledgement travelling back toward the victim. */
export function makeSosAckEnvelope(input: {
  senderName: string;
  ackFor: string;
  message?: string;
  language?: string;
  senderId?: string;
}): BroadcastEnvelope {
  return {
    type: BROADCAST_MESSAGE_TYPE,
    id: makeBroadcastId(),
    senderName: input.senderName,
    message:
      input.message?.trim() || 'Rescue team notified. Stay where you are.',
    language: input.language ?? 'en',
    ttl: MESH_SOS_ACK_TTL,
    kind: 'sos-ack',
    senderId: input.senderId?.trim() || undefined,
    createdAt: Date.now(),
    ackFor: input.ackFor,
  };
}

/** True when an SOS carries a usable GPS fix. */
export function hasSosLocation(envelope: {
  kind?: unknown;
  lat?: unknown;
  lon?: unknown;
}): boolean {
  if (!isSosEnvelope(envelope)) return false;
  const { lat, lon } = envelope as { lat?: unknown; lon?: unknown };
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

/** Age of the SOS in ms; null when `createdAt` is missing/invalid. */
export function sosAgeMs(
  envelope: { createdAt?: unknown },
  now: number = Date.now(),
): number | null {
  const createdAt = (envelope as { createdAt?: unknown })?.createdAt;
  if (
    typeof createdAt !== 'number' ||
    !Number.isFinite(createdAt) ||
    createdAt <= 0
  )
    return null;
  return Math.max(0, now - createdAt);
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
  if (id) seenBroadcastIds.add(id);
}

export function encodeBroadcast(envelope: BroadcastEnvelope): string {
  return JSON.stringify(envelope);
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
    // Kind: unknown strings fall back to 'chat' so old/new versions interop.
    const rawKind = (candidate as { kind?: unknown }).kind;
    const kind: MeshMessageKind =
      rawKind === 'sos' || rawKind === 'sos-ack' ? rawKind : 'chat';
    const ceiling = maxTtlForKind(kind);
    const ttl =
      typeof candidate.ttl === 'number' && Number.isFinite(candidate.ttl)
        ? Math.max(0, Math.min(Math.floor(candidate.ttl), ceiling))
        : ceiling;
    const out: BroadcastEnvelope = {
      ...(candidate as BroadcastEnvelope),
      kind,
      ttl,
    };

    // Optional SOS fields: keep only when valid, drop silently otherwise so
    // one corrupt field never kills the whole distress message.
    if (typeof candidate.senderId === 'string' && candidate.senderId.trim()) {
      out.senderId = candidate.senderId.trim().slice(0, 64);
    } else {
      delete out.senderId;
    }
    if (
      typeof candidate.createdAt === 'number' &&
      Number.isFinite(candidate.createdAt) &&
      candidate.createdAt > 0
    ) {
      out.createdAt = Math.floor(candidate.createdAt);
    } else if (kind !== 'chat') {
      out.createdAt = Date.now();
    } else {
      delete out.createdAt;
    }
    const lat = candidate.lat;
    const lon = candidate.lon;
    if (
      typeof lat === 'number' &&
      typeof lon === 'number' &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180
    ) {
      out.lat = lat;
      out.lon = lon;
    } else {
      delete out.lat;
      delete out.lon;
    }
    if (
      typeof candidate.accuracy === 'number' &&
      Number.isFinite(candidate.accuracy) &&
      candidate.accuracy > 0
    ) {
      out.accuracy = candidate.accuracy;
    } else {
      delete out.accuracy;
    }
    if (
      typeof candidate.battery === 'number' &&
      Number.isFinite(candidate.battery)
    ) {
      out.battery = Math.max(0, Math.min(100, Math.round(candidate.battery)));
    } else {
      delete out.battery;
    }
    if (
      typeof candidate.peopleCount === 'number' &&
      Number.isFinite(candidate.peopleCount) &&
      candidate.peopleCount > 0
    ) {
      out.peopleCount = Math.min(999, Math.floor(candidate.peopleCount));
    } else {
      delete out.peopleCount;
    }
    out.severity =
      candidate.severity === 'urgent'
        ? 'urgent'
        : kind === 'sos'
          ? 'critical'
          : undefined;
    if (kind !== 'sos') delete (out as { severity?: unknown }).severity;
    if (
      kind === 'sos-ack' &&
      typeof candidate.ackFor === 'string' &&
      candidate.ackFor.trim()
    ) {
      out.ackFor = candidate.ackFor.trim().slice(0, 64);
    } else {
      delete out.ackFor;
    }
    if (kind === 'chat') {
      delete out.senderId;
      delete out.lat;
      delete out.lon;
      delete out.accuracy;
      delete out.battery;
      delete out.peopleCount;
      delete out.ackFor;
    }
    return out;
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
  /** Last mesh broadcast result for the homepage hint line. */
  lastResult: string | null;
  /** Links confirmed delivered in the last flood round. */
  lastDelivered: number;
  /** Links attempted in the last flood round. */
  lastAttempted: number;
};

type MeshStatusListener = (status: MeshStatus) => void;

let meshStatus: MeshStatus = {
  isAdvertising: false,
  isScanning: false,
  peers: [],
  connectedCount: 0,
  lastResult: null,
  lastDelivered: 0,
  lastAttempted: 0,
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
