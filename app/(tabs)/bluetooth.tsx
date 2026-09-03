import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Device from 'expo-device';

import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { useAutoSpeak } from '../../features/tts/useAutoSpeak';
import { BleIncomingTextTracker } from '../../features/tts/bleTtsText';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Buffer } from 'buffer';

import {
  requestBluetoothPermission,
  isBluetoothEnabled,
  setServices,
  startAdvertising,
  stopAdvertising,
  startScan,
  stopScan,
  addDeviceFoundListener,
  addEventListener,
  connect,
  disconnect,
  discoverServices,
  subscribeToCharacteristic,
  writeCharacteristic,
  updateCharacteristicValue,
  requestMTU,
} from 'react-native-bluetooth-ble';

import { useTheme } from '../../context/ThemeContext';
import { FontSize, Radius, Spacing } from '../../constants/theme';

const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';
const RX_CHARACTERISTIC_UUID = '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';
const TX_CHARACTERISTIC_UUID = '8b3e8c1f-5d42-4f77-a91d-6c3e2b8a5f19';

/**
 * BLE ATT default MTU is 23 bytes -> 20 bytes of usable payload.
 * Anything larger sent in a single write/notify gets truncated or
 * fails silently (iOS `updateValue` returns false, Android truncates),
 * which is why long / multi-byte (Hindi, emoji) messages arrived garbled.
 * We therefore always fragment into 20-byte packets and reassemble.
 */
const MAX_BYTES_PER_PACKET = 20;
const MAX_HEX_PER_PACKET = MAX_BYTES_PER_PACKET * 2; // 40 hex chars
const CHUNK_DELAY_MS = 30;
const REASSEMBLY_TIMEOUT_MS = 15000;

// Control frames use a Unit Separator prefix so normal typed / transcribed
// text can never collide with them.
const START_FRAME_RE = /^\u001FBLK:S:([0-9a-f]{4}):(\d+)\u001F$/;
const END_FRAME_RE = /^\u001FBLK:E:([0-9a-f]{4})\u001F$/;
const makeFrameId = () =>
  Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, '0');
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'other';
};

