import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  decodeBroadcast,
  encodeBroadcast,
  sortByMeshPriority,
  type BroadcastEnvelope,
} from './broadcast';

/**
 * SOS store-and-forward queue (protocol persistence, no UI).
 *
 * Why this exists: in a disaster the victim is often ALONE — no phone in
 * radio range at the moment they tap SOS. Without persistence that SOS dies
 * silently. With this queue the SOS is saved to disk and the mesh runtime
 * re-floods it whenever new peers appear, until an `sos-ack` arrives or the
 * entry expires.
 *
 * Both the ORIGIN and every RELAY carry: receivers persist incoming SOS/ACK
 * via the runtime subscriber, so the message keeps travelling across time
 * gaps even after the origin is gone. Same message ID everywhere → phones
 * that already saw it dedup silently, new phones display it.
 */

const PENDING_SOS_KEY = 'vaanisetu.pending_sos.v1';
/** Upper bound so a pocket-dial loop can't fill disk. */
export const MAX_PENDING_SOS = 20;
/** Drop queued SOS older than this (stale location harms triage). */
export const PENDING_SOS_TTL_MS = 24 * 60 * 60 * 1000;

async function readQueue(): Promise<BroadcastEnvelope[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SOS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: BroadcastEnvelope[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      try {
        const decoded = decodeBroadcast(JSON.stringify(item));
        if (decoded) {
          out.push(decoded);
        }
      } catch {
        // Skip one corrupt entry, keep the rest.
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function writeQueue(queue: BroadcastEnvelope[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      PENDING_SOS_KEY,
      JSON.stringify(sortByMeshPriority(queue).slice(0, MAX_PENDING_SOS)),
    );
  } catch {
    // Disk full / unavailable — the in-memory flood still goes out; the
    // retry-on-next-peer round is just skipped.
  }
}

function isExpired(envelope: BroadcastEnvelope, now: number): boolean {
  const createdAt =
    typeof envelope.createdAt === 'number' ? envelope.createdAt : now;
  return now - createdAt > PENDING_SOS_TTL_MS;
}

/**
 * Queue an envelope for repeat flooding. De-dupes by id, SOS-first order.
 * Callers decide what belongs here: SOS is always queued (until ACK), chat
 * only when its flood round delivered to zero links.
 */
export async function queuePendingSos(
  envelope: BroadcastEnvelope,
): Promise<BroadcastEnvelope[]> {
  if (!envelope?.id) return getPendingSos();
  const queue = await readQueue();
  if (!queue.some((e) => e.id === envelope.id)) {
    queue.push(envelope);
  }
  const now = Date.now();
  const fresh = queue.filter((e) => !isExpired(e, now));
  await writeQueue(fresh);
  return fresh;
}

/** Pending envelopes (SOS/ACK/chat retries), SOS-first, expired pruned. */
export async function getPendingSos(): Promise<BroadcastEnvelope[]> {
  const queue = await readQueue();
  const now = Date.now();
  const fresh = queue.filter((e) => !isExpired(e, now));
  if (fresh.length !== queue.length) {
    await writeQueue(fresh);
  }
  return sortByMeshPriority(fresh);
}

/** Remove one entry (delivered, or ACK received for it). */
export async function removePendingSos(
  id: string,
): Promise<BroadcastEnvelope[]> {
  if (!id) return getPendingSos();
  const queue = await readQueue();
  const next = queue.filter((e) => e.id !== id);
  await writeQueue(next);
  return next;
}

/**
 * An incoming `sos-ack` resolves the matching queued SOS: drop the SOS so
 * the phone stops re-flooding "help me" after rescue is confirmed.
 * Returns the id that was resolved, if any.
 */
export async function resolvePendingSosWithAck(
  ack: BroadcastEnvelope,
): Promise<string | null> {
  const ackFor =
    typeof ack.ackFor === 'string' && ack.ackFor.trim()
      ? ack.ackFor.trim()
      : null;
  if (!ackFor) return null;
  const queue = await readQueue();
  if (!queue.some((e) => e.id === ackFor)) return null;
  await writeQueue(queue.filter((e) => e.id !== ackFor));
  return ackFor;
}

/** Re-encode queue for a flood round (SOS first, fresh TTL each attempt). */
export function pendingSosPayloads(
  queue: BroadcastEnvelope[],
): { envelope: BroadcastEnvelope; payload: string }[] {
  const now = Date.now();
  return sortByMeshPriority(queue)
    .filter((e) => !isExpired(e, now))
    .map((envelope) => ({
      envelope,
      payload: encodeBroadcast(envelope),
    }));
}
