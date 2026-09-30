import { useCallback, useEffect, useRef, useState } from 'react';
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
  Bluetooth as BluetoothIcon,
  Globe,
  Languages,
  Mic,
  Search,
  Send,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react-native';
import { router } from 'expo-router';

import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { useAutoSpeak } from '../../features/tts/useAutoSpeak';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isLanguageInstalled } from '../../features/models/languages';
import GlassCard from '@/components/ui/GlassCard';
import TiltDeck from '@/components/ui/TiltDeck';
import CircleButton from '@/components/ui/CircleButton';
import ScreenHeader from '@/components/ui/ScreenHeader';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import SectionHeader from '@/components/ui/SectionHeader';
import { showAppAlert } from '@/components/ui/AppModal';
import { useKeyboardHeight } from '@/components/ui/useKeyboardHeight';
import { Radius, Shadows, Spacing, Typography } from '../../constants/theme';
import { styles } from './bluetooth.styles';

import {
  getDeviceDisplayName,
  promptInstallLanguage,
  useBleAdvertiser,
  useBleConnection,
  useBleMessages,
  useBleModels,
  useBleScanner,
} from '../../features/bluetooth';

/**
 * Bluetooth chat screen - UI composition only (premium redesign).
 * All BLE logic lives in `features/bluetooth/`.
 */
