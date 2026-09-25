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
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';

export default function SettingsScreen() {
  const { colors } = useTheme() as any;
  const { selectedLanguage } = useLanguage();

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        style={[styles.container, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: colors.text }]}>Settings</Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            Preferences
          </Text>

          <TouchableOpacity
            style={[styles.settingRow, { backgroundColor: colors.surface }]}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/language')}
          >
            <View style={styles.textContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Language
              </Text>

              <Text
                style={[
                  styles.settingDescription,
                  { color: colors.textSecondary },
                ]}
              >
                {selectedLanguage.label}
              </Text>
            </View>

            <Text style={[styles.arrow, { color: colors.textSecondary }]}>
              ›
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.settingRow, { backgroundColor: colors.surface }]}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/appearance')}
          >
            <View style={styles.textContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                Appearance
              </Text>
            </View>

            <Text style={[styles.arrow, { color: colors.textSecondary }]}>
              ›
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textSecondary }]}>
            About
          </Text>

          <TouchableOpacity
            style={[styles.settingRow, { backgroundColor: colors.surface }]}
            activeOpacity={0.7}
            onPress={() => router.push('/settings/about')}
          >
            <View style={styles.textContainer}>
              <Text style={[styles.settingTitle, { color: colors.text }]}>
                About App
              </Text>
            </View>

            <Text style={[styles.arrow, { color: colors.textSecondary }]}>
              ›
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={[styles.version, { color: colors.textSecondary }]}>
          v1.0.0
        </Text>
      </ScrollView>
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
    paddingHorizontal: 20,
    paddingBottom: 18,
  },

  header: {
    paddingTop: 8,
    paddingBottom: 20,
  },

  title: {
    fontSize: 30,
    fontWeight: '700',
  },

  subtitle: {
    marginTop: 4,
    fontSize: 14,
  },

  section: {
    marginBottom: 18,
  },

  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },

  settingRow: {
    minHeight: 66,
    paddingVertical: 11,
    paddingHorizontal: 15,
    marginBottom: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  textContainer: {
    flex: 1,
    paddingRight: 10,
  },

  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
  },

  settingDescription: {
    marginTop: 3,
    fontSize: 12,
  },

  arrow: {
    fontSize: 26,
  },

  version: {
    textAlign: 'center',
    marginTop: 2,
    fontSize: 12,
  },
});
