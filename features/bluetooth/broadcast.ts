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
  kind?: 'sos' | 'normal';
  /** Present only when kind === 'sos'. */
  sos?: SosMeta;
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
    const ttl =
      typeof candidate.ttl === 'number' && Number.isFinite(candidate.ttl)
        ? Math.max(0, Math.min(Math.floor(candidate.ttl), MESH_DEFAULT_TTL))
        : MESH_DEFAULT_TTL;
    const kind =
      candidate.kind === 'sos' || candidate.kind === 'normal'
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
    return { ...(candidate as BroadcastEnvelope), ttl, kind, sos };
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
