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
import { LogOut, MessageCircle, RefreshCw } from 'lucide-react-native';

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
  isSosEnvelope,
  type MeshStatus,
} from '@/features/bluetooth';
import { useVoiceMessage } from '@/features/audio/useVoiceMessage';
import { formatRemaining } from '@/features/sos';
import { tryGetLocation } from '@/features/sos/location';
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

function appendGps(
  text: string,
  coords: { lat: number; lon: number } | null,
): string {
  if (!coords) return text;
  return `${text} [📍 ${coords.lat.toFixed(4)},${coords.lon.toFixed(4)}]`;
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
  const [connectingBle, setConnectingBle] = useState(false);
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
    return [...wifiEntries, ...bleEntries].sort((a, b) => a.ts - b.ts);
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
    const location = await tryGetLocation();
    const outgoing = appendGps(text, location);
    broadcast(outgoing);
    void bleSendBroadcast(outgoing);
  }, [stopVoice, broadcast, bleSendBroadcast]);

  const handleConnectAll = useCallback(async () => {
    startHosting();
    for (const peer of wifiPeers) {
      if (!connectedAddresses.includes(peer.address)) {
        connectTo(peer.address);
      }
    }
    setConnectingBle(true);
    try {
      await requestMeshDiscovery();
    } finally {
      setConnectingBle(false);
    }
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
              onPress={handleConnectAll}
              accessibilityLabel="Connect all nearby devices"
            >
              {connectingBle ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <RefreshCw size={20} color={colors.text} />
              )}
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
              style={[styles.armSos, { borderColor: colors.border }]}
              onPress={() =>
                void startTimer({
                  durationMs: 30 * 60 * 1000,
                  helpMessage: 'Mission Mode check-in overdue',
                  workspaceLabel: 'Mission Mode',
                  includeLocation: true,
                })
              }
              activeOpacity={0.85}
            >
              <Text
                style={[Typography.bodyMedium, { color: colors.textSecondary }]}
              >
                Arm 30-min safety timer
              </Text>
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
          <SectionHeader overline={`Transcript · ${transcript.length}`} />
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
