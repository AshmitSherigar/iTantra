  import { useEffect, useState } from 'react';
  import {
    ActivityIndicator,
    Alert,
    Pressable,
    StyleSheet,
    Text,
    View,
  } from 'react-native';
  import { SafeAreaView } from 'react-native-safe-area-context';
  import { Ionicons } from '@expo/vector-icons';
  import { router } from 'expo-router';
  import * as Device from 'expo-device';

  import RecordButton from '@/components/RecordButton';
  import TranscriptBox from '@/components/TranscriptBox';
  import StatusIndicator from '@/components/StatusIndicator';

  import { useTheme } from '../../context/ThemeContext';
  import { useLanguage } from '../../context/LanguageContext';
  import { isLanguageInstalled } from '../../features/models/languages';
  import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
  import { FontSize, Radius, Spacing } from '../../constants/theme';
  import {
    makeBroadcastId,
    sendNearbyBroadcast,
  } from '../../features/bluetooth';

  export default function Index() {
    const { colors } = useTheme();
    const { selectedLanguage } = useLanguage();

    const [transcript, setTranscript] = useState('');
    const [isBroadcasting, setIsBroadcasting] = useState(false);

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
    } = useVoiceMessage();

    const languageInstalled = isLanguageInstalled(selectedLanguage);
    const sttModelPath = selectedLanguage.sttAssetPath;

    useEffect(() => {
      if (!languageInstalled || !sttModelPath) return;
      void ensureSttReady(sttModelPath);
    }, [sttModelPath, languageInstalled]);

    const status: 'ready' | 'listening' | 'processing' | 'error' = isRecording
      ? 'listening'
      : isTranscribing || sttLoading
        ? 'processing'
        : voiceError || sttError
          ? 'error'
          : 'ready';

    function promptInstallLanguage() {
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
    }

    async function handleRecording() {
      if (isRecording) {
        const text = await stopVoice();
        if (text) {
          setTranscript(text);
        }
        return;
      }

      if (isTranscribing || sttLoading) return;

      if (!languageInstalled || !sttModelPath) {
        promptInstallLanguage();
        return;
      }

      setTranscript('');
      await ensureSttReady(sttModelPath);
      await startVoice();
    }

    async function handleBroadcast() {
      const message = transcript.trim();
      if (!message || isBroadcasting) return;

      setIsBroadcasting(true);
      const senderName =
        Device.deviceName?.trim() || Device.modelName?.trim() || 'VaaniSetu';
      try {
        const sent = await sendNearbyBroadcast({
          type: 'broadcast',
          id: makeBroadcastId(),
          senderName,
          message,
          language: selectedLanguage.id,
        });
        Alert.alert(
          sent ? 'Broadcast sent' : 'Broadcast unavailable',
          sent
            ? 'Broadcast sent to nearby devices.'
            : 'No nearby VaaniSetu connection is ready. Start Bluetooth and connect to a device first.',
          [{ text: 'OK' }],
        );
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
    }

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
            : `${selectedLanguage.label} • Tap mic to load model`;

    return (
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['top', 'bottom']}
      >
        <View style={styles.headerArea}>
          <View>
            <Text style={[styles.title, { color: colors.text }]}>
              Speech to Text
            </Text>
          </View>
        </View>

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

          <TranscriptBox
            transcript={transcript}
            onChangeText={setTranscript}
            editable
            placeholder={
              isRecording
                ? 'Listening… speak now'
                : `Tap the mic and speak in ${selectedLanguage.label}…`
            }
          />

          <Pressable
            onPress={handleBroadcast}
            disabled={!canBroadcast}
            style={({ pressed }) => [
              styles.broadcastButton,
              {
                backgroundColor: canBroadcast ? colors.primary : colors.surface,
                borderColor: colors.border,
                opacity: !canBroadcast ? 0.6 : pressed ? 0.85 : 1,
              },
            ]}
          >
            <Ionicons
              name="megaphone-outline"
              size={18}
              color={canBroadcast ? '#FFFFFF' : colors.textSecondary}
            />
            <Text
              style={[
                styles.broadcastText,
                { color: canBroadcast ? '#FFFFFF' : colors.textSecondary },
              ]}
            >
              {isBroadcasting ? 'Sending…' : 'Broadcast'}
            </Text>
          </Pressable>
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
            <Ionicons name="download-outline" size={16} color={colors.primary} />
            <Text style={[styles.installText, { color: colors.primary }]}>
              Install “{selectedLanguage.label}” models to enable the mic
            </Text>
          </Pressable>
        ) : null}
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
            {isRecording
              ? `Listening in ${selectedLanguage.label}...`
              : isTranscribing || sttLoading
                ? 'Working...'
                : 'Tap to start speaking'}
          </Text>

          <Text style={[styles.recordSubtitle, { color: colors.textSecondary }]}>
            {isRecording
              ? 'Tap the button when you are finished'
              : sttLoading
                ? `Loading ${selectedLanguage.label} speech model…`
                : 'Your speech will appear above'}
          </Text>

          <RecordButton isRecording={isRecording} onPress={handleRecording} />

          {sttLoading && !isRecording ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.loadingText, { color: colors.textSecondary }]}>
                Loading speech model…
              </Text>
            </View>
          ) : null}

          <StatusIndicator status={status} />
        </View>

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
      borderRadius: Radius.sm,
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

    languageLine: {
      marginTop: Spacing.xl,
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

    errorLine: {
      fontSize: 10,
    },

    broadcastButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: Spacing.sm,
      paddingVertical: 13,
      borderRadius: Radius.md,
      borderWidth: 1,
    },

    broadcastText: {
      fontSize: FontSize.medium,
      fontWeight: '700',
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

    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: Spacing.sm,
    },

    loadingText: {
      fontSize: 13,
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
