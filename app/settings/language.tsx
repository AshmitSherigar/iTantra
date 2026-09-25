import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Download } from 'lucide-react-native';

import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import {
  SUPPORTED_LANGUAGES,
  isLanguageInstalled,
} from '../../features/models/languages';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import { showAppAlert } from '@/components/ui/AppModal';
import { Radius, Spacing, Typography } from '../../constants/theme';

export default function LanguageScreen() {
  const { colors } = useTheme();
  const { selectedId, selectLanguage, isLoaded } = useLanguage();

  const handleSelect = (id: (typeof SUPPORTED_LANGUAGES)[number]['id']) => {
    void selectLanguage(id);
  };

  const handleInstall = (label: string) => {
    void showAppAlert(
      'Install language model',
      `"${label}" model download isn't available yet. English, Hindi and Kannada ship with the app and work offline.`,
      [{ text: 'OK' }],
    );
  };

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[Typography.title, { color: colors.text }]}>Language</Text>
        <Text
          style={[
            Typography.body,
            { color: colors.textSecondary, marginTop: 4 },
          ]}
        >
          {!isLoaded ? 'Loading...' : 'Voice uses the selected language.'}
        </Text>

        <View style={{ marginTop: Spacing.lg, gap: 10 }}>
          {SUPPORTED_LANGUAGES.map((language, i) => {
            const installed = isLanguageInstalled(language);
            const selected = selectedId === language.id;
            return (
              <AnimatedListItem key={language.id} index={i}>
                <GlassCard
                  style={
                    selected
                      ? { borderColor: colors.primary, borderWidth: 1.5 }
                      : undefined
                  }
                >
                  <TouchableOpacity
                    style={styles.optionMain}
                    activeOpacity={0.7}
                    onPress={() => handleSelect(language.id)}
                  >
                    <View style={styles.labelColumn}>
                      <Text style={[Typography.h3, { color: colors.text }]}>
                        {language.label}
                      </Text>
                      <Text
                        style={[
                          Typography.caption,
                          {
                            color: installed
                              ? colors.success
                              : colors.textSecondary,
                            marginTop: 2,
                          },
                        ]}
                      >
                        {installed
                          ? 'Installed • works offline'
                          : 'Not installed'}
                      </Text>
                    </View>
                    {selected ? (
                      <View style={styles.check}>
                        <Check size={16} color="#FFF" />
                      </View>
                    ) : (
                      <View
                        style={[styles.radio, { borderColor: colors.border }]}
                      />
                    )}
                  </TouchableOpacity>

                  {!installed && (
                    <TouchableOpacity
                      style={[
                        styles.installButton,
                        { backgroundColor: colors.primaryMuted },
                      ]}
                      activeOpacity={0.7}
                      onPress={() => handleInstall(language.label)}
                    >
                      <Download size={14} color={colors.primary} />
                      <Text
                        style={[styles.installText, { color: colors.primary }]}
                      >
                        Install
                      </Text>
                    </TouchableOpacity>
                  )}
                </GlassCard>
              </AnimatedListItem>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: 32,
  },
  optionMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  labelColumn: { flex: 1 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#CF5C36',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
  installButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.round,
  },
  installText: { fontSize: 14, fontWeight: '700' },
});
