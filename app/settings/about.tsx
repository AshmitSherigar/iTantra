import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';

export default function AboutScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={[styles.appName, { color: colors.text }]}>
            VaaniSetu
          </Text>

          <Text style={[styles.description, { color: colors.textSecondary }]}>
            A low-latency speech-to-text and text-to-speech mobile application
            built with React Native for emergency contact.
          </Text>

          <Text style={[styles.version, { color: colors.textSecondary }]}>
            Version 1.1.0
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },

  container: {
    flex: 1,
  },

  content: {
    padding: 25,
    alignItems: 'center',
  },

  appName: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 15,
  },

  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },

  version: {
    marginTop: 30,
    fontSize: 14,
  },
});
