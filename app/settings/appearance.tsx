import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';

export default function AppearanceScreen() {
  const { theme, setTheme, colors } = useTheme();

  const themes = ['Light', 'Dark', 'System Default'] as const;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        <Text style={[styles.heading, { color: colors.text }]}>
          Choose Appearance
        </Text>

        {themes.map((item) => (
          <TouchableOpacity
            key={item}
            style={[styles.option, { borderBottomColor: colors.border }]}
            activeOpacity={0.7}
            onPress={() => setTheme(item)}
          >
            <Text style={[styles.optionText, { color: colors.text }]}>
              {item}
            </Text>

            {theme === item && (
              <Text style={[styles.check, { color: colors.primary }]}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  content: {
    padding: 20,
  },

  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: 1,
  },

  optionText: {
    fontSize: 17,
  },

  check: {
    fontSize: 20,
    fontWeight: '700',
  },
});
