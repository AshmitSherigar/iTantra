import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Radius, Shadows, Typography } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

type TranscriptBoxProps = {
  transcript: string;
  onChangeText?: (text: string) => void;
  editable?: boolean;
  placeholder?: string;
};

/** Premium glass transcript card - 20px radius, fine border, micro-shadow. */
export default function TranscriptBox({
  transcript,
  onChangeText,
  editable = false,
  placeholder,
}: TranscriptBoxProps) {
  const { colors } = useTheme() as any;

  const hasTranscript = transcript.length > 0;
  const isEditable = editable && typeof onChangeText === 'function';

  return (
    <View
      style={[
        styles.container,
        Shadows.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.glassBorder,
        },
      ]}
    >
      <View style={styles.labelRow}>
        <Text style={[Typography.overline, { color: colors.textSecondary }]}>
          Transcript
        </Text>
        <View
          style={[
            styles.dot,
            { backgroundColor: hasTranscript ? colors.success : colors.border },
          ]}
        />
      </View>

      {isEditable ? (
        <TextInput
          value={transcript}
          onChangeText={onChangeText}
          multiline
          textAlignVertical="top"
          placeholder={placeholder ?? 'Your words appear here...'}
          placeholderTextColor={colors.textTertiary ?? colors.textSecondary}
          style={[styles.input, { color: colors.text }]}
        />
      ) : (
        <Text
          style={[
            styles.text,
            { color: hasTranscript ? colors.text : colors.textSecondary },
          ]}
        >
          {hasTranscript
            ? transcript
            : (placeholder ?? 'Your words appear here...')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 132,
    padding: 18,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    ...Typography.body,
    fontSize: 16,
    lineHeight: 24,
  },
  input: {
    minHeight: 88,
    fontSize: 16,
    lineHeight: 24,
    padding: 0,
    margin: 0,
  },
});
