import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, Stack } from 'expo-router';
import * as Device from 'expo-device';
import { Globe, LogOut, MessageCircle } from 'lucide-react-native';

import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSos } from '@/context/SosContext';
import { useWifiChat } from '@/features/wifi';
import {
  subscribeToBroadcasts,
  getMeshStatus,
  subscribeToMeshStatus,
  requestMeshDiscovery,
  sendNearbyBroadcast,
  makeMeshEnvelope,
  isRangeEnvelope,
  isSosEnvelope,
  type MeshStatus,
} from '@/features/bluetooth';
import { useVoiceMessage } from '@/features/audio/useVoiceMessage';
import { formatRemaining } from '@/features/sos';
import { isLanguageInstalled } from '@/features/models/languages';

import ScreenHeader from '@/components/ui/ScreenHeader';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import SectionHeader from '@/components/ui/SectionHeader';
import SpringButton from '@/components/ui/SpringButton';
import CircleButton from '@/components/ui/CircleButton';
import { showAppAlert } from '@/components/ui/AppModal';

import PTTButton from '@/components/mission/PTTButton';
import ConnectionStatusBadge from '@/components/mission/ConnectionStatusBadge';
import DeviceStatusRow from '@/components/mission/DeviceStatusRow';
import AlertOverlay from '@/components/mission/AlertOverlay';
import {
  updateMissionSession,
  appendBleMissionMessage,
  subscribeMissionSession,
  getMissionSession,
} from '@/components/mission/missionSession';

import { Radius, Spacing, Typography } from '@/constants/theme';

type TranscriptEntry = {
  id: string;
  sender: string;
  text: string;
  ts: number;
  mine: boolean;
};

/** Dual-transport (WiFi + BLE) delivers the same voice text twice — once per
 *  link — so collapse same-sender + same-text entries arriving within a few
 *  seconds into one row. Window is deliberately small so intentional repeats
 *  typed seconds apart still show. */
const DUPLICATE_WINDOW_MS = 5000;

function dedupeTranscript(sorted: TranscriptEntry[]): TranscriptEntry[] {
  const kept: TranscriptEntry[] = [];
  for (const entry of sorted) {
    const text = entry.text.trim();
    // Look back a few rows: the WiFi + BLE copies of one transmission land
    // milliseconds apart but another message can slip between them.
    let isDuplicate = false;
    for (let i = kept.length - 1; i >= 0 && i >= kept.length - 4; i -= 1) {
      const prev = kept[i];
      if (
        prev.mine === entry.mine &&
        prev.sender === entry.sender &&
        prev.text.trim() === text &&
        Math.abs(entry.ts - prev.ts) <= DUPLICATE_WINDOW_MS
      ) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) kept.push(entry);
  }
  return kept;
}

