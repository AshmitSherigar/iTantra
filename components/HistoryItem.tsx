import { Pressable, StyleSheet, Text } from 'react-native';

import { FontSize, Radius, Spacing } from '../constants/theme';

import { useTheme } from '../context/ThemeContext';

type HistoryItemProps = {
  title: string;
  preview: string;
  date: string;
  onPress: () => void;
};

export default function HistoryItem({
  title,
  preview,
  date,
  onPress,
}: HistoryItemProps) {
  const theme = useTheme();
  const colors = (theme as any)?.colors ?? {
    text: '#000000',
    textSecondary: '#666666',
    surface: '#ffffff',
    border: '#d9d9d9',
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
        },
        pressed && styles.pressed,
      ]}
      onPress={onPress}
    >
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

      <Text
        style={[styles.preview, { color: colors.textSecondary }]}
        numberOfLines={2}
      >
        {preview}
      </Text>

      <Text style={[styles.date, { color: colors.textSecondary }]}>{date}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderRadius: Radius.md,
  },

  title: {
    fontSize: FontSize.medium,
    fontWeight: '600',
  },

  preview: {
    marginTop: Spacing.sm,
    fontSize: FontSize.body,
    lineHeight: 22,
  },

  date: {
    marginTop: Spacing.sm,
    fontSize: FontSize.small,
  },

  pressed: {
    opacity: 0.7,
  },
});