export default function BluetoothScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Clearance above the floating tab bar + Android system buttons.
  const chatBottomPad = 70 + Math.max(insets.bottom, 12) + 16;
  // Edge-to-edge Android won't resize for the keyboard — lift manually.
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
  const [message, setMessage] = useState('');

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
    releaseStt,
  } = useVoiceMessage();

  const {
    enabled: ttsEnabled,
    setEnabled: setTtsEnabled,
    isSpeaking: ttsSpeaking,
    isReady: ttsReady,
    isLoading: ttsLoading,
    error: ttsError,
    stop: stopTts,
    speakFullMessage,
    beginStream: ttsBeginStream,
    pushStreamText: ttsPushText,
    endStream: ttsEndStream,
    discardStream: ttsDiscardStream,
    ensureReady: ensureTtsReady,
    release: releaseTts,
  } = useAutoSpeak(true, { autoInit: false });

  const ttsRef = useRef({
    speakFullMessage,
    beginStream: ttsBeginStream,
    pushText: ttsPushText,
    endStream: ttsEndStream,
    discardStream: ttsDiscardStream,
  });
  useEffect(() => {
    ttsRef.current = {
      speakFullMessage,
      beginStream: ttsBeginStream,
      pushText: ttsPushText,
      endStream: ttsEndStream,
      discardStream: ttsDiscardStream,
    };
  }, [
    speakFullMessage,
    ttsBeginStream,
    ttsPushText,
    ttsEndStream,
    ttsDiscardStream,
  ]);

  const {
    messages,
    setMessages,
    addMessage,
    clearMessages,
    handleIncomingHex,
    resetIncomingState,
  } = useBleMessages(ttsRef);

  const {
    displayName,
    setDisplayName,
    advertisedName,
    bluetoothReady,
    btError,
    isStartingBt,
    startBluetooth,
    stopBluetooth,
  } = useBleAdvertiser();

  const languageInstalled = isLanguageInstalled(selectedLanguage);
  const handlePromptInstall = useCallback(
    () => promptInstallLanguage(selectedLanguage),
    [selectedLanguage],
  );

  const {
    isConnecting,
    isChatConnected,
    connectToDevice,
    disconnectFromDevice,
    ensurePeripheralListeners,
    sendTextOverBLE,
  } = useBleConnection({
    handleIncomingHex,
    addMessage,
    clearMessages,
    setMessages,
    resetIncomingState,
    isLanguageInstalled: languageInstalled,
    promptInstallLanguage: handlePromptInstall,
  });

  const {
    devices,
    setDevices,
    isScanning,
    scanError,
    scanForDevices,
    stopScanning,
  } = useBleScanner({ isChatConnected });

  useBleModels(isChatConnected, selectedLanguage, {
    ensureSttReady,
    releaseStt,
    ensureTtsReady,
    releaseTts,
    stopTts,
    endStream: ttsEndStream,
  });

  const handleStartPress = useCallback(async () => {
    ensurePeripheralListeners();
    await startBluetooth();
  }, [ensurePeripheralListeners, startBluetooth]);

  const handleConnectPress = useCallback(
    async (deviceId: string) => {
      await connectToDevice(deviceId, async () => {
        await stopScanning();
        setDevices([]);
      });
    },
    [connectToDevice, setDevices, stopScanning],
  );

  const sendMessage = useCallback(async () => {
    if (!message.trim()) return;
    const ok = await sendTextOverBLE(message);
    if (ok) setMessage('');
  }, [message, sendTextOverBLE]);

  const handleClearChat = useCallback(() => {
    if (messages.length === 0) return;
    void showAppAlert(
      'Clear messages?',
      'This removes all messages in this chat.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearMessages },
      ],
    );
  }, [messages.length, clearMessages]);

  /** Toggle voice recording on/off. On stop -> transcribe -> send. */
  const handleVoiceToggle = useCallback(async () => {
    if (!isVoiceRecording && !isLanguageInstalled(selectedLanguage)) {
      promptInstallLanguage(selectedLanguage);
      return;
    }
    try {
      if (isVoiceRecording) {
        const text = await stopVoice();
        if (text) {
          await sendTextOverBLE(text);
        }
      } else {
        try {
          stopTts();
        } catch {}
        await startVoice();
      }
    } catch (e) {
      console.warn('[Chat] Voice toggle failed:', e);
    }
  }, [
    isVoiceRecording,
    selectedLanguage,
    sendTextOverBLE,
    startVoice,
    stopTts,
    stopVoice,
  ]);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <View style={[premium.headerPad]}>
        <ScreenHeader
          title="Bluetooth"
          subtitle={
            isChatConnected
              ? `Private chat • ${selectedLanguage.label}`
              : bluetoothReady
                ? advertisedName
                  ? `Visible as "${advertisedName}"`
                  : 'Ready to connect'
                : 'Start Bluetooth so nearby phones find you.'
          }
          left={
            isChatConnected ? (
              <CircleButton
                onPress={disconnectFromDevice}
                accessibilityLabel="Disconnect chat"
              >
                <X size={20} color={colors.text} />
              </CircleButton>
            ) : (
              <CircleButton
                onPress={isScanning ? stopScanning : scanForDevices}
                accessibilityLabel={
                  isScanning ? 'Stop scanning' : 'Scan for devices'
                }
              >
                {isScanning ? (
                  <Square size={18} color={colors.text} fill={colors.text} />
                ) : (
                  <Search size={20} color={colors.text} />
                )}
              </CircleButton>
            )
          }
          right={
            <CircleButton
              onPress={() => router.push('/settings/language')}
              accessibilityLabel="Voice language"
            >
              <Globe size={20} color={colors.text} />
            </CircleButton>
          }
        />
      </View>

      {!isChatConnected ? (
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
                onChangeText={(t) => setDisplayName(t.slice(0, 20))}
                placeholder={Device.modelName ?? 'Name'}
                placeholderTextColor={colors.textSecondary}
                maxLength={20}
                style={[
                  premium.nameInput,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.glassBorder,
                  },
                ]}
              />
              {btError ? (
                <View style={{ marginBottom: 8 }}>
                  <Text style={[premium.errorText, { color: colors.error }]}>
                    {btError}
                  </Text>
                  <TouchableOpacity
                    onPress={() => Linking.openSettings()}
                    activeOpacity={0.8}
                  >
                    <Text style={[premium.linkText, { color: colors.primary }]}>
                      Open system settings
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              <TouchableOpacity
                style={[
                  premium.primaryBtn,
                  {
                    backgroundColor: isStartingBt
                      ? colors.inputBackground
                      : colors.text,
                    opacity: isStartingBt ? 0.7 : 1,
                  },
                  Shadows.card,
                ]}
                onPress={handleStartPress}
                disabled={isStartingBt}
                activeOpacity={0.85}
              >
                {isStartingBt ? (
                  <ActivityIndicator
                    color={colors.textSecondary}
                    size="small"
                  />
                ) : (
                  <BluetoothIcon
                    size={18}
                    color={
                      bluetoothReady || !isStartingBt
                        ? colors.background
                        : colors.textSecondary
                    }
                  />
                )}
                <Text
                  style={[
                    premium.primaryBtnText,
                    {
                      color: isStartingBt
                        ? colors.textSecondary
                        : colors.background,
                    },
                  ]}
                >
                  {isStartingBt
                    ? 'Starting...'
                    : bluetoothReady
                      ? `Update & restart ("${advertisedName}")`
                      : 'Start Bluetooth'}
                </Text>
              </TouchableOpacity>
              {bluetoothReady ? (
                <TouchableOpacity
                  style={[
                    premium.ghostBtn,
                    { backgroundColor: colors.inputBackground },
                  ]}
                  onPress={stopBluetooth}
                  activeOpacity={0.85}
                >
                  <Text style={[premium.ghostText, { color: colors.text }]}>
                    Stop advertising
                  </Text>
                </TouchableOpacity>
              ) : null}
            </TiltDeck>
          </AnimatedListItem>

          <View style={{ marginTop: Spacing.lg }}>
            <SectionHeader overline="Language" />
            <AnimatedListItem index={1}>
              <GlassCard>
                <View style={premium.rowBetween}>
                  <View style={{ flex: 1 }}>
                    <View style={premium.rowGap}>
                      <Languages size={16} color={colors.primary} />
                      <Text style={[Typography.h3, { color: colors.text }]}>
                        {selectedLanguage.label}
                      </Text>
                    </View>
                    <Text
                      style={[
                        Typography.caption,
                        { color: colors.textSecondary, marginTop: 4 },
                      ]}
                    >
                      {isLanguageInstalled(selectedLanguage)
                        ? 'Installed • works offline'
                        : 'Not installed'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[premium.miniBtn, { backgroundColor: colors.text }]}
                    onPress={() => router.push('/settings/language')}
                    activeOpacity={0.85}
                  >
                    <Text
                      style={[
                        premium.miniBtnText,
                        { color: colors.background },
                      ]}
                    >
                      Change
                    </Text>
                  </TouchableOpacity>
                </View>
                {!isLanguageInstalled(selectedLanguage) ? (
                  <TouchableOpacity
                    style={[
                      premium.ghostBtn,
                      { backgroundColor: colors.inputBackground },
                    ]}
                    onPress={handlePromptInstall}
                    activeOpacity={0.85}
                  >
                    <Text style={[premium.ghostText, { color: colors.text }]}>
                      Install &quot;{selectedLanguage.label}&quot; models
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </GlassCard>
            </AnimatedListItem>
          </View>

          <View style={{ marginTop: Spacing.lg }}>
            <SectionHeader
              overline={`Nearby VaaniSetu • ${devices.length}${isScanning ? ' • scanning...' : ''}`}
              actionLabel={isScanning ? 'Stop' : 'Scan'}
              onAction={isScanning ? stopScanning : scanForDevices}
            />
            {scanError ? (
              <GlassCard style={{ marginBottom: 10 }}>
                <Text style={[premium.errorText, { color: colors.error }]}>
                  {scanError}
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openSettings()}
                  activeOpacity={0.8}
                >
                  <Text style={[premium.linkText, { color: colors.primary }]}>
                    Open system settings
                  </Text>
                </TouchableOpacity>
              </GlassCard>
            ) : null}

            {devices.length === 0 ? (
              <GlassCard style={premium.empty}>
                <Search size={30} color={colors.textSecondary} />
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
                  Open app on both phones, then Scan.
                </Text>
              </GlassCard>
            ) : (
              <View style={{ gap: 10 }}>
                {devices.map((device, i) => (
                  <AnimatedListItem key={device.id} index={i}>
                    <GlassCard>
                      <View style={premium.rowBetween}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                          <Text
                            style={[Typography.h3, { color: colors.text }]}
                            numberOfLines={1}
                          >
                            {getDeviceDisplayName(device)}
                          </Text>
                          <Text
                            style={[
                              premium.mono,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {device.id}
                          </Text>
                          {device.rssi !== undefined && (
                            <Text
                              style={[
                                Typography.caption,
                                { color: colors.textSecondary, marginTop: 2 },
                              ]}
                            >
                              Signal: {device.rssi} dBm
                            </Text>
                          )}
                        </View>
                        <TouchableOpacity
                          style={[
                            premium.miniBtn,
                            { backgroundColor: colors.text },
                          ]}
                          disabled={isConnecting}
                          onPress={() => handleConnectPress(device.id)}
                          activeOpacity={0.85}
                        >
                          {isConnecting ? (
                            <ActivityIndicator
                              color={colors.background}
                              size="small"
                            />
                          ) : (
                            <Text
                              style={[
                                premium.miniBtnText,
                                { color: colors.background },
                              ]}
                            >
                              Connect
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </GlassCard>
                  </AnimatedListItem>
                ))}
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
            {messages.length === 0 ? (
              <Text
                style={[
                  styles.emptyChatText,
                  { color: colors.textSecondary, textAlign: 'center' },
                ]}
              >
                Say where you are - messages appear here.
              </Text>
            ) : (
              messages.map((chatMessage) => (
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
          {(voiceError || sttError || ttsError) &&
            !isVoiceRecording &&
            !isTranscribing && (
              <Text
                style={[premium.hintLine, { color: colors.error }]}
                numberOfLines={2}
              >
                {voiceError ??
                  (sttError
                    ? `Speech model: ${sttError}`
                    : `Voice model: ${ttsError}`)}
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
                    premium.hearChipText,
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
                  ? 'Speaking...'
                  : sttLoading || ttsLoading
                    ? 'Loading voice...'
                    : sttReady && ttsReady
                      ? 'Voice ready'
                      : sttError || ttsError
                        ? 'Voice failed'
                        : 'Voice off'}
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
                  onPress={handleClearChat}
                  activeOpacity={0.8}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Clear chat messages"
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
                premium.composer,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.glassBorder,
                },
                Shadows.floating,
              ]}
            >
              <TextInput
                value={message}
                onChangeText={setMessage}
                placeholder={
                  isVoiceRecording ? 'Recording...' : 'Type a message...'
                }
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderRadius: Radius.md,
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
                    backgroundColor: message.trim()
                      ? '#CF5C36'
                      : colors.inputBackground,
                  },
                ]}
                disabled={!message.trim() || isVoiceRecording || isTranscribing}
                onPress={sendMessage}
                activeOpacity={0.85}
              >
                <Send
                  size={18}
                  color={message.trim() ? '#FFFFFF' : colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const premium = {
  headerPad: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
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
  primaryBtnText: { fontSize: 15, fontWeight: '700' as const },
  ghostBtn: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 8,
  },
  ghostText: { fontSize: 14, fontWeight: '600' as const },
  rowBetween: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
  },
  rowGap: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  miniBtn: {
    minWidth: 82,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  miniBtnText: {
    color: '#FFF8EC',
    fontSize: 14,
    fontWeight: '700' as const,
  },
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
  hearChipText: { fontSize: 13, fontWeight: '700' as const },
  utilStatus: { flex: 1, fontSize: 12, fontWeight: '600' as const },
  composer: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8,
    padding: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  circleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
};
