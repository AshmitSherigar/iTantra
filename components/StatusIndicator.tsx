import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useEffect } from 'react';

import { Radius, Typography } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

type Status = 'ready' | 'listening' | 'processing' | 'error';

const statusText: Record<Status, string> = {
  ready: 'Ready',
  listening: 'Listening...',
  processing: 'Processing...',
  error: 'Something went wrong',
};

/** Premium status pill - pulsing dot for live states. */
export default function StatusIndicator({ status }: { status: Status }) {
  const { colors } = useTheme() as any;
  const pulse = useSharedValue(0.4);

  const dotColor: Record<Status, string> = {
    ready: colors.success,
    listening: colors.error,
    processing: colors.primary,
    error: colors.error,
  };

  useEffect(() => {
    if (status === 'listening' || status === 'processing') {
      pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
    } else {
      pulse.value = withTiming(1, { duration: 200 });
    }
  }, [status, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View
      style={[styles.container, { backgroundColor: colors.inputBackground }]}
    >
      <Animated.View
        style={[styles.dot, { backgroundColor: dotColor[status] }, dotStyle]}
      />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.text, { color: colors.textSecondary }]}
      >
        {statusText[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.round,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    ...Typography.caption,
    flexShrink: 1,
  },
});
