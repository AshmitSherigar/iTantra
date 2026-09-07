export const BROADCAST_MESSAGE_TYPE = 'broadcast' as const;

export type BroadcastEnvelope = {
  type: typeof BROADCAST_MESSAGE_TYPE;
  id: string;
  senderName: string;
  message: string;
  language: string;
};

type BroadcastSender = (
  envelope: BroadcastEnvelope,
) => Promise<boolean>;

type BroadcastListener = (envelope: BroadcastEnvelope) => void;

let broadcastSender: BroadcastSender | null = null;
const broadcastListeners = new Set<BroadcastListener>();
const emittedBroadcastIds = new Set<string>();

export function makeBroadcastId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
    return candidate as BroadcastEnvelope;
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
  return broadcastSender?.(envelope) ?? Promise.resolve(false);
}

export function subscribeToBroadcasts(listener: BroadcastListener): () => void {
  broadcastListeners.add(listener);
  return () => broadcastListeners.delete(listener);
}

export function emitBroadcast(envelope: BroadcastEnvelope): void {
  if (emittedBroadcastIds.has(envelope.id)) return;
  emittedBroadcastIds.add(envelope.id);
  broadcastListeners.forEach((listener) => listener(envelope));
}