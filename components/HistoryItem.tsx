import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { Radius, Shadows, Typography } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

type HistoryItemProps = {
  title: string;
  preview: string;
  date: string;
  onPress: () => void;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Premium list card with spring press feedback. */
export default function HistoryItem({
  title,
  preview,
  date,
  onPress,
}: HistoryItemProps) {
  const { colors } = useTheme() as any;
  const scale = useSharedValue(1);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      onPress={onPress}
      onPressIn={() => {
        scale.value = withSpring(0.97, { damping: 14, stiffness: 400 });
      }}
      onPressOut={() => {
        scale.value = withSpring(1, { damping: 12, stiffness: 320 });
      }}
      style={[
        styles.container,
        Shadows.card,
        { backgroundColor: colors.card, borderColor: colors.glassBorder },
        anim,
      ]}
    >
      <Text style={[Typography.h3, { color: colors.text }]}>{title}</Text>
      <Text
        style={[styles.preview, { color: colors.textSecondary }]}
        numberOfLines={2}
      >
        {preview}
      </Text>
      <Text style={[styles.date, { color: colors.textSecondary }]}>{date}</Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: Radius.lg,
  },
  preview: {
    ...Typography.body,
    marginTop: 6,
  },
  date: {
    ...Typography.caption,
    marginTop: 8,
    fontSize: 12,
  },
});
