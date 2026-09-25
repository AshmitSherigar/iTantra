import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
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
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';

import RecordButton from '@/components/RecordButton';
import TranscriptBox from '@/components/TranscriptBox';
import StatusIndicator from '@/components/StatusIndicator';
import LinkifiedMessage from '../../features/sos/LinkifiedMessage';

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
  /** Mirror of pttHoldingRef for UI (warm-up indicator while mic opens). */
  const [pttHolding, setPttHolding] = useState(false);

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
  // dies in warm-up — pre-requesting keeps the hold path dialog-free and
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
  }, [selectedLanguage.label]);

  // Push-to-talk guards. Refs mirror state so press-in/out handlers (which
  // can interleave with async mic start/stop) never act on stale closures.
  // NOTE: release decisions use the synchronous `isVoiceActive()` (native
  // handle held OR start in flight), never `isRecording` state alone — state
  // lags a render behind `mic.start()`, and that gap used to strand the mic
  // open when the finger lifted early.
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
        // Read the just-published flood detail (counts are module-fresh here,
        // not the possibly-stale render state).
        const fresh = getMeshStatus();
        if (!(sent && fresh.lastDelivered > 0)) {
          // Distress rule: success stays inline (result line below) with no
          // blocking popup; only failure interrupts — nobody heard you.
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
    },
    [selectedLanguage.id],
  );

  /** Manual send for typed/edited text in the transcript box. */
  const handleBroadcast = useCallback(async () => {
    await broadcastText(transcript);
  }, [broadcastText, transcript]);

  // Shown once per session when the speech model itself is broken (not for
  // ordinary "no speech detected" results, which stay as the red error line).
  const modelAlertShownRef = useRef(false);
  const showModelFailedAlert = useCallback((detail: string | null) => {
    if (modelAlertShownRef.current) return;
    modelAlertShownRef.current = true;
    Alert.alert(
      'Speech model failed to load',
      detail
        ? `The on-device speech model could not start:\n\n${detail}\n\nRebuild the app with the latest code and reinstall it, then try again.`
        : 'The on-device speech model could not start. Rebuild the app with the latest code and reinstall it, then try again.',
      [{ text: 'OK' }],
    );
  }, []);

  /**
   * Push-to-talk press-in: start capturing. Ignored while transcribing,
   * sending, or when the language model isn't installed.
   */
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
    // Walkie-talkie max-TX: force a normal release (stop + transcribe) even
    // if the finger never lifts, so the mic can never wedge open.
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
    // Stop mesh playback first so the mic doesn't pick up the speaker.
    try {
      meshSpeechRef.current.stop();
    } catch {}
    setTranscript('');
    try {
      await ensureSttReady(sttModelPath);
    } catch {
      // Belt-and-braces: ensureSttReady reports via state, verify below.
    }
    // NOTE: ensureSttReady() resolves normally even when the native load
    // fails (failure lands in engine status), so verify synchronously —
    // otherwise we'd open the mic with no working model and the hold would
    // transcribe nothing.
    const sttStatus = getSttStatus();
    if (!sttStatus.isInitialized) {
      pttHoldingRef.current = false;
      setPttHolding(false);
      clearPttTimeout();
      showModelFailedAlert(sttStatus.lastError);
      return;
    }
    modelAlertShownRef.current = false;
    // The finger may have lifted while the model was loading — don't open
    // the mic into a dead hold.
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

  /**
   * Push-to-talk release: stop and transcribe into the transcript box.
   * Sending is always manual via the Broadcast button. Releases landing
   * mid-warm-up are NOT fatal: stopVoice waits for the launch to settle and
   * transcribes whatever arrived (possibly ~nothing, which yields the usual
   * empty-speech error instead of a phantom abort). Empty results just stay
   * in the box (error line explains why).
   */
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
      // Null = either the model is broken (init/transcribe threw) or just
      // empty speech. Only the broken-model case gets an alert; empty speech
      // stays as the red error line under the inbox.
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

  // Latest release fn for the max-hold timer / AppState listener below.
  const handlePttPressOutRef = useRef(handlePttPressOut);
  useEffect(() => {
    handlePttPressOutRef.current = handlePttPressOut;
  }, [handlePttPressOut]);

  /**
   * Cancel path: drop the hold silently (app backgrounded past the grace
   * period, unmount). A completed recording in progress is left to the
   * normal release path.
   */
  const cancelPttHold = useCallback(async () => {
    if (!pttHoldingRef.current) return;
    pttHoldingRef.current = false;
    setPttHolding(false);
    clearPttTimeout();
    if (isVoiceActive()) {
      await abortVoice();
    }
  }, [abortVoice, clearPttTimeout, isVoiceActive]);

  // Backgrounding mid-hold must never leave the mic live: no release event
  // fires when the app loses focus, so cancel the hold here. NOTE: only
  // 'background' cancels — 'inactive' is transient (permission dialogs,
  // notification shade, app switcher) and the finger is usually still down,
  // so killing the hold there strands otherwise-healthy holds.
  //
  // Even 'background' gets a short grace period: on some OEM skins the mic
  // permission check itself flashes system UI that pauses the activity for
  // a fraction of a second. A real backgrounding (home button, app switch)
  // persists past the grace and still cancels; a flicker returns to active
  // and the hold survives untouched.
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
      ? `${selectedLanguage.label} • Loading speech model…`
      : sttError
        ? `${selectedLanguage.label} • Model failed: ${sttError}`
        : sttReady
          ? `${selectedLanguage.label} • Speech model ready`
          : `${selectedLanguage.label} • Hold mic to load model`;

  const scanning = meshStatus.isScanning || isRefreshingPeers;
  const peers = meshStatus.peers;
  const voiceHint = meshSpeech.isSpeaking
    ? `Speaking${meshSpeech.spokenLangLabel ? ` • ${meshSpeech.spokenLangLabel}` : ''}…`
    : meshSpeech.isLoadingVoice
      ? 'Loading voice…'
      : !meshSpeech.enabled
        ? "Off — you won't hear replies."
        : null;

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
            <Text style={[styles.title, { color: colors.text }]}>
              Get Help
            </Text>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              Hold mic, speak, broadcast to nearby phones.
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
            isRecording ? 'Listening…' : 'Hold mic — say what + where…'
          }
        />

        <Pressable
          onPress={handleBroadcast}
          disabled={!canBroadcast}
          accessibilityRole="button"
          accessibilityLabel="Broadcast for help to nearby phones"
          accessibilityState={{ disabled: !canBroadcast, busy: isBroadcasting }}
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
            {isBroadcasting ? 'Sending…' : 'Broadcast for help'}
          </Text>
        </Pressable>

        {meshStatus.lastResult ? (
          <Text style={[styles.resultLine, { color: colors.textSecondary }]}>
            {meshStatus.lastResult}
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={() => router.push('/sos' as any)}
          activeOpacity={0.6}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Open SOS timer"
          style={{ alignSelf: 'center', paddingVertical: 6 }}
        >
          <Text style={{ color: colors.error, fontSize: 13, fontWeight: '700' }}>
            Need help now? Open SOS →
          </Text>
        </TouchableOpacity>

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
              {scanning ? 'Looking…' : 'No nearby phones — keep app open.'}
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
                {voiceHint ? (
                  <Text
                    style={[styles.peerMeta, { color: colors.textSecondary }]}
                    numberOfLines={1}
                  >
                    {voiceHint}
                  </Text>
                ) : null}
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
              Replies from nearby phones appear here.
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
                  <LinkifiedMessage
                    message={item.message}
                    textStyle={[styles.messageText, { color: colors.text }]}
                    linkColor={colors.primary}
                  />
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
            ? `Listening in ${selectedLanguage.label}… release to transcribe`
            : pttHolding
              ? 'Starting mic… keep holding'
              : isTranscribing
                ? 'Transcribing…'
                : isBroadcasting
                  ? 'Sending…'
                  : sttLoading
                    ? 'Working…'
                    : 'Hold to talk'}
        </Text>
        <RecordButton
          isRecording={isRecording}
          disabled={pttDisabled}
          onPressIn={() => void handlePttPressIn()}
          onPressOut={() => void handlePttPressOut()}
        />
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
