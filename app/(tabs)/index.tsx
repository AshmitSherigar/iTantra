import { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import Header from '@/components/Header';
import RecordButton from '@/components/RecordButton';
import TranscriptBox from '@/components/TranscriptBox';
import StatusIndicator from '@/components/StatusIndicator';

import { useTheme } from '../../context/ThemeContext';
import { FontSize, Radius, Spacing } from '../../constants/theme';

export default function Index() {
  const { colors } = useTheme();

  const [transcript, setTranscript] = useState('');
  const [status, setStatus] = useState<
    'ready' | 'listening' | 'processing' | 'error'
  >('ready');

  const isRecording = status === 'listening';

  function handleRecording() {
    if (status === 'ready') {
      setStatus('listening');
      setTranscript('Listening...');
    } else if (status === 'listening') {
      setStatus('processing');
      setTranscript('Processing your speech...');
    }
  }

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      {/* Header */}
      <View style={styles.headerArea}>
        <View>
          <Text style={[styles.greeting, { color: colors.textSecondary }]}>
            READY TO CAPTURE
          </Text>

          <Text style={[styles.title, { color: colors.text }]}>
            Speech to Text
          </Text>
        </View>

        <View style={[styles.headerIcon, { backgroundColor: colors.surface }]}>
          <Ionicons name="mic-outline" size={22} color={colors.primary} />
        </View>
      </View>

      {/* Transcript */}
      <View style={styles.transcriptSection}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>
            Live Transcript
          </Text>

          <View
            style={[
              styles.liveBadge,
              {
                backgroundColor: isRecording ? colors.error : colors.surface,
              },
            ]}
          >
            <View
              style={[
                styles.badgeDot,
                {
                  backgroundColor: isRecording ? '#FFFFFF' : colors.success,
                },
              ]}
            />

            <Text
              style={[
                styles.liveText,
                {
                  color: isRecording ? '#FFFFFF' : colors.textSecondary,
                },
              ]}
            >
              {isRecording ? 'LIVE' : 'READY'}
            </Text>
          </View>
        </View>

        <TranscriptBox transcript={transcript} />
      </View>

      {/* Recording Area */}
      <View
        style={[
          styles.recordingCard,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.recordTitle, { color: colors.text }]}>
          {isRecording ? 'Listening to you...' : 'Tap to start speaking'}
        </Text>

        <Text style={[styles.recordSubtitle, { color: colors.textSecondary }]}>
          {isRecording
            ? 'Tap the button when you are finished'
            : 'Your speech will appear above'}
        </Text>

        <RecordButton isRecording={isRecording} onPress={handleRecording} />

        <StatusIndicator status={status} />
      </View>

      {/* Bottom Hint */}
      <View style={styles.footer}>
        <Ionicons name="flash-outline" size={16} color={colors.textSecondary} />

        <Text style={[styles.footerText, { color: colors.textSecondary }]}>
          Low-latency speech recognition
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.md,
  },

  headerArea: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
  },

  greeting: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
  },

  title: {
    marginTop: 4,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },

  headerIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  transcriptSection: {
    flex: 1,
    minHeight: 220,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },

  sectionTitle: {
    fontSize: FontSize.medium,
    fontWeight: '700',
  },

  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radius.round,
  },

  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },

  liveText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.7,
  },

  recordingCard: {
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    marginTop: Spacing.md,
  },

  recordTitle: {
    fontSize: FontSize.medium,
    fontWeight: '700',
  },

  recordSubtitle: {
    marginTop: 4,
    fontSize: FontSize.small,
    textAlign: 'center',
  },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
  },

  footerText: {
    fontSize: 11,
  },
});
