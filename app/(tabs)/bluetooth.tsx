import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { useAutoSpeak } from '../../features/tts/useAutoSpeak';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isLanguageInstalled } from '../../features/models/languages';
import { router } from 'expo-router';
import { Spacing } from '../../constants/theme';
import { styles } from './bluetooth.styles';

import {
  MAX_ADVERTISED_NAME_LEN,
  getDeviceDisplayName,
  promptInstallLanguage,
  useBleAdvertiser,
  useBleConnection,
  useBleMessages,
  useBleModels,
  useBleScanner,
} from '../../features/bluetooth';

/**
 * Bluetooth chat screen — UI composition only.
 *
 * All BLE logic lives in `features/bluetooth/`:
 * - `constants` / `codec` / `devices` / `transport` — pure protocol helpers
 * - `permissions` — BT + Location runtime requests (new-Android scan fix)
 * - `useBleAdvertiser` — peripheral setup + advertising
 * - `useBleScanner` — discovery (requests permissions before scanning)
 * - `useBleConnection` — GATT connect/disconnect + framed sends
 * - `useBleMessages` — message list + packet reassembly + streaming TTS feed
 * - `useBleModels` — heavy STT/TTS load on connect, release on disconnect
 */
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

  // Auto-speak incoming messages via streaming Hindi TTS.
  // autoInit:false — the ~114MB VITS model loads only after the two devices
  // connect (see useBleModels), so idle RAM stays low.
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
    if (!isVoiceRecording && !isLanguageInstalled(selectedLanguage)) {
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
                  {isLanguageInstalled(selectedLanguage)
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
            {!isLanguageInstalled(selectedLanguage) ? (
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

          {/* STT status (terminal holds the full logs) */}
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
