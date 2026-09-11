import * as Device from 'expo-device';
import {
  makeSosEnvelope,
  sendNearbyBroadcast,
  type BroadcastEnvelope,
} from '../bluetooth';
import { getOrCreateSenderId } from './senderId';
import { getSosFix, type SosFix } from './sosLocation';

export type DistressSosResult = {
  sent: boolean;
  envelope: BroadcastEnvelope;
  fix: SosFix | null;
};

/**
 * Build + flood one distress SOS (mesh runtime queues + carries it, an
 * sos-ack later resolves it). Shared by the manual SOS button and the
 * keyword-trigger auto-send so both paths behave identically.
 */
export async function sendDistressSos(input: {
  message: string;
  language: string;
  /** Fired once the (best-effort) GPS step finishes, before flooding. */
  onFix?: (fix: SosFix | null) => void;
}): Promise<DistressSosResult> {
  const senderName =
    Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu';
  const [fix, senderId] = await Promise.all([
    getSosFix(),
    getOrCreateSenderId(),
  ]);
  try {
    input.onFix?.(fix);
  } catch {}
  const envelope = makeSosEnvelope({
    senderName,
    message: input.message.trim(),
    language: input.language,
    senderId,
    lat: fix?.lat,
    lon: fix?.lon,
    accuracy: fix?.accuracy,
  });
  const sent = await sendNearbyBroadcast(envelope);
  return { sent, envelope, fix };
}
