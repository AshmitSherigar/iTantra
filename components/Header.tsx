import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

export default function Header() {
  const theme = useTheme() as any;
  const colors = theme.colors ?? { text: '#000000', textSecondary: '#666666' };

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>
        Low Latency STT
      </Text>

      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
        Speech to Text
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: Spacing.md,
  },

  title: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
  },

  subtitle: {
    marginTop: Spacing.sm,
    fontSize: FontSize.body,
  },
});
