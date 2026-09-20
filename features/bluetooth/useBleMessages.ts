import { useCallback, useRef, useState } from 'react';
import {
  END_FRAME_RE,
  REASSEMBLY_TIMEOUT_MS,
  START_FRAME_RE,
  type ChatMessage,
} from './constants';
import { cleanDataPacket, hexToText } from './codec';
import {
  containsReplacementChar,
  decodeBroadcast,
  emitBroadcast,
  looksLikeBroadcastJson,
} from './broadcast';
import { BleIncomingTextTracker } from '../tts/bleTtsText';

export type StreamTts = {
  speakFullMessage: (text: string) => void;
  beginStream: () => void;
  pushText: (fresh: string) => void;
  endStream: () => void;
  /** Drop buffered-but-unspoken stream text without speaking it. */
  discardStream: () => void;
};

type ReassemblyState = {
  id: string | null;
  total: number;
  chunks: string[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Once the buffered text looks like broadcast JSON, stop feeding TTS. */
  suppressStream: boolean;
};

const emptyState = (): ReassemblyState => ({
  id: null,
  total: 0,
  chunks: [],
  timer: null,
  suppressStream: false,
});

/**
 * Incoming BLE text reassembly + streaming TTS feed.
 *
 * Reassembly is tracked PER SENDER (centralId/deviceId). The old code kept
 * a single global buffer, so when two mesh phones transmitted at overlapping
 * times their chunks interleaved into one corrupt message — heard/spoken as
 * gibberish. Keying buffers by sender keeps concurrent floods isolated.
 *
 * Broadcast envelopes are also kept out of streaming TTS: while chunks
 * arrive we peek at the decoded prefix, and once it looks like mesh JSON we
 * stop pushing partial text to speech. The full envelope is still emitted
 * (Alert + inbox + relay) on completion — just never spoken as raw JSON.
 */
export function useBleMessages(ttsRef: React.MutableRefObject<StreamTts>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const statesRef = useRef(new Map<string, ReassemblyState>());
  const trackersRef = useRef(new Map<string, BleIncomingTextTracker>());

  const addMessage = useCallback(
    (text: string, sender: 'me' | 'other') => {
      if (!text) return;
      setMessages((current) => [
        ...current,
        { id: Date.now().toString() + Math.random().toString(), text, sender },
      ]);
    },
    [setMessages],
  );

  const getState = useCallback((sender: string): ReassemblyState => {
    let state = statesRef.current.get(sender);
    if (!state) {
      state = emptyState();
      statesRef.current.set(sender, state);
    }
    return state;
  }, []);

  const getTracker = useCallback((sender: string): BleIncomingTextTracker => {
    let tracker = trackersRef.current.get(sender);
    if (!tracker) {
      tracker = new BleIncomingTextTracker();
      trackersRef.current.set(sender, tracker);
    }
    return tracker;
  }, []);

  const clearReassembly = useCallback((sender?: string) => {
    if (sender !== undefined) {
      const state = statesRef.current.get(sender);
      if (state?.timer) clearTimeout(state.timer);
      statesRef.current.delete(sender);
      trackersRef.current.delete(sender);
      return;
    }
    statesRef.current.forEach((state) => {
      if (state.timer) clearTimeout(state.timer);
    });
    statesRef.current.clear();
    trackersRef.current.clear();
  }, []);

  const handleCompletedText = useCallback(
    (text: string, opts?: { streamed?: boolean }) => {
      const streamed = opts?.streamed === true;
      const broadcast = decodeBroadcast(text);
      if (broadcast) {
        // Mesh broadcast (homepage flood): shared de-dup lives in
        // broadcast.ts. emitBroadcast shows the Alert via subscribers AND
        // triggers the one-time relay to other nearby phones. Duplicates
        // and our own looped-back echoes return false → stay silent.
        if (streamed) {
          // Never speak broadcast JSON: drop any fragments buffered for
          // TTS before detection instead of flushing them as a tail.
          try {
            ttsRef.current.discardStream();
          } catch {}
        }
        emitBroadcast(broadcast);
        return;
      }
      if (looksLikeBroadcastJson(text)) {
        // Starts with `{` but isn't a valid envelope → corrupt/truncated
        // broadcast. Drop silently instead of speaking raw JSON gibberish
        // as if it were a 1-to-1 chat line.
        console.warn('Dropping corrupt broadcast-like payload');
        if (streamed) {
          try {
            ttsRef.current.discardStream();
          } catch {}
        }
        return;
      }
      if (containsReplacementChar(text)) {
        console.warn('Dropping text with undecodable bytes');
        if (streamed) {
          try {
            ttsRef.current.discardStream();
          } catch {}
        }
        return;
      }

      addMessage(text, 'other');
      if (streamed) {
        // Already spoken incrementally while packets arrived (speakable
        // chunks during streaming + the tail flushed by endStream below).
        // Speaking the full text here as well repeats every received
        // message twice — the reported double-speech bug.
        ttsRef.current.endStream();
      } else {
        // Single-packet message: never streamed, so speak it once here.
        ttsRef.current.speakFullMessage(text);
      }
    },
    [addMessage, ttsRef],
  );

  const flushReassembly = useCallback(
    (sender: string) => {
      const state = statesRef.current.get(sender);
      if (!state?.id || state.chunks.length === 0) {
        clearReassembly(sender);
        return;
      }
      const joined = state.chunks.join('');
      const text = hexToText(joined);
      clearReassembly(sender);
      if (text) {
        // Chunked message: its text was already fed to streaming TTS while
        // packets arrived — handleCompletedText must NOT re-speak it.
        handleCompletedText(text, { streamed: true });
      } else {
        console.warn('Discarding undecodable chunked message');
        ttsRef.current.endStream();
      }
    },
    [clearReassembly, handleCompletedText, ttsRef],
  );

  const armReassemblyTimeout = useCallback(
    (sender: string) => {
      const state = getState(sender);
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(() => {
        console.warn('BLE reassembly timed out — flushing best effort');
        flushReassembly(sender);
      }, REASSEMBLY_TIMEOUT_MS);
    },
    [flushReassembly, getState],
  );

  const resetIncomingState = useCallback(() => {
    clearReassembly();
    ttsRef.current.endStream();
  }, [clearReassembly, ttsRef]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  const handleIncomingHex = useCallback(
    (hex: string | null | undefined, senderId?: string | null) => {
      if (hex == null) return;
      const sender = senderId?.trim() ? senderId.trim() : 'default';
      const text = hexToText(hex);

      if (text) {
        const startMatch = text.match(START_FRAME_RE);
        if (startMatch) {
          const [, id, totalStr] = startMatch;
          const total = parseInt(totalStr, 10);
          if (!Number.isFinite(total) || total <= 0 || total > 5000) {
            console.warn('Ignoring invalid START frame:', text);
            return;
          }
          clearReassembly(sender);
          statesRef.current.set(sender, {
            id,
            total,
            chunks: [],
            timer: null,
            suppressStream: false,
          });
          trackersRef.current.delete(sender);
          ttsRef.current.beginStream();
          armReassemblyTimeout(sender);
          return;
        }
        const endMatch = text.match(END_FRAME_RE);
        if (endMatch) {
          const [, id] = endMatch;
          if (statesRef.current.get(sender)?.id !== id) {
            console.warn('Ignoring END for unknown message:', id);
            return;
          }
          flushReassembly(sender);
          return;
        }
      }

      const state = statesRef.current.get(sender);
      if (state?.id) {
        const clean = cleanDataPacket(hex);
        if (!clean) {
          console.warn('Dropping corrupt data packet during reassembly');
          return;
        }
        state.chunks.push(clean);
        if (!state.suppressStream) {
          try {
            const joined = state.chunks.join('');
            const tracker = getTracker(sender);
            const fresh = tracker.pushJoinedHex(joined);
            // Peek at the full buffered decode: broadcast JSON must never
            // reach speech, even as partial fragments.
            if (looksLikeBroadcastJson(tracker.getSpokenText())) {
              state.suppressStream = true;
              // Drop anything buffered for TTS before detection so it is
              // never flushed as a spoken tail at END.
              try {
                ttsRef.current.discardStream();
              } catch {}
            } else if (fresh) {
              ttsRef.current.pushText(fresh);
            }
          } catch (e) {
            console.warn('Streaming TTS push failed:', e);
          }
        }
        armReassemblyTimeout(sender);
        if (state.chunks.length >= state.total) {
          flushReassembly(sender);
        }
        return;
      }

      if (text == null || text === '') return;
      handleCompletedText(text);
    },
    [
      armReassemblyTimeout,
      clearReassembly,
      flushReassembly,
      getTracker,
      handleCompletedText,
      ttsRef,
    ],
  );

  return {
    messages,
    setMessages,
    addMessage,
    clearMessages,
    handleIncomingHex,
    clearReassembly,
    flushReassembly,
    resetIncomingState,
  };
}
