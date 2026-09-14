import { Stack, useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';

import { useTheme } from '@/context/ThemeContext';

export default function TranscriptDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme() as any;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: 'Transcript',
          headerBackTitle: 'Back',
          headerStyle: {
            backgroundColor: colors.background,
          },
          headerTintColor: colors.text,
          headerTitleStyle: {
            color: colors.text,
          },
        }}
      />

      <Text style={[styles.title, { color: colors.text }]}>
        Transcript #{id}
      </Text>

      <Text style={[styles.date, { color: colors.textSecondary }]}>
        Today, 10:30 AM
      </Text>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.transcript, { color: colors.text }]}>
          This is where the complete transcript will appear. Later, the actual
          speech-to-text system will provide this content.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.md,
  },

  title: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
  },

  date: {
    marginTop: Spacing.sm,
    fontSize: FontSize.small,
  },

  card: {
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderRadius: Radius.md,
  },

  transcript: {
    fontSize: FontSize.body,
    lineHeight: 26,
  },
});
