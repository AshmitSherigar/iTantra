import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FontFamily, Radius, Shadows, Typography } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type HeroCardProps = {
  overline: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: ViewStyle;
  /** Center the headline like the reference's Reflections header. */
  centered?: boolean;
  /** Playful tilt in degrees. */
  tilt?: number;
};

/**
 * Soft header card in the reference style - warm paper surface,
 * big Fraunces serif title, sand blob accent, 28px radius.
 */
export default function HeroCard({
  overline,
  title,
  subtitle,
  right,
  children,
  style,
  centered = false,
  tilt = 0,
}: HeroCardProps) {
  const { colors, isDark } = useTheme();
  return (
    <Animated.View entering={FadeInDown.springify().damping(20)} style={style}>
      <View
        style={[
          styles.card,
          Shadows.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.glassBorder,
            ...(tilt !== 0 ? { transform: [{ rotate: `${tilt}deg` }] } : null),
          },
        ]}
      >
        <View
          style={[
            styles.blob,
            {
              backgroundColor: isDark
                ? 'rgba(239, 200, 139, 0.1)'
                : 'rgba(207, 92, 54, 0.08)',
            },
          ]}
        />
        <View
          style={[
            styles.blobB,
            {
              backgroundColor: isDark
                ? 'rgba(207, 92, 54, 0.12)'
                : 'rgba(239, 200, 139, 0.35)',
            },
          ]}
        />
        <View style={[styles.topRow, centered && styles.topRowCentered]}>
          <View style={[styles.textBox, centered && styles.textBoxCentered]}>
            <Text
              style={[
                Typography.overline,
                styles.overline,
                { color: colors.textSecondary },
                centered && { textAlign: 'center' },
              ]}
            >
              {overline}
            </Text>
            <Text
              style={[
                styles.title,
                { color: colors.text },
                centered && { textAlign: 'center' },
              ]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[
                  styles.subtitle,
                  { color: colors.textSecondary },
                  centered && { textAlign: 'center' },
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
          {right}
        </View>
        {children}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.card,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 1,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
    top: -70,
    right: -50,
    width: 170,
    height: 170,
    borderRadius: 85,
  },
  blobB: {
    position: 'absolute',
    bottom: -90,
    left: -40,
    width: 140,
    height: 140,
    borderRadius: 70,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  topRowCentered: {
    flexDirection: 'column',
    alignItems: 'center',
  },
  textBox: { flex: 1 },
  textBoxCentered: { flex: 0, alignItems: 'center' },
  overline: { fontSize: 10 },
  title: {
    fontFamily: FontFamily.display,
    fontSize: 27,
    fontWeight: '800' as const,
    letterSpacing: -0.2,
    lineHeight: 32,
    marginTop: 3,
  },
  subtitle: {
    fontFamily: FontFamily.body,
    fontSize: 13,
    fontWeight: '400' as const,
    lineHeight: 18,
    marginTop: 3,
  },
});
