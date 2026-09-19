import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isLanguageInstalled } from '../../features/models/languages';
import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { Spacing } from '../../constants/theme';
import { styles } from './bluetooth.styles';
import {
  checkWifiPermissions,
  ensureWifiPermissions,
  showWifiPermissionDeniedAlert,
  useWifiChat,
} from '../../features/wifi';
import { useWifiSpeech } from '../../features/wifi/useWifiSpeech';

/**
 * WiFi LAN chat screen — same-WiFi offline chat.
 *
 * Mirrors `bluetooth.tsx` structure:
 * - Main page (`chatPeer === null`): hosting + broadcast-to-all composer +
 *   same-WiFi peer list. Broadcast goes to every connected phone via WiFi.
 * - Chat window (`chatPeer !== null`): Bluetooth-style 1-to-1 chat with
 *   that peer (bubbles, mic, auto-speak, back/disconnect).
 *
 * Bluetooth (`bluetooth.tsx`, `features/bluetooth/*`) is untouched: this
 * screen only imports from `features/wifi/*` + shared STT/TTS hooks.
 */
export default function WifiScreen() {
  const { colors } = useTheme();
  const { selectedLanguage } = useLanguage();
  const [displayName, setDisplayName] = useState(
    () => Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu',
  );
  const [deviceId] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  /** 1-to-1 input inside the chat window. */
  const [chatInput, setChatInput] = useState('');
  /** Broadcast composer on the main page (sends to ALL connected). */
  const [broadcastInput, setBroadcastInput] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  /** Which peer's 1-to-1 window is open. Null = main broadcast page. */
  const [chatPeer, setChatPeer] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [permNeedsSettings, setPermNeedsSettings] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  /** Peers the user explicitly dropped — auto-join skips them. */
  const blockedRef = useRef(new Set<string>());
  /** Peers already dialed — avoids re-dialing on every announce tick. */
  const dialedRef = useRef(new Set<string>());

  // Silent check on mount — never prompts. If already granted (the
  // "still asking" case), later taps skip the system dialog entirely.
  useEffect(() => {
    let cancelled = false;
    void checkWifiPermissions().then((ok) => {
      if (!cancelled) setHasPermission(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    status,
    peers,
    connectedAddresses,
    isConnected,
    messages,
    ssid,
    error: wifiError,
    startHosting,
    connectTo,
    disconnectPeer,
    disconnectAll,
    sendToPeer,
    broadcast,
  } = useWifiChat({
    deviceName: displayName.trim() || 'VaaniSetu',
    deviceId,
    lang: selectedLanguage.id,
  });

  const {
    isRecording: isVoiceRecording,
    isTranscribing,
    partialText,
    error: voiceError,
    sttReady,
    sttLoading,
    sttError,
    startVoice,
    stopVoice,
    ensureSttReady,
  } = useVoiceMessage();

  const {
    enabled: ttsEnabled,
    setEnabled: setTtsEnabled,
    isSpeaking: ttsSpeaking,
    isLoadingVoice: ttsLoading,
    spokenLangLabel: ttsLangLabel,
    speakMessage,
    stop: stopTts,
  } = useWifiSpeech(true);

  // Speak incoming WiFi messages in the SENDER's language (each message
  // carries `lang`). The old `useAutoSpeak` spoke everything with one
  // receiver-side model, so Hindi via the English model sounded wrong.
  const speakRef = useRef(speakMessage);
  useEffect(() => {
    speakRef.current = speakMessage;
  }, [speakMessage]);
  const seenIdsRef = useRef(new Set<string>());
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.sender !== 'other' || seenIdsRef.current.has(last.id))
      return;
    seenIdsRef.current.add(last.id);
    speakRef.current({ text: last.text, lang: last.lang });
  }, [messages]);

  const languageInstalled = isLanguageInstalled(selectedLanguage);

  const handleConnectAllPress = useCallback(async () => {
    // Fast path: already granted → never show the system dialog again.
    if (!(hasPermission || (await checkWifiPermissions()))) {
      const res = await ensureWifiPermissions();
      if (!res.granted) {
        setPermError(
          'Location permission is required to discover phones on the same WiFi network.',
        );
        setPermNeedsSettings(res.needsSettings);
        showWifiPermissionDeniedAlert(res);
        return;
      }
      setHasPermission(true);
    }
    setPermError(null);
    setPermNeedsSettings(false);
    // Host so others can dial us, then dial everyone discovered — this is
    // an explicit "connect to all on this WiFi", so it overrides previous
    // Drops and the auto-join deviceId ordering.
    startHosting();
    blockedRef.current.clear();
    for (const peer of peers) {
      if (connectedAddresses.includes(peer.address)) continue;
      dialedRef.current.add(peer.address);
      connectTo(peer.address);
    }
  }, [hasPermission, startHosting, peers, connectedAddresses, connectTo]);

  /** Connect and stay on the main broadcast page (Everyone default).
   *  Private 1-to-1 opens only via the Chat button — so broadcast stays
   *  the default target after connecting. */
  const handleConnectPress = useCallback(
    async (address: string) => {
      // Connects must not re-prompt when permission already exists.
      if (!(hasPermission || (await checkWifiPermissions()))) {
        const res = await ensureWifiPermissions();
        if (!res.granted) {
          setPermError('Location permission is required to discover phones.');
          setPermNeedsSettings(res.needsSettings);
          showWifiPermissionDeniedAlert(res);
          return;
        }
        setHasPermission(true);
      }
      setPermError(null);
      setPermNeedsSettings(false);
      blockedRef.current.delete(address);
      dialedRef.current.add(address);
      connectTo(address);
    },
    [connectTo, hasPermission],
  );

  /**
   * Auto-join: discovered phones join the broadcast mesh by themselves —
   * no manual Connect tap needed. Rules:
   * - Only after permission + hosting (server up).
   * - Skips user-dropped peers (Drop / Disconnect) until manual Connect.
   * - One dial per pair: only the lower deviceId dials, so two phones
   *   discovering each other don't open duplicate colliding sockets.
   * - Transport dedupes + reconnects, so one `connectTo` per peer suffices.
   */
  useEffect(() => {
    if (!hasPermission) return;
    if (status === 'idle') return;
    // Forget stale dial attempts so a returning phone can rejoin.
    const live = new Set(peers.map((p) => p.address));
    for (const addr of [...dialedRef.current]) {
      if (!live.has(addr) && !connectedAddresses.includes(addr)) {
        dialedRef.current.delete(addr);
      }
    }
    for (const peer of peers) {
      if (connectedAddresses.includes(peer.address)) continue;
      if (blockedRef.current.has(peer.address)) continue;
      if (dialedRef.current.has(peer.address)) continue;
      if (!(deviceId < peer.deviceId)) continue;
      dialedRef.current.add(peer.address);
      connectTo(peer.address);
    }
  }, [peers, connectedAddresses, hasPermission, status, deviceId, connectTo]);

  const handleDropPeer = useCallback(
    (address: string) => {
      blockedRef.current.add(address);
      dialedRef.current.delete(address);
      if (chatPeer === address) {
        try {
          stopTts();
        } catch {}
        setChatPeer(null);
        setChatInput('');
      }
      disconnectPeer(address);
    },
    [chatPeer, disconnectPeer, stopTts],
  );

  const handleDisconnectAll = useCallback(() => {
    for (const addr of connectedAddresses) blockedRef.current.add(addr);
    dialedRef.current.clear();
    try {
      stopTts();
    } catch {}
    setChatPeer(null);
    disconnectAll();
  }, [connectedAddresses, disconnectAll, stopTts]);

  const handleOpenChat = useCallback((address: string) => {
    setChatPeer(address);
  }, []);

  const handleBackFromChat = useCallback(() => {
    try {
      stopTts();
    } catch {}
    setChatPeer(null);
    setChatInput('');
  }, [stopTts]);

  const handleDisconnectChatPeer = useCallback(() => {
    try {
      stopTts();
    } catch {}
    if (chatPeer) {
      blockedRef.current.add(chatPeer);
      dialedRef.current.delete(chatPeer);
      disconnectPeer(chatPeer);
    }
    setChatPeer(null);
    setChatInput('');
  }, [chatPeer, disconnectPeer, stopTts]);

  /** 1-to-1 send inside the chat window. */
  const sendChatMessage = useCallback(() => {
    if (!chatPeer || !chatInput.trim()) return;
    sendToPeer(chatPeer, chatInput);
    setChatInput('');
  }, [chatPeer, chatInput, sendToPeer]);

  /** Broadcast from the main page to ALL connected WiFi phones. */
  const handleBroadcast = useCallback(() => {
    const text = broadcastInput.trim();
    if (!text || isBroadcasting) return;
    setIsBroadcasting(true);
    try {
      const res = broadcast(text);
      if (res.attempted === 0) {
        Alert.alert(
          'No WiFi connections yet',
          'No phones joined yet — they auto-join a few seconds after opening this tab on the same WiFi. If nobody appears, check the device list below.',
          [{ text: 'OK' }],
        );
        return;
      }
      setBroadcastInput('');
    } finally {
      setIsBroadcasting(false);
    }
  }, [broadcastInput, isBroadcasting, broadcast]);

  /** Mic: in chat window → 1-to-1; on main page → broadcast to all. */
  const handleVoiceToggle = useCallback(async () => {
    if (!isVoiceRecording && !languageInstalled) {
      Alert.alert(
        'Language model not installed',
        `Install "${selectedLanguage.label}" models or switch language to use voice.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'View Languages',
            onPress: () => router.push('/settings/language'),
          },
        ],
      );
      return;
    }
    try {
      if (isVoiceRecording) {
        const text = await stopVoice();
        if (!text) return;
        if (chatPeer) {
          sendToPeer(chatPeer, text);
        } else {
          const res = broadcast(text);
          if (res.attempted === 0) {
            Alert.alert(
              'No WiFi connections yet',
              'Nobody joined yet — phones auto-join seconds after opening this tab on the same WiFi.',
              [{ text: 'OK' }],
            );
          }
        }
      } else {
        try {
          stopTts();
        } catch {}
        if (!sttReady)
          await ensureSttReady(selectedLanguage.sttAssetPath ?? undefined);
        await startVoice();
      }
    } catch (e) {
      console.warn('[WiFi] voice toggle failed', e);
    }
  }, [
    isVoiceRecording,
    languageInstalled,
    selectedLanguage,
    stopVoice,
    chatPeer,
    sendToPeer,
    broadcast,
    stopTts,
    sttReady,
    ensureSttReady,
    startVoice,
  ]);

  const statusLabel =
    status === 'connected'
      ? `Connected • ${connectedAddresses.length}`
      : status === 'listening'
        ? 'Hosting • waiting'
        : status === 'connecting'
          ? 'Connecting…'
          : status === 'disconnected'
            ? 'Disconnected'
            : 'Idle';

  const chatPeerName =
    (chatPeer && peers.find((p) => p.address === chatPeer)?.name) ??
    chatPeer ??
    '';
  const chatPeerConnected = chatPeer
    ? connectedAddresses.includes(chatPeer)
    : false;

  /** 1-to-1 thread for the open chat window. */
  const chatMessages = useMemo(() => {
    if (!chatPeer) return [];
    return messages.filter((m) => m.peerAddress === chatPeer);
  }, [messages, chatPeer]);

  /** Broadcast history shown on the main page. */
  const broadcastMessages = useMemo(() => {
    return messages.filter((m) => m.peerAddress === 'broadcast').slice(-20);
  }, [messages]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.surface, borderBottomColor: colors.border },
        ]}
      >
        <View>
          <Text style={[styles.headerLabel, { color: colors.textSecondary }]}>
            VaaniSetu WiFi
          </Text>
          <Text style={[{ fontSize: 12, color: colors.textSecondary }]}>
            {ssid ? `WiFi: ${ssid}` : 'Same WiFi • no internet needed'}
          </Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isConnected ? '#DCFCE7' : colors.inputBackground,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: isConnected ? colors.success : colors.textSecondary },
            ]}
          >
            {statusLabel}
          </Text>
        </View>
      </View>

      {chatPeer === null ? (
        /* ---------------- MAIN PAGE: broadcast to all + peer list -------- */
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionDescription,
                { color: colors.textSecondary },
              ]}
            >
              All phones on the SAME WiFi network running this app appear below.
              Tap Connect All to join every phone to the broadcast at once (new
              phones auto-join too), or tap Chat on one phone for a private
              1-to-1 like Bluetooth. No mobile data or internet is used.
            </Text>
            <Text style={[styles.nameLabel, { color: colors.textSecondary }]}>
              YOUR DEVICE NAME
            </Text>
            <TextInput
              value={displayName}
              onChangeText={(t) => setDisplayName(t.slice(0, 32))}
              placeholder={Device.modelName ?? 'e.g. Rahul'}
              placeholderTextColor={colors.textSecondary}
              maxLength={32}
              style={[
                styles.nameInput,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                },
              ]}
            />
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
              ]}
              onPress={handleConnectAllPress}
              activeOpacity={0.82}
            >
              <Ionicons
                name="wifi"
                size={18}
                color="#FFFFFF"
                style={styles.buttonIcon}
              />
              <Text style={styles.primaryButtonText}>
                Connect All ({peers.length} found)
              </Text>
            </TouchableOpacity>
            {permError || wifiError ? (
              <View style={styles.btErrorBox}>
                <Text style={[styles.btErrorText, { color: colors.error }]}>
                  {permError ?? wifiError}
                </Text>
                {permNeedsSettings ? (
                  <TouchableOpacity
                    onPress={() => Linking.openSettings()}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[styles.btErrorLink, { color: colors.primary }]}
                    >
                      Open system settings
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Broadcast to all ({connectedAddresses.length} connected)
            </Text>
            <Text
              style={[
                styles.sectionDescription,
                { color: colors.textSecondary },
              ]}
            >
              Default target is Everyone — sends to every connected WiFi phone
              at once via WiFi. Incoming plays in the sender’s language.
            </Text>
            <View
              style={[
                styles.ttsBar,
                {
                  backgroundColor: colors.surface,
                  borderTopColor: colors.border,
                  marginBottom: 10,
                },
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
                    {
                      color: ttsEnabled ? '#FFFFFF' : colors.textSecondary,
                    },
                  ]}
                >
                  {ttsEnabled ? 'Hear incoming ON' : 'Hear incoming OFF'}
                </Text>
              </TouchableOpacity>
              {ttsEnabled && (ttsLoading || ttsSpeaking) ? (
                <Text
                  style={[styles.ttsStatus, { color: colors.textSecondary }]}
                >
                  {ttsLoading
                    ? 'Loading voice…'
                    : `Speaking${ttsLangLabel ? ` • ${ttsLangLabel}` : ''}…`}
                </Text>
              ) : null}
            </View>
            <View
              style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}
            >
              <TextInput
                value={broadcastInput}
                onChangeText={setBroadcastInput}
                placeholder="Broadcast to everyone on WiFi..."
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    flex: 1,
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                  },
                ]}
                multiline
                editable={!isVoiceRecording && !isTranscribing}
              />
              <TouchableOpacity
                style={[
                  styles.micButton,
                  {
                    backgroundColor: isVoiceRecording
                      ? colors.error
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
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  {
                    backgroundColor:
                      broadcastInput.trim() && !isBroadcasting
                        ? colors.primary
                        : colors.inputBackground,
                  },
                ]}
                disabled={
                  !broadcastInput.trim() ||
                  isBroadcasting ||
                  isVoiceRecording ||
                  isTranscribing
                }
                onPress={handleBroadcast}
                activeOpacity={0.82}
              >
                {isBroadcasting ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons
                    name="megaphone-outline"
                    size={18}
                    color={
                      broadcastInput.trim() ? '#FFFFFF' : colors.textSecondary
                    }
                  />
                )}
              </TouchableOpacity>
            </View>
            {(isVoiceRecording || isTranscribing) && (
              <Text
                style={[
                  styles.voiceIndicatorText,
                  { color: colors.textSecondary, marginTop: 6 },
                ]}
              >
                {isVoiceRecording
                  ? 'Recording… tap mic to stop & broadcast'
                  : 'Transcribing…'}
                {isVoiceRecording && partialText ? ` ${partialText}` : ''}
              </Text>
            )}
            {broadcastMessages.length > 0 && (
              <View style={{ marginTop: 10 }}>
                {broadcastMessages.map((m) => (
                  <View
                    key={m.id}
                    style={[
                      styles.messageRow,
                      m.sender === 'me'
                        ? styles.messageRowMe
                        : styles.messageRowOther,
                    ]}
                  >
                    <View
                      style={[
                        styles.messageBubble,
                        m.sender === 'me'
                          ? [
                              styles.messageBubbleMe,
                              { backgroundColor: colors.primary },
                            ]
                          : [
                              styles.messageBubbleOther,
                              {
                                backgroundColor: colors.surface,
                                borderColor: colors.border,
                              },
                            ],
                      ]}
                    >
                      {m.sender === 'other' ? (
                        <Text
                          style={[
                            {
                              fontSize: 11,
                              color: colors.textSecondary,
                              marginBottom: 2,
                            },
                          ]}
                        >
                          {m.peerName}
                        </Text>
                      ) : null}
                      <Text
                        style={[
                          styles.messageText,
                          m.sender === 'me'
                            ? styles.messageTextMe
                            : [styles.messageTextOther, { color: colors.text }],
                        ]}
                      >
                        {m.text}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Same-WiFi devices
                </Text>
                <Text
                  style={[styles.deviceCount, { color: colors.textSecondary }]}
                >
                  {peers.length} found • {connectedAddresses.length} connected
                </Text>
              </View>
              {isConnected ? (
                <TouchableOpacity
                  style={[styles.scanButton, { backgroundColor: colors.error }]}
                  onPress={handleDisconnectAll}
                  activeOpacity={0.82}
                >
                  <Text style={styles.scanButtonText}>Disconnect all</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {peers.length === 0 ? (
              <View
                style={[
                  styles.emptyState,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Ionicons
                  name="wifi-outline"
                  size={32}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                  No WiFi phones found
                </Text>
                <Text
                  style={[
                    styles.emptyStateText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Join the same WiFi on both phones, open this tab on both, tap
                  Connect All, and wait a few seconds.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {peers.map((peer) => {
                  const connected = connectedAddresses.includes(peer.address);
                  return (
                    <View
                      key={peer.address}
                      style={[
                        styles.deviceCard,
                        {
                          backgroundColor: colors.surface,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View style={styles.deviceInfo}>
                        <Text
                          style={[styles.deviceName, { color: colors.text }]}
                          numberOfLines={1}
                        >
                          {peer.name}
                          {connected ? ' • connected' : ''}
                        </Text>
                        <Text
                          style={[
                            styles.deviceId,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {peer.address}:{peer.tcpPort}
                        </Text>
                      </View>
                      {connected ? (
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <TouchableOpacity
                            style={[
                              styles.connectButton,
                              { backgroundColor: colors.primary },
                            ]}
                            onPress={() => handleOpenChat(peer.address)}
                            activeOpacity={0.82}
                          >
                            <Text style={styles.connectButtonText}>Chat</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[
                              styles.connectButton,
                              { backgroundColor: colors.error },
                            ]}
                            onPress={() => handleDropPeer(peer.address)}
                            activeOpacity={0.82}
                          >
                            <Text style={styles.connectButtonText}>Drop</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.connectButton,
                            { backgroundColor: colors.primary },
                          ]}
                          onPress={() => handleConnectPress(peer.address)}
                          activeOpacity={0.82}
                        >
                          <Text style={styles.connectButtonText}>Connect</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
          <Text
            style={[
              {
                color: colors.textSecondary,
                fontSize: 11,
                marginTop: 8,
                textAlign: 'center',
              },
            ]}
          >
            WiFi chat is separate from Bluetooth — both stay available.
          </Text>
        </ScrollView>
      ) : (
        /* ---------------- 1-to-1 CHAT WINDOW (Bluetooth-style) ---------- */
        <View style={styles.flex}>
          <View
            style={[
              styles.connectionBar,
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={styles.connectionInfo}>
              <TouchableOpacity
                onPress={handleBackFromChat}
                activeOpacity={0.7}
                hitSlop={10}
                style={{ marginRight: 4 }}
              >
                <Ionicons
                  name="arrow-back"
                  size={22}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
              <View
                style={[
                  styles.connectedDot,
                  {
                    backgroundColor: chatPeerConnected
                      ? colors.success
                      : colors.textSecondary,
                  },
                ]}
              />
              <View>
                <Text style={[styles.connectedTitle, { color: colors.text }]}>
                  {chatPeerName || 'WiFi chat'}
                </Text>
                <Text
                  style={[
                    styles.connectedRole,
                    { color: colors.textSecondary },
                  ]}
                >
                  {chatPeerConnected
                    ? `WiFi private • ${selectedLanguage.label}`
                    : 'Not connected — reconnect from the list'}{' '}
                  • {chatPeer}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={[
                styles.disconnectButton,
                { backgroundColor: colors.inputBackground },
              ]}
              onPress={handleDisconnectChatPeer}
              activeOpacity={0.8}
            >
              <Text style={[styles.disconnectText, { color: colors.text }]}>
                {chatPeerConnected ? 'Disconnect' : 'Close'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.messagesContent}
            keyboardShouldPersistTaps="handled"
          >
            {chatMessages.length === 0 ? (
              <View style={styles.emptyChat}>
                <Ionicons
                  name="chatbubbles-outline"
                  size={48}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyChatTitle, { color: colors.text }]}>
                  Private WiFi chat
                </Text>
                <Text
                  style={[
                    styles.emptyChatText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Messages here go only to {chatPeerName || 'this phone'} over
                  WiFi — nothing uses the internet.
                </Text>
              </View>
            ) : (
              chatMessages.map((chatMessage) => (
                <View
                  key={chatMessage.id}
                  style={[
                    styles.messageRow,
                    chatMessage.sender === 'me'
                      ? styles.messageRowMe
                      : styles.messageRowOther,
                  ]}
                >
                  <View
                    style={[
                      styles.messageBubble,
                      chatMessage.sender === 'me'
                        ? [
                            styles.messageBubbleMe,
                            { backgroundColor: colors.primary },
                          ]
                        : [
                            styles.messageBubbleOther,
                            {
                              backgroundColor: colors.surface,
                              borderColor: colors.border,
                            },
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

          <View
            style={[
              styles.ttsBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
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
            {!ttsEnabled ? null : ttsLoading ? (
              <Text style={[styles.ttsStatus, { color: colors.textSecondary }]}>
                Loading voice…
              </Text>
            ) : ttsSpeaking ? (
              <Text style={[styles.ttsStatus, { color: colors.primary }]}>
                🔊 Speaking{ttsLangLabel ? ` • ${ttsLangLabel}` : ''}…
              </Text>
            ) : ttsLangLabel ? (
              <Text style={[styles.ttsStatus, { color: colors.textSecondary }]}>
                Plays in sender’s language
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
                    {
                      color: isVoiceRecording ? colors.error : colors.primary,
                    },
                  ]}
                >
                  {isVoiceRecording
                    ? 'Recording… Tap mic to stop'
                    : 'Transcribing speech…'}
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

          {(voiceError || sttError) && !isVoiceRecording && !isTranscribing && (
            <View
              style={[styles.voiceErrorBar, { borderTopColor: colors.border }]}
            >
              <Text style={[styles.voiceErrorText, { color: colors.error }]}>
                {voiceError ?? `Speech model: ${sttError}`}
              </Text>
            </View>
          )}

          <View
            style={[
              styles.sttBar,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            ]}
          >
            <View style={styles.sttStatusRow}>
              <View
                style={[
                  styles.statusDotSmall,
                  {
                    backgroundColor: sttReady
                      ? colors.success
                      : sttLoading
                        ? colors.primary
                        : colors.textSecondary,
                  },
                ]}
              />
              <Text
                style={[styles.sttStatusText, { color: colors.textSecondary }]}
              >
                {sttLoading
                  ? `Loading ${selectedLanguage.label} speech model…`
                  : sttReady
                    ? `${selectedLanguage.label} speech model ready`
                    : sttError
                      ? `Speech model failed: ${sttError}`
                      : 'Speech model not loaded'}
              </Text>
            </View>
          </View>

          <View
            style={[
              styles.inputContainer,
              {
                backgroundColor: colors.surface,
                borderTopColor: colors.border,
              },
            ]}
          >
            <TextInput
              value={chatInput}
              onChangeText={setChatInput}
              placeholder={
                isVoiceRecording ? 'Recording…' : 'Type a message...'
              }
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { backgroundColor: colors.inputBackground, color: colors.text },
              ]}
              multiline
              editable={!isVoiceRecording && !isTranscribing}
            />
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
            <TouchableOpacity
              style={[
                styles.sendButton,
                {
                  backgroundColor: chatInput.trim()
                    ? colors.primary
                    : colors.inputBackground,
                },
              ]}
              disabled={!chatInput.trim() || isVoiceRecording || isTranscribing}
              onPress={sendChatMessage}
              activeOpacity={0.82}
            >
              <Ionicons
                name="send"
                size={18}
                color={chatInput.trim() ? '#FFFFFF' : colors.textSecondary}
              />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
