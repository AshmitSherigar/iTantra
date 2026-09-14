import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';

import { useTheme } from '@/context/ThemeContext';

type Status = 'ready' | 'listening' | 'processing' | 'error';

type StatusIndicatorProps = {
  status: Status;
};

const statusText: Record<Status, string> = {
  ready: 'Ready',
  listening: 'Listening...',
  processing: 'Processing...',
  error: 'Something went wrong',
};

export default function StatusIndicator({ status }: StatusIndicatorProps) {
  const { colors } = useTheme() as any;

  return (
    <View style={styles.container}>
      <Text style={[styles.text, { color: colors.textSecondary }]}>
        {statusText[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    gap: Spacing.sm,
  },

  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  text: {
    fontSize: FontSize.body,
  },
});
