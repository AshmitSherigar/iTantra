import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Device from 'expo-device';

import RecordButton from '@/components/RecordButton';
import TranscriptBox from '@/components/TranscriptBox';
import StatusIndicator from '@/components/StatusIndicator';

import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  SUPPORTED_LANGUAGES,
  isLanguageInstalled,
} from '../../features/models/languages';
import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { FontSize, Radius, Spacing } from '../../constants/theme';
import {
  MESH_DEFAULT_TTL,
  getEnvelopeTtl,
  getMeshStatus,
  makeMeshEnvelope,
  requestMeshDiscovery,
  sendNearbyBroadcast,
  subscribeToBroadcasts,
  subscribeToMeshStatus,
  useMeshSpeech,
} from '../../features/bluetooth';
import type { BroadcastEnvelope, MeshStatus } from '../../features/bluetooth';

type ReceivedMeshMessage = BroadcastEnvelope & {
  receivedAt: number;
  hops: number;
};

function meshLangLabel(lang: string): string {
  const found = SUPPORTED_LANGUAGES.find(
    (l) => l.id === (lang ?? '').trim().toLowerCase(),
  );
  return found ? found.label : lang?.trim() || 'Unknown';
}

/** Relays a message travelled: 0 = arrived directly from the sender. */
function hopsOf(envelope: BroadcastEnvelope): number {
  return Math.max(0, MESH_DEFAULT_TTL - getEnvelopeTtl(envelope));
}

function hopLabel(hops: number): string {
  if (hops <= 0) return 'direct';
  return hops === 1 ? '1 hop' : `${hops} hops`;
}

function shortId(id: string): string {
  const trimmed = (id ?? '').trim();
  if (!trimmed) return '';
  return trimmed.length > 12 ? `…${trimmed.slice(-8)}` : trimmed;
}

function initialOf(name: string): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '?';
  return trimmed.charAt(0).toUpperCase();
}

