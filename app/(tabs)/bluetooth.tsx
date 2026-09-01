import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontSize, Spacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';


export default function History() {
  const { colors } = useTheme() as any;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <Text style={[styles.title, { color: colors.text }]}>Bluetooth</Text>
    </SafeAreaView>
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
    marginBottom: Spacing.lg,
  },
});
