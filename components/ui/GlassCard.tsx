import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { Radius, Shadows } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type GlassCardProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
  radius?: number;
  /** Playful tilt in degrees (e.g. -1.5) like the stacked reference cards. */
  tilt?: number;
};

/**
 * Soft floating card - 24px radius, hairline border, diffuse shadow.
 * Optional static `tilt` for the playful stacked-deck look.
 */
export default function GlassCard({
  children,
  style,
  padding = 18,
  radius = 24,
  tilt = 0,
}: GlassCardProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.card,
        Shadows.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.glassBorder,
          padding,
          borderRadius: radius,
          ...(tilt !== 0 ? { transform: [{ rotate: `${tilt}deg` }] } : null),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: Radius.xl,
  },
});
