import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { router, Stack } from 'expo-router';
import {
  ArrowLeft,
  Bluetooth,
  Radar,
  RefreshCw,
  Wifi,
} from 'lucide-react-native';

import { useTheme } from '@/context/ThemeContext';
import ScreenHeader from '@/components/ui/ScreenHeader';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import SectionHeader from '@/components/ui/SectionHeader';
import SpringButton from '@/components/ui/SpringButton';
import CircleButton from '@/components/ui/CircleButton';
import {
  bandBars,
  bandLabel,
  formatApproxMeters,
  useDeviceSearch,
  useProximityBeep,
  type SearchPeer,
} from '@/features/proximity';
import { Radius, Spacing, Typography } from '@/constants/theme';

function SignalBars({ filled }: { filled: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.bars}>
      {[0, 1, 2, 3].map((i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              backgroundColor:
                i < filled ? colors.primary : colors.glassBorder,
              height: 6 + i * 3,
            },
          ]}
        />
      ))}
    </View>
  );
}

function PeerRow({
  peer,
  index,
  onTrack,
}: {
  peer: SearchPeer;
  index: number;
  onTrack: () => void;
}) {
  const { colors } = useTheme();
  const band = peer.ble?.band ?? 'unknown';
  return (
    <AnimatedListItem index={index}>
      <GlassCard>
        <View style={styles.rowTop}>
          <View style={styles.rowInfo}>
            <Text style={[Typography.h3, { color: colors.text }]} numberOfLines={1}>
              {peer.name}
            </Text>
            <View style={styles.chipRow}>
              {peer.ble ? (
                <View
                  style={[styles.chip, { backgroundColor: colors.primaryMuted }]}
                >
                  <Bluetooth size={12} color={colors.primary} />
                  <Text style={[styles.chipText, { color: colors.primary }]}>
                    {peer.ble.band === 'unknown'
                      ? 'BLE'
                      : `${formatApproxMeters(peer.ble.meters)} · ${bandLabel(band)}`}
                  </Text>
                </View>
              ) : null}
              {peer.wifi ? (
                <View
                  style={[styles.chip, { backgroundColor: colors.inputBackground }]}
                >
                  <Wifi size={12} color={colors.textSecondary} />
                  <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                    WiFi
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
          <SignalBars filled={bandBars(band)} />
        </View>
        <TouchableOpacity
          style={[styles.trackButton, { backgroundColor: colors.text }]}
          onPress={onTrack}
          activeOpacity={0.8}
        >
          <Radar size={15} color={colors.background} />
          <Text style={[styles.trackText, { color: colors.background }]}>
            Track
          </Text>
        </TouchableOpacity>
      </GlassCard>
    </AnimatedListItem>
  );
}

export default function DeviceSearchScreen() {
  const { colors } = useTheme();
  const {
    deviceName,
    isScanning,
    peers,
    tracked,
    soughtBy,
    startTracking,
    stopTracking,
    dismissSought,
    refresh,
  } = useDeviceSearch();

  useProximityBeep({
    enabled: tracked !== null,
    band: tracked?.band ?? 'unknown',
  });

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false, animation: 'fade' }} />

      <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }}>
        <ScreenHeader
          title="Device Search"
          subtitle={`As ${deviceName} · ${peers.length} nearby`}
          left={
            <CircleButton
              onPress={() => router.back()}
              accessibilityLabel="Back"
            >
              <ArrowLeft size={20} color={colors.text} />
            </CircleButton>
          }
          right={
            <CircleButton
              onPress={refresh}
              accessibilityLabel="Scan again"
            >
              {isScanning ? (
                <ActivityIndicator size="small" color={colors.text} />
              ) : (
                <RefreshCw size={20} color={colors.text} />
              )}
            </CircleButton>
          }
        />
      </View>

      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {soughtBy ? (
          <AnimatedListItem index={0}>
            <GlassCard style={{ borderColor: colors.primary }}>
              <Text style={[Typography.overline, { color: colors.primary }]}>
                📡 {soughtBy.seekerName} IS LOOKING FOR YOU
              </Text>
              <Text style={[Typography.title, { color: colors.text, marginTop: 4 }]}>
                {soughtBy.myMeters !== null
                  ? `They are ${formatApproxMeters(soughtBy.myMeters)} away`
                  : 'Measuring distance…'}
              </Text>
              <Text style={[Typography.body, { color: colors.textSecondary, marginTop: 4 }]}>
                {soughtBy.theirMeters !== null
                  ? `They see you at ${formatApproxMeters(soughtBy.theirMeters)}. Hold still and let them follow the beeps.`
                  : 'Hold still and let them follow the beeps.'}
              </Text>
              <TouchableOpacity
                style={[styles.dismissButton, { backgroundColor: colors.inputBackground }]}
                onPress={dismissSought}
                activeOpacity={0.8}
              >
                <Text style={[Typography.bodyMedium, { color: colors.text }]}>
                  Dismiss
                </Text>
              </TouchableOpacity>
            </GlassCard>
          </AnimatedListItem>
        ) : null}

        {tracked ? (
          <AnimatedListItem index={soughtBy ? 1 : 0}>
            <GlassCard>
              <Text style={[Typography.overline, { color: colors.textSecondary }]}>
                TRACKING · {tracked.name}
              </Text>
              <Text style={[styles.bigBand, { color: colors.primary }]}>
                {bandLabel(tracked.band)}
              </Text>
              <Text style={[Typography.title, { color: colors.text }]}>
                {tracked.meters !== null
                  ? formatApproxMeters(tracked.meters)
                  : 'No signal — keep moving'}
              </Text>
              <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                {tracked.rssi !== null
                  ? `live signal ${Math.round(tracked.rssi)} dBm`
                  : 'listening for signal…'}
              </Text>
              <View style={styles.trackMeta}>
                <SignalBars filled={bandBars(tracked.band)} />
                <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                  {tracked.peerSeesMeMeters !== null
                    ? `They see you at ${formatApproxMeters(tracked.peerSeesMeMeters)}`
                    : 'Waiting for their reply…'}
                </Text>
              </View>
              <Text style={[Typography.caption, { color: colors.textSecondary }]}>
                Faster + louder beeps = closer. Distances are approximate.
              </Text>
              <SpringButton
                title="Stop Tracking"
                variant="danger"
                onPress={stopTracking}
                style={{ marginTop: Spacing.md }}
              />
            </GlassCard>
          </AnimatedListItem>
        ) : (
          <>
            <SectionHeader
              overline={`Nearby · ${peers.length}`}
              actionLabel={isScanning ? 'Scanning…' : 'Scan'}
              onAction={refresh}
            />
            {peers.length === 0 ? (
              <GlassCard>
                <Text style={[Typography.body, { color: colors.textSecondary }]}>
                  No devices yet. Keep both phones awake with the app open —
                  nearby VaaniSetu phones appear here over Bluetooth and WiFi.
                </Text>
              </GlassCard>
            ) : (
              <View style={{ gap: 10 }}>
                {peers.map((peer, i) => (
                  <PeerRow
                    key={peer.key}
                    peer={peer}
                    index={i}
                    onTrack={() => startTracking(peer.key)}
                  />
                ))}
              </View>
            )}
            <Text style={[styles.finePrint, { color: colors.textSecondary }]}>
              Distances are approximate (±50% indoors) — follow the beeps after
              tapping Track. WiFi-only phones show no distance until you close
              in over Bluetooth.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xl * 2,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowInfo: { flex: 1, gap: 6 },
  chipRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.round,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3 },
  bar: { width: 5, borderRadius: 2 },
  trackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
    height: 42,
    borderRadius: Radius.md,
  },
  trackText: { fontSize: 14, fontWeight: '800' },
  bigBand: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 0.3,
    marginTop: 4,
  },
  trackMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    marginBottom: 4,
  },
  dismissButton: {
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: Radius.sm,
    marginTop: 10,
  },
  finePrint: { marginTop: 12, fontSize: 12, lineHeight: 17 },
});
