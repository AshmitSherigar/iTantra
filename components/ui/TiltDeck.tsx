import React from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';

import { Radius } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import GlassCard from './GlassCard';

type TiltDeckProps = {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
};

/**
 * Stacked-deck card like the Home broadcast deck — a sand back card
 * peeking from behind a slightly tilted front card.
 */
export default function TiltDeck({
  children,
  style,
  padding = 18,
}: TiltDeckProps) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      <View
        style={[
          styles.back,
          {
            backgroundColor: colors.primaryMuted,
            borderColor: colors.glassBorder,
          },
        ]}
      />
      <GlassCard tilt={-1.5} padding={padding}>
        {children}
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 6,
    marginBottom: 6,
  },
  back: {
    ...StyleSheet.absoluteFillObject,
    top: 8,
    borderRadius: Radius.card,
    borderWidth: 1,
    transform: [{ rotate: '3deg' }],
  },
});
