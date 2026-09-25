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
import { extractMapUrl } from '../../features/sos/links';
import LinkifiedMessage from '../../features/sos/LinkifiedMessage';
import { FontSize, Radius, Spacing } from '../../constants/theme';

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
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              SOS Timer
            </Text>
          </View>
          <View
            style={[
              styles.livePill,
              {
                backgroundColor: activeTimer ? colors.error : colors.surface,
                borderColor: colors.border,
              },
            ]}
          >
            <View
              style={[
                styles.liveDot,
                { backgroundColor: activeTimer ? '#FFFFFF' : colors.success },
              ]}
            />
            <Text
              style={[
                styles.liveText,
                { color: activeTimer ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              {activeTimer ? 'ARMED' : 'READY'}
            </Text>
          </View>
        </View>

        {/* Active timer card */}
        {activeTimer ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.error },
            ]}
          >
            <View style={styles.timerTop}>
              <Ionicons name="timer-outline" size={22} color={colors.error} />
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
              <Text
                style={[styles.helpPreview, { color: colors.text }]}
                numberOfLines={3}
              >
                “{activeTimer.helpMessage}”
              </Text>
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
          </View>
        ) : (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Arm timer
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
                        borderColor: colors.border,
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
                    borderColor: colors.border,
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
                placeholder="Minutes"
                placeholderTextColor={colors.textSecondary}
                keyboardType="numeric"
                style={[
                  styles.input,
                  {
                    backgroundColor: colors.inputBackground,
                    color: colors.text,
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
              placeholder="Label"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { backgroundColor: colors.inputBackground, color: colors.text },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>
              HELP MESSAGE
            </Text>
            <TextInput
              value={helpMessage}
              onChangeText={(t) => setHelpMessage(t.slice(0, 280))}
              placeholder="Help message"
              placeholderTextColor={colors.textSecondary}
              multiline
              style={[
                styles.input,
                {
                  backgroundColor: colors.inputBackground,
                  color: colors.text,
                  minHeight: 64,
                  textAlignVertical: 'top',
                },
              ]}
            />

            <View style={styles.locationRow}>
              <Ionicons
                name={includeLocation ? 'location' : 'location-outline'}
                size={18}
                color={includeLocation ? colors.primary : colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.locationTitle, { color: colors.text }]}>
                  Include location
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

        {/* Manual SOS */}
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
            <Ionicons name="alert-circle" size={22} color="#FFFFFF" />
          )}
          <Text style={styles.sosButtonText}>
            {isFiring ? 'Sending…' : 'SEND SOS NOW'}
          </Text>
        </TouchableOpacity>

        {/* Siren & alerts — loops a loud siren on incoming SOS + on missed check-in */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: sirenPlaying ? colors.error : colors.border,
            },
          ]}
        >
          <View style={styles.locationRow}>
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
            <View style={{ flex: 1 }}>
              <Text style={[styles.locationTitle, { color: colors.text }]}>
                SOS siren{sirenPlaying ? ' — SOUNDING' : ''}
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
          <Text style={[styles.resultLine, { color: colors.textSecondary }]}>
            {lastResult}
          </Text>
        ) : null}

        {pendingRetry ? (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.warning },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              SOS not delivered
            </Text>
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
          <Text style={[styles.overline, { color: colors.textSecondary }]}>
            Received SOS · {inbox.length}
          </Text>
          {inbox.length > 0 ? (
            <TouchableOpacity
              onPress={clearInbox}
              hitSlop={10}
              activeOpacity={0.6}
            >
              <Text style={[styles.clearText, { color: colors.primary }]}>
                Clear
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {inbox.length === 0 ? null : (
          <View
            style={[
              styles.listCard,
              { backgroundColor: colors.surface, borderColor: colors.error },
            ]}
          >
            {inbox.map((item, i) => {
              const mapUrl = extractMapUrl(item.message);
              return (
                <View
                  key={item.id}
                  style={[
                    styles.messageBlock,
                    i < inbox.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[styles.messageMeta, { color: colors.error }]}
                    numberOfLines={1}
                  >
                    🆘 {item.senderName} ·{' '}
                    {item.isAuto ? 'auto (missed check-in)' : 'manual'} ·{' '}
                    {item.hops <= 0
                      ? 'direct'
                      : item.hops === 1
                        ? '1 hop'
                        : `${item.hops} hops`}{' '}
                    · {new Date(item.receivedAt).toLocaleTimeString()}
                  </Text>
                  <LinkifiedMessage
                    message={item.message}
                    textStyle={[styles.messageText, { color: colors.text }]}
                    linkColor={colors.primary}
                  />
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
              );
            })}
          </View>
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
  title: { marginTop: 2, fontSize: 27, fontWeight: '800', letterSpacing: -0.5 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radius.round,
    borderWidth: 1,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.md,
    marginTop: Spacing.sm,
  },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  muted: { marginTop: 4, fontSize: 13, lineHeight: 19 },
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
    fontSize: 15,
  },
  helpPreview: { marginTop: 8, fontSize: 14, fontStyle: 'italic' },
  timerTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timerCountdown: {
    fontSize: 38,
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
    gap: 10,
    marginTop: Spacing.lg,
    height: 60,
    borderRadius: Radius.round,
  },
  sosButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  finePrint: { marginTop: 8, fontSize: 12, lineHeight: 17 },
  resultLine: {
    marginTop: Spacing.sm,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  clearText: { fontSize: 13, fontWeight: '700' },
  listCard: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
  },
  messageBlock: { paddingVertical: 11, gap: 4 },
  messageMeta: { fontSize: 11, fontWeight: '700' },
  messageText: { fontSize: 15, lineHeight: 21 },
  mapButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.round,
  },
  mapButtonText: { fontSize: 13, fontWeight: '800' },
});
