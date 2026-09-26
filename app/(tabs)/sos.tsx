import { useMemo, useState } from 'react';
import {
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
import {
  CheckCircle2,
  Clock,
  Map,
  MapPin,
  ShieldCheck,
  Siren,
  Square,
  TriangleAlert,
  Volume2,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { useTheme } from '../../context/ThemeContext';
import { useSos } from '../../context/SosContext';
import { SOS_PRESETS, formatRemaining } from '../../features/sos';
import {
  resolveSosMapUrl,
  stripUrlsForDisplay,
} from '../../features/sos/links';
import GlassCard from '@/components/ui/GlassCard';
import SpringButton from '@/components/ui/SpringButton';
import CircleButton from '@/components/ui/CircleButton';
import ScreenHeader from '@/components/ui/ScreenHeader';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import SectionHeader from '@/components/ui/SectionHeader';
import { showAppAlert } from '@/components/ui/AppModal';
import { Radius, Spacing, Typography } from '../../constants/theme';

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
      await showAppAlert(
        'Pick a duration',
        'Choose a preset or enter custom minutes (1-1440).',
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
      await showAppAlert('Could not start timer', 'Please try again.', [
        { text: 'OK' },
      ]);
    } finally {
      setIsStarting(false);
    }
  }

  function handleSafe() {
    void showAppAlert(
      "You're safe?",
      'This cancels the timer. No SOS will be sent.',
      [
        { text: 'Keep timer', style: 'cancel' },
        {
          text: "I'm Safe - Cancel",
          style: 'destructive',
          onPress: () => void cancelTimer(),
        },
      ],
    );
  }

  function handleManualSos() {
    void showAppAlert(
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
    void showAppAlert(
      'Clear received SOS?',
      'This removes all SOS messages here.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear', style: 'destructive', onPress: clearInbox },
      ],
    );
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          title={activeTimer ? formatRemaining(remainingMs) : 'SOS'}
          subtitle={
            activeTimer
              ? `Auto-SOS at ${new Date(activeTimer.deadlineAt).toLocaleTimeString()}${activeTimer.workspaceLabel ? ` • ${activeTimer.workspaceLabel}` : ''}`
              : 'Alert nearby phones in an emergency'
          }
          left={
            <CircleButton
              onPress={() => void testSiren()}
              accessibilityLabel="Test SOS siren"
            >
              <Volume2 size={20} color={colors.text} />
            </CircleButton>
          }
          right={
            <CircleButton
              onPress={() => void stopSiren()}
              accessibilityLabel="Stop SOS siren"
            >
              <Square
                size={18}
                color={sirenPlaying ? colors.error : colors.textSecondary}
                fill={sirenPlaying ? colors.error : colors.textSecondary}
              />
            </CircleButton>
          }
        />

        {activeTimer ? (
          <AnimatedListItem index={0}>
            <GlassCard>
              <View
                style={[
                  styles.progressTrack,
                  { backgroundColor: colors.inputBackground },
                ]}
              >
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
                    &quot;{activeTimer.helpMessage}&quot;
                  </Text>
                </View>
              ) : null}
              <SpringButton
                title="I'm Safe - Cancel SOS"
                variant="emerald"
                onPress={handleSafe}
                icon={<CheckCircle2 size={18} color="#FFF" />}
                style={{ marginTop: 12 }}
              />
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
                Fires in background via the &quot;SOS timer armed&quot;
                notification - don&apos;t swipe it away.
              </Text>
            </GlassCard>
          </AnimatedListItem>
        ) : (
          <AnimatedListItem index={0}>
            <GlassCard>
              <View style={styles.cardTitleRow}>
                <ShieldCheck size={20} color={colors.primary} />
                <Text style={[Typography.h3, { color: colors.text }]}>
                  Arm a safety timer
                </Text>
              </View>
              <Text style={[styles.muted, { color: colors.textSecondary }]}>
                Miss the check-in and SOS auto-broadcasts with your message +
                location.
              </Text>

              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
                Duration
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
                            ? colors.text
                            : colors.inputBackground,
                          borderColor: selected
                            ? colors.text
                            : colors.glassBorder,
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
                          {
                            color: selected ? colors.background : colors.text,
                          },
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
                        ? colors.text
                        : colors.inputBackground,
                      borderColor: useCustom ? colors.text : colors.glassBorder,
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
                      {
                        color: useCustom ? colors.background : colors.text,
                      },
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
                  placeholder="Minutes (1-1440)"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="numeric"
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      color: colors.text,
                      borderColor: colors.glassBorder,
                      flex: 1,
                    },
                  ]}
                />
              </View>

              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
                Workspace label (optional)
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
                    borderColor: colors.glassBorder,
                  },
                ]}
              />

              <Text
                style={[styles.fieldLabel, { color: colors.textSecondary }]}
              >
                Help message
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
                    borderColor: colors.glassBorder,
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
                    borderColor: colors.glassBorder,
                  },
                ]}
              >
                <MapPin
                  size={18}
                  color={
                    includeLocation ? colors.primary : colors.textSecondary
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.locationTitle, { color: colors.text }]}>
                    Include location
                  </Text>
                  <Text
                    style={[styles.mutedSmall, { color: colors.textSecondary }]}
                  >
                    GPS + Map button on receivers
                  </Text>
                </View>
                <Switch
                  value={includeLocation}
                  onValueChange={setIncludeLocation}
                  trackColor={{ true: '#CF5C36', false: colors.border }}
                />
              </View>

              <SpringButton
                title={
                  isStarting
                    ? 'Arming...'
                    : `Start ${effectiveMinutes > 0 ? `${effectiveMinutes}m ` : ''}timer`
                }
                variant="ink"
                onPress={() => void handleStartTimer()}
                disabled={!canStart}
                loading={isStarting}
                icon={
                  <Clock
                    size={18}
                    color={canStart ? colors.background : colors.textSecondary}
                  />
                }
                style={{ marginTop: 14 }}
              />
            </GlassCard>
          </AnimatedListItem>
        )}

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          Emergency
        </Text>
        <SpringButton
          title={isFiring ? 'Sending...' : 'SEND SOS NOW'}
          variant="danger"
          onPress={handleManualSos}
          disabled={isFiring}
          loading={isFiring}
          icon={<Siren size={22} color="#FFF" />}
        />
        <Text
          style={[
            styles.finePrint,
            { color: colors.textSecondary, textAlign: 'center' },
          ]}
        >
          Uses your help message + location above. Floods 3 tries.
        </Text>

        <GlassCard style={{ marginTop: 14 }}>
          <View style={styles.sirenHeader}>
            <View
              style={[
                styles.sirenIcon,
                {
                  backgroundColor: sirenPlaying
                    ? colors.errorMuted
                    : colors.inputBackground,
                },
              ]}
            >
              <Volume2
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
                          ? colors.successMuted
                          : colors.inputBackground,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusChipText,
                      {
                        color: sirenPlaying
                          ? '#FFF'
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
              <Text
                style={[styles.mutedSmall, { color: colors.textSecondary }]}
              >
                Loops on incoming SOS. Stop here or from notification.
              </Text>
            </View>
            <Switch
              value={sirenEnabled}
              onValueChange={setSirenEnabled}
              trackColor={{ true: '#CF5C36', false: colors.border }}
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
        </GlassCard>

        {lastResult ? (
          <GlassCard style={{ marginTop: 12 }}>
            <Text style={[styles.resultText, { color: colors.textSecondary }]}>
              {lastResult}
            </Text>
          </GlassCard>
        ) : null}

        {pendingRetry ? (
          <GlassCard style={{ marginTop: 12 }}>
            <View style={styles.cardTitleRow}>
              <TriangleAlert size={20} color={colors.warning} />
              <Text style={[Typography.h3, { color: colors.text }]}>
                SOS not delivered
              </Text>
            </View>
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              No nearby phones were reachable. Keep the app open and re-send
              when phones are near.
            </Text>
            <SpringButton
              title="Re-send SOS"
              onPress={() => void retryPendingSos()}
              style={{ marginTop: 12 }}
            />
          </GlassCard>
        ) : null}

        <View style={styles.inboxHeader}>
          <SectionHeader
            overline="Received SOS"
            count={inbox.length}
            accent={colors.error}
            actionLabel={inbox.length > 0 ? 'Clear' : undefined}
            onAction={handleClearInbox}
          />
        </View>
        {inbox.length === 0 ? (
          <GlassCard style={styles.emptyCard}>
            <ShieldCheck size={28} color={colors.textSecondary} />
            <Text style={[styles.emptyTitle, { color: colors.text }]}>
              No SOS received
            </Text>
            <Text style={[styles.mutedSmall, { color: colors.textSecondary }]}>
              SOS broadcasts land here with a Map button.
            </Text>
          </GlassCard>
        ) : (
          inbox.map((item, i) => {
            const mapUrl = resolveSosMapUrl(item.message, item.lat, item.lon);
            const displayMessage = stripUrlsForDisplay(item.message);
            return (
              <AnimatedListItem key={item.id} index={i}>
                <GlassCard style={styles.sosCard} padding={0}>
                  <View style={styles.sosAccent} />
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
                              ? colors.warningMuted
                              : colors.errorMuted,
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
                    <Text style={[styles.messageText, { color: colors.text }]}>
                      {displayMessage}
                    </Text>
                    {mapUrl ? (
                      <TouchableOpacity
                        style={[
                          styles.mapButton,
                          { backgroundColor: colors.primaryMuted },
                        ]}
                        onPress={() =>
                          Linking.openURL(mapUrl).catch(
                            () =>
                              void showAppAlert('Cannot open link', mapUrl, [
                                { text: 'OK' },
                              ]),
                          )
                        }
                        activeOpacity={0.8}
                      >
                        <Map size={16} color={colors.primary} />
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
                </GlassCard>
              </AnimatedListItem>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 130,
    gap: 4,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: { height: 8, borderRadius: 4 },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginBottom: 8,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  muted: { marginTop: 4, fontSize: 13, lineHeight: 19 },
  mutedSmall: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  fieldLabel: {
    marginTop: Spacing.md,
    marginBottom: 6,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  presetRow: { flexDirection: 'row', gap: 8 },
  preset: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.round,
    borderWidth: 1,
  },
  presetText: { fontSize: 14, fontWeight: '700' },
  customRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  input: {
    marginTop: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    borderWidth: 1,
    fontSize: 15,
  },
  quoteBox: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  helpPreview: { fontSize: 14, fontStyle: 'italic', lineHeight: 20 },
  extendRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  extendButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  extendText: { fontSize: 14, fontWeight: '700' },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: Spacing.md,
    padding: 12,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  locationTitle: { fontSize: 15, fontWeight: '700' },
  finePrint: { marginTop: 8, fontSize: 12, lineHeight: 17 },
  resultText: { fontSize: 13, lineHeight: 19 },
  sirenHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sirenIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sirenTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.round,
  },
  statusChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  inboxHeader: { marginTop: Spacing.lg },
  emptyCard: { alignItems: 'center', gap: 6, paddingVertical: 28 },
  emptyTitle: { marginTop: 6, fontSize: 15, fontWeight: '800' },
  sosCard: { flexDirection: 'row', marginTop: 8, overflow: 'hidden' },
  sosAccent: { width: 4, backgroundColor: '#EF4444' },
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
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.round,
  },
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
