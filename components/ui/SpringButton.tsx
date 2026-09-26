import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Radius, Shadows, Typography } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type Variant = 'primary' | 'emerald' | 'danger' | 'ghost' | 'ink';

type SpringButtonProps = {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  accessibilityLabel?: string;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Interactive CTA with subtle spring / press feedback.
 * Reanimated scale spring on press-in/out + opacity for disabled.
 * Moti-compatible: same spring config works with Moti `animate={{ scale }}`.
 */
export default function SpringButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  icon,
  style,
  accessibilityLabel,
}: SpringButtonProps) {
  const { colors, isDark } = useTheme();
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const bg = (() => {
    switch (variant) {
      case 'primary':
        return colors.brand;
      case 'emerald':
        return colors.success;
      case 'danger':
        return colors.error;
      case 'ink':
        return colors.text;
      case 'ghost':
        return colors.inputBackground;
    }
  })();

  const fg =
    variant === 'ghost'
      ? colors.text
      : variant === 'ink'
        ? colors.background
        : '#FFFFFF';
  const isDisabled = disabled || loading;

  return (
    <AnimatedPressable
      onPress={() => {
        if (isDisabled) return;
        try {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
            () => {},
          );
        } catch {}
        onPress();
      }}
      onPressIn={() => {
        scale.value = withSpring(0.96, { damping: 14, stiffness: 380 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 320 });
      }}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={[
        styles.button,
        isDark && variant === 'primary' ? Shadows.glow : Shadows.card,
        {
          backgroundColor:
            isDisabled && variant !== 'ghost' ? colors.inputBackground : bg,
        },
        isDisabled && { opacity: 0.65 },
        animatedStyle,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon}
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              styles.label,
              {
                color:
                  isDisabled && variant !== 'ghost' ? colors.textSecondary : fg,
              },
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: Radius.round,
  },
  label: {
    ...Typography.h3,
    fontSize: 16,
    flexShrink: 1,
  },
});
