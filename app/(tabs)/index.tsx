import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Device from 'expo-device';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import {
  Download,
  Eraser,
  Globe,
  Megaphone,
  Radio,
  Siren,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react-native';

import RecordButton from '@/components/RecordButton';
import TranscriptBox from '@/components/TranscriptBox';
import StatusIndicator from '@/components/StatusIndicator';
import LinkifiedMessage from '../../features/sos/LinkifiedMessage';
import GlassCard from '@/components/ui/GlassCard';
import SpringButton from '@/components/ui/SpringButton';
import CircleButton from '@/components/ui/CircleButton';
import ScreenHeader from '@/components/ui/ScreenHeader';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import SectionHeader from '@/components/ui/SectionHeader';
import { showAppAlert } from '@/components/ui/AppModal';

import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  SUPPORTED_LANGUAGES,
  isLanguageInstalled,
} from '../../features/models/languages';
import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { Radius, Shadows, Spacing, Typography } from '../../constants/theme';
import {
  MESH_DEFAULT_TTL,
  getEnvelopeTtl,
  getMeshStatus,
  isSosEnvelope,
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
  return trimmed.length > 12 ? `...${trimmed.slice(-8)}` : trimmed;
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
  /** Mirror of pttHoldingRef for UI (warm-up indicator while mic opens). */
  const [, setPttHolding] = useState(false);

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
    isVoiceActive,
    abortVoice,
    getSttStatus,
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

  // Ask for mic permission once, up front. A system permission dialog
  // appearing MID-HOLD steals the touch (responder terminate) and the hold
  // dies in warm-up - pre-requesting keeps the hold path dialog-free and
  // makes the first hold fast.
  useEffect(() => {
    (async () => {
      try {
        const current = await Audio.getPermissionsAsync();
        if (!current.granted) {
          await Audio.requestPermissionsAsync();
        }
      } catch {
        // Permission errors surface when the mic is actually used.
      }
    })();
  }, []);
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
        // SOS is siren-only: stop any ongoing readout so the siren is clear,
        // never speak the SOS text.
        if (isSosEnvelope(envelope)) {
          try {
            meshSpeechRef.current.stop();
          } catch {}
          return;
        }
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

  const promptInstallLanguage = useCallback(() => {
    void (async () => {
      const picked = await showAppAlert(
        'Language model not installed',
        `The "${selectedLanguage.label}" voice models aren't installed yet. Install it or switch to an installed language to use the microphone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Install' },
          {
            text: 'View Languages',
            onPress: () => router.push('/settings/language'),
          },
        ],
      );
      if (picked === 1) {
        await showAppAlert(
          'Install language model',
          `"${selectedLanguage.label}" model download isn't available yet.`,
          [{ text: 'OK' }],
        );
      }
    })();
  }, [selectedLanguage.label]);

  // Push-to-talk guards. Refs mirror state so press-in/out handlers (which
  // can interleave with async mic start/stop) never act on stale closures.
  const pttHoldingRef = useRef(false);
  const pttTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Walkie-talkie max transmission: a hold can never wedge the mic open. */
  const PTT_MAX_HOLD_MS = 60000;
  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  const isBroadcastingRef = useRef(false);
  useEffect(() => {
    isBroadcastingRef.current = isBroadcasting;
  }, [isBroadcasting]);
  const isTranscribingRef = useRef(isTranscribing);
  useEffect(() => {
    isTranscribingRef.current = isTranscribing;
  }, [isTranscribing]);

  const clearPttTimeout = useCallback(() => {
    if (pttTimeoutRef.current) {
      clearTimeout(pttTimeoutRef.current);
      pttTimeoutRef.current = null;
    }
  }, []);

  const broadcastText = useCallback(
    async (rawText: string) => {
      const message = rawText.trim();
      if (!message || isBroadcastingRef.current) return;

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
        const fresh = getMeshStatus();
        if (!(sent && fresh.lastDelivered > 0)) {
          // Distress rule: success stays inline (result line below) with no
          // blocking popup; only failure interrupts - nobody heard you.
          await showAppAlert(
            'No nearby devices',
            'No nearby VaaniSetu phone was reachable. Keep Bluetooth + Location ON, keep the app open on both phones, and try again.',
            [{ text: 'OK' }],
          );
        }
      } catch (error) {
        console.warn('[Broadcast] send failed:', error);
        await showAppAlert(
          'Broadcast failed',
          'Bluetooth could not send this message. Check that Bluetooth is on and try again.',
          [{ text: 'OK' }],
        );
      } finally {
        setIsBroadcasting(false);
      }
    },
    [selectedLanguage.id],
  );

  /** Manual send for typed/edited text in the transcript box. */
  const handleBroadcast = useCallback(async () => {
    await broadcastText(transcript);
  }, [broadcastText, transcript]);

  const modelAlertShownRef = useRef(false);
  const showModelFailedAlert = useCallback((detail: string | null) => {
    if (modelAlertShownRef.current) return;
    modelAlertShownRef.current = true;
    void showAppAlert(
      'Speech model failed to load',
      detail
        ? `The on-device speech model could not start:\n\n${detail}\n\nRebuild the app with the latest code and reinstall it, then try again.`
        : 'The on-device speech model could not start. Rebuild the app with the latest code and reinstall it, then try again.',
      [{ text: 'OK' }],
    );
  }, []);

  const handlePttPressIn = useCallback(async () => {
    if (pttHoldingRef.current) return;
    if (
      isRecordingRef.current ||
      isTranscribingRef.current ||
      isBroadcastingRef.current ||
      sttLoading
    ) {
      return;
    }
    if (!languageInstalled || !sttModelPath) {
      promptInstallLanguage();
      return;
    }
    pttHoldingRef.current = true;
    setPttHolding(true);
    clearPttTimeout();
    pttTimeoutRef.current = setTimeout(() => {
      pttTimeoutRef.current = null;
      void handlePttPressOutRef.current();
    }, PTT_MAX_HOLD_MS);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
        () => {},
      );
    } catch {}
    try {
      meshSpeechRef.current.stop();
    } catch {}
    setTranscript('');
    try {
      await ensureSttReady(sttModelPath);
    } catch {}
    const sttStatus = getSttStatus();
    if (!sttStatus.isInitialized) {
      pttHoldingRef.current = false;
      setPttHolding(false);
      clearPttTimeout();
      showModelFailedAlert(sttStatus.lastError);
      return;
    }
    modelAlertShownRef.current = false;
    if (!pttHoldingRef.current) {
      setPttHolding(false);
      return;
    }
    await startVoice();
  }, [
    clearPttTimeout,
    ensureSttReady,
    getSttStatus,
    languageInstalled,
    promptInstallLanguage,
    showModelFailedAlert,
    startVoice,
    sttLoading,
    sttModelPath,
  ]);

  const handlePttPressOut = useCallback(async () => {
    if (!pttHoldingRef.current) return;
    pttHoldingRef.current = false;
    setPttHolding(false);
    clearPttTimeout();
    if (!isVoiceActive()) return;
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => {},
      );
    } catch {}
    const text = await stopVoice();
    if (!text) {
      const sttStatus = getSttStatus();
      if (!sttStatus.isInitialized) {
        showModelFailedAlert(sttStatus.lastError);
      }
      return;
    }
    setTranscript(text);
  }, [
    clearPttTimeout,
    getSttStatus,
    isVoiceActive,
    showModelFailedAlert,
    stopVoice,
  ]);

  const handlePttPressOutRef = useRef(handlePttPressOut);
  useEffect(() => {
    handlePttPressOutRef.current = handlePttPressOut;
  }, [handlePttPressOut]);

  const cancelPttHold = useCallback(async () => {
    if (!pttHoldingRef.current) return;
    pttHoldingRef.current = false;
    setPttHolding(false);
    clearPttTimeout();
    if (isVoiceActive()) {
      await abortVoice();
    }
  }, [abortVoice, clearPttTimeout, isVoiceActive]);

  const bgGraceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const APP_BACKGROUND_GRACE_MS = 2500;
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        if (bgGraceTimeoutRef.current) {
          clearTimeout(bgGraceTimeoutRef.current);
        }
        bgGraceTimeoutRef.current = setTimeout(() => {
          bgGraceTimeoutRef.current = null;
          void cancelPttHold();
        }, APP_BACKGROUND_GRACE_MS);
      } else if (state === 'active') {
        if (bgGraceTimeoutRef.current) {
          clearTimeout(bgGraceTimeoutRef.current);
          bgGraceTimeoutRef.current = null;
        }
      }
    });
    return () => {
      sub.remove();
      if (bgGraceTimeoutRef.current) {
        clearTimeout(bgGraceTimeoutRef.current);
        bgGraceTimeoutRef.current = null;
      }
      void cancelPttHold();
      if (pttTimeoutRef.current) {
        clearTimeout(pttTimeoutRef.current);
        pttTimeoutRef.current = null;
      }
    };
  }, [cancelPttHold]);

  const pttDisabled =
    !isRecording && (isTranscribing || sttLoading || isBroadcasting);

  const canBroadcast =
    transcript.trim().length > 0 &&
    !isRecording &&
    !isTranscribing &&
    !isBroadcasting;

  const sttStatusLine = !languageInstalled
    ? `${selectedLanguage.label} • Model not installed`
    : sttLoading
      ? `${selectedLanguage.label} • Loading speech model...`
      : sttError
        ? `${selectedLanguage.label} • Model failed: ${sttError}`
        : sttReady
          ? `${selectedLanguage.label} • Speech model ready`
          : `${selectedLanguage.label} • Hold mic to load model`;

  const scanning = meshStatus.isScanning || isRefreshingPeers;
  const peers = meshStatus.peers;

  const handleClearTranscript = useCallback(() => {
    try {
      meshSpeechRef.current.stop();
    } catch {}
    setTranscript('');
  }, []);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title="Get Help"
          subtitle="Take a breath. You're in a safe space."
          left={
            <CircleButton
              onPress={() => router.push('/settings/language')}
              accessibilityLabel="Voice language"
            >
              <Globe size={20} color={colors.text} />
            </CircleButton>
          }
          right={
            <CircleButton
              onPress={() =>
                meshSpeech.isSpeaking
                  ? meshSpeech.stop()
                  : meshSpeech.setEnabled(!meshSpeech.enabled)
              }
              accessibilityLabel={
                meshSpeech.isSpeaking
                  ? 'Stop incoming voice'
                  : 'Toggle incoming voice'
              }
            >
              {meshSpeech.isSpeaking ? (
                <Square size={18} color={colors.text} fill={colors.text} />
              ) : meshSpeech.enabled ? (
                <Volume2 size={20} color={colors.text} />
              ) : (
                <VolumeX size={20} color={colors.textSecondary} />
              )}
            </CircleButton>
          }
        />

        <View style={styles.deck}>
          <View
            style={[
              styles.deckBack,
              {
                backgroundColor: colors.primaryMuted,
                borderColor: colors.glassBorder,
              },
            ]}
          />
          <View style={styles.deckFront}>
            <TranscriptBox
              transcript={transcript}
              onChangeText={setTranscript}
              editable
              placeholder={
                isRecording ? 'Listening...' : 'Hold mic - say what + where...'
              }
            />
          </View>
          {transcript.length > 0 ? (
            <CircleButton
              onPress={handleClearTranscript}
              accessibilityLabel="Clear transcribed text"
              size={44}
              style={[styles.badgeRefresh, { backgroundColor: colors.brand }]}
            >
              <Eraser size={19} color="#FFF8EC" />
            </CircleButton>
          ) : null}
        </View>

        <AnimatedListItem index={1}>
          <SpringButton
            title={isBroadcasting ? 'Sending...' : 'Broadcast for help'}
            variant="ink"
            onPress={() => void handleBroadcast()}
            disabled={!canBroadcast}
            loading={isBroadcasting}
            icon={
              <Megaphone
                size={18}
                color={canBroadcast ? colors.background : colors.textSecondary}
              />
            }
            style={styles.broadcast}
          />
        </AnimatedListItem>

        <GlassCard style={styles.micDock} padding={14} radius={20}>
          <RecordButton
            isRecording={isRecording}
            disabled={pttDisabled}
            onPressIn={() => void handlePttPressIn()}
            onPressOut={() => void handlePttPressOut()}
          />
          <StatusIndicator status={status} />
        </GlassCard>

        {meshStatus.lastResult ? (
          <Text style={[styles.resultLine, { color: colors.textSecondary }]}>
            {meshStatus.lastResult}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={() => router.push('/sos' as any)}
          activeOpacity={0.7}
          style={[
            styles.sosLink,
            {
              backgroundColor: colors.errorMuted,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Siren size={16} color={colors.error} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.sosLinkText, { color: colors.error }]}
          >
            Need help now? Open SOS
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => router.push('/mission-mode' as any)}
          activeOpacity={0.7}
          style={[
            styles.sosLink,
            {
              backgroundColor: colors.primaryMuted,
              borderColor: colors.glassBorder,
            },
          ]}
        >
          <Radio size={16} color={colors.primary} />
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[styles.sosLinkText, { color: colors.primary }]}
          >
            Launch Mission Mode
          </Text>
        </TouchableOpacity>

        <View style={styles.section}>
          <SectionHeader
            overline={`Nearby · ${peers.length}${meshStatus.connectedCount > 0 ? ` · ${meshStatus.connectedCount} connected` : ''}`}
            actionLabel={scanning ? 'Looking...' : 'Refresh'}
            onAction={() => void handleRefreshPeers()}
          />
          {peers.length === 0 ? (
            <GlassCard>
              <Text style={[Typography.body, { color: colors.textSecondary }]}>
                {scanning
                  ? 'Looking for nearby phones...'
                  : 'No nearby phones - keep app open on both phones.'}
              </Text>
            </GlassCard>
          ) : (
            <GlassCard padding={8}>
              {peers.map((peer, i) => (
                <AnimatedListItem key={peer.id} index={i}>
                  <View
                    style={[
                      styles.peerRow,
                      i < peers.length - 1 && styles.peerDivider,
                    ]}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {initialOf(peer.name)}
                      </Text>
                    </View>
                    <View style={styles.peerInfo}>
                      <Text
                        style={[Typography.h3, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {peer.name}
                      </Text>
                      <Text
                        style={[
                          Typography.caption,
                          { color: colors.textSecondary },
                        ]}
                        numberOfLines={1}
                      >
                        {peer.rssi !== undefined ? `${peer.rssi} dBm · ` : ''}
                        {shortId(peer.id)}
                      </Text>
                    </View>
                    {scanning && i === 0 ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <View
                        style={[
                          styles.onlineDot,
                          { backgroundColor: colors.success },
                        ]}
                      />
                    )}
                  </View>
                </AnimatedListItem>
              ))}
            </GlassCard>
          )}
        </View>

        <View style={styles.section}>
          <SectionHeader
            overline={`Received · ${meshInbox.length}`}
            actionLabel={meshInbox.length > 0 ? 'Clear' : undefined}
            onAction={handleClearInbox}
          />
          {meshInbox.length === 0 ? (
            <GlassCard>
              <Text style={[Typography.body, { color: colors.textSecondary }]}>
                Replies from nearby phones appear here.
              </Text>
            </GlassCard>
          ) : (
            <GlassCard padding={8}>
              {meshInbox.map((item, i) => (
                <AnimatedListItem key={item.id} index={i}>
                  <View
                    style={[
                      styles.messageBlock,
                      i < meshInbox.length - 1 && styles.peerDivider,
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
                    <LinkifiedMessage
                      message={item.message}
                      textStyle={[styles.messageText, { color: colors.text }]}
                      linkColor={colors.primary}
                    />
                  </View>
                </AnimatedListItem>
              ))}
            </GlassCard>
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
            style={[
              styles.installBanner,
              { backgroundColor: colors.card, borderColor: colors.glassBorder },
            ]}
          >
            <Download size={16} color={colors.primary} />
            <Text style={[styles.installText, { color: colors.primary }]}>
              Install &quot;{selectedLanguage.label}&quot; models to enable the
              mic
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 130,
    gap: 4,
  },
  deck: {
    marginTop: 30,
    marginBottom: 6,
  },
  deckBack: {
    ...StyleSheet.absoluteFillObject,
    top: 8,
    borderRadius: Radius.card,
    borderWidth: 1,
    transform: [{ rotate: '3deg' }],
  },
  deckFront: {
    transform: [{ rotate: '-1.5deg' }],
  },
  badgeRefresh: {
    position: 'absolute',
    top: -22,
    right: 16,
    borderWidth: 0,
  },
  broadcast: { marginTop: 14 },
  resultLine: { marginTop: 8, fontSize: 12, textAlign: 'center' },
  sosLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: Radius.round,
    borderWidth: 1,
  },
  sosLinkText: { fontSize: 13, fontWeight: '800', flexShrink: 1 },
  section: { marginTop: Spacing.lg },
  peerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  peerDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.25)',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F6DECB',
  },
  avatarText: { fontSize: 16, fontWeight: '800', color: '#CF5C36' },
  peerInfo: { flex: 1 },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  messageBlock: { paddingVertical: 10, paddingHorizontal: 10, gap: 4 },
  messageMeta: { fontSize: 11, fontWeight: '600' },
  messageText: { fontSize: 15, lineHeight: 21 },
  languageLine: { marginTop: Spacing.lg, fontSize: 12 },
  errorLine: { marginTop: 4, fontSize: 12 },
  installBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  installText: { flex: 1, fontSize: 13, fontWeight: '700' },
  micDock: {
    alignItems: 'center',
    marginTop: 12,
    ...Shadows.card,
  },
  refreshIcon: { padding: 4 },
});