export default function MissionModeScreen() {
  const { colors } = useTheme();
  const { selectedLanguage } = useLanguage();
  const { activeTimer, remainingMs, startTimer, cancelTimer, extendTimer } =
    useSos();

  const [deviceName] = useState(
    () =>
      Device.deviceName?.trim() || Device.modelName?.trim() || 'iTantra Unit',
  );
  const [deviceId] = useState(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );

  const {
    status: wifiStatus,
    peers: wifiPeers,
    connectedAddresses,
    messages: wifiMessages,
    startHosting,
    connectTo,
    sendToPeer,
    broadcast,
  } = useWifiChat({ deviceName, deviceId, lang: selectedLanguage.id });

  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    sttReady,
    startVoice,
    stopVoice,
    ensureSttReady,
  } = useVoiceMessage();

  const languageInstalled = isLanguageInstalled(selectedLanguage);

  useEffect(() => {
    if (!languageInstalled || !selectedLanguage.sttAssetPath) return;
    void ensureSttReady(selectedLanguage.sttAssetPath);
  }, [languageInstalled, selectedLanguage.sttAssetPath, ensureSttReady]);

  const [meshStatus, setMeshStatus] = useState<MeshStatus>(() =>
    getMeshStatus(),
  );
  useEffect(() => subscribeToMeshStatus(setMeshStatus), []);

  const [currentAlert, setCurrentAlert] = useState<{
    senderName: string;
    message: string;
  } | null>(null);
  /** Guards the Arm-timer tap: startTimer is async, so without this a second
   *  tap fires a concurrent arming round and the first-tap UI looks dead. */
  const [isArming, setIsArming] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!connectingAddress) return;
    if (connectedAddresses.includes(connectingAddress)) {
      setConnectingAddress(null);
      return;
    }
    const timeout = setTimeout(() => setConnectingAddress(null), 6000);
    return () => clearTimeout(timeout);
  }, [connectingAddress, connectedAddresses]);

  const session = useSyncExternalStore(subscribeMissionSession, getMissionSession);

  const bleSendBroadcast = useCallback(
    async (text: string) => {
      const envelope = makeMeshEnvelope({
        senderName: deviceName,
        message: text,
        language: selectedLanguage.id,
      });
      appendBleMissionMessage({
        id: envelope.id,
        senderName: deviceName,
        text,
        ts: Date.now(),
        sender: 'me',
      });
      return sendNearbyBroadcast(envelope);
    },
    [deviceName, selectedLanguage.id],
  );

  useEffect(() => {
    updateMissionSession({
      deviceName,
      deviceId,
      languageId: selectedLanguage.id,
      wifiPeers,
      wifiConnectedAddresses: connectedAddresses,
      wifiMessages,
      wifiSendToPeer: sendToPeer,
      wifiBroadcast: broadcast,
      bleBroadcastSend: bleSendBroadcast,
    });
  }, [
    deviceName,
    deviceId,
    selectedLanguage.id,
    wifiPeers,
    connectedAddresses,
    wifiMessages,
    sendToPeer,
    broadcast,
    bleSendBroadcast,
  ]);

  useEffect(
    () =>
      subscribeToBroadcasts((envelope) => {
        // Device-search ranging pings never enter the mission transcript.
        if (isRangeEnvelope(envelope)) return;
        if (isSosEnvelope(envelope)) {
          setCurrentAlert({
            senderName: envelope.senderName,
            message: envelope.message,
          });
          return;
        }
        appendBleMissionMessage({
          id: envelope.id,
          senderName: envelope.senderName,
          text: envelope.message,
          ts: Date.now(),
          sender: 'other',
        });
      }),
    [],
  );

  const transcript = useMemo<TranscriptEntry[]>(() => {
    const wifiEntries: TranscriptEntry[] = wifiMessages.map((m) => ({
      id: `wifi-${m.id}`,
      sender: m.sender === 'me' ? 'You' : m.peerName,
      text: m.text,
      ts: m.timestamp,
      mine: m.sender === 'me',
    }));
    const bleEntries: TranscriptEntry[] = session.bleMessages.map((m) => ({
      id: `ble-${m.id}`,
      sender: m.sender === 'me' ? 'You' : m.senderName,
      text: m.text,
      ts: m.ts,
      mine: m.sender === 'me',
    }));
    const sorted = [...wifiEntries, ...bleEntries].sort((a, b) => a.ts - b.ts);
    return dedupeTranscript(sorted);
  }, [wifiMessages, session.bleMessages]);

  const handlePttPressIn = useCallback(async () => {
    if (!languageInstalled) {
      await showAppAlert(
        'Language model not installed',
        `Install "${selectedLanguage.label}" models to use voice.`,
        [{ text: 'OK' }],
      );
      return;
    }
    await startVoice();
  }, [languageInstalled, selectedLanguage.label, startVoice]);

  const handlePttPressOut = useCallback(async () => {
    const text = await stopVoice();
    if (!text) return;
    // Mesh chat carries voice text only — location is SOS-timer-only.
    const outgoing = text.trim();
    if (!outgoing) return;
    broadcast(outgoing);
    void bleSendBroadcast(outgoing);
  }, [stopVoice, broadcast, bleSendBroadcast]);

  const handleArmSos = useCallback(async () => {
    if (isArming || activeTimer) return;
    setIsArming(true);
    try {
      await startTimer({
        durationMs: 30 * 60 * 1000,
        helpMessage: 'Mission Mode check-in overdue',
        workspaceLabel: 'Mission Mode',
        includeLocation: true,
      });
    } catch (e) {
      console.warn('[MissionMode] arm timer failed:', e);
      await showAppAlert('Could not arm timer', 'Please try again.', [
        { text: 'OK' },
      ]);
    } finally {
      setIsArming(false);
    }
  }, [isArming, activeTimer, startTimer]);

  const handleConnectAll = useCallback(async () => {
    startHosting();
    for (const peer of wifiPeers) {
      if (!connectedAddresses.includes(peer.address)) {
        connectTo(peer.address);
      }
    }
    await requestMeshDiscovery();
  }, [startHosting, wifiPeers, connectedAddresses, connectTo]);

  const handleConnectOne = useCallback(
    (address: string) => {
      setConnectingAddress(address);
      connectTo(address);
    },
    [connectTo],
  );

  const handleOpenPrivateChat = useCallback(
    (peer: { name: string; address: string }) => {
      router.push({
        pathname: '/private-chat' as any,
        params: { address: peer.address, name: peer.name, transport: 'wifi' },
      });
    },
    [],
  );

  const handlePrivateChatPress = useCallback(async () => {
    const connectedPeers = wifiPeers.filter((p) =>
      connectedAddresses.includes(p.address),
    );
    if (connectedPeers.length === 0) {
      await showAppAlert(
        'No connected device',
        'Connect to a device first to start a private chat.',
        [{ text: 'OK' }],
      );
      return;
    }
    await showAppAlert('Private Chat', 'Choose a device to message privately.', [
      ...connectedPeers.map((p) => ({
        text: p.name,
        onPress: () => handleOpenPrivateChat(p),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [wifiPeers, connectedAddresses, handleOpenPrivateChat]);

  const handleExit = useCallback(() => {
    router.replace('/(tabs)');
  }, []);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />

      <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }}>
        <ScreenHeader
          title="Mission Mode"
          subtitle="WiFi + BLE mesh, live"
          left={
            <CircleButton onPress={handleExit} accessibilityLabel="Exit Mission Mode">
              <LogOut size={20} color={colors.text} />
            </CircleButton>
          }
          right={
            <CircleButton
              onPress={() => router.push('/settings/language' as any)}
              accessibilityLabel="Change voice language"
            >
              <Globe size={20} color={colors.text} />
            </CircleButton>
          }
        />
        <ConnectionStatusBadge
          wifiStatus={wifiStatus}
          wifiConnectedCount={connectedAddresses.length}
          bleConnectedCount={meshStatus.connectedCount}
        />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {activeTimer ? (
          <AnimatedListItem index={0}>
            <GlassCard>
              <Text
                style={[Typography.overline, { color: colors.textSecondary }]}
              >
                SOS TIMER ARMED
              </Text>
              <Text
                style={[
                  Typography.title,
                  { color: colors.error, marginTop: 4 },
                ]}
              >
                {formatRemaining(remainingMs)}
              </Text>
              <View style={styles.sosRow}>
                <TouchableOpacity
                  style={[
                    styles.sosButton,
                    { backgroundColor: colors.inputBackground },
                  ]}
                  onPress={() => void cancelTimer()}
                  activeOpacity={0.85}
                >
                  <Text style={[Typography.bodyMedium, { color: colors.text }]}>
                    I&apos;m Safe
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.sosButton,
                    { backgroundColor: colors.inputBackground },
                  ]}
                  onPress={() => void extendTimer(15 * 60 * 1000)}
                  activeOpacity={0.85}
                >
                  <Text style={[Typography.bodyMedium, { color: colors.text }]}>
                    +15 min
                  </Text>
                </TouchableOpacity>
              </View>
            </GlassCard>
          </AnimatedListItem>
        ) : (
          <AnimatedListItem index={0}>
            <TouchableOpacity
              style={[
                styles.armSos,
                { borderColor: colors.border, opacity: isArming ? 0.6 : 1 },
              ]}
              onPress={() => void handleArmSos()}
              disabled={isArming || !!activeTimer}
              activeOpacity={0.85}
            >
              {isArming ? (
                <ActivityIndicator size="small" color={colors.textSecondary} />
              ) : (
                <Text
                  style={[
                    Typography.bodyMedium,
                    { color: colors.textSecondary },
                  ]}
                >
                  Arm 30-min safety timer
                </Text>
              )}
            </TouchableOpacity>
          </AnimatedListItem>
        )}

        <View style={styles.pttWrap}>
          <PTTButton
            isRecording={isRecording}
            disabled={isTranscribing || !sttReady}
            onPressIn={handlePttPressIn}
            onPressOut={handlePttPressOut}
          />
          {voiceError ? (
            <Text
              style={[Typography.caption, { color: colors.error, marginTop: 8 }]}
            >
              {voiceError}
            </Text>
          ) : null}
        </View>

        <View style={{ marginTop: Spacing.lg }}>
          <SectionHeader overline={`Mesh Chat · ${transcript.length}`} />
          <GlassCard style={{ minHeight: 120 }}>
            {transcript.length === 0 ? (
              <Text style={[Typography.body, { color: colors.textSecondary }]}>
                Hold the button to transmit. Messages from nearby devices
                appear here.
              </Text>
            ) : (
              transcript.map((entry) => (
                <View key={entry.id} style={styles.transcriptRow}>
                  <Text
                    style={[Typography.caption, { color: colors.textSecondary }]}
                  >
                    {entry.sender}
                  </Text>
                  <Text style={[Typography.body, { color: colors.text }]}>
                    {entry.text}
                  </Text>
                </View>
              ))
            )}
          </GlassCard>
        </View>

        <View style={{ marginTop: Spacing.lg }}>
          <SectionHeader
            overline={`Nearby WiFi · ${wifiPeers.length}`}
            actionLabel="Connect All"
            onAction={handleConnectAll}
          />
          {wifiPeers.length === 0 ? (
            <GlassCard>
              <Text style={[Typography.body, { color: colors.textSecondary }]}>
                No WiFi devices found yet.
              </Text>
            </GlassCard>
          ) : (
            <View style={{ gap: 10 }}>
              {wifiPeers.map((peer, i) => (
                <AnimatedListItem key={peer.address} index={i}>
                  <DeviceStatusRow
                    name={peer.name}
                    address={peer.address}
                    isConnected={connectedAddresses.includes(peer.address)}
                    isConnecting={connectingAddress === peer.address}
                    onConnect={() => handleConnectOne(peer.address)}
                  />
                </AnimatedListItem>
              ))}
            </View>
          )}
        </View>

        <AnimatedListItem index={wifiPeers.length + 1}>
          <SpringButton
            title="Private Chat"
            variant="ink"
            icon={<MessageCircle size={18} color={colors.background} />}
            onPress={handlePrivateChatPress}
            style={{ marginTop: Spacing.lg }}
          />
        </AnimatedListItem>
      </ScrollView>

      <AlertOverlay
        visible={currentAlert !== null}
        senderName={currentAlert?.senderName ?? ''}
        message={currentAlert?.message ?? ''}
        onAcknowledge={() => setCurrentAlert(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
  },
  pttWrap: {
    alignItems: 'center',
    marginTop: Spacing.lg,
  },
  transcriptRow: {
    marginBottom: 10,
  },
  sosRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: Spacing.sm,
  },
  sosButton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  armSos: {
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
