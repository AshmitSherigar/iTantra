import { StyleSheet, Text, TextInput, View } from 'react-native';

import { FontSize, Radius, Spacing } from '../constants/theme';

import { useTheme } from '../context/ThemeContext';

type TranscriptBoxProps = {
  transcript: string;
  /** When provided with `editable`, the box becomes an editable textbox. */
  onChangeText?: (text: string) => void;
  editable?: boolean;
  placeholder?: string;
};

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
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        TRANSCRIPT
      </Text>

      {isEditable ? (
        <TextInput
          value={transcript}
          onChangeText={onChangeText}
          multiline
          textAlignVertical="top"
          placeholder={placeholder ?? '…'}
          placeholderTextColor={colors.textSecondary}
          style={[styles.input, { color: colors.text }]}
        />
      ) : (
        <Text style={[styles.text, { color: colors.text }]}>
          {hasTranscript ? transcript : (placeholder ?? '…')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    minHeight: 100,
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },

  label: {
    fontSize: FontSize.small,
    fontWeight: '600',
    marginBottom: Spacing.md,
    letterSpacing: 1,
  },

  text: {
    fontSize: FontSize.body,
    lineHeight: 26,
  },

  input: {
    minHeight: 80,
    fontSize: FontSize.body,
    lineHeight: 26,
    padding: 0,
    margin: 0,
  },
});
