import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import React from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Moon, Smartphone, Sun } from 'lucide-react-native';

import { useTheme } from '../../context/ThemeContext';
import GlassCard from '@/components/ui/GlassCard';
import AnimatedListItem from '@/components/ui/AnimatedListItem';
import { Radius, Spacing, Typography } from '../../constants/theme';

const OPTIONS = [
  {
    id: 'Light',
    icon: Sun,
    tint: '#FEF3C7',
    iconColor: '#D97706',
    desc: 'Warm paper • #FAF3E6',
  },
  {
    id: 'Dark',
    icon: Moon,
    tint: '#E0E7FF',
    iconColor: '#CF5C36',
    desc: 'Dusk ink • #050517',
  },
  {
    id: 'System Default',
    icon: Smartphone,
    tint: '#F8E9CB',
    iconColor: '#CF5C36',
    desc: 'Follows your phone',
  },
] as const;

export default function AppearanceScreen() {
  const { theme, setTheme, colors } = useTheme();

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.content}>
        <Text style={[Typography.title, { color: colors.text }]}>
          Appearance
        </Text>
        <Text
          style={[
            Typography.body,
            { color: colors.textSecondary, marginTop: 4 },
          ]}
        >
          Premium in both themes - pick your glow.
        </Text>

        <View style={{ marginTop: Spacing.lg, gap: 10 }}>
          {OPTIONS.map((opt, i) => {
            const selected = theme === opt.id;
            const Icon = opt.icon;
            return (
              <AnimatedListItem key={opt.id} index={i}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setTheme(opt.id)}
                >
                  <GlassCard
                    style={
                      selected
                        ? { borderColor: '#CF5C36', borderWidth: 1.5 }
                        : undefined
                    }
                  >
                    <View style={styles.row}>
                      <View
                        style={[styles.iconBox, { backgroundColor: opt.tint }]}
                      >
                        <Icon size={18} color={opt.iconColor} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[Typography.h3, { color: colors.text }]}>
                          {opt.id}
                        </Text>
                        <Text
                          style={[
                            Typography.caption,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {opt.desc}
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
                    </View>
                  </GlassCard>
                </TouchableOpacity>
              </AnimatedListItem>
            );
          })}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#CF5C36',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5 },
});
