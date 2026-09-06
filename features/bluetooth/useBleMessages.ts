import { useCallback, useRef, useState } from 'react';
import {
  END_FRAME_RE,
  REASSEMBLY_TIMEOUT_MS,
  START_FRAME_RE,
  type ChatMessage,
} from './constants';
import { cleanDataPacket, hexToText } from './codec';
import { BleIncomingTextTracker } from '../tts/bleTtsText';

export type StreamTts = {
  speakFullMessage: (text: string) => void;
  beginStream: () => void;
  pushText: (fresh: string) => void;
  endStream: () => void;
};

type ReassemblyState = {
  id: string | null;
  total: number;
  chunks: string[];
  timer: ReturnType<typeof setTimeout> | null;
};

const emptyState = (): ReassemblyState => ({
  id: null,
  total: 0,
  chunks: [],
  timer: null,
});

/**
 * Owns the chat message list + the chunked-message reassembly buffer.
 *
 * Every BLE notification / write event funnels through `handleIncomingHex`:
 * - Control frames (START/END) drive the buffer and are never shown.
 * - Data packets while reassembling are stored as RAW HEX (byte-exact) so
 *   multi-byte UTF-8 (Hindi, emoji) split across packets reassembles cleanly,
 *   while newly-completed text is pushed to streaming TTS immediately.
 * - Anything else is a complete single-packet message, decoded + spoken at once
 *   (backward compatible with peers that send short messages without framing).
 */
export function useBleMessages(ttsRef: React.MutableRefObject<StreamTts>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const reassemblyRef = useRef<ReassemblyState>(emptyState());
  const trackerRef = useRef(new BleIncomingTextTracker());

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

  const clearReassembly = useCallback(() => {
    const state = reassemblyRef.current;
    if (state.timer) clearTimeout(state.timer);
    reassemblyRef.current = emptyState();
  }, []);

  const flushReassembly = useCallback(() => {
    const state = reassemblyRef.current;
    if (!state.id || state.chunks.length === 0) {
      clearReassembly();
      return;
    }
    const joined = state.chunks.join('');
    const text = hexToText(joined);
    clearReassembly();
    // The full text arrived via packets — its speakable parts were already
    // pushed to streaming TTS as packets arrived; this flushes the tail.
    ttsRef.current.endStream();
    if (text) {
      addMessage(text, 'other');
    } else {
      console.warn('Discarding undecodable chunked message');
    }
  }, [addMessage, clearReassembly, ttsRef]);

  const armReassemblyTimeout = useCallback(() => {
    const state = reassemblyRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      console.warn('BLE reassembly timed out — flushing best effort');
      flushReassembly();
    }, REASSEMBLY_TIMEOUT_MS);
  }, [flushReassembly]);

  const resetIncomingState = useCallback(() => {
    clearReassembly();
    trackerRef.current.reset();
    // Finish any half-streamed utterance so its tail is still spoken.
    ttsRef.current.endStream();
  }, [clearReassembly, ttsRef]);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, [setMessages]);

  const handleIncomingHex = useCallback(
    (hex: string | null | undefined) => {
      if (hex == null) return;
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
          clearReassembly();
          reassemblyRef.current = { id, total, chunks: [], timer: null };
          // New streamed message: reset decode tracking and start a fresh
          // TTS utterance (flushes any orphaned tail from a lost END).
          trackerRef.current.reset();
          ttsRef.current.beginStream();
          armReassemblyTimeout();
          return;
        }
        const endMatch = text.match(END_FRAME_RE);
        if (endMatch) {
          const [, id] = endMatch;
          if (reassemblyRef.current.id !== id) {
            console.warn('Ignoring END for unknown message:', id);
            return;
          }
          flushReassembly();
          return;
        }
      }

      // Not a control frame.
      if (reassemblyRef.current.id) {
        const clean = cleanDataPacket(hex);
        if (!clean) {
          console.warn('Dropping corrupt data packet during reassembly');
          return;
        }
        reassemblyRef.current.chunks.push(clean);
        // Streaming TTS: decode everything received so far and speak only
        // the newly-completed characters (handles Hindi split across packets).
        try {
          const fresh = trackerRef.current.pushJoinedHex(
            reassemblyRef.current.chunks.join(''),
          );
          if (fresh) ttsRef.current.pushText(fresh);
        } catch (e) {
          console.warn('Streaming TTS push failed:', e);
        }
        armReassemblyTimeout();
        // Tolerate a lost END frame: if we already have everything, flush.
        if (
          reassemblyRef.current.chunks.length >= reassemblyRef.current.total
        ) {
          flushReassembly();
        }
        return;
      }

      if (text == null || text === '') return;
      addMessage(text, 'other');
      // Single-packet message — speak it in full (queued behind any speech).
      ttsRef.current.speakFullMessage(text);
    },
    [
      addMessage,
      armReassemblyTimeout,
      clearReassembly,
      flushReassembly,
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