export default function BluetoothScreen() {
  const { colors } = useTheme();

  const [devices, setDevices] = useState<any[]>([]);
  const [connectedDeviceId, setConnectedDeviceId] = useState<string | null>(null);
  const [peripheralCentralId, setPeripheralCentralId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [bluetoothReady, setBluetoothReady] = useState(false);
  // User-visible BLE name. Prefilled from the OS device name so peers see a
  // real name ("Rahul's Pixel") instead of the same "Bluetooth Chat" for all.
  const [displayName, setDisplayName] = useState('');
  const [advertisedName, setAdvertisedName] = useState<string | null>(null);
  const [btError, setBtError] = useState<string | null>(null);
  const [isStartingBt, setIsStartingBt] = useState(false);
  const advertisedNameRef = useRef<string | null>(null);
  const startingRef = useRef(false);

  const {
    isRecording: isVoiceRecording,
    isTranscribing,
    partialText,
    error: voiceError,
    startVoice,
    stopVoice,
  } = useVoiceMessage();

  // Auto-speak incoming messages via streaming Hindi TTS.
  const {
    enabled: ttsEnabled,
    setEnabled: setTtsEnabled,
    isReady: ttsReady,
    isSpeaking: ttsSpeaking,
    stop: stopTts,
    speakFullMessage,
    beginStream: ttsBeginStream,
    pushStreamText: ttsPushText,
    endStream: ttsEndStream,
  } = useAutoSpeak(true);

  // Latest TTS callbacks for use inside BLE event listeners (which are
  // registered once per connection and would otherwise capture stale closures).
  const ttsRef = useRef({
    speakFullMessage,
    beginStream: ttsBeginStream,
    pushText: ttsPushText,
    endStream: ttsEndStream,
  });
  useEffect(() => {
    ttsRef.current = {
      speakFullMessage,
      beginStream: ttsBeginStream,
      pushText: ttsPushText,
      endStream: ttsEndStream,
    };
  }, [speakFullMessage, ttsBeginStream, ttsPushText, ttsEndStream]);

  // Tracks decode progress of the in-flight chunked message so each newly
  // completed slice of text is pushed to streaming TTS exactly once —
  // speech starts while later BLE packets are still arriving.
  const incomingTextTrackerRef = useRef(new BleIncomingTextTracker());

  const removeDeviceListenerRef = useRef<(() => void) | undefined>(undefined);
  const removeCentralValueListenerRef = useRef<(() => void) | undefined>(undefined);
  const removePeripheralWriteListenerRef = useRef<(() => void) | undefined>(undefined);
  const removePeripheralSubscribedListenerRef = useRef<(() => void) | undefined>(undefined);
  const removePeripheralUnsubscribedListenerRef = useRef<(() => void) | undefined>(undefined);

  // Reassembly buffer for chunked incoming messages. Only one peer sends to
  // us at a time (TX notifies as central, RX writes as peripheral), so a
  // single buffer is sufficient.
  const reassemblyRef = useRef<{
    id: string | null;
    total: number;
    chunks: string[];
    timer: ReturnType<typeof setTimeout> | null;
  }>({ id: null, total: 0, chunks: [], timer: null });

  // Prefill an editable real device name (OS name -> model -> fallback).
  useEffect(() => {
    const fallback =
      Device.deviceName?.trim() ||
      Device.modelName?.trim() ||
      (Platform.OS === 'ios' ? 'iPhone' : 'Android Phone');
    setDisplayName((prev) => prev || fallback.slice(0, 20));
  }, []);

  useEffect(() => {
    return () => {
      removeDeviceListenerRef.current?.();
      removeCentralValueListenerRef.current?.();
      removePeripheralWriteListenerRef.current?.();
      removePeripheralSubscribedListenerRef.current?.();
      removePeripheralUnsubscribedListenerRef.current?.();
      const state = reassemblyRef.current;
      if (state.timer) clearTimeout(state.timer);
      try {
        stopScan();
      } catch {}
      try {
        stopAdvertising();
      } catch {}
    };
  }, []);

  const stopScanning = async () => {
    try {
      await stopScan();
    } catch (error) {
      console.log('Stop scan error:', error);
    }

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    setIsScanning(false);
    console.log('Scan stopped');
  };

  // BLE advertising payload is ~31 bytes. With a 128-bit service UUID there
  // is only room for a short local name — longer names get truncated by
  // the OS (especially iOS), so cap what we advertise.
  const MAX_ADVERTISED_NAME_LEN = 18;
  const getNameToAdvertise = (raw?: string): string => {
    const base =
      (raw ?? displayName).trim() ||
      Device.deviceName?.trim() ||
      Device.modelName?.trim() ||
      'Phone';
    return base.slice(0, MAX_ADVERTISED_NAME_LEN);
  };

  const getDeviceDisplayName = (device: any): string => {
    const candidates = [
      device?.name,
      device?.localName,
      device?.advertisingData?.completeLocalName,
      device?.advertisingData?.shortenedLocalName,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (
          trimmed.length > 0 &&
          trimmed.toLowerCase() !== 'unknown' &&
          trimmed.toLowerCase() !== 'null' &&
          trimmed.toLowerCase() !== 'undefined'
        ) {
          return trimmed;
        }
      }
    }
    return 'Bluetooth Device';
  };

  const mergeScannedDevice = (prev: any, next: any) => {
    // Prefer non-empty name fields so a later scan-response packet carrying
    // the local name upgrades an earlier nameless discovery of the same id.
    const merged: any = { ...prev, ...next };
    for (const key of ['name', 'localName'] as const) {
      const prevVal = typeof prev?.[key] === 'string' ? prev[key].trim() : '';
      const nextVal = typeof next?.[key] === 'string' ? next[key].trim() : '';
      merged[key] = nextVal || prevVal || undefined;
    }
    const prevAdv = prev?.advertisingData ?? {};
    const nextAdv = next?.advertisingData ?? {};
    merged.advertisingData = { ...prevAdv, ...nextAdv };
    for (const key of ['completeLocalName', 'shortenedLocalName'] as const) {
      const prevVal = typeof prevAdv?.[key] === 'string' ? prevAdv[key].trim() : '';
      const nextVal = typeof nextAdv?.[key] === 'string' ? nextAdv[key].trim() : '';
      if (nextVal) merged.advertisingData[key] = nextVal;
      else if (prevVal) merged.advertisingData[key] = prevVal;
    }
    if (next?.rssi !== undefined) merged.rssi = next.rssi;
    if (next?.serviceUUIDs !== undefined) merged.serviceUUIDs = next.serviceUUIDs;
    return merged;
  };

  const scanForDevices = async () => {
    if (isScanning) return;
    if (connectedDeviceId || peripheralCentralId) {
      console.log('Already connected');
      return;
    }

    setDevices([]);

    if (removeDeviceListenerRef.current) {
      removeDeviceListenerRef.current();
      removeDeviceListenerRef.current = undefined;
    }

    removeDeviceListenerRef.current = addDeviceFoundListener((device) => {
      console.log('Device found:', JSON.stringify(device));
      setDevices((currentDevices) => {
        const byId = currentDevices.findIndex((d) => d.id === device.id);
        if (byId !== -1) {
          // allowDuplicates delivers the same id again, often with the local
          // name filled in on the second callback — merge instead of dropping.
          const updated = [...currentDevices];
          updated[byId] = mergeScannedDevice(currentDevices[byId], device);
          return updated;
        }
        // BLE privacy: Android/iOS rotate the advertised MAC/UUID, so tapping
        // "Start Bluetooth" again on the peer shows up as a NEW id with the
        // SAME name. Collapse those instead of listing the phone N times.
        const incomingName = getDeviceDisplayName(device);
        if (incomingName !== 'Bluetooth Device') {
          const byName = currentDevices.findIndex(
            (d) => getDeviceDisplayName(d) === incomingName,
          );
          if (byName !== -1) {
            console.log(
              `Address rotated for "${incomingName}": ${currentDevices[byName].id} -> ${device.id}`,
            );
            const updated = [...currentDevices];
            updated[byName] = mergeScannedDevice(
              { ...currentDevices[byName], id: device.id },
              device,
            );
            updated[byName].id = device.id;
            return updated;
          }
        }
        // Cap growth in crowded areas.
        if (currentDevices.length >= 50) return currentDevices;
        return [...currentDevices, device];
      });
    });

    console.log('Starting scan...');
    // Filter by our chat service so random nameless BLE peripherals
    // (TVs, watches, beacons) don't fill the list. allowDuplicates must be
    // true: the first callback for a peer often has no name yet and the
    // scan-response carrying the local name arrives right after.
    try {
      await startScan({
        serviceUUIDs: [SERVICE_UUID],
        allowDuplicates: true,
        scanMode: 'lowLatency',
      });
    } catch (e) {
      // Fall back to an unfiltered scan if the device rejects the filter
      // (some Android stacks do) — names still resolve via merge logic.
      console.log('Filtered scan failed, retrying unfiltered:', e);
      await startScan({ allowDuplicates: true, scanMode: 'lowLatency' });
    }
    setIsScanning(true);
    console.log('Scan started');
  };

  const hexToText = (hex: string | null | undefined): string | null => {
    if (hex == null) return null;
    try {
      // Native sides disagree on formatting: Android keeps spaces, iOS only
      // trims the ends and pads odd-length with "0" (corrupting data), and
      // some stacks add "0x" / separators. Normalise before decoding.
      const clean = hex
        .trim()
        .replace(/^0x/i, '')
        .replace(/[\s_\-:]/g, '')
        .toLowerCase();
      if (!clean) return null;
      if (clean.length % 2 !== 0) {
        console.warn('Dropping odd-length hex payload');
        return null;
      }
      if (!/^[0-9a-f]*$/.test(clean)) {
        console.warn('Dropping non-hex payload');
        return null;
      }
      return Buffer.from(clean, 'hex').toString('utf-8');
    } catch (e) {
      console.warn('Failed to decode hex to text:', e);
      return null;
    }
  };

  const textToHex = (text: string) => {
    return Buffer.from(text, 'utf-8').toString('hex').toLowerCase();
  };

  const splitHexIntoPackets = (hex: string): string[] => {
    const packets: string[] = [];
    for (let i = 0; i < hex.length; i += MAX_HEX_PER_PACKET) {
      packets.push(hex.slice(i, i + MAX_HEX_PER_PACKET));
    }
    return packets;
  };

  const addMessage = (text: string, sender: 'me' | 'other') => {
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: Date.now().toString() + Math.random().toString(), text, sender },
    ]);
  };

  const clearReassembly = () => {
    const state = reassemblyRef.current;
    if (state.timer) clearTimeout(state.timer);
    reassemblyRef.current = { id: null, total: 0, chunks: [], timer: null };
  };

  const flushReassembly = () => {
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
  };

  const armReassemblyTimeout = () => {
    const state = reassemblyRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      console.warn('BLE reassembly timed out — flushing best effort');
      flushReassembly();
    }, REASSEMBLY_TIMEOUT_MS);
  };

  /**
   * Every BLE notification / write event funnels through here.
   * - Control frames (START/END) drive the reassembly buffer and are never shown.
   * - Data packets while reassembling are stored as RAW HEX (byte-exact) so
   *   multi-byte UTF-8 (Hindi, emoji) split across packets reassembles cleanly.
   *   Newly-completed text is also pushed to streaming TTS immediately, so
   *   speech starts while later packets are still in flight.
   * - Anything else is a complete single-packet (or natively reassembled)
   *   message and is decoded + spoken immediately. This keeps backward
   *   compatibility with peers that send short messages without framing.
   */
  const handleIncomingHex = (hex: string | null | undefined) => {
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
        incomingTextTrackerRef.current.reset();
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
      const clean = hex
        .trim()
        .replace(/^0x/i, '')
        .replace(/[\s_\-:]/g, '')
        .toLowerCase();
      if (!clean || clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
        console.warn('Dropping corrupt data packet during reassembly');
        return;
      }
      reassemblyRef.current.chunks.push(clean);
      // Streaming TTS: decode everything received so far and speak only
      // the newly-completed characters (handles Hindi split across packets).
      try {
        const fresh = incomingTextTrackerRef.current.pushJoinedHex(
          reassemblyRef.current.chunks.join(''),
        );
        if (fresh) ttsRef.current.pushText(fresh);
      } catch (e) {
        console.warn('Streaming TTS push failed:', e);
      }
      armReassemblyTimeout();
      // Tolerate a lost END frame: if we already have everything, flush.
      if (reassemblyRef.current.chunks.length >= reassemblyRef.current.total) {
        flushReassembly();
      }
      return;
    }

    if (text == null || text === '') return;
    addMessage(text, 'other');
    // Single-packet message — speak it in full (queued behind any speech).
    ttsRef.current.speakFullMessage(text);
  };

  const clearConnection = () => {
    setConnectedDeviceId(null);
    setPeripheralCentralId(null);
    setMessages([]);
    setMessage('');
    clearReassembly();
    incomingTextTrackerRef.current.reset();
    // Finish any half-streamed utterance so its tail is still spoken.
    ttsRef.current.endStream();
  };

  const setupPeripheralListeners = () => {
    if (removePeripheralWriteListenerRef.current) return;

    console.log('Setting up peripheral listeners');

    removePeripheralWriteListenerRef.current = addEventListener(
      'peripheralWriteRequest',
      (event) => {
        console.log('PERIPHERAL WRITE — Central:', event.centralId);
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
        if (event.characteristicUUID.toLowerCase() !== RX_CHARACTERISTIC_UUID.toLowerCase()) {
          console.log('Ignoring peripheral write: not RX');
          return;
        }
        handleIncomingHex(event.value);
      },
    );

    removePeripheralSubscribedListenerRef.current = addEventListener(
      'peripheralSubscribed',
      (event) => {
        console.log('PERIPHERAL SUBSCRIBED — Central:', event.centralId);
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
        if (event.characteristicUUID.toLowerCase() !== TX_CHARACTERISTIC_UUID.toLowerCase()) return;
        setPeripheralCentralId(event.centralId);
        setMessages([]);
        clearReassembly();
        incomingTextTrackerRef.current.reset();
        console.log('Peripheral chat is ready');
      },
    );

    removePeripheralUnsubscribedListenerRef.current = addEventListener(
      'peripheralUnsubscribed',
      (event) => {
        console.log('PERIPHERAL UNSUBSCRIBED');
        if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
        if (event.characteristicUUID.toLowerCase() !== TX_CHARACTERISTIC_UUID.toLowerCase()) return;
        setPeripheralCentralId(null);
        setMessages([]);
        clearReassembly();
        incomingTextTrackerRef.current.reset();
        ttsRef.current.endStream();
      },
    );

    console.log('Peripheral listeners ready');
  };

  const connectToDevice = async (deviceId: string) => {
    if (isConnecting || connectedDeviceId || peripheralCentralId) return;
    setIsConnecting(true);

    try {
      console.log('CONNECT START — Device:', deviceId);
      await stopScanning();
      setDevices([]);

      await connect(deviceId);
      console.log('Connected');
      setConnectedDeviceId(deviceId);

      const services = await discoverServices(deviceId);
      const chatService = services.find(
        (s) => s.uuid.toLowerCase() === SERVICE_UUID.toLowerCase(),
      );

      if (!chatService) {
        console.log('Chat service not found');
        await disconnect(deviceId);
        clearConnection();
        return;
      }

      const rxCharacteristic = chatService.characteristics.find(
        (c) => c.uuid.toLowerCase() === RX_CHARACTERISTIC_UUID.toLowerCase(),
      );
      const txCharacteristic = chatService.characteristics.find(
        (c) => c.uuid.toLowerCase() === TX_CHARACTERISTIC_UUID.toLowerCase(),
      );

      if (!rxCharacteristic || !txCharacteristic) {
        console.log('RX or TX characteristic not found');
        await disconnect(deviceId);
        clearConnection();
        return;
      }

      if (removeCentralValueListenerRef.current) {
        removeCentralValueListenerRef.current();
        removeCentralValueListenerRef.current = undefined;
      }

      removeCentralValueListenerRef.current = addEventListener(
        'characteristicValueChanged',
        (event) => {
          if (event.deviceId !== deviceId) return;
          if (event.serviceUUID.toLowerCase() !== SERVICE_UUID.toLowerCase()) return;
          if (event.characteristicUUID.toLowerCase() !== TX_CHARACTERISTIC_UUID.toLowerCase()) return;
          handleIncomingHex(event.value);
        },
      );

      await subscribeToCharacteristic(deviceId, SERVICE_UUID, TX_CHARACTERISTIC_UUID);

      // Best effort: raise ATT MTU so fewer packets are needed. Chunking to
      // 20 bytes still keeps us safe when negotiation fails (e.g. iOS).
      try {
        await requestMTU(deviceId, 512);
      } catch (e) {
        console.log('MTU request failed (non-fatal, using 20-byte chunks):', e);
      }
      console.log('CONNECT COMPLETE');
    } catch (error) {
      console.log('CONNECT ERROR:', error);
      clearConnection();
    } finally {
      setIsConnecting(false);
    }
  };

  /**
   * Low-level send: fragments the hex payload into 20-byte BLE packets.
   * Short messages use a single packet (backward compatible). Long messages
   * use START -> data packets -> END framing so the peer can reassemble
   * byte-exact UTF-8 regardless of MTU.
   */
  const sendHexFramed = async (
    hexPayload: string,
    writeCentral: (packetHex: string) => Promise<void>,
    notifyPeripheral: (packetHex: string) => Promise<void>,
  ) => {
    if (!hexPayload) return;
    if (hexPayload.length <= MAX_HEX_PER_PACKET) {
      if (connectedDeviceId) await writeCentral(hexPayload);
      else await notifyPeripheral(hexPayload);
      return;
    }

    const chunks = splitHexIntoPackets(hexPayload);
    const id = makeFrameId();
    const startHex = textToHex(`\u001FBLK:S:${id}:${chunks.length}\u001F`);
    const endHex = textToHex(`\u001FBLK:E:${id}\u001F`);

    if (connectedDeviceId) {
      await writeCentral(startHex);
      for (const chunk of chunks) {
        await delay(CHUNK_DELAY_MS);
        await writeCentral(chunk);
      }
      await delay(CHUNK_DELAY_MS);
      await writeCentral(endHex);
    } else {
      await notifyPeripheral(startHex);
      for (const chunk of chunks) {
        await delay(CHUNK_DELAY_MS);
        await notifyPeripheral(chunk);
      }
      await delay(CHUNK_DELAY_MS);
      await notifyPeripheral(endHex);
    }
  };

  const sendMessage = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;
    if (!connectedDeviceId && !peripheralCentralId) {
      console.log('No connection');
      return;
    }
    const hexMessage = textToHex(trimmedMessage);

    try {
      await sendHexFramed(
        hexMessage,
        (packetHex) =>
          writeCharacteristic(
            connectedDeviceId!,
            SERVICE_UUID,
            RX_CHARACTERISTIC_UUID,
            packetHex,
            'write',
          ),
        (packetHex) =>
          updateCharacteristicValue(SERVICE_UUID, TX_CHARACTERISTIC_UUID, packetHex, true),
      );
      addMessage(trimmedMessage, 'me');
      setMessage('');
    } catch (error) {
      console.log('Send failed:', error);
    }
  };

  /** Send an arbitrary text string over BLE (used by both typed & voice messages). */
  const sendTextOverBLE = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!connectedDeviceId && !peripheralCentralId) {
      console.log('No connection — cannot send voice message');
      return;
    }
    const hexMsg = textToHex(trimmed);

    try {
      await sendHexFramed(
        hexMsg,
        (packetHex) =>
          writeCharacteristic(
            connectedDeviceId!,
            SERVICE_UUID,
            RX_CHARACTERISTIC_UUID,
            packetHex,
            'write',
          ),
        (packetHex) =>
          updateCharacteristicValue(SERVICE_UUID, TX_CHARACTERISTIC_UUID, packetHex, true),
      );
      addMessage(trimmed, 'me');
    } catch (error) {
      console.log('Voice send failed:', error);
    }
  };

  /** Toggle voice recording on/off.  On stop → transcribe → send. */
  const handleVoiceToggle = async () => {
    if (isVoiceRecording) {
      // Stop recording → transcribe → send
      const text = await stopVoice();
      if (text) {
        await sendTextOverBLE(text);
      }
    } else {
      // Start recording
      await startVoice();
    }
  };

  const stopBluetooth = () => {
    try {
      stopAdvertising();
    } catch (error) {
      console.log('Stop advertising error:', error);
    }
    advertisedNameRef.current = null;
    setAdvertisedName(null);
    setBluetoothReady(false);
    console.log('BLUETOOTH STOPPED');
  };

  const checkBluetooth = async () => {
    // Guard double-taps: restarting advertising generates a NEW random
    // private BLE address, which is why the peer saw you "multiple times
    // with changed bluetooth address".
    if (startingRef.current || isStartingBt) return;
    const nameToAdvertise = getNameToAdvertise();
    if (bluetoothReady && advertisedNameRef.current === nameToAdvertise) {
      console.log('Already advertising as', nameToAdvertise);
      return;
    }
    // Name changed -> restart with the new name instead of stacking a second
    // advertiser.
    if (bluetoothReady) {
      console.log('Name changed, restarting advertising as', nameToAdvertise);
      stopBluetooth();
    }

    startingRef.current = true;
    setIsStartingBt(true);
    setBtError(null);
    try {
      console.log('BLUETOOTH START');
      const granted = await requestBluetoothPermission();
      if (!granted) {
        const msg = 'Bluetooth permission denied. Allow Bluetooth + Location to advertise and scan.';
        setBtError(msg);
        console.log('Permission denied');
        return;
      }

      const enabled = await isBluetoothEnabled();
      if (!enabled) {
        // The library cannot turn on system Bluetooth itself (Android/iOS
        // require user consent) — guide the user to Settings instead.
        const msg = 'Bluetooth is turned off. Turn it on in system settings, then tap Start again.';
        setBtError(msg);
        console.log('Bluetooth disabled');
        Alert.alert(
          'Bluetooth is off',
          'This app cannot switch system Bluetooth on by itself. Please turn Bluetooth on, then tap Start Bluetooth again.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return;
      }

      await setServices([
        {
          uuid: SERVICE_UUID,
          characteristics: [
            { uuid: RX_CHARACTERISTIC_UUID, properties: ['write', 'writeWithoutResponse'] },
            { uuid: TX_CHARACTERISTIC_UUID, properties: ['notify'] },
          ],
        },
      ]);

      setupPeripheralListeners();
      // Advertise the user's real name (not a fixed "Bluetooth Chat" for every
      // phone) twice — localName + advertisingData — for max cross-platform
      // visibility: Android puts it in the scan response, iOS only exposes
      // local name + service UUIDs.
      startAdvertising({
        serviceUUIDs: [SERVICE_UUID],
        localName: nameToAdvertise,
        advertisingData: { completeLocalName: nameToAdvertise } as any,
      });

      advertisedNameRef.current = nameToAdvertise;
      setAdvertisedName(nameToAdvertise);
      setBluetoothReady(true);
      console.log('BLUETOOTH READY as', nameToAdvertise);
    } catch (error) {
      const msg = 'Bluetooth setup failed. Make sure Bluetooth is on and try again.';
      setBtError(msg);
      console.log('Bluetooth setup failed:', error);
    } finally {
      startingRef.current = false;
      setIsStartingBt(false);
    }
  };

  const disconnectFromDevice = async () => {
    if (connectedDeviceId) {
      try {
        await disconnect(connectedDeviceId);
        console.log('Central disconnected');
      } catch (error) {
        console.log('Disconnect error:', error);
      }
      clearConnection();
      return;
    }

    if (peripheralCentralId) {
      setPeripheralCentralId(null);
      setMessages([]);
      setMessage('');
      clearReassembly();
      incomingTextTrackerRef.current.reset();
      ttsRef.current.endStream();
    }
  };

  const isChatConnected = connectedDeviceId !== null || peripheralCentralId !== null;

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>BLUETOOTH</Text>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Chat</Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            { backgroundColor: bluetoothReady ? '#DCFCE7' : colors.inputBackground },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              { backgroundColor: bluetoothReady ? colors.success : colors.textSecondary },
            ]}
          />
          <Text style={[styles.statusText, { color: bluetoothReady ? colors.success : colors.textSecondary }]}>
            {bluetoothReady ? 'Ready' : 'Not started'}
          </Text>
        </View>
      </View>

      {!isChatConnected ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: Spacing.xl }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Setup</Text>
            <Text style={[styles.sectionDescription, { color: colors.textSecondary }]}>
              Set the name other phones will see, then start Bluetooth to advertise. Tap Start only once — tapping again changes your BLE address and you appear as a duplicate.
            </Text>
            <Text style={[styles.nameLabel, { color: colors.textSecondary }]}>
              YOUR DEVICE NAME (max {MAX_ADVERTISED_NAME_LEN} chars for BLE)
            </Text>
            <TextInput
              value={displayName}
              onChangeText={(t) => setDisplayName(t.slice(0, 20))}
              placeholder={Device.modelName ?? 'e.g. Rahul'}
              placeholderTextColor={colors.textSecondary}
              maxLength={20}
              style={[
                styles.nameInput,
                { backgroundColor: colors.inputBackground, color: colors.text },
              ]}
            />
            {bluetoothReady && advertisedName ? (
              <Text style={[styles.advertisedAs, { color: colors.success }]}>
                You are visible as “{advertisedName}”
              </Text>
            ) : null}
            {btError ? (
              <View style={styles.btErrorBox}>
                <Text style={[styles.btErrorText, { color: colors.error }]}>{btError}</Text>
                <TouchableOpacity onPress={() => Linking.openSettings()} activeOpacity={0.8}>
                  <Text style={[styles.btErrorLink, { color: colors.primary }]}>
                    Open system settings
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                {
                  backgroundColor: isStartingBt ? colors.textSecondary : colors.primary,
                  opacity: isStartingBt ? 0.7 : 1,
                },
              ]}
              onPress={checkBluetooth}
              disabled={isStartingBt}
              activeOpacity={0.82}
            >
              {isStartingBt ? (
                <ActivityIndicator color="#FFFFFF" size="small" style={styles.buttonIcon} />
              ) : (
                <Ionicons name="bluetooth" size={18} color="#FFFFFF" style={styles.buttonIcon} />
              )}
              <Text style={styles.primaryButtonText}>
                {isStartingBt
                  ? 'Starting…'
                  : bluetoothReady
                    ? `Update name & restart (“${advertisedName}”)`
                    : 'Start Bluetooth'}
              </Text>
            </TouchableOpacity>
            {bluetoothReady ? (
              <TouchableOpacity
                style={[styles.stopButton, { backgroundColor: colors.inputBackground }]}
                onPress={stopBluetooth}
                activeOpacity={0.82}
              >
                <Text style={[styles.stopButtonText, { color: colors.text }]}>
                  Stop advertising
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Nearby Devices</Text>
                <Text style={[styles.deviceCount, { color: colors.textSecondary }]}>
                  {devices.length} device{devices.length === 1 ? '' : 's'} found
                </Text>
              </View>

              <TouchableOpacity
                style={[
                  styles.scanButton,
                  {
                    backgroundColor: isScanning ? colors.error : colors.primary,
                  },
                ]}
                onPress={isScanning ? stopScanning : scanForDevices}
                activeOpacity={0.82}
              >
                <Text style={styles.scanButtonText}>{isScanning ? 'Stop' : 'Scan'}</Text>
              </TouchableOpacity>
            </View>

            {devices.length === 0 ? (
              <View
                style={[
                  styles.emptyState,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Ionicons name="search-outline" size={32} color={colors.textSecondary} style={{ marginBottom: Spacing.sm }} />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>No devices found</Text>
                <Text style={[styles.emptyStateText, { color: colors.textSecondary }]}>
                  Start a scan to find another Bluetooth Chat device.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {devices.map((device) => (
                  <View
                    key={device.id}
                    style={[
                      styles.deviceCard,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.deviceInfo}>
                      <Text style={[styles.deviceName, { color: colors.text }]} numberOfLines={1}>
                        {getDeviceDisplayName(device)}
                      </Text>
                      <Text style={[styles.deviceId, { color: colors.textSecondary }]}>
                        {device.id}
                      </Text>
                      {device.rssi !== undefined && (
                        <Text style={[styles.deviceRssi, { color: colors.textSecondary }]}>
                          Signal: {device.rssi} dBm
                        </Text>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[styles.connectButton, { backgroundColor: colors.primary }]}
                      disabled={isConnecting}
                      onPress={() => connectToDevice(device.id)}
                      activeOpacity={0.82}
                    >
                      {isConnecting ? (
                        <ActivityIndicator color="#FFFFFF" size="small" />
                      ) : (
                        <Text style={styles.connectButtonText}>Connect</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.flex}>
          <View
            style={[
              styles.connectionBar,
              { backgroundColor: colors.surface, borderBottomColor: colors.border },
            ]}
          >
            <View style={styles.connectionInfo}>
              <View style={[styles.connectedDot, { backgroundColor: colors.success }]} />
              <View>
                <Text style={[styles.connectedTitle, { color: colors.text }]}>Connected</Text>
                <Text style={[styles.connectedRole, { color: colors.textSecondary }]}>
                  {connectedDeviceId ? 'Central (scanner)' : 'Peripheral (advertiser)'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.disconnectButton, { backgroundColor: colors.inputBackground }]}
              onPress={disconnectFromDevice}
              activeOpacity={0.8}
            >
              <Text style={[styles.disconnectText, { color: colors.text }]}>Disconnect</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={styles.emptyChat}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={48}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyChatTitle, { color: colors.text }]}>
                  Start the conversation
                </Text>
                <Text style={[styles.emptyChatText, { color: colors.textSecondary }]}>
                  Messages from either device will appear here.
                </Text>
              </View>
            ) : (
              messages.map((chatMessage) => (
                <View
                  key={chatMessage.id}
                  style={[
                    styles.messageRow,
                    chatMessage.sender === 'me' ? styles.messageRowMe : styles.messageRowOther,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      chatMessage.sender === 'me'
                        ? [styles.messageBubbleMe, { backgroundColor: colors.primary }]
                        : [
                          styles.messageBubbleOther,
                          { backgroundColor: colors.surface, borderColor: colors.border },
                        ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        chatMessage.sender === 'me'
                          ? styles.messageTextMe
                          : [styles.messageTextOther, { color: colors.text }],
                      ]}
                    >
                      {chatMessage.text}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </ScrollView>

          {/* Auto-speak (streaming TTS) control for incoming messages */}
          <View
            style={[
              styles.ttsBar,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}
          >
            <TouchableOpacity
              style={[
                styles.ttsToggle,
                {
                  backgroundColor: ttsEnabled
                    ? colors.primary
                    : colors.inputBackground,
                },
              ]}
              onPress={() => setTtsEnabled(!ttsEnabled)}
              activeOpacity={0.82}
            >
              <Ionicons
                name={ttsEnabled ? 'volume-high' : 'volume-mute'}
                size={16}
                color={ttsEnabled ? '#FFFFFF' : colors.textSecondary}
              />
              <Text
                style={[
                  styles.ttsToggleText,
                  { color: ttsEnabled ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {ttsEnabled ? 'Auto-speak ON' : 'Auto-speak OFF'}
              </Text>
            </TouchableOpacity>

            {!ttsReady && ttsEnabled ? (
              <Text style={[styles.ttsStatus, { color: colors.textSecondary }]}>
                Loading voice…
              </Text>
            ) : ttsSpeaking ? (
              <Text style={[styles.ttsStatus, { color: colors.primary }]}>
                🔊 Speaking…
              </Text>
            ) : null}

            {ttsSpeaking && (
              <TouchableOpacity
                style={[
                  styles.ttsStop,
                  { backgroundColor: colors.inputBackground },
                ]}
                onPress={stopTts}
                activeOpacity={0.82}
              >
                <Ionicons name="stop" size={16} color={colors.error} />
                <Text style={[styles.ttsStopText, { color: colors.error }]}>
                  Stop
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Voice recording / transcribing indicator */}
          {(isVoiceRecording || isTranscribing) && (
            <View
              style={[
                styles.voiceIndicator,
                {
                  backgroundColor: isVoiceRecording ? '#FEE2E2' : '#DBEAFE',
                  borderTopColor: colors.border,
                },
              ]}
            >
              <View style={styles.voiceIndicatorIcon}>
                {isTranscribing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <View style={styles.recordingPulse} />
                )}
              </View>
              <View style={styles.voiceIndicatorTextContainer}>
                <Text
                  style={[
                    styles.voiceIndicatorText,
                    { color: isVoiceRecording ? colors.error : colors.primary },
                  ]}
                >
                  {isVoiceRecording ? 'Recording… Tap mic to stop' : 'Transcribing speech…'}
                </Text>
                {isVoiceRecording && partialText.length > 0 && (
                  <Text
                    style={[styles.partialTranscript, { color: colors.text }]}
                    numberOfLines={2}
                  >
                    {partialText}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Voice error message */}
          {voiceError && !isVoiceRecording && !isTranscribing && (
            <View style={[styles.voiceErrorBar, { borderTopColor: colors.border }]}>
              <Text style={[styles.voiceErrorText, { color: colors.error }]}>
                {voiceError}
              </Text>
            </View>
          )}

          <View
            style={[
              styles.inputContainer,
              { backgroundColor: colors.surface, borderTopColor: colors.border },
            ]}
          >
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={isVoiceRecording ? 'Recording…' : 'Type a message...'}
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { backgroundColor: colors.inputBackground, color: colors.text },
              ]}
              multiline
              editable={!isVoiceRecording && !isTranscribing}
            />

            {/* Mic button — voice-to-text */}
            <TouchableOpacity
              style={[
                styles.micButton,
                {
                  backgroundColor: isVoiceRecording
                    ? colors.error
                    : isTranscribing
                      ? colors.inputBackground
                      : colors.inputBackground,
                },
              ]}
              onPress={handleVoiceToggle}
              disabled={isTranscribing}
              activeOpacity={0.82}
            >
              {isTranscribing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name={isVoiceRecording ? 'stop' : 'mic'}
                  size={20}
                  color={isVoiceRecording ? '#FFFFFF' : colors.primary}
                />
              )}
            </TouchableOpacity>

            {/* Send button */}
            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor: message.trim() ? colors.primary : colors.inputBackground,
                },
              ]}
              disabled={!message.trim() || isVoiceRecording || isTranscribing}
              onPress={sendMessage}
              activeOpacity={0.82}
            >
              <Ionicons
                name="send"
                size={18}
                color={message.trim() ? '#FFFFFF' : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  flex: {
    flex: 1,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
  },

  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  headerTitle: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.round,
  },

  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },

  scrollContent: {
    padding: Spacing.md,
  },

  section: {
    marginBottom: Spacing.lg,
  },

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },

  sectionTitle: {
    fontSize: FontSize.medium,
    fontWeight: '700',
  },

  sectionDescription: {
    fontSize: FontSize.small + 2,
    lineHeight: 20,
    marginTop: 6,
    marginBottom: Spacing.md,
  },

  deviceCount: {
    marginTop: 3,
    fontSize: FontSize.small,
  },

  primaryButton: {
    height: 52,
    borderRadius: Radius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },

  buttonIcon: {
    marginRight: 8,
  },

  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.body,
    fontWeight: '700',
  },

  nameLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },

  nameInput: {
    height: 48,
    borderRadius: Radius.md,
    paddingHorizontal: 14,
    fontSize: 15,
    marginBottom: 8,
  },

  advertisedAs: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },

  btErrorBox: {
    marginBottom: 10,
    gap: 4,
  },

  btErrorText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },

  btErrorLink: {
    fontSize: 13,
    fontWeight: '700',
  },

  stopButton: {
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },

  stopButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },

  scanButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },

  scanButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  emptyState: {
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    alignItems: 'center',
    borderWidth: 1,
  },

  emptyStateTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },

  emptyStateText: {
    fontSize: FontSize.small,
    textAlign: 'center',
    lineHeight: 18,
  },

  deviceList: {
    gap: 10,
  },

  deviceCard: {
    borderRadius: Radius.md,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },

  deviceInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },

  deviceName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 3,
  },

  deviceId: {
    fontSize: 11,
  },

  deviceRssi: {
    fontSize: 12,
    marginTop: 3,
  },

  connectButton: {
    minWidth: 82,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },

  connectButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },

  connectionBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 4,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  connectionInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },

  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  connectedTitle: {
    fontSize: 15,
    fontWeight: '700',
  },

  connectedRole: {
    fontSize: 11,
    marginTop: 2,
  },

  disconnectButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  disconnectText: {
    fontSize: 13,
    fontWeight: '600',
  },

  messagesContent: {
    padding: Spacing.md,
    paddingBottom: Spacing.lg,
    flexGrow: 1,
  },

  emptyChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  },

  emptyChatTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },

  emptyChatText: {
    fontSize: FontSize.small,
    textAlign: 'center',
    lineHeight: 20,
  },

  messageRow: {
    width: '100%',
    marginBottom: 10,
  },

  messageRowMe: {
    alignItems: 'flex-end',
  },

  messageRowOther: {
    alignItems: 'flex-start',
  },

  messageBubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 17,
  },

  messageBubbleMe: {
    borderBottomRightRadius: 5,
  },

  messageBubbleOther: {
    borderBottomLeftRadius: 5,
    borderWidth: 1,
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },

  messageTextMe: {
    color: '#FFFFFF',
  },

  messageTextOther: {},

  inputContainer: {
    padding: Spacing.sm + 4,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },

  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: Radius.md,
    fontSize: 15,
  },

  sendButton: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  micButton: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  voiceIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderTopWidth: 1,
  },

  voiceIndicatorIcon: {
    marginRight: 8,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },

  voiceIndicatorTextContainer: {
    flex: 1,
  },

  voiceIndicatorText: {
    fontSize: 13,
    fontWeight: '600',
  },

  partialTranscript: {
    fontSize: 14,
    marginTop: 4,
    fontStyle: 'italic',
  },

  recordingPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#DC2626',
  },

  voiceErrorBar: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderTopWidth: 1,
    backgroundColor: '#FEF2F2',
  },

  voiceErrorText: {
    fontSize: 12,
    fontWeight: '500',
  },

  ttsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 8,
    borderTopWidth: 1,
    gap: 8,
  },

  ttsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  ttsToggleText: {
    fontSize: 13,
    fontWeight: '700',
  },

  ttsStatus: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },

  ttsStop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.sm,
  },

  ttsStopText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
