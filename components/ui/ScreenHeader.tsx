import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontFamily, Spacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  /** Left circular action (typically a CircleButton). */
  left?: React.ReactNode;
  /** Right circular action. */
  right?: React.ReactNode;
};

/**
 * Shared screen header - the Home pattern every tab follows:
 * two floating circular actions with a centered Fraunces serif
 * title + muted subtitle between them.
 */
export default function ScreenHeader({
  title,
  subtitle,
  left,
  right,
}: ScreenHeaderProps) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={styles.topRow}>
        {left ?? <View style={styles.slot} />}
        {right ?? <View style={styles.slot} />}
      </View>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {subtitle ? (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  slot: {
    width: 46,
    height: 46,
  },
  title: {
    fontFamily: FontFamily.display,
    fontSize: 30,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
    lineHeight: 36,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  subtitle: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: Spacing.lg,
  },
});
