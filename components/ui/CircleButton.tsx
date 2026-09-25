import React from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Shadows } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type CircleButtonProps = {
  onPress: () => void;
  children: React.ReactNode;
  size?: number;
  /** Dot badge (e.g. unread count) shown top-right. */
  dot?: boolean;
  dotColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Floating circular icon button - white circle, diffuse shadow,
 * spring press feedback. Matches the reference's search/bell/back pills.
 */
export default function CircleButton({
  onPress,
  children,
  size = 46,
  dot = false,
  dotColor,
  style,
  accessibilityLabel,
}: CircleButtonProps) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={() => {
        try {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
            () => {},
          );
        } catch {}
        onPress();
      }}
      onPressIn={() => {
        scale.value = withSpring(0.9, { damping: 14, stiffness: 420 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 320 });
      }}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.circle,
        Shadows.card,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.card,
          borderColor: colors.glassBorder,
        },
        anim,
        style,
      ]}
    >
      {children}
      {dot ? (
        <Animated.View
          style={[styles.dot, { backgroundColor: dotColor ?? colors.error }]}
        />
      ) : null}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
