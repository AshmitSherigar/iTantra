import { useCallback, useEffect, useRef, useState } from 'react';
import { getPendingSos, removePendingSos } from '../bluetooth';
import { sendDistressSos } from './sendSos';
import { type SosFix } from './sosLocation';

export type SosPhase = 'idle' | 'locating' | 'sending' | 'active';

const FALLBACK_MESSAGE = 'SOS! I need help. I am trapped.';

/**
 * Survivor-side SOS sender (homepage SOS button).
 *
 * Flow: locating (GPS, best-effort) → sending (mesh flood) → active
 * (queued for re-flood + carried by receivers until an sos-ack resolves it).
 *
 * Cancelling stops THIS phone's future re-floods only — copies already
 * relayed to other phones can't be recalled, and the hook says so.
 */
export function useSosSender(languageId: string) {
  const [phase, setPhase] = useState<SosPhase>('idle');
  const [fix, setFix] = useState<SosFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeSosId, setActiveSosId] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    // Resume "active" display if an SOS from an earlier session is still
    // queued (app was killed, SOS still on disk).
    void (async () => {
      try {
        const pending = await getPendingSos();
        const mine = pending.find((e) => e.kind === 'sos');
        if (mine && mountedRef.current) {
          setActiveSosId(mine.id);
          setPhase('active');
          if (typeof mine.lat === 'number' && typeof mine.lon === 'number') {
            setFix({
              lat: mine.lat,
              lon: mine.lon,
              accuracy: mine.accuracy,
            });
          }
        }
      } catch {}
    })();
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sendSos = useCallback(
    async (voiceText: string): Promise<boolean> => {
      if (phase === 'locating' || phase === 'sending') return false;
      setError(null);
      setPhase('locating');
      const message = voiceText.trim() || FALLBACK_MESSAGE;
      try {
        // GPS happens inside (best-effort, never blocks); the mesh runtime
        // floods now AND queues for retry/carry; an sos-ack resolves it.
        const { sent, envelope, fix } = await sendDistressSos({
          message,
          language: languageId,
          onFix: (gps) => {
            if (mountedRef.current) {
              setFix(gps);
              setPhase('sending');
            }
          },
        });
        if (!mountedRef.current) return sent;
        setFix(fix);
        if (!mountedRef.current) return sent;
        setActiveSosId(envelope.id);
        setPhase('active');
        return sent;
      } catch {
        if (mountedRef.current) {
          setError('SOS failed. Check Bluetooth and try again.');
          setPhase('idle');
        }
        return false;
      }
    },
    [languageId, phase],
  );

  const cancelSos = useCallback(async (): Promise<void> => {
    const id = activeSosId;
    if (mountedRef.current) {
      setActiveSosId(null);
      setPhase('idle');
      setFix(null);
    }
    // Stops future re-floods from THIS phone. Copies already carried by
    // other phones keep travelling until they expire (24h) — they can't be
    // recalled, which is the honest disaster trade-off.
    if (id) {
      try {
        await removePendingSos(id);
      } catch {}
    }
  }, [activeSosId]);

  return {
    phase,
    fix,
    error,
    activeSosId,
    sendSos,
    cancelSos,
  };
}
