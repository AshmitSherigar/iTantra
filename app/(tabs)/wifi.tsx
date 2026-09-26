import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Device from 'expo-device';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Globe,
  Megaphone,
  Mic,
  Send,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Wifi as WifiIcon,
  X,
} from 'lucide-react-native';
import { router } from 'expo-router';

import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isLanguageInstalled } from '../../features/models/languages';
import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import GlassCard from '@/components/ui/GlassCard';
import TiltDeck from '@/components/ui/TiltDeck';
import CircleButton from '@/components/ui/CircleButton';
import ScreenHeader from '@/components/ui/ScreenHeader';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import SectionHeader from '@/components/ui/SectionHeader';
import { showAppAlert } from '@/components/ui/AppModal';
import { useKeyboardHeight } from '@/components/ui/useKeyboardHeight';
import { Shadows, Spacing, Typography } from '../../constants/theme';
import { styles } from './bluetooth.styles';
import {
  checkWifiPermissions,
  ensureWifiPermissions,
  showWifiPermissionDeniedAlert,
  useWifiChat,
} from '../../features/wifi';
import { useWifiSpeech } from '../../features/wifi/useWifiSpeech';

/**
 * WiFi LAN chat screen - premium redesign, logic preserved.
 */
export default function WifiScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Clearance above the floating tab bar + Android system buttons.
  const chatBottomPad = 70 + Math.max(insets.bottom, 12) + 16;
  // Edge-to-edge Android won't resize for the keyboard - lift manually.
  const kbHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => {
    if (kbHeight <= 0) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [kbHeight]);
  const { selectedLanguage } = useLanguage();
  const [displayName, setDisplayName] = useState(
    () => Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu',
  );
  const [deviceId] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [chatInput, setChatInput] = useState('');
  const [broadcastInput, setBroadcastInput] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [chatPeer, setChatPeer] = useState<string | null>(null);
  const [permError, setPermError] = useState<string | null>(null);
  const [permNeedsSettings, setPermNeedsSettings] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const blockedRef = useRef(new Set<string>());
  const dialedRef = useRef(new Set<string>());

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
    clearMessages,
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
    startHosting();
    blockedRef.current.clear();
    for (const peer of peers) {
      if (connectedAddresses.includes(peer.address)) continue;
      dialedRef.current.add(peer.address);
      connectTo(peer.address);
    }
  }, [hasPermission, startHosting, peers, connectedAddresses, connectTo]);

  const handleConnectPress = useCallback(
    async (address: string) => {
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

  useEffect(() => {
    if (!hasPermission) return;
    if (status === 'idle') return;
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

  const sendChatMessage = useCallback(() => {
    if (!chatPeer || !chatInput.trim()) return;
    sendToPeer(chatPeer, chatInput);
    setChatInput('');
  }, [chatPeer, chatInput, sendToPeer]);

  const handleClearMessages = useCallback(() => {
    if (messages.length === 0) return;
    void showAppAlert(
      'Clear messages?',
      'This clears all WiFi messages, including past broadcasts.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearMessages },
      ],
    );
  }, [messages.length, clearMessages]);

  const handleBroadcast = useCallback(async () => {
    const text = broadcastInput.trim();
    if (!text || isBroadcasting) return;
    setIsBroadcasting(true);
    try {
      const res = broadcast(text);
      if (res.attempted === 0) {
        await showAppAlert(
          'No WiFi connections yet',
          'No phones joined yet - they auto-join a few seconds after opening this tab on the same WiFi. If nobody appears, check the device list below.',
          [{ text: 'OK' }],
        );
        return;
      }
      setBroadcastInput('');
    } finally {
      setIsBroadcasting(false);
    }
  }, [broadcastInput, isBroadcasting, broadcast]);

  const handleVoiceToggle = useCallback(async () => {
    if (!isVoiceRecording && !languageInstalled) {
      await showAppAlert(
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
            await showAppAlert(
              'No WiFi connections yet',
              'Nobody joined yet - phones auto-join seconds after opening this tab on the same WiFi.',
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
          ? 'Connecting...'
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

  const chatMessages = useMemo(() => {
    if (!chatPeer) return [];
    return messages.filter((m) => m.peerAddress === chatPeer);
  }, [messages, chatPeer]);

  const broadcastMessages = useMemo(() => {
    return messages.filter((m) => m.peerAddress === 'broadcast').slice(-20);
  }, [messages]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }}>
        <ScreenHeader
          title={chatPeer ? chatPeerName || 'WiFi chat' : 'WiFi Chat'}
          subtitle={
            chatPeer
              ? chatPeerConnected
                ? `Private • ${selectedLanguage.label}`
                : 'Not connected - reconnect from list'
              : ssid
                ? `${statusLabel} • ${ssid}`
                : `${statusLabel} • same WiFi, no internet`
          }
          left={
            chatPeer ? (
              <CircleButton
                onPress={handleBackFromChat}
                accessibilityLabel="Back to devices"
              >
                <ArrowLeft size={20} color={colors.text} />
              </CircleButton>
            ) : (
              <CircleButton
                onPress={handleConnectAllPress}
                accessibilityLabel="Connect all devices"
              >
                <WifiIcon size={20} color={colors.text} />
              </CircleButton>
            )
          }
          right={
            chatPeer ? (
              <CircleButton
                onPress={handleDisconnectChatPeer}
                accessibilityLabel="Disconnect chat"
              >
                <X size={20} color={colors.text} />
              </CircleButton>
            ) : (
              <CircleButton
                onPress={() => router.push('/settings/language')}
                accessibilityLabel="Voice language"
              >
                <Globe size={20} color={colors.text} />
              </CircleButton>
            )
          }
        />
      </View>

      {chatPeer === null ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 130, paddingHorizontal: Spacing.lg },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <AnimatedListItem index={0}>
            <TiltDeck>
              <Text
                style={[Typography.overline, { color: colors.textSecondary }]}
              >
                Device name
              </Text>
              <TextInput
                value={displayName}
                onChangeText={(t) => setDisplayName(t.slice(0, 32))}
                placeholder={Device.modelName ?? 'Name'}
                placeholderTextColor={colors.textSecondary}
                maxLength={32}
                style={[
                  premium.nameInput,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.glassBorder,
                  },
                ]}
              />
              <TouchableOpacity
                style={[
                  premium.primaryBtn,
                  { backgroundColor: colors.text },
                  Shadows.card,
                ]}
                onPress={handleConnectAllPress}
                activeOpacity={0.85}
              >
                <WifiIcon size={18} color={colors.background} />
                <Text
                  style={[premium.primaryBtnText, { color: colors.background }]}
                >
                  Connect All ({peers.length} found)
                </Text>
              </TouchableOpacity>
              {permError || wifiError ? (
                <View style={{ marginTop: 8 }}>
                  <Text style={[premium.errorText, { color: colors.error }]}>
                    {permError ?? wifiError}
                  </Text>
                  {permNeedsSettings ? (
                    <TouchableOpacity
                      onPress={() => Linking.openSettings()}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[premium.linkText, { color: colors.primary }]}
                      >
                        Open system settings
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </TiltDeck>
          </AnimatedListItem>

          <View style={{ marginTop: Spacing.lg }}>
            <SectionHeader
              overline={`Broadcast • ${connectedAddresses.length}`}
              actionLabel={broadcastMessages.length > 0 ? 'Clear' : undefined}
              onAction={handleClearMessages}
            />
            <AnimatedListItem index={1}>
              <TiltDeck>
                <TouchableOpacity
                  style={[
                    premium.hearRow,
                    {
                      backgroundColor: ttsEnabled
                        ? colors.primaryMuted
                        : colors.inputBackground,
                    },
                  ]}
                  onPress={() => setTtsEnabled(!ttsEnabled)}
                  activeOpacity={0.85}
                >
                  {ttsEnabled ? (
                    <Volume2 size={16} color={colors.primary} />
                  ) : (
                    <VolumeX size={16} color={colors.textSecondary} />
                  )}
                  <Text
                    style={[
                      premium.hearText,
                      {
                        color: ttsEnabled
                          ? colors.primary
                          : colors.textSecondary,
                      },
                    ]}
                  >
                    {ttsEnabled ? 'Hear incoming ON' : 'Hear incoming OFF'}
                  </Text>
                  {ttsEnabled && (ttsLoading || ttsSpeaking) ? (
                    <Text
                      style={[
                        Typography.caption,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {ttsLoading
                        ? 'Loading...'
                        : `Speaking${ttsLangLabel ? ` • ${ttsLangLabel}` : ''}...`}
                    </Text>
                  ) : null}
                </TouchableOpacity>
                <View style={premium.composer}>
                  <TextInput
                    value={broadcastInput}
                    onChangeText={setBroadcastInput}
                    placeholder="Broadcast for help..."
                    placeholderTextColor={colors.textSecondary}
                    style={[
                      premium.input,
                      {
                        backgroundColor: colors.inputBackground,
                        color: colors.text,
                      },
                    ]}
                    multiline
                    editable={!isVoiceRecording && !isTranscribing}
                  />
                  <TouchableOpacity
                    style={[
                      premium.circleBtn,
                      {
                        backgroundColor: isVoiceRecording
                          ? colors.error
                          : colors.inputBackground,
                      },
                    ]}
                    onPress={handleVoiceToggle}
                    disabled={isTranscribing}
                    activeOpacity={0.85}
                  >
                    {isTranscribing ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : isVoiceRecording ? (
                      <Square size={18} color="#FFF" fill="#FFF" />
                    ) : (
                      <Mic size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      premium.circleBtn,
                      {
                        backgroundColor:
                          broadcastInput.trim() && !isBroadcasting
                            ? '#CF5C36'
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
                    activeOpacity={0.85}
                  >
                    {isBroadcasting ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Megaphone
                        size={18}
                        color={
                          broadcastInput.trim()
                            ? '#FFFFFF'
                            : colors.textSecondary
                        }
                      />
                    )}
                  </TouchableOpacity>
                </View>
                {(isVoiceRecording || isTranscribing) && (
                  <Text
                    style={[
                      Typography.caption,
                      { color: colors.textSecondary, marginTop: 6 },
                    ]}
                  >
                    {isVoiceRecording
                      ? 'Recording... tap mic to stop & broadcast'
                      : 'Transcribing...'}
                    {isVoiceRecording && partialText ? ` ${partialText}` : ''}
                  </Text>
                )}
                {broadcastMessages.length > 0 && (
                  <View style={{ marginTop: 10, gap: 8 }}>
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
                                  { backgroundColor: '#CF5C36' },
                                ]
                              : [
                                  styles.messageBubbleOther,
                                  {
                                    backgroundColor: colors.inputBackground,
                                    borderColor: colors.glassBorder,
                                  },
                                ],
                          ]}
                        >
                          {m.sender === 'other' ? (
                            <Text
                              style={{
                                fontSize: 11,
                                color: colors.textSecondary,
                                marginBottom: 2,
                              }}
                            >
                              {m.peerName}
                            </Text>
                          ) : null}
                          <Text
                            style={[
                              styles.messageText,
                              m.sender === 'me'
                                ? styles.messageTextMe
                                : [
                                    styles.messageTextOther,
                                    { color: colors.text },
                                  ],
                            ]}
                          >
                            {m.text}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </TiltDeck>
            </AnimatedListItem>
          </View>

          <View style={{ marginTop: Spacing.lg }}>
            <SectionHeader
              overline={`Same-WiFi • ${peers.length} found · ${connectedAddresses.length} connected`}
              actionLabel={isConnected ? 'Disconnect all' : undefined}
              onAction={handleDisconnectAll}
            />
            {peers.length === 0 ? (
              <GlassCard style={premium.empty}>
                <WifiIcon size={30} color={colors.textSecondary} />
                <Text
                  style={[Typography.h3, { color: colors.text, marginTop: 8 }]}
                >
                  No devices
                </Text>
                <Text
                  style={[
                    Typography.caption,
                    {
                      color: colors.textSecondary,
                      textAlign: 'center',
                      marginTop: 4,
                    },
                  ]}
                >
                  Join same WiFi, open this tab, tap Connect All.
                </Text>
              </GlassCard>
            ) : (
              <View style={{ gap: 10 }}>
                {peers.map((peer, i) => {
                  const connected = connectedAddresses.includes(peer.address);
                  return (
                    <AnimatedListItem key={peer.address} index={i}>
                      <GlassCard>
                        <View style={premium.rowBetween}>
                          <View style={{ flex: 1, marginRight: 10 }}>
                            <Text
                              style={[Typography.h3, { color: colors.text }]}
                              numberOfLines={1}
                            >
                              {peer.name}
                              {connected ? ' • connected' : ''}
                            </Text>
                            <Text
                              style={[
                                premium.mono,
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
                                  premium.miniBtn,
                                  { backgroundColor: colors.text },
                                ]}
                                onPress={() => handleOpenChat(peer.address)}
                                activeOpacity={0.85}
                              >
                                <Text
                                  style={[
                                    premium.miniBtnText,
                                    { color: colors.background },
                                  ]}
                                >
                                  Chat
                                </Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                style={[
                                  premium.miniBtn,
                                  { backgroundColor: colors.error },
                                ]}
                                onPress={() => handleDropPeer(peer.address)}
                                activeOpacity={0.85}
                              >
                                <Text style={premium.miniBtnText}>Drop</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={[
                                premium.miniBtn,
                                { backgroundColor: '#CF5C36' },
                              ]}
                              onPress={() => handleConnectPress(peer.address)}
                              activeOpacity={0.85}
                            >
                              <Text
                                style={[
                                  premium.miniBtnText,
                                  { color: colors.background },
                                ]}
                              >
                                Connect
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </GlassCard>
                    </AnimatedListItem>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={[
              styles.messagesContent,
              { paddingHorizontal: Spacing.lg },
            ]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              if (kbHeight > 0) {
                scrollRef.current?.scrollToEnd({ animated: true });
              }
            }}
          >
            {chatMessages.length === 0 ? (
              <Text
                style={[
                  styles.emptyChatText,
                  { color: colors.textSecondary, textAlign: 'center' },
                ]}
              >
                Messages with this phone appear here.
              </Text>
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
                            { backgroundColor: colors.text },
                          ]
                        : [
                            styles.messageBubbleOther,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.glassBorder,
                            },
                          ],
                    ]}
                  >
                    <Text
                      style={[
                        styles.messageText,
                        chatMessage.sender === 'me'
                          ? [styles.messageTextMe, { color: colors.background }]
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

          {(isVoiceRecording || isTranscribing) && (
            <Text
              style={[premium.hintLine, { color: colors.textSecondary }]}
              numberOfLines={2}
            >
              {isVoiceRecording
                ? `Recording...${partialText ? ` "${partialText}"` : ' tap mic to stop'}`
                : 'Transcribing speech...'}
            </Text>
          )}

          <View style={{ paddingHorizontal: Spacing.lg }}>
            <View
              style={[
                premium.utilRow,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.glassBorder,
                },
              ]}
            >
              <TouchableOpacity
                style={[
                  premium.hearChip,
                  {
                    backgroundColor: ttsEnabled
                      ? colors.text
                      : colors.inputBackground,
                  },
                ]}
                onPress={() => setTtsEnabled(!ttsEnabled)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Toggle auto-speak"
                accessibilityState={{ selected: ttsEnabled }}
              >
                {ttsEnabled ? (
                  <Volume2 size={14} color={colors.background} />
                ) : (
                  <VolumeX size={14} color={colors.textSecondary} />
                )}
                <Text
                  style={[
                    premium.hearToggleText,
                    {
                      color: ttsEnabled
                        ? colors.background
                        : colors.textSecondary,
                    },
                  ]}
                >
                  Hear
                </Text>
              </TouchableOpacity>
              <Text
                style={[premium.utilStatus, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {ttsSpeaking
                  ? `Speaking${ttsLangLabel ? ` • ${ttsLangLabel}` : ''}...`
                  : ttsLoading
                    ? 'Loading voice...'
                    : 'Voice ready'}
              </Text>
              {ttsSpeaking ? (
                <TouchableOpacity
                  onPress={stopTts}
                  activeOpacity={0.8}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Stop speaking"
                >
                  <Square size={16} color={colors.error} fill={colors.error} />
                </TouchableOpacity>
              ) : null}
              {messages.length > 0 ? (
                <TouchableOpacity
                  onPress={handleClearMessages}
                  activeOpacity={0.8}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear WiFi messages"
                >
                  <Trash2 size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View
            style={{
              paddingHorizontal: Spacing.lg,
              paddingBottom: kbHeight > 0 ? kbHeight + 12 : chatBottomPad,
            }}
          >
            <View
              style={[
                premium.composerCard,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.glassBorder,
                },
                Shadows.floating,
              ]}
            >
              <TextInput
                value={chatInput}
                onChangeText={setChatInput}
                placeholder={
                  isVoiceRecording ? 'Recording...' : 'Type a message...'
                }
                placeholderTextColor={colors.textSecondary}
                style={[
                  premium.input,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    flex: 1,
                  },
                ]}
                multiline
                editable={!isVoiceRecording && !isTranscribing}
              />
              <TouchableOpacity
                style={[
                  premium.circleBtn,
                  {
                    backgroundColor: isVoiceRecording
                      ? colors.error
                      : colors.inputBackground,
                  },
                ]}
                onPress={handleVoiceToggle}
                disabled={isTranscribing}
                activeOpacity={0.85}
              >
                {isTranscribing ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : isVoiceRecording ? (
                  <Square size={18} color="#FFF" fill="#FFF" />
                ) : (
                  <Mic size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  premium.circleBtn,
                  {
                    backgroundColor: chatInput.trim()
                      ? '#CF5C36'
                      : colors.inputBackground,
                  },
                ]}
                disabled={
                  !chatInput.trim() || isVoiceRecording || isTranscribing
                }
                onPress={sendChatMessage}
                activeOpacity={0.85}
              >
                <Send
                  size={18}
                  color={chatInput.trim() ? '#FFFFFF' : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
            {(voiceError || sttError) &&
            !isVoiceRecording &&
            !isTranscribing ? (
              <Text style={{ fontSize: 12, color: colors.error, marginTop: 6 }}>
                {voiceError ?? `Speech model: ${sttError}`}
              </Text>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const premium = {
  nameInput: {
    borderWidth: 1,
    minHeight: 50,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 15,
    marginTop: 8,
    marginBottom: 10,
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: 999,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
  },
  primaryBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
  rowBetween: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  rowGap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    flex: 1,
  },
  miniBtn: {
    minWidth: 82,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  miniBtnText: { color: '#FFF8EC', fontSize: 14, fontWeight: '700' as const },
  mono: { fontSize: 11, marginTop: 2 },
  empty: { alignItems: 'center' as const, paddingVertical: 28 },
  errorText: { fontSize: 13, fontWeight: '600' as const, lineHeight: 18 },
  linkText: { fontSize: 13, fontWeight: '700' as const, marginTop: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  hintLine: {
    textAlign: 'center' as const,
    fontSize: 12,
    fontWeight: '600' as const,
    paddingHorizontal: Spacing.lg,
    marginTop: 6,
  },
  utilRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  hearChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  utilStatus: { flex: 1, fontSize: 12, fontWeight: '600' as const },
  hearRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    marginBottom: 10,
  },
  hearText: { fontSize: 13, fontWeight: '700' as const },
  composer: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'flex-end' as const,
  },
  composerCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
    padding: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  input: {
    minHeight: 46,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    fontSize: 15,
  },
  circleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  hearToggle: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    height: 46,
  },
  hearToggleText: { fontSize: 12, fontWeight: '700' as const },
};
