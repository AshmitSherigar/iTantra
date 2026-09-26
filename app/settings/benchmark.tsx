import React, { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useTheme } from '../../context/ThemeContext';
import {
  benchmarkLogger,
  BenchmarkRunner,
  Utf8TestResult,
  TraceSummary,
  BenchmarkEvent,
} from '../../features/benchmark';

function formatStats(
  label: string,
  stats: ReturnType<typeof benchmarkLogger.calculateStats>,
) {
  if (!stats.count) return `${label}: no measurements yet`;
  return `${label} (n=${stats.count}): mean ${stats.mean} ms • median ${stats.median} ms • P90 ${stats.p90} ms • P95 ${stats.p95} ms • min ${stats.min} ms • max ${stats.max} ms • SD ${stats.stdDev} ms`;
}

export default function BenchmarkScreen() {
  const { colors } = useTheme();

  const [utf8Results, setUtf8Results] = useState<{
    results: Utf8TestResult[];
    summary: {
      total: number;
      passed: number;
      failed: number;
      corrupted: number;
      exactMatchPct: number;
      avgTimeMs: number;
    };
  } | null>(null);

  const [isRunningUtf8, setIsRunningUtf8] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [events, setEvents] = useState<BenchmarkEvent[]>([]);
  const [traceSummaries, setTraceSummaries] = useState<TraceSummary[]>([]);

  // Update telemetry data from logger
  const refreshTelemetry = () => {
    setEvents(benchmarkLogger.getEvents().slice(-15).reverse());
    setTraceSummaries(benchmarkLogger.getAllTraceSummaries().reverse());
  };

  useEffect(() => {
    refreshTelemetry();
    const unsubscribe = benchmarkLogger.subscribe(() => {
      refreshTelemetry();
    });
    return () => unsubscribe();
  }, []);

  const handleRunUtf8Benchmark = () => {
    setIsRunningUtf8(true);
    setTimeout(() => {
      try {
        const out = BenchmarkRunner.runUtf8FramingBenchmark();
        setUtf8Results(out);
      } catch (e) {
        Alert.alert('Benchmark Error', String(e));
      } finally {
        setIsRunningUtf8(false);
      }
    }, 50);
  };

  const handleExportCsv = async () => {
    const csv = benchmarkLogger.exportCsv();
    try {
      await Share.share({
        title: 'iTantra Benchmark Telemetry CSV',
        message: csv,
      });
    } catch (e) {
      Alert.alert('Export Failed', String(e));
    }
  };

  const handleClearEvents = () => {
    benchmarkLogger.clearEvents();
    refreshTelemetry();
    Alert.alert('Cleared', 'Recorded telemetry ring-buffer has been reset.');
  };

  // Compute aggregate stats across recent traces
  const sttStats = useMemo(() => {
    const times = traceSummaries
      .map((s) => s.sttDurationMs)
      .filter((t): t is number => typeof t === 'number' && t >= 0);
    return benchmarkLogger.calculateStats(times);
  }, [traceSummaries]);

  const ttsStats = useMemo(() => {
    const times = traceSummaries
      .map((s) => s.ttsTtfaMs)
      .filter((t): t is number => typeof t === 'number' && t >= 0);
    return benchmarkLogger.calculateStats(times);
  }, [traceSummaries]);

  const bleTxStats = useMemo(
    () =>
      benchmarkLogger.calculateStats(
        traceSummaries
          .map((s) => s.bleTxDurationMs)
          .filter((t): t is number => typeof t === 'number' && t >= 0),
      ),
    [traceSummaries],
  );
  const bleConnectStats = useMemo(
    () =>
      benchmarkLogger.calculateStats(
        traceSummaries
          .map((s) => s.bleConnectDurationMs)
          .filter((t): t is number => typeof t === 'number' && t >= 0),
      ),
    [traceSummaries],
  );

  const filteredUtf8Results = useMemo(() => {
    if (!utf8Results) return [];
    if (selectedCategory === 'all') return utf8Results.results;
    return utf8Results.results.filter(
      (r) => r.testCase.category === selectedCategory,
    );
  }, [utf8Results, selectedCategory]);

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={[styles.heading, { color: colors.text }]}>
            System Benchmarks & Telemetry
          </Text>
          <Text style={[styles.subheading, { color: colors.textSecondary }]}>
            iTantra Neural Transceiver • Empirical Validation Suite
          </Text>
        </View>

        {/* Device-reported facts and configured constants, not results. */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Test Device & Configuration
          </Text>
          <View style={styles.specRow}>
            <Text style={[styles.specKey, { color: colors.textSecondary }]}>
              Device:
            </Text>
            <Text style={[styles.specValue, { color: colors.text }]}>
              {Device.manufacturer ?? 'Unknown'} {Device.modelName ?? 'Unknown'}
            </Text>
          </View>
          <View style={styles.specRow}>
            <Text style={[styles.specKey, { color: colors.textSecondary }]}>
              Android / OS:
            </Text>
            <Text style={[styles.specValue, { color: colors.text }]}>
              {Device.osVersion ?? 'Unknown'}
            </Text>
          </View>
          <View style={styles.specRow}>
            <Text style={[styles.specKey, { color: colors.textSecondary }]}>
              Physical memory (OS):
            </Text>
            <Text style={[styles.specValue, { color: colors.text }]}>
              {Device.totalMemory
                ? `${(Device.totalMemory / 1024 ** 3).toFixed(1)} GB`
                : 'Unavailable'}
            </Text>
          </View>
          <View style={styles.specRow}>
            <Text style={[styles.specKey, { color: colors.textSecondary }]}>
              BLE framing config:
            </Text>
            <Text style={[styles.specValue, { color: colors.text }]}>
              20 B fallback • 15 s reassembly timeout
            </Text>
          </View>
          <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
            Device memory is OS-reported total physical memory, not app RAM. BLE
            values are implementation settings, not measured throughput or
            range.
          </Text>
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Speech accuracy
          </Text>
          <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
            Run real microphone trials against a typed ground-truth transcript
            and export WER/CER inputs and results.
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary || '#007AFF' },
            ]}
            // Expo's checked-in route type snapshot predates this new route.
            onPress={() => router.push('/settings/stt-benchmark' as never)}
          >
            <Text style={styles.primaryButtonText}>
              Open STT Accuracy Trials
            </Text>
          </TouchableOpacity>
        </View>

        {/* 2. UTF-8 & BLE Framing Benchmark */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            UTF-8 & 20-Byte Boundary Suite
          </Text>
          <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
            In-app codec simulation only: bit-for-bit text reconstruction across
            packet boundaries. This does not exercise the radio or measure BLE
            delivery.
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: colors.primary || '#007AFF' },
            ]}
            onPress={handleRunUtf8Benchmark}
            disabled={isRunningUtf8}
          >
            <Text style={styles.primaryButtonText}>
              {isRunningUtf8
                ? 'Executing Test Suite…'
                : 'Run UTF-8 Framing Benchmark'}
            </Text>
          </TouchableOpacity>

          {utf8Results && (
            <View style={styles.resultsContainer}>
              <View style={styles.statsGrid}>
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: '#34C759' }]}>
                    {utf8Results.summary.exactMatchPct}%
                  </Text>
                  <Text
                    style={[styles.statLabel, { color: colors.textSecondary }]}
                  >
                    Exact Match
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text
                    style={[
                      styles.statValue,
                      {
                        color:
                          utf8Results.summary.corrupted === 0
                            ? '#34C759'
                            : '#FF3B30',
                      },
                    ]}
                  >
                    {utf8Results.summary.corrupted}
                  </Text>
                  <Text
                    style={[styles.statLabel, { color: colors.textSecondary }]}
                  >
                    Corrupted
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {utf8Results.summary.avgTimeMs} ms
                  </Text>
                  <Text
                    style={[styles.statLabel, { color: colors.textSecondary }]}
                  >
                    Avg Time
                  </Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={[styles.statValue, { color: colors.text }]}>
                    {utf8Results.summary.passed}/{utf8Results.summary.total}
                  </Text>
                  <Text
                    style={[styles.statLabel, { color: colors.textSecondary }]}
                  >
                    Pass/Total
                  </Text>
                </View>
              </View>

              {/* Category Filter Chips */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipsRow}
              >
                {[
                  'all',
                  'boundary',
                  'hindi',
                  'kannada',
                  'ascii',
                  'mixed',
                  'emoji',
                  'stress',
                ].map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          selectedCategory === cat
                            ? colors.primary || '#007AFF'
                            : colors.background,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => setSelectedCategory(cat)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        {
                          color:
                            selectedCategory === cat ? '#fff' : colors.text,
                        },
                      ]}
                    >
                      {cat.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Test Cases List */}
              <View style={styles.testList}>
                {filteredUtf8Results.map((r) => (
                  <View
                    key={r.testCase.id}
                    style={[
                      styles.testItem,
                      { borderBottomColor: colors.border },
                    ]}
                  >
                    <View style={styles.testItemHeader}>
                      <Text style={[styles.testId, { color: colors.text }]}>
                        {r.testCase.id} ({r.testCase.category})
                      </Text>
                      <Text
                        style={[
                          styles.badge,
                          {
                            backgroundColor: r.passed ? '#E8F5E9' : '#FFEBEE',
                            color: r.passed ? '#2E7D32' : '#C62828',
                          },
                        ]}
                      >
                        {r.passed ? 'PASS' : 'FAIL'}
                      </Text>
                    </View>
                    <Text
                      style={[styles.testDesc, { color: colors.textSecondary }]}
                    >
                      {r.testCase.description}
                    </Text>
                    <Text
                      style={[styles.testTextPreview, { color: colors.text }]}
                      numberOfLines={1}
                    >
                      &quot;{r.testCase.text}&quot;
                    </Text>
                    <View style={styles.testMetaRow}>
                      <Text
                        style={[
                          styles.testMeta,
                          { color: colors.textSecondary },
                        ]}
                      >
                        Bytes: {r.originalByteLength}B • Chunks:{' '}
                        {r.packetsCount} • Time: {r.executionTimeMs}ms
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>

        {/* 3. Operational Latency Statistics Card */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.cardTitle, { color: colors.text }]}>
            Observed Pipeline Latency (Recent Sessions)
          </Text>
          <Text style={[styles.cardDesc, { color: colors.textSecondary }]}>
            Timings captured in this app process. BLE send completion means
            local GATT writes resolved; it is not a receiver acknowledgement.
            TTS first chunk/write are not acoustic-onset measurements.
          </Text>

          <View style={styles.statsGrid}>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {sttStats.count > 0 ? `${sttStats.median} ms` : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                STT Median (P50, recent recorded traces)
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {bleTxStats.count > 0 ? `${bleTxStats.median} ms` : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                BLE local-send median
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {bleConnectStats.count > 0
                  ? `${bleConnectStats.median} ms`
                  : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                BLE connect median
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {sttStats.count > 0 ? `${sttStats.p90} ms` : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                STT P90 Latency
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {ttsStats.count > 0 ? `${ttsStats.median} ms` : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                TTS generation first-chunk time (P50)
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.text }]}>
                {ttsStats.count > 0 ? `${ttsStats.p90} ms` : '—'}
              </Text>
              <Text style={[styles.statLabel, { color: colors.textSecondary }]}>
                TTS generation first-chunk time (P90)
              </Text>
            </View>
          </View>
          <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
            {formatStats('STT inference', sttStats)}
          </Text>
          <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
            {formatStats('TTS time to first generated chunk', ttsStats)}
          </Text>
          <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
            {formatStats('BLE local send', bleTxStats)}
          </Text>
          <Text style={[styles.summaryLine, { color: colors.textSecondary }]}>
            {formatStats('BLE connection setup', bleConnectStats)}
          </Text>
        </View>

        {/* 4. Live Event Log Stream */}
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <View style={styles.cardHeaderRow}>
            <Text style={[styles.cardTitle, { color: colors.text }]}>
              Live Telemetry Events
            </Text>
            <TouchableOpacity onPress={handleClearEvents}>
              <Text style={[styles.actionText, { color: '#FF3B30' }]}>
                Clear
              </Text>
            </TouchableOpacity>
          </View>

          {events.length === 0 ? (
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              No events recorded yet. Send a voice message or transmit over BLE
              to capture live telemetry.
            </Text>
          ) : (
            <View style={styles.eventList}>
              {events.map((e, idx) => (
                <View
                  key={`${e.traceId}_${e.stage}_${idx}`}
                  style={[
                    styles.eventItem,
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <View style={styles.eventTop}>
                    <Text style={[styles.eventStage, { color: colors.text }]}>
                      {e.stage}
                    </Text>
                    <Text
                      style={[
                        styles.eventTime,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {new Date(e.timestampMillis).toLocaleTimeString()}
                    </Text>
                  </View>
                  <Text
                    style={[styles.eventTrace, { color: colors.textSecondary }]}
                  >
                    Trace: {e.traceId}
                    {e.charCount !== undefined && ` • ${e.charCount} chars`}
                    {e.byteCount !== undefined && ` • ${e.byteCount} bytes`}
                    {e.extraInfo ? ` • ${e.extraInfo}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.secondaryButton, { borderColor: colors.border }]}
            onPress={handleExportCsv}
          >
            <Text style={[styles.secondaryButtonText, { color: colors.text }]}>
              Export Full Telemetry (CSV)
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  headerBlock: {
    marginBottom: 16,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
  },
  subheading: {
    fontSize: 13,
    marginTop: 4,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  summaryLine: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 5,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  specRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  specKey: {
    fontSize: 13,
  },
  specValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginVertical: 8,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  resultsContainer: {
    marginTop: 14,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -4,
    marginBottom: 12,
  },
  statBox: {
    flex: 1,
    minWidth: '45%',
    padding: 10,
    margin: 4,
    backgroundColor: 'rgba(0,0,0,0.03)',
    borderRadius: 8,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  chipsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  testList: {
    marginTop: 6,
  },
  testItem: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  testItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  testId: {
    fontSize: 13,
    fontWeight: '600',
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  testDesc: {
    fontSize: 12,
    marginTop: 2,
  },
  testTextPreview: {
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  testMetaRow: {
    flexDirection: 'row',
    marginTop: 3,
  },
  testMeta: {
    fontSize: 11,
  },
  emptyText: {
    fontSize: 13,
    fontStyle: 'italic',
    paddingVertical: 8,
  },
  eventList: {
    marginTop: 4,
  },
  eventItem: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  eventTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  eventStage: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 11,
  },
  eventTrace: {
    fontSize: 11,
    marginTop: 1,
  },
});
