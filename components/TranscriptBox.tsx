import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '../constants/theme';

import { useTheme } from '../context/ThemeContext';

type TranscriptBoxProps = {
  transcript: string;
};

export default function TranscriptBox({ transcript }: TranscriptBoxProps) {
  const { colors } = useTheme() as any;

  const hasTranscript = transcript.length > 0;

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

      <Text style={[styles.text, { color: colors.text }]}>
        {hasTranscript ? transcript : 'Your transcript will appear here...'}
      </Text>
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
});
