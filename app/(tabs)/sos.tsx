import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../../context/ThemeContext';
import { useSos } from '../../context/SosContext';
import { SOS_PRESETS, formatRemaining } from '../../features/sos';
import {
  resolveSosMapUrl,
  stripUrlsForDisplay,
} from '../../features/sos/links';
import { FontSize, Radius, Spacing } from '../../constants/theme';

function hopLabel(hops: number): string {
  if (hops <= 0) return 'direct';
  return hops === 1 ? '1 hop' : `${hops} hops`;
}

export default function SosScreen() {
  const { colors } = useTheme();
  const {
    activeTimer,
    remainingMs,
    isFiring,
    lastResult,
    pendingRetry,
    inbox,
    startTimer,
    cancelTimer,
    extendTimer,
    sendManualSos,
    retryPendingSos,
    clearInbox,
    sirenEnabled,
    setSirenEnabled,
    sirenPlaying,
    stopSiren,
    testSiren,
  } = useSos();

  const [presetMinutes, setPresetMinutes] = useState<number>(180);
  const [customMinutes, setCustomMinutes] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [workspaceLabel, setWorkspaceLabel] = useState('');
  const [helpMessage, setHelpMessage] = useState('');
  const [includeLocation, setIncludeLocation] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  const effectiveMinutes = useMemo(() => {
    if (useCustom) {
      const n = parseInt(customMinutes, 10);
      return Number.isFinite(n) ? n : 0;
    }
    return presetMinutes;
  }, [useCustom, customMinutes, presetMinutes]);

  const canStart =
    !activeTimer &&
    !isStarting &&
    effectiveMinutes >= 1 &&
    effectiveMinutes <= 24 * 60;

  const progress = useMemo(() => {
    if (!activeTimer) return 0;
    const total = activeTimer.durationMs;
    // Guard NaN/corrupt values: an invalid width ("NaN%") crashes layout.
    if (
      !Number.isFinite(total) ||
      total <= 0 ||
      !Number.isFinite(remainingMs)
    ) {
      return 0;
    }
    return Math.min(1, Math.max(0, 1 - remainingMs / total));
  }, [activeTimer, remainingMs]);

  async function handleStartTimer() {
    if (!canStart) {
      Alert.alert(
        'Pick a duration',
        'Choose a preset or enter custom minutes (1–1440).',
        [{ text: 'OK' }],
      );
      return;
    }
    setIsStarting(true);
    try {
      await startTimer({
        durationMs: effectiveMinutes * 60 * 1000,
        helpMessage,
        workspaceLabel,
        includeLocation,
      });
      try {
        await Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
      } catch {}
    } catch (e) {
      console.warn('[SOS] start failed:', e);
      Alert.alert('Could not start timer', 'Please try again.', [
        { text: 'OK' },
      ]);
    } finally {
      setIsStarting(false);
    }
  }

  function handleSafe() {
    Alert.alert(
      "You're safe?",
      'This cancels the timer. No SOS will be sent.',
      [
        { text: 'Keep timer', style: 'cancel' },
        {
          text: "I'm Safe — Cancel",
          style: 'destructive',
          onPress: () => void cancelTimer(),
        },
      ],
    );
  }

  function handleManualSos() {
    Alert.alert(
      'Send SOS now?',
      'This broadcasts SOS to ALL nearby VaaniSetu phones immediately (3 flood tries).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'SEND SOS',
          style: 'destructive',
          onPress: () =>
            void (async () => {
              try {
                await Haptics.notificationAsync(
                  Haptics.NotificationFeedbackType.Warning,
                );
              } catch {}
              await sendManualSos(helpMessage, includeLocation);
            })(),
        },
      ],
    );
  }

  function handleClearInbox() {
    if (inbox.length === 0) return;
    Alert.alert('Clear received SOS?', 'This removes all SOS messages here.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: clearInbox },
    ]);
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.overline, { color: colors.textSecondary }]}>
              Safety
            </Text>
            <Text style={[styles.title, { color: colors.text }]}>SOS</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Alert nearby phones in an emergency
            </Text>
          </View>
          <View
            style={[
              styles.livePill,
              {
                backgroundColor: activeTimer ? colors.error : colors.success,
                borderColor: activeTimer ? colors.error : colors.success,
              },
            ]}
          >
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>
              {activeTimer ? 'ARMED' : 'READY'}
            </Text>
          </View>
        </View>

        {/* Active timer card */}
        {activeTimer ? (
          <View
            style={[
              styles.card,
              styles.armedCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.error,
              },
            ]}
          >
            <View style={styles.armedHeader}>
              <View
                style={[
                  styles.armedBadge,
                  { backgroundColor: `${colors.error}1A` },
                ]}
              >
                <Ionicons name="timer" size={16} color={colors.error} />
                <Text style={[styles.armedBadgeText, { color: colors.error }]}>
                  TIMER ARMED
                </Text>
              </View>
              <Text style={[styles.timerCountdown, { color: colors.text }]}>
                {formatRemaining(remainingMs)}
              </Text>
            </View>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              Auto-SOS at{' '}
              {new Date(activeTimer.deadlineAt).toLocaleTimeString()}
              {activeTimer.workspaceLabel
                ? ` • ${activeTimer.workspaceLabel}`
                : ''}
            </Text>
            {activeTimer.helpMessage ? (
              <View
                style={[
                  styles.quoteBox,
                  { backgroundColor: colors.inputBackground },
                ]}
              >
                <Text
                  style={[styles.helpPreview, { color: colors.text }]}
                  numberOfLines={3}
                >
                  “{activeTimer.helpMessage}”
                </Text>
              </View>
            ) : null}
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.round(progress * 100)}%`,
                    backgroundColor: colors.error,
                  },
                ]}
              />
            </View>
            <TouchableOpacity
              style={[styles.safeButton, { backgroundColor: colors.success }]}
              onPress={handleSafe}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
              <Text style={styles.safeButtonText}>
                I&apos;m Safe — Cancel SOS
              </Text>
            </TouchableOpacity>
            <View style={styles.extendRow}>
              <TouchableOpacity
                style={[
                  styles.extendButton,
                  { backgroundColor: colors.inputBackground },
                ]}
                onPress={() => void extendTimer(15 * 60 * 1000)}
                activeOpacity={0.8}
              >
                <Text style={[styles.extendText, { color: colors.text }]}>
                  +15 min
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.extendButton,
                  { backgroundColor: colors.inputBackground },
                ]}
                onPress={() => void extendTimer(60 * 60 * 1000)}
                activeOpacity={0.8}
              >
                <Text style={[styles.extendText, { color: colors.text }]}>
                  +1 hour
                </Text>
              </TouchableOpacity>
            </View>
            <Text style={[styles.finePrint, { color: colors.textSecondary }]}>
              Fires in background via the “SOS timer armed” notification — don’t
              swipe it away. If the phone is force-stopped, opening the app
              fires any missed SOS instantly.
            </Text>
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardTitleRow}>
              <Ionicons name="shield-checkmark" size={20} color={colors.primary} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                Arm a safety timer
              </Text>
            </View>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              Miss the check-in and SOS auto-broadcasts to everyone nearby with
              your message + location.
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              DURATION
            </Text>
            <View style={styles.presetRow}>
              {SOS_PRESETS.map((p) => {
                const selected = !useCustom && presetMinutes === p.minutes;
                return (
                  <TouchableOpacity
                    key={p.minutes}
                    style={[
                      styles.preset,
                      {
                        backgroundColor: selected
                          ? colors.primary
                          : colors.inputBackground,
                        borderColor: selected
                          ? colors.primary
                          : colors.border,
                      },
                    ]}
                    onPress={() => {
                      setUseCustom(false);
                      setPresetMinutes(p.minutes);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.presetText,
                        { color: selected ? '#FFFFFF' : colors.text },
                      ]}
                    >
                      {p.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.customRow}>
              <TouchableOpacity
                style={[
                  styles.preset,
                  {
                    backgroundColor: useCustom
                      ? colors.primary
                      : colors.inputBackground,
                    borderColor: useCustom ? colors.primary : colors.border,
                    flex: 0,
                    paddingHorizontal: 14,
                  },
                ]}
                onPress={() => setUseCustom(true)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.presetText,
                    { color: useCustom ? '#FFFFFF' : colors.text },
                  ]}
                >
                  Custom
                </Text>
              </TouchableOpacity>
              <TextInput
                value={customMinutes}
                onChangeText={(t) => {
                  setUseCustom(true);
                  setCustomMinutes(t.replace(/[^0-9]/g, '').slice(0, 4));
                }}
                placeholder="Minutes (1–1440)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
                    borderColor: colors.border,
                    flex: 1,
                  },
                ]}
              />
            </View>

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              WORKSPACE LABEL (OPTIONAL)
            </Text>
            <TextInput
              value={workspaceLabel}
              onChangeText={(t) => setWorkspaceLabel(t.slice(0, 60))}
              placeholder="e.g. Night shift • Warehouse B"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              HELP MESSAGE
            </Text>
            <TextInput
              value={helpMessage}
              onChangeText={(t) => setHelpMessage(t.slice(0, 280))}
              placeholder="e.g. I am near the back gate, need help"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  borderColor: colors.border,
                  minHeight: 64,
                  textAlignVertical: 'top',
                },
              ]}
            />

            <View
              style={[
                styles.locationRow,
                {
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.border,
                },
              ]}
            >
              <Ionicons
                name={includeLocation ? 'location' : 'location-outline'}
                size={18}
                color={includeLocation ? colors.primary : colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.locationTitle, { color: colors.text }]}>
                  Include location
                </Text>
                <Text style={[styles.mutedSmall, { color: colors.textSecondary }]}>
                  GPS + Map button on receiver phones
                </Text>
              </View>
              <Switch
                value={includeLocation}
                onValueChange={setIncludeLocation}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>

            <TouchableOpacity
              style={[
                styles.startButton,
                {
                  backgroundColor: canStart
                    ? colors.primary
                    : colors.inputBackground,
                  opacity: isStarting ? 0.7 : 1,
                },
              ]}
              onPress={handleStartTimer}
              disabled={!canStart}
              activeOpacity={0.85}
            >
              {isStarting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons
                  name="timer"
                  size={18}
                  color={canStart ? '#FFFFFF' : colors.textSecondary}
                />
              )}
              <Text
                style={[
                  styles.startButtonText,
                  { color: canStart ? '#FFFFFF' : colors.textSecondary },
                ]}
              >
                {isStarting
                  ? 'Arming…'
                  : `Start ${effectiveMinutes > 0 ? `${effectiveMinutes}m ` : ''}timer`}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Manual SOS — emergency first */}
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          EMERGENCY
        </Text>
        <TouchableOpacity
          style={[
            styles.sosButton,
            { backgroundColor: colors.error, opacity: isFiring ? 0.7 : 1 },
          ]}
          onPress={handleManualSos}
          disabled={isFiring}
          activeOpacity={0.85}
        >
          {isFiring ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Ionicons name="alert-circle" size={24} color="#FFFFFF" />
          )}
          <View>
            <Text style={styles.sosButtonText}>
              {isFiring ? 'Sending…' : 'SEND SOS NOW'}
            </Text>
            <Text style={styles.sosButtonSub}>
              Broadcast to nearby phones
            </Text>
          </View>
        </TouchableOpacity>
        <Text
          style={[
            styles.finePrint,
            { color: colors.textSecondary, textAlign: 'center' },
          ]}
        >
          Uses your help message + location above. Floods 3 tries.
        </Text>

        {/* Siren & alerts */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: sirenPlaying ? colors.error : colors.border,
            },
          ]}
        >
          <View style={styles.sirenHeader}>
            <View
              style={[
                styles.sirenIcon,
                {
                  backgroundColor: sirenPlaying
                    ? `${colors.error}1A`
                    : colors.inputBackground,
                },
              ]}
            >
              <Ionicons
                name={sirenEnabled ? 'megaphone' : 'megaphone-outline'}
                size={18}
                color={
                  sirenPlaying
                    ? colors.error
                    : sirenEnabled
                      ? colors.primary
                      : colors.textSecondary
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.sirenTitleRow}>
                <Text style={[styles.locationTitle, { color: colors.text }]}>
                  SOS siren
                </Text>
                <View
                  style={[
                    styles.statusChip,
                    {
                      backgroundColor: sirenPlaying
                        ? colors.error
                        : sirenEnabled
                          ? `${colors.success}1A`
                          : colors.inputBackground,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      {
                        color: sirenPlaying
                          ? '#FFFFFF'
                          : sirenEnabled
                            ? colors.success
                            : colors.textSecondary,
                      },
                    ]}
                  >
                    {sirenPlaying ? 'SOUNDING' : sirenEnabled ? 'ON' : 'OFF'}
                  </Text>
                </View>
              </View>
              <Text style={[styles.mutedSmall, { color: colors.textSecondary }]}>
                Loops on incoming SOS. Stop it here or from the notification.
              </Text>
            </View>
            <Switch
              value={sirenEnabled}
              onValueChange={setSirenEnabled}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <View style={styles.extendRow}>
            <TouchableOpacity
              style={[
                styles.extendButton,
                { backgroundColor: colors.inputBackground },
              ]}
              onPress={() => void testSiren()}
              activeOpacity={0.8}
            >
              <Text style={[styles.extendText, { color: colors.text }]}>
                Test siren
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.extendButton,
                {
                  backgroundColor: sirenPlaying
                    ? colors.error
                    : colors.inputBackground,
                  opacity: sirenPlaying ? 1 : 0.5,
                },
              ]}
              onPress={() => void stopSiren()}
              disabled={!sirenPlaying}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.extendText,
                  { color: sirenPlaying ? '#FFFFFF' : colors.text },
                ]}
              >
                Stop siren
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {lastResult ? (
          <View
            style={[
              styles.resultBanner,
              { backgroundColor: colors.inputBackground },
            ]}
          >
            <Ionicons
              name="information-circle-outline"
              size={16}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.resultText, { color: colors.textSecondary }]}
            >
              {lastResult}
            </Text>
          </View>
        ) : null}

        {pendingRetry ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.warning },
            ]}
          >
            <View style={styles.cardTitleRow}>
              <Ionicons name="warning" size={20} color={colors.warning} />
              <Text style={[styles.cardTitle, { color: colors.text }]}>
                SOS not delivered
              </Text>
            </View>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              No nearby phones were reachable. Keep the app open and re-send
              when phones are near.
            </Text>
            <TouchableOpacity
              style={[styles.startButton, { backgroundColor: colors.warning }]}
              onPress={() => void retryPendingSos()}
              activeOpacity={0.85}
            >
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={[styles.startButtonText, { color: '#FFFFFF' }]}>
                Re-send SOS
              </Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Received SOS inbox */}
        <View style={styles.sectionHeader}>
          <View style={styles.inboxTitleRow}>
            <Text style={[styles.overline, { color: colors.textSecondary }]}>
              Received SOS
            </Text>
            <View
              style={[
                styles.countBadge,
                {
                  backgroundColor:
                    inbox.length > 0 ? colors.error : colors.inputBackground,
                },
              ]}
            >
              <Text
                style={[
                  styles.countBadgeText,
                  {
                    color:
                      inbox.length > 0 ? '#FFFFFF' : colors.textSecondary,
                  },
                ]}
              >
                {inbox.length}
              </Text>
            </View>
          </View>
          {inbox.length > 0 ? (
            <TouchableOpacity
              onPress={handleClearInbox}
              hitSlop={10}
              activeOpacity={0.6}
            >
              <Text style={[styles.clearText, { color: colors.primary }]}>
                Clear
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {inbox.length === 0 ? (
          <View
            style={[
              styles.emptyCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={28}
              color={colors.textSecondary}
            />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No SOS received
            </Text>
            <Text
              style={[styles.mutedSmall, { color: colors.textSecondary }]}
            >
              SOS broadcasts from nearby phones land here with a Map button.
            </Text>
          </View>
        ) : (
          inbox.map((item) => {
            const mapUrl = resolveSosMapUrl(item.message, item.lat, item.lon);
            const displayMessage = stripUrlsForDisplay(item.message);
            return (
              <View
                key={item.id}
                style={[
                  styles.sosCard,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.sosAccent,
                    { backgroundColor: colors.error },
                  ]}
                />
                <View style={styles.sosCardBody}>
                  <View style={styles.sosCardTop}>
                    <Text
                      style={[styles.senderName, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      🆘 {item.senderName}
                    </Text>
                    <Text
                      style={[
                        styles.timeText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {new Date(item.receivedAt).toLocaleTimeString()}
                    </Text>
                  </View>
                  <View style={styles.chipRow}>
                    <View
                      style={[
                        styles.chip,
                        {
                          backgroundColor: item.isAuto
                            ? `${colors.warning}1A`
                            : `${colors.error}1A`,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          {
                            color: item.isAuto
                              ? colors.warning
                              : colors.error,
                          },
                        ]}
                      >
                        {item.isAuto ? 'AUTO • missed check-in' : 'MANUAL'}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.chip,
                        { backgroundColor: colors.inputBackground },
                      ]}
                    >
                      <Text
                        style={[
                          styles.chipText,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {hopLabel(item.hops)}
                      </Text>
                    </View>
                  </View>
                  <Text
                    style={[styles.messageText, { color: colors.text }]}
                  >
                    {displayMessage}
                  </Text>
                  {mapUrl ? (
                    <TouchableOpacity
                      style={[
                        styles.mapButton,
                        { backgroundColor: colors.primaryMuted },
                      ]}
                      onPress={() =>
                        Linking.openURL(mapUrl).catch(() =>
                          Alert.alert('Cannot open link', mapUrl, [
                            { text: 'OK' },
                          ]),
                        )
                      }
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="map-outline"
                        size={16}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.mapButtonText,
                          { color: colors.primary },
                        ]}
                      >
                        Open location in Maps
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: Spacing.md },
  scrollContent: { paddingTop: Spacing.md, paddingBottom: Spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
    gap: 12,
  },
  overline: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: { marginTop: 2, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { marginTop: 2, fontSize: 13, lineHeight: 18 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.round,
    borderWidth: 1,
    marginTop: 6,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
  liveText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: '#FFFFFF' },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  armedCard: { borderWidth: 1.5 },
  armedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  armedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.round,
  },
  armedBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  muted: { marginTop: 4, fontSize: 13, lineHeight: 19 },
  mutedSmall: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  fieldLabel: {
    marginTop: Spacing.md,
    marginBottom: 6,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
  },
  presetRow: { flexDirection: 'row', gap: 8 },
  preset: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  presetText: { fontSize: 14, fontWeight: '700' },
  customRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    fontSize: 15,
  },
  quoteBox: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  helpPreview: { fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  timerCountdown: {
    fontSize: 34,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    marginTop: 10,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00000014',
    overflow: 'hidden',
  },
  progressFill: { height: 8, borderRadius: 4 },
  safeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.md,
    height: 52,
    borderRadius: Radius.round,
  },
  safeButtonText: {
    color: '#FFFFFF',
    fontSize: FontSize.medium,
    fontWeight: '800',
  },
  extendRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  extendButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.md,
  },
  extendText: { fontSize: 14, fontWeight: '700' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Spacing.md,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
  },
  locationTitle: { fontSize: 15, fontWeight: '700' },
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.md,
    height: 50,
    borderRadius: Radius.round,
  },
  startButtonText: { fontSize: FontSize.medium, fontWeight: '700' },
  sosButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    marginTop: 4,
    minHeight: 68,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sosButtonSub: { color: '#FFFFFFCC', fontSize: 12, fontWeight: '600' },
  sirenHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sirenIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sirenTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.round },
  statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  finePrint: { marginTop: 8, fontSize: 12, lineHeight: 17 },
  resultBanner: {
    flexDirection: 'row',
    gap: 8,
    marginTop: Spacing.sm,
    padding: 12,
    borderRadius: Radius.md,
  },
  resultText: { flex: 1, fontSize: 13, lineHeight: 19 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  inboxTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: 12, fontWeight: '800' },
  clearText: { fontSize: 13, fontWeight: '700' },
  emptyCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { marginTop: 6, fontSize: 15, fontWeight: '800' },
  sosCard: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: 8,
    overflow: 'hidden',
  },
  sosAccent: { width: 4 },
  sosCardBody: { flex: 1, padding: Spacing.md, gap: 6 },
  sosCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  senderName: { flex: 1, fontSize: 15, fontWeight: '800' },
  timeText: { fontSize: 12, fontWeight: '600' },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.round },
  chipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  messageText: { fontSize: 15, lineHeight: 21 },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: Radius.round,
  },
  mapButtonText: { fontSize: 13, fontWeight: '800' },
});
