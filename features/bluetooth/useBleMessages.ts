import { useCallback, useRef, useState } from 'react';
import {
  END_FRAME_RE,
  REASSEMBLY_TIMEOUT_MS,
  START_FRAME_RE,
  type ChatMessage,
} from './constants';
import { cleanDataPacket, hexToText } from './codec';
import { decodeBroadcast, emitBroadcast } from './broadcast';
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

export function useBleMessages(ttsRef: React.MutableRefObject<StreamTts>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const reassemblyRef = useRef<ReassemblyState>(emptyState());
  const trackerRef = useRef(new BleIncomingTextTracker());
  const seenBroadcastIdsRef = useRef(new Set<string>());

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

  const handleCompletedText = useCallback(
    (text: string) => {
      const broadcast = decodeBroadcast(text);
      if (broadcast) {
        if (seenBroadcastIdsRef.current.has(broadcast.id)) return;
        seenBroadcastIdsRef.current.add(broadcast.id);
        emitBroadcast(broadcast);
        return;
      }

      addMessage(text, 'other');
      ttsRef.current.speakFullMessage(text);
    },
    [addMessage, ttsRef],
  );

  const flushReassembly = useCallback(() => {
    const state = reassemblyRef.current;
    if (!state.id || state.chunks.length === 0) {
      clearReassembly();
      return;
    }
    const joined = state.chunks.join('');
    const text = hexToText(joined);
    clearReassembly();
    ttsRef.current.endStream();
    if (text) {
      handleCompletedText(text);
    } else {
      console.warn('Discarding undecodable chunked message');
    }
  }, [clearReassembly, handleCompletedText, ttsRef]);

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

      if (reassemblyRef.current.id) {
        const clean = cleanDataPacket(hex);
        if (!clean) {
          console.warn('Dropping corrupt data packet during reassembly');
          return;
        }
        reassemblyRef.current.chunks.push(clean);
        try {
          const fresh = trackerRef.current.pushJoinedHex(
            reassemblyRef.current.chunks.join(''),
          );
          if (fresh) ttsRef.current.pushText(fresh);
        } catch (e) {
          console.warn('Streaming TTS push failed:', e);
        }
        armReassemblyTimeout();
        if (
          reassemblyRef.current.chunks.length >= reassemblyRef.current.total
        ) {
          flushReassembly();
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