export default function Index() {
  const { colors } = useTheme();
  const { selectedLanguage } = useLanguage();

  const [transcript, setTranscript] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isRefreshingPeers, setIsRefreshingPeers] = useState(false);
  const [meshStatus, setMeshStatus] = useState<MeshStatus>(() =>
    getMeshStatus(),
  );
  const [meshInbox, setMeshInbox] = useState<ReceivedMeshMessage[]>([]);

  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    sttReady,
    sttLoading,
    sttError,
    startVoice,
    stopVoice,
    ensureSttReady,
  } = useVoiceMessage();

  // Incoming mesh broadcasts are spoken in the SENDER's language (each
  // envelope carries it), not the receiver's selected language.
  const meshSpeech = useMeshSpeech(true);
  const meshSpeechRef = useRef(meshSpeech);
  useEffect(() => {
    meshSpeechRef.current = meshSpeech;
  }, [meshSpeech]);

  const languageInstalled = isLanguageInstalled(selectedLanguage);
  const sttModelPath = selectedLanguage.sttAssetPath;

  useEffect(() => {
    if (!languageInstalled || !sttModelPath) return;
    void ensureSttReady(sttModelPath);
  }, [sttModelPath, languageInstalled, ensureSttReady]);

  useEffect(() => subscribeToMeshStatus(setMeshStatus), []);
  useEffect(
    () =>
      subscribeToBroadcasts((envelope) => {
        setMeshInbox((current) => {
          if (current.some((m) => m.id === envelope.id)) return current;
          return [
            { ...envelope, receivedAt: Date.now(), hops: hopsOf(envelope) },
            ...current,
          ].slice(0, 20);
        });
        meshSpeechRef.current.speakBroadcast(envelope);
      }),
    [],
  );

  // Discover neighbours once shortly after mount so the nearby list is
  // populated even before the first broadcast.
  useEffect(() => {
    const t = setTimeout(() => {
      void requestMeshDiscovery();
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  const handleRefreshPeers = useCallback(async () => {
    if (isRefreshingPeers) return;
    setIsRefreshingPeers(true);
    try {
      await requestMeshDiscovery();
    } finally {
      setIsRefreshingPeers(false);
    }
  }, [isRefreshingPeers]);

  const handleClearInbox = useCallback(() => {
    meshSpeechRef.current.stop();
    setMeshInbox([]);
  }, []);

  const status: 'ready' | 'listening' | 'processing' | 'error' = isRecording
    ? 'listening'
    : isTranscribing || sttLoading
      ? 'processing'
      : voiceError || sttError
        ? 'error'
        : 'ready';

  function promptInstallLanguage() {
    Alert.alert(
      'Language model not installed',
      `The "${selectedLanguage.label}" voice models aren't installed yet. Install it or switch to an installed language to use the microphone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Install',
          onPress: () =>
            Alert.alert(
              'Install language model',
              `"${selectedLanguage.label}" model download isn't available yet.`,
              [{ text: 'OK' }],
            ),
        },
        {
          text: 'View Languages',
          onPress: () => router.push('/settings/language'),
        },
      ],
    );
  }

  async function handleRecording() {
    if (isRecording) {
      const text = await stopVoice();
      if (text) {
        setTranscript(text);
      }
      return;
    }

    if (isTranscribing || sttLoading) return;

    if (!languageInstalled || !sttModelPath) {
      promptInstallLanguage();
      return;
    }

    // Stop mesh playback first so the mic doesn't pick up the speaker.
    try {
      meshSpeechRef.current.stop();
    } catch {}
    setTranscript('');
    await ensureSttReady(sttModelPath);
    await startVoice();
  }

  async function handleBroadcast() {
    const message = transcript.trim();
    if (!message || isBroadcasting) return;

    setIsBroadcasting(true);
    const senderName =
      Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu';
    try {
      const sent = await sendNearbyBroadcast(
        makeMeshEnvelope({
          senderName,
          message,
          language: selectedLanguage.id,
        }),
      );
      // Read the just-published flood detail (counts are module-fresh here,
      // not the possibly-stale render state).
      const fresh = getMeshStatus();
      if (sent && fresh.lastDelivered > 0) {
        const partial = fresh.lastDelivered < fresh.lastAttempted;
        Alert.alert(
          partial
            ? `Reached ${fresh.lastDelivered} of ${fresh.lastAttempted}`
            : `Sent to ${fresh.lastDelivered}`,
          partial
            ? 'Some links were unreachable — the rest may still get it as nearby phones relay.'
            : 'Every nearby VaaniSetu phone receives it and relays it further.',
          [{ text: 'OK' }],
        );
      } else {
        Alert.alert(
          'No nearby devices',
          'No nearby VaaniSetu phone was reachable. Keep Bluetooth + Location ON, keep the app open on both phones, and try again.',
          [{ text: 'OK' }],
        );
      }
    } catch (error) {
      console.warn('[Broadcast] send failed:', error);
      Alert.alert(
        'Broadcast failed',
        'Bluetooth could not send this message. Check that Bluetooth is on and try again.',
        [{ text: 'OK' }],
      );
    } finally {
      setIsBroadcasting(false);
    }
  }

  const canBroadcast =
    transcript.trim().length > 0 &&
    !isRecording &&
    !isTranscribing &&
    !isBroadcasting;

  const sttStatusLine = !languageInstalled
    ? `${selectedLanguage.label} • Model not installed`
    : sttLoading
      ? `${selectedLanguage.label} • Loading speech model…`
      : sttError
        ? `${selectedLanguage.label} • Model failed: ${sttError}`
        : sttReady
          ? `${selectedLanguage.label} • Speech model ready`
          : `${selectedLanguage.label} • Tap mic to load model`;

  const scanning = meshStatus.isScanning || isRefreshingPeers;
  const peers = meshStatus.peers;
  const voiceHint = meshSpeech.isSpeaking
    ? `Speaking${meshSpeech.spokenLangLabel ? ` • ${meshSpeech.spokenLangLabel}` : ''}…`
    : meshSpeech.isLoadingVoice
      ? 'Loading voice…'
      : meshSpeech.enabled
        ? 'Plays in the sender’s language'
        : 'Off — messages arrive silently';

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={[styles.overline, { color: colors.textSecondary }]}>
              VaaniSetu mesh
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>
              Speech to Text
            </Text>
          </View>
          <View
            style={[
              styles.livePill,
              {
                backgroundColor: isRecording ? colors.error : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.liveDot,
                {
                  backgroundColor: isRecording ? '#FFFFFF' : colors.success,
                },
              ]}
            />
            <Text
              style={[
                styles.liveText,
                { color: isRecording ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              {isRecording ? 'LIVE' : 'READY'}
            </Text>
          </View>
        </View>

        <TranscriptBox
          transcript={transcript}
          onChangeText={setTranscript}
          editable
          placeholder={
            isRecording
              ? 'Listening… speak now'
              : `Tap the mic and speak in ${selectedLanguage.label}…`
          }
        />

        <Pressable
          onPress={handleBroadcast}
          disabled={!canBroadcast}
          style={({ pressed }) => [
            styles.broadcastButton,
            {
              backgroundColor: canBroadcast ? colors.primary : colors.surface,
              opacity: !canBroadcast ? 0.55 : pressed ? 0.86 : 1,
            },
          ]}
        >
          {isBroadcasting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons
              name="megaphone-outline"
              size={18}
              color={canBroadcast ? '#FFFFFF' : colors.textSecondary}
            />
          )}
          <Text
            style={[
              styles.broadcastText,
              { color: canBroadcast ? '#FFFFFF' : colors.textSecondary },
            ]}
          >
            {isBroadcasting ? 'Sending…' : 'Broadcast to nearby'}
          </Text>
        </Pressable>

        {meshStatus.lastResult ? (
          <Text style={[styles.resultLine, { color: colors.textSecondary }]}>
            {meshStatus.lastResult}
          </Text>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.overline, { color: colors.textSecondary }]}>
              Nearby · {peers.length}
              {meshStatus.connectedCount > 0
                ? ` · ${meshStatus.connectedCount} connected`
                : ''}
            </Text>
            <TouchableOpacity
              onPress={handleRefreshPeers}
              disabled={scanning}
              activeOpacity={0.6}
              hitSlop={10}
              style={styles.iconButton}
            >
              {scanning ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name="refresh"
                  size={17}
                  color={colors.textSecondary}
                />
              )}
            </TouchableOpacity>
          </View>

          {peers.length === 0 ? (
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              {scanning
                ? 'Looking for nearby phones…'
                : 'No phones nearby yet. Tap refresh with the app open on both phones.'}
            </Text>
          ) : (
            <View
              style={[
                styles.listCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {peers.map((peer, i) => (
                <View
                  key={peer.id}
                  style={[
                    styles.peerRow,
                    i < peers.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: colors.primaryMuted },
                    ]}
                  >
                    <Text
                      style={[styles.avatarText, { color: colors.primary }]}
                    >
                      {initialOf(peer.name)}
                    </Text>
                  </View>
                  <View style={styles.peerInfo}>
                    <Text
                      style={[styles.peerName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      {peer.name}
                    </Text>
                    <Text
                      style={[styles.peerMeta, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      {peer.rssi !== undefined ? `${peer.rssi} dBm · ` : ''}
                      {shortId(peer.id)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View
            style={[
              styles.listCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.voiceRow}>
              <Ionicons
                name={meshSpeech.enabled ? 'volume-high' : 'volume-mute'}
                size={18}
                color={
                  meshSpeech.enabled ? colors.primary : colors.textSecondary
                }
              />
              <View style={styles.peerInfo}>
                <Text style={[styles.peerName, { color: colors.text }]}>
                  Hear incoming
                </Text>
                <Text
                  style={[styles.peerMeta, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {voiceHint}
                </Text>
              </View>
              <Switch
                value={meshSpeech.enabled}
                onValueChange={meshSpeech.setEnabled}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
            {meshSpeech.isSpeaking ? (
              <TouchableOpacity
                onPress={meshSpeech.stop}
                activeOpacity={0.6}
                style={styles.stopRow}
              >
                <Text style={[styles.stopText, { color: colors.error }]}>
                  Stop voice
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.overline, { color: colors.textSecondary }]}>
              Received · {meshInbox.length}
            </Text>
            {meshInbox.length > 0 ? (
              <TouchableOpacity
                onPress={handleClearInbox}
                activeOpacity={0.6}
                hitSlop={10}
              >
                <Text style={[styles.clearText, { color: colors.primary }]}>
                  Clear
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {meshInbox.length === 0 ? (
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              Broadcasts from nearby phones land here.
            </Text>
          ) : (
            <View
              style={[
                styles.listCard,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                },
              ]}
            >
              {meshInbox.map((item, i) => (
                <View
                  key={item.id}
                  style={[
                    styles.messageBlock,
                    i < meshInbox.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.messageMeta,
                      { color: colors.textSecondary },
                    ]}
                    numberOfLines={1}
                  >
                    {item.senderName} · {meshLangLabel(item.language)} ·{' '}
                    {hopLabel(item.hops)} ·{' '}
                    {new Date(item.receivedAt).toLocaleTimeString()}
                  </Text>
                  <Text style={[styles.messageText, { color: colors.text }]}>
                    {item.message}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={[styles.languageLine, { color: colors.textSecondary }]}>
          {sttStatusLine}
        </Text>

        {voiceError || sttError ? (
          !isRecording && !isTranscribing ? (
            <Text style={[styles.errorLine, { color: colors.error }]}>
              {voiceError ?? `Speech model: ${sttError}`}
            </Text>
          ) : null
        ) : null}

        {!languageInstalled ? (
          <Pressable
            onPress={promptInstallLanguage}
            style={[styles.installBanner, { backgroundColor: colors.surface }]}
          >
            <Ionicons
              name="download-outline"
              size={16}
              color={colors.primary}
            />
            <Text style={[styles.installText, { color: colors.primary }]}>
              Install “{selectedLanguage.label}” models to enable the mic
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View
        style={[
          styles.micDock,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text
          style={[styles.micTitle, { color: colors.text }]}
          numberOfLines={1}
        >
          {isRecording
            ? `Listening in ${selectedLanguage.label}…`
            : isTranscribing || sttLoading
              ? 'Working…'
              : 'Tap to speak'}
        </Text>
        <RecordButton isRecording={isRecording} onPress={handleRecording} />
        <StatusIndicator status={status} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.md,
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },

  overline: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },

  title: {
    marginTop: 2,
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.round,
    borderWidth: 1,
  },

  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },

  liveText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },

  broadcastButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.md,
    height: 52,
    borderRadius: Radius.round,
  },

  broadcastText: {
    fontSize: FontSize.medium,
    fontWeight: '700',
  },

  resultLine: {
    marginTop: Spacing.sm,
    fontSize: 12,
    textAlign: 'center',
  },

  section: {
    marginTop: Spacing.lg,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },

  iconButton: {
    padding: 4,
  },

  muted: {
    fontSize: 13,
    lineHeight: 19,
  },

  listCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },

  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
  },

  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarText: {
    fontSize: 16,
    fontWeight: '800',
  },

  peerInfo: {
    flex: 1,
  },

  peerName: {
    fontSize: 15,
    fontWeight: '700',
  },

  peerMeta: {
    marginTop: 1,
    fontSize: 12,
  },

  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },

  stopRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },

  stopText: {
    fontSize: 13,
    fontWeight: '700',
  },

  clearText: {
    fontSize: 13,
    fontWeight: '700',
  },

  messageBlock: {
    paddingVertical: 11,
    gap: 4,
  },

  messageMeta: {
    fontSize: 11,
    fontWeight: '600',
  },

  messageText: {
    fontSize: 15,
    lineHeight: 21,
  },

  languageLine: {
    marginTop: Spacing.lg,
    fontSize: 12,
  },

  errorLine: {
    marginTop: 4,
    fontSize: 12,
  },

  installBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },

  installText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },

  micDock: {
    alignItems: 'center',
    gap: 2,
    marginTop: Spacing.sm,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },

  micTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
});
