import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { AudioLines } from 'lucide-react-native';
import { router } from 'expo-router';

import { useTheme } from '../../context/ThemeContext';
import GlassCard from '@/components/ui/GlassCard';
import SpringButton from '@/components/ui/SpringButton';
import {
  FontFamily,
  Radius,
  Shadows,
  Spacing,
  Typography,
} from '../../constants/theme';

export default function AboutScreen() {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={['#CF5C36', '#050517']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.logo, Shadows.floating]}
        >
          <AudioLines size={34} color="#FFF" strokeWidth={2.2} />
        </LinearGradient>
        <Text
          style={[
            Typography.title,
            { color: colors.text, marginTop: Spacing.md },
          ]}
        >
          VaaniSetu
        </Text>
        <Text
          style={[
            Typography.body,
            { color: colors.textSecondary, textAlign: 'center', marginTop: 6 },
          ]}
        >
          Offline voice + SOS for nearby phones.{'\n'}No internet needed.
        </Text>

        <GlassCard style={{ marginTop: Spacing.lg, width: '100%' }}>
          <View style={styles.featureRow}>
            {['Mesh voice', 'SOS timer', 'Siren'].map((f) => (
              <View
                key={f}
                style={[styles.pill, { backgroundColor: colors.primaryMuted }]}
              >
                <Text style={[styles.pillText, { color: colors.primary }]}>
                  {f}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[styles.version, { color: colors.textSecondary }]}>
            Version 1.0.0
          </Text>
        </GlassCard>

        <GlassCard
          style={{ marginTop: Spacing.md, width: '100%', alignItems: 'center' }}
          padding={22}
        >
          <Text style={[styles.itantraTitle, { color: colors.text }]}>
            iTantra.
          </Text>
          <Text style={[styles.itantraDesc, { color: colors.textSecondary }]}>
            iTantra is a fully offline, AI-powered multilingual voice
            communication Android application designed for use in
            zero-connectivity environments
          </Text>
          <SpringButton
            title="Get Started"
            variant="ink"
            onPress={() => router.push('/(tabs)')}
            style={styles.itantraButton}
          />
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    alignItems: 'center',
  },
  logo: {
    width: 84,
    height: 84,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureRow: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.round,
  },
  pillText: { fontSize: 12, fontWeight: '700' },
  version: { marginTop: 12, fontSize: 13, textAlign: 'center' },
  itantraTitle: {
    fontFamily: FontFamily.display,
    fontSize: 32,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
    lineHeight: 38,
    textAlign: 'center',
  },
  itantraDesc: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginTop: 10,
    paddingHorizontal: 4,
  },
  itantraButton: {
    alignSelf: 'stretch',
    marginTop: 16,
  },
});
