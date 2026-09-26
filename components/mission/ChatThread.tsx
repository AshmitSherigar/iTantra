import { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Mic, Send, Square, Trash2, Volume2, VolumeX } from 'lucide-react-native';

import { useTheme } from '@/context/ThemeContext';
import { useKeyboardHeight } from '@/components/ui/useKeyboardHeight';
import { Shadows, Spacing } from '@/constants/theme';
import { styles as bubbleStyles } from '@/app/(tabs)/bluetooth.styles';

export type ChatThreadMessage = {
  id: string;
  text: string;
  sender: 'me' | 'other';
};

type ChatThreadProps = {
  messages: ChatThreadMessage[];
  emptyText: string;
  inputValue: string;
  onChangeInput: (text: string) => void;
  onSend: () => void;
  isRecording: boolean;
  isTranscribing: boolean;
  onMicPress: () => void;
  partialText?: string;
  errorText?: string | null;
  autoSpeakEnabled?: boolean;
  onToggleAutoSpeak?: () => void;
  autoSpeakStatusText?: string;
  isSpeaking?: boolean;
  onStopSpeaking?: () => void;
  onClearMessages?: () => void;
};

export default function ChatThread({
  messages,
  emptyText,
  inputValue,
  onChangeInput,
  onSend,
  isRecording,
  isTranscribing,
  onMicPress,
  partialText,
  errorText,
  autoSpeakEnabled,
  onToggleAutoSpeak,
  autoSpeakStatusText,
  isSpeaking,
  onStopSpeaking,
  onClearMessages,
}: ChatThreadProps) {
  const { colors } = useTheme();
  const kbHeight = useKeyboardHeight();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (kbHeight <= 0) return;
    const t = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 60);
    return () => clearTimeout(t);
  }, [kbHeight]);

  const showAutoSpeak = onToggleAutoSpeak !== undefined;
  const showToolbar = showAutoSpeak || onClearMessages !== undefined;

  return (
    <KeyboardAvoidingView
      style={bubbleStyles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        ref={scrollRef}
        style={bubbleStyles.flex}
        contentContainerStyle={[
          bubbleStyles.messagesContent,
          { paddingHorizontal: Spacing.lg },
        ]}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (kbHeight > 0) {
            scrollRef.current?.scrollToEnd({ animated: true });
          }
        }}
      >
        {messages.length === 0 ? (
          <Text
            style={[
              bubbleStyles.emptyChatText,
              { color: colors.textSecondary, textAlign: 'center' },
            ]}
          >
            {emptyText}
          </Text>
        ) : (
          messages.map((item) => (
            <View
              key={item.id}
              style={[
                bubbleStyles.messageRow,
                item.sender === 'me'
                  ? bubbleStyles.messageRowMe
                  : bubbleStyles.messageRowOther,
              ]}
            >
              <View
                style={[
                  bubbleStyles.messageBubble,
                  item.sender === 'me'
                    ? [
                        bubbleStyles.messageBubbleMe,
                        { backgroundColor: colors.text },
                      ]
                    : [
                        bubbleStyles.messageBubbleOther,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.glassBorder,
                        },
                      ],
                ]}
              >
                <Text
                  style={[
                    bubbleStyles.messageText,
                    item.sender === 'me'
                      ? [
                          bubbleStyles.messageTextMe,
                          { color: colors.background },
                        ]
                      : [bubbleStyles.messageTextOther, { color: colors.text }],
                  ]}
                >
                  {item.text}
                </Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {isRecording || isTranscribing ? (
        <Text
          style={[styles.hintLine, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          {isRecording
            ? `Recording...${partialText ? ` "${partialText}"` : ' tap mic to stop'}`
            : 'Transcribing speech...'}
        </Text>
      ) : null}
      {errorText && !isRecording && !isTranscribing ? (
        <Text
          style={[styles.hintLine, { color: colors.error }]}
          numberOfLines={2}
        >
          {errorText}
        </Text>
      ) : null}

      {showToolbar ? (
        <View style={{ paddingHorizontal: Spacing.lg }}>
          <View
            style={[
              styles.utilRow,
              { backgroundColor: colors.card, borderColor: colors.glassBorder },
            ]}
          >
            {showAutoSpeak ? (
              <TouchableOpacity
                style={[
                  styles.hearChip,
                  {
                    backgroundColor: autoSpeakEnabled
                      ? colors.text
                      : colors.inputBackground,
                  },
                ]}
                onPress={onToggleAutoSpeak}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Toggle auto-speak"
                accessibilityState={{ selected: !!autoSpeakEnabled }}
              >
                {autoSpeakEnabled ? (
                  <Volume2 size={14} color={colors.background} />
                ) : (
                  <VolumeX size={14} color={colors.textSecondary} />
                )}
                <Text
                  style={[
                    styles.hearChipText,
                    {
                      color: autoSpeakEnabled
                        ? colors.background
                        : colors.textSecondary,
                    },
                  ]}
                >
                  Hear
                </Text>
              </TouchableOpacity>
            ) : null}

            {autoSpeakStatusText ? (
              <Text
                style={[styles.utilStatus, { color: colors.textSecondary }]}
                numberOfLines={1}
              >
                {autoSpeakStatusText}
              </Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}

            {isSpeaking && onStopSpeaking ? (
              <TouchableOpacity
                onPress={onStopSpeaking}
                activeOpacity={0.8}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Stop speaking"
              >
                <Square size={16} color={colors.error} fill={colors.error} />
              </TouchableOpacity>
            ) : null}

            {onClearMessages && messages.length > 0 ? (
              <TouchableOpacity
                onPress={onClearMessages}
                activeOpacity={0.8}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear messages"
              >
                <Trash2 size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      <View
        style={{
          paddingHorizontal: Spacing.lg,
          paddingBottom: kbHeight > 0 ? kbHeight + 12 : Spacing.lg,
        }}
      >
        <View
          style={[
            styles.composerCard,
            { backgroundColor: colors.card, borderColor: colors.glassBorder },
            Shadows.floating,
          ]}
        >
          <TextInput
            value={inputValue}
            onChangeText={onChangeInput}
            placeholder={isRecording ? 'Recording...' : 'Type a message...'}
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              {
                backgroundColor: colors.inputBackground,
                color: colors.text,
                flex: 1,
              },
            ]}
            multiline
            editable={!isRecording && !isTranscribing}
          />
          <TouchableOpacity
            style={[
              styles.circleBtn,
              {
                backgroundColor: isRecording
                  ? colors.error
                  : colors.inputBackground,
              },
            ]}
            onPress={onMicPress}
            disabled={isTranscribing}
            activeOpacity={0.85}
          >
            {isTranscribing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : isRecording ? (
              <Square size={18} color="#FFF" fill="#FFF" />
            ) : (
              <Mic size={20} color={colors.primary} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.circleBtn,
              {
                backgroundColor: inputValue.trim()
                  ? colors.primary
                  : colors.inputBackground,
              },
            ]}
            disabled={!inputValue.trim() || isRecording || isTranscribing}
            onPress={onSend}
            activeOpacity={0.85}
          >
            <Send
              size={18}
              color={inputValue.trim() ? colors.background : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  hintLine: {
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.lg,
    marginTop: 6,
  },
  utilRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  hearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  hearChipText: {
    fontSize: 13,
    fontWeight: '700',
  },
  utilStatus: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  composerCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  input: {
    minHeight: 46,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 14,
    fontSize: 15,
  },
  circleBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
