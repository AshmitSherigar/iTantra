import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import {
  SUPPORTED_LANGUAGES,
  isLanguageInstalled,
} from '../../features/models/languages';

export default function LanguageScreen() {
  const { colors } = useTheme();
  const { selectedId, selectLanguage, isLoaded } = useLanguage();

  const handleSelect = (id: (typeof SUPPORTED_LANGUAGES)[number]['id']) => {
    void selectLanguage(id);
  };

  // Placeholder — download flow not implemented yet. The button exists so
  // the "prompt to install" UX can be wired without changing this screen.
  const handleInstall = (label: string) => {
    Alert.alert(
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
        <Text style={[styles.heading, { color: colors.text }]}>
          Select Language
        </Text>
        <Text style={[styles.subheading, { color: colors.textSecondary }]}>
          {!isLoaded
            ? 'Loading…'
            : 'English is selected by default. Only the selected language model loads during a chat to save memory.'}
        </Text>

        {SUPPORTED_LANGUAGES.map((language) => {
          const installed = isLanguageInstalled(language);
          const selected = selectedId === language.id;
          return (
            <View
              key={language.id}
              style={[
                styles.option,
                {
                  borderBottomColor: colors.border,
                  backgroundColor: selected ? colors.surface : 'transparent',
                },
              ]}
            >
              <TouchableOpacity
                style={styles.optionMain}
                activeOpacity={0.7}
                onPress={() => handleSelect(language.id)}
              >
                <View style={styles.labelColumn}>
                  <Text style={[styles.optionText, { color: colors.text }]}>
                    {language.label}
                  </Text>
                  <Text
                    style={[
                      styles.statusText,
                      {
                        color: installed ? colors.success : colors.textSecondary,
                      },
                    ]}
                  >
                    {installed ? 'Installed • works offline' : 'Not installed'}
                  </Text>
                </View>
                {selected && (
                  <Text style={[styles.check, { color: colors.primary }]}>
                    ✓
                  </Text>
                )}
              </TouchableOpacity>

              {!installed && (
                <TouchableOpacity
                  style={[
                    styles.installButton,
                    { backgroundColor: colors.inputBackground },
                  ]}
                  activeOpacity={0.7}
                  onPress={() => handleInstall(language.label)}
                >
                  <Text
                    style={[
                      styles.installText,
                      { color: colors.primary },
                    ]}
                  >
                    Install
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  content: {
    padding: 20,
    paddingBottom: 32,
  },

  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 6,
  },

  subheading: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderRadius: 8,
    gap: 12,
  },

  optionMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },

  labelColumn: {
    flex: 1,
  },

  optionText: {
    fontSize: 17,
  },

  statusText: {
    marginTop: 2,
    fontSize: 12,
  },

  check: {
    fontSize: 20,
    fontWeight: '700',
  },

  installButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },

  installText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
