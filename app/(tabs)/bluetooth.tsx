import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import * as Device from 'expo-device';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useVoiceMessage } from '@/features/audio/useVoiceMessage';
import { useAutoSpeak } from '@/features/tts/useAutoSpeak';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { isLanguageInstalled } from '@/features/models/languages';
import { router } from 'expo-router';
import { logger } from '@/utils/logger';
import {
  MAX_ADVERTISED_NAME_LEN,
  getDeviceDisplayName,
  promptInstallLanguage,
  useBleAdvertiser,
  useBleConnection,
  useBleMessages,
  useBleModels,
  useBleScanner,
} from '@/features/bluetooth';

export default function BluetoothScreen() {
  const { colors } = useTheme();
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
    isReady: ttsReady,
    isLoading: ttsLoading,
    error: ttsError,
    isSpeaking: ttsSpeaking,
    stop: stopTts,
    speakFullMessage,
    beginStream: ttsBeginStream,
    pushStreamText: ttsPushText,
    endStream: ttsEndStream,
    ensureReady: ensureTtsReady,
    release: releaseTts,
  } = useAutoSpeak(true, { autoInit: false });

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
    connectedDeviceId,
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

  // NOTE: homepage mesh broadcast is owned solely by the always-on mesh
  // runtime (flood to ALL nearby app phones, no manual connect). This screen
  // keeps the manual 1-to-1 chat only, so it must NOT override that sender.

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

  /** Toggle voice recording on/off. On stop → transcribe → send. */
  const handleVoiceToggle = useCallback(async () => {
    if (!isVoiceRecording && !languageInstalled) {
      promptInstallLanguage(selectedLanguage);
      return;
    }
    try {
      if (isVoiceRecording) {
        // Stop recording → transcribe → send
        const text = await stopVoice();
        if (text) {
          await sendTextOverBLE(text);
        }
      } else {
        // Halt speaker playback first: avoids the mic picking up TTS output
        // and avoids AudioTrack/AudioRecord contention on low-end devices.
        try {
          stopTts();
        } catch {}
        await startVoice();
      }
    } catch (e) {
      logger.warn('Chat', 'Voice toggle failed', e);
    }
  }, [
    isVoiceRecording,
    selectedLanguage,
    sendTextOverBLE,
    startVoice,
    stopTts,
    stopVoice,
    languageInstalled,
  ]);

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
            VaaniSetu
          </Text>
        </View>

        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: bluetoothReady
                ? '#DCFCE7'
                : colors.inputBackground,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: bluetoothReady ? colors.success : colors.textSecondary },
            ]}
          >
            {bluetoothReady ? 'Ready' : 'Not started'}
          </Text>
        </View>
      </View>

      {!isChatConnected ? (
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
              Set the name other phones will see, then start Bluetooth to
              advertise. Tap Start only once — tapping again changes your BLE
              address and you appear as a duplicate.
            </Text>
            <Text style={[styles.nameLabel, { color: colors.textSecondary }]}>
              YOUR DEVICE NAME (max {MAX_ADVERTISED_NAME_LEN} chars for BLE)
            </Text>
            <TextInput
              value={displayName}
              onChangeText={(t) =>
                setDisplayName(t.slice(0, MAX_ADVERTISED_NAME_LEN))
              }
              placeholder={Device.modelName ?? 'e.g. Rahul'}
              placeholderTextColor={colors.textSecondary}
              maxLength={MAX_ADVERTISED_NAME_LEN}
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
                <Text style={[styles.btErrorText, { color: colors.error }]}>
                  {btError}
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openSettings()}
                  activeOpacity={0.8}
                >
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
                  backgroundColor: isStartingBt
                    ? colors.textSecondary
                    : colors.primary,
                  opacity: isStartingBt ? 0.7 : 1,
                },
              ]}
              onPress={handleStartPress}
              disabled={isStartingBt}
              activeOpacity={0.82}
            >
              {isStartingBt ? (
                <ActivityIndicator
                  color="#FFFFFF"
                  size="small"
                  style={styles.buttonIcon}
                />
              ) : (
                <Ionicons
                  name="bluetooth"
                  size={18}
                  color="#FFFFFF"
                  style={styles.buttonIcon}
                />
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
                style={[
                  styles.stopButton,
                  { backgroundColor: colors.inputBackground },
                ]}
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
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Language
            </Text>
            <Text
              style={[
                styles.sectionDescription,
                { color: colors.textSecondary },
              ]}
            >
              Voice models for the selected language load when a chat opens.
              Only that language stays in memory.
            </Text>
            <View
              style={[
                styles.deviceCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.deviceInfo}>
                <Text style={[styles.deviceName, { color: colors.text }]}>
                  {selectedLanguage.label}
                </Text>
                <Text
                  style={[styles.deviceId, { color: colors.textSecondary }]}
                >
                  {languageInstalled
                    ? 'Installed • works offline'
                    : 'Not installed'}
                </Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.connectButton,
                  { backgroundColor: colors.primary },
                ]}
                onPress={() => router.push('/settings/language')}
                activeOpacity={0.82}
              >
                <Text style={styles.connectButtonText}>Change</Text>
              </TouchableOpacity>
            </View>
            {!languageInstalled ? (
              <TouchableOpacity
                style={[
                  styles.stopButton,
                  { backgroundColor: colors.inputBackground, marginTop: 8 },
                ]}
                onPress={handlePromptInstall}
                activeOpacity={0.82}
              >
                <Text style={[styles.stopButtonText, { color: colors.text }]}>
                  Install “{selectedLanguage.label}” models
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Nearby VaaniSetu Devices
                </Text>
                <Text
                  style={[styles.deviceCount, { color: colors.textSecondary }]}
                >
                  {devices.length} app device{devices.length === 1 ? '' : 's'}{' '}
                  found{isScanning ? ' • scanning…' : ''}
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
                <Text style={styles.scanButtonText}>
                  {isScanning ? 'Stop' : 'Scan'}
                </Text>
              </TouchableOpacity>
            </View>

            {scanError ? (
              <View style={styles.btErrorBox}>
                <Text style={[styles.btErrorText, { color: colors.error }]}>
                  {scanError}
                </Text>
                <TouchableOpacity
                  onPress={() => Linking.openSettings()}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.btErrorLink, { color: colors.primary }]}>
                    Open system settings
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {devices.length === 0 ? (
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
                  name="search-outline"
                  size={32}
                  color={colors.textSecondary}
                  style={{ marginBottom: Spacing.sm }}
                />
                <Text style={[styles.emptyStateTitle, { color: colors.text }]}>
                  No VaaniSetu devices found
                </Text>
                <Text
                  style={[
                    styles.emptyStateText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Only phones running this app appear here. Ask the other phone
                  to open the app (mesh runs in the background), then tap Scan.
                </Text>
              </View>
            ) : (
              <View style={styles.deviceList}>
                {devices.map((device) => (
                  <View
                    key={device.id}
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
                        {getDeviceDisplayName(device)}
                      </Text>
                      <Text
                        style={[
                          styles.deviceId,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {device.id}
                      </Text>
                      {device.rssi !== undefined && (
                        <Text
                          style={[
                            styles.deviceRssi,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Signal: {device.rssi} dBm
                        </Text>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.connectButton,
                        { backgroundColor: colors.primary },
                      ]}
                      disabled={isConnecting}
                      onPress={() => handleConnectPress(device.id)}
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
              {
                backgroundColor: colors.surface,
                borderBottomColor: colors.border,
              },
            ]}
          >
            <View style={styles.connectionInfo}>
              <View
                style={[
                  styles.connectedDot,
                  { backgroundColor: colors.success },
                ]}
              />
              <View>
                <Text style={[styles.connectedTitle, { color: colors.text }]}>
                  Connected
                </Text>
                <Text
                  style={[
                    styles.connectedRole,
                    { color: colors.textSecondary },
                  ]}
                >
                  {connectedDeviceId
                    ? 'Central (scanner)'
                    : 'Peripheral (advertiser)'}{' '}
                  • {selectedLanguage.label}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.disconnectButton,
                { backgroundColor: colors.inputBackground },
              ]}
              onPress={disconnectFromDevice}
              activeOpacity={0.8}
            >
              <Text style={[styles.disconnectText, { color: colors.text }]}>
                Disconnect
              </Text>
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
                <Text
                  style={[
                    styles.emptyChatText,
                    { color: colors.textSecondary },
                  ]}
                >
                  Messages from either device will appear here.
                </Text>
              </View>
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
                          : { color: colors.text },
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

            {!ttsReady && ttsEnabled ? (
              <Text style={[styles.ttsStatus, { color: colors.textSecondary }]}>
                {ttsLoading
                  ? 'Loading voice…'
                  : ttsError
                    ? `Voice failed: ${ttsError}`
                    : 'Voice not loaded'}
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

          {/* Voice error message */}
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
              value={message}
              onChangeText={setMessage}
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
                  backgroundColor: message.trim()
                    ? colors.primary
                    : colors.inputBackground,
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
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.sm,
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
    borderBlockColor: '#D1D5DB',
    borderWidth: 1,
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

  sttBar: {
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 8,
    borderTopWidth: 1,
  },

  sttStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  statusDotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  sttStatusText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
});
