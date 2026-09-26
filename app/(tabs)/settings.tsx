import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronRight, Info, Languages, Palette } from 'lucide-react-native';
import { Image } from 'expo-image';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import { Radius, Spacing, Typography } from '../../constants/theme';

export default function SettingsScreen() {
  const { colors } = useTheme() as any;
  const { selectedLanguage } = useLanguage();

  const rows = [
    {
      icon: <Languages size={18} color="#CF5C36" />,
      tint: '#F6DECB',
      title: 'Language',
      desc: selectedLanguage.label,
      onPress: () => router.push('/settings/language'),
    },
    {
      icon: <Palette size={18} color="#A97E2F" />,
      tint: '#F8E9CB',
      title: 'Appearance',
      desc: 'Light • Dark • System',
      onPress: () => router.push('/settings/appearance'),
    },
  ];

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top']}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[Typography.title, { color: colors.text }]}>Settings</Text>
        <Text
          style={[
            Typography.body,
            { color: colors.textSecondary, marginTop: 4 },
          ]}
        >
          Tune VaaniSetu to your comfort.
        </Text>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          Preferences
        </Text>
        <GlassCard padding={8}>
          {rows.map((r, i) => (
            <AnimatedListItem key={r.title} index={i}>
              <TouchableOpacity
                style={[styles.row, i < rows.length - 1 && styles.divider]}
                activeOpacity={0.7}
                onPress={r.onPress}
              >
                <View style={[styles.iconBox, { backgroundColor: r.tint }]}>
                  {r.icon}
                </View>
                <View style={styles.textBox}>
                  <Text style={[Typography.h3, { color: colors.text }]}>
                    {r.title}
                  </Text>
                  <Text
                    style={[
                      Typography.caption,
                      { color: colors.textSecondary },
                    ]}
                  >
                    {r.desc}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </AnimatedListItem>
          ))}
        </GlassCard>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          About
        </Text>
        <GlassCard padding={8}>
          <AnimatedListItem index={0}>
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => router.push('/settings/about')}
            >
              <View style={[styles.iconBox, { backgroundColor: '#FEF2F2' }]}>
                <Info size={18} color="#EF4444" />
              </View>
              <View style={styles.textBox}>
                <Text style={[Typography.h3, { color: colors.text }]}>
                  About App
                </Text>
                <Text
                  style={[Typography.caption, { color: colors.textSecondary }]}
                >
                  Offline voice + SOS
                </Text>
              </View>
              <ChevronRight size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </AnimatedListItem>
        </GlassCard>

        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
          iTantra
        </Text>
        <AnimatedListItem index={1}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => router.push('/settings/about')}
            accessibilityRole="button"
            accessibilityLabel="About iTantra"
          >
            <Image
              source={require('../../assets/images/itantra-man.png')}
              style={styles.itantraPhoto}
              contentFit="cover"
              transition={300}
              accessibilityLabel="Illustration of a man using a phone"
            />
          </TouchableOpacity>
        </AnimatedListItem>

        <Text style={[styles.version, { color: colors.textSecondary }]}>
          VaaniSetu • v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 130,
  },
  sectionLabel: {
    ...Typography.overline,
    marginTop: Spacing.lg,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  divider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.25)',
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBox: { flex: 1 },
  itantraPhoto: {
    width: '100%',
    height: 300,
    borderRadius: Radius.card,
  },
  version: { textAlign: 'center', marginTop: Spacing.lg, fontSize: 12 },
});
