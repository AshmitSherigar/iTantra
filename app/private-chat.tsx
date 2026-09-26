import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { View, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';

import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useVoiceMessage } from '@/features/audio/useVoiceMessage';
import { isLanguageInstalled } from '@/features/models/languages';

import ScreenHeader from '@/components/ui/ScreenHeader';
import CircleButton from '@/components/ui/CircleButton';
import { showAppAlert } from '@/components/ui/AppModal';
import ChatThread, {
  type ChatThreadMessage,
} from '@/components/mission/ChatThread';
import {
  subscribeMissionSession,
  getMissionSession,
} from '@/components/mission/missionSession';

import { Spacing } from '@/constants/theme';

export default function PrivateChatScreen() {
  const { colors } = useTheme();
  const { selectedLanguage } = useLanguage();
  const params = useLocalSearchParams<{
    address: string;
    name: string;
    transport: string;
  }>();

  const address = params.address ?? '';
  const targetName = params.name || 'Device';
  const isWifiTarget = params.transport !== 'ble';

  const [message, setMessage] = useState('');

  const {
    isRecording,
    isTranscribing,
    partialText,
    error: voiceError,
    sttReady,
    startVoice,
    stopVoice,
    ensureSttReady,
  } = useVoiceMessage();

  const languageInstalled = isLanguageInstalled(selectedLanguage);

  const session = useSyncExternalStore(
    subscribeMissionSession,
    getMissionSession,
  );

  const messages = useMemo<ChatThreadMessage[]>(() => {
    if (isWifiTarget) {
      return session.wifiMessages
        .filter((m) => m.peerAddress === address)
        .map((m) => ({ id: m.id, text: m.text, sender: m.sender }));
    }
    return session.bleMessages
      .filter((m) => m.senderName === targetName || m.sender === 'me')
      .map((m) => ({ id: m.id, text: m.text, sender: m.sender }));
  }, [session.wifiMessages, session.bleMessages, isWifiTarget, address, targetName]);

  const sendToTarget = useCallback(
    (text: string) => {
      if (isWifiTarget) {
        session.wifiSendToPeer?.(address, text);
      } else {
        void session.bleBroadcastSend?.(text);
      }
    },
    [isWifiTarget, address, session],
  );

  const handleSend = useCallback(() => {
    const trimmed = message.trim();
    if (!trimmed) return;
    sendToTarget(trimmed);
    setMessage('');
  }, [message, sendToTarget]);

  const handleMicPress = useCallback(async () => {
    if (!isRecording && !languageInstalled) {
      await showAppAlert(
        'Language model not installed',
        `Install "${selectedLanguage.label}" models to use voice.`,
        [{ text: 'OK' }],
      );
      return;
    }
    try {
      if (isRecording) {
        const text = await stopVoice();
        if (text) sendToTarget(text);
      } else {
        if (!sttReady) {
          await ensureSttReady(selectedLanguage.sttAssetPath ?? undefined);
        }
        await startVoice();
      }
    } catch (e) {
      console.warn('[PrivateChat] voice toggle failed', e);
    }
  }, [
    isRecording,
    languageInstalled,
    selectedLanguage,
    stopVoice,
    sendToTarget,
    sttReady,
    ensureSttReady,
    startVoice,
  ]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  return (
    <SafeAreaView
      style={[styles.flex, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }}>
        <ScreenHeader
          title={targetName}
          subtitle={
            isWifiTarget
              ? `Private • ${selectedLanguage.label}`
              : 'BLE mesh • sent to all nearby devices, shown filtered here'
          }
          left={
            <CircleButton
              onPress={handleBack}
              accessibilityLabel="Back to Mission Mode"
            >
              <ArrowLeft size={20} color={colors.text} />
            </CircleButton>
          }
        />
      </View>

      <ChatThread
        messages={messages}
        emptyText={`Messages with ${targetName} appear here.`}
        inputValue={message}
        onChangeInput={setMessage}
        onSend={handleSend}
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        onMicPress={handleMicPress}
        partialText={partialText}
        errorText={voiceError}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
