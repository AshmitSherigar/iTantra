import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Radio, Square } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Shadows, Typography } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

type PTTButtonProps = {
  isRecording: boolean;
  disabled?: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
};

export default function PTTButton({
  isRecording,
  disabled = false,
  onPressIn,
  onPressOut,
}: PTTButtonProps) {
  const { colors, isDark } = useTheme();
  const [pressed, setPressed] = useState(false);

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const pressInRef = useRef(onPressIn);
  pressInRef.current = onPressIn;
  const pressOutRef = useRef(onPressOut);
  pressOutRef.current = onPressOut;
  const activeRef = useRef(false);

  const scale = useSharedValue(1);
  const halo = useSharedValue(0);

  useEffect(() => {
    scale.value = withSpring(pressed || isRecording ? 0.95 : 1, {
      damping: 13,
      stiffness: 380,
    });
  }, [pressed, isRecording, scale]);

  useEffect(() => {
    if (isRecording) {
      halo.value = withRepeat(withTiming(1, { duration: 1400 }), -1, true);
    } else {
      halo.value = withTiming(0, { duration: 200 });
    }
  }, [isRecording, halo]);

  const buttonAnim = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const haloAnim = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - halo.value * 0.6),
    transform: [{ scale: 1 + halo.value * 0.28 }],
  }));

  const handleGrant = () => {
    activeRef.current = true;
    setPressed(true);
    pressInRef.current();
  };

  const handleRelease = () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    setPressed(false);
    pressOutRef.current();
  };

  const bg = isRecording ? colors.error : colors.primary;

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={
          isRecording ? 'Release to send' : 'Hold to talk to everyone'
        }
        accessibilityHint="Press and hold to record, release to transmit over WiFi and BLE"
        accessibilityState={{ disabled, busy: isRecording }}
        onStartShouldSetResponder={() => !disabledRef.current}
        onMoveShouldSetResponder={() => false}
        onResponderTerminationRequest={() => false}
        onResponderGrant={handleGrant}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleRelease}
        style={styles.touchTarget}
      >
        {isRecording ? (
          <Animated.View
            style={[styles.halo, { backgroundColor: bg }, haloAnim]}
          />
        ) : null}
        <Animated.View
          style={[
            styles.button,
            {
              backgroundColor: bg,
              opacity: disabled && !isRecording ? 0.55 : 1,
            },
            isDark && !isRecording ? Shadows.glow : Shadows.floating,
            isRecording && {
              shadowColor: colors.error,
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.4,
              shadowRadius: 20,
              elevation: 8,
            },
            buttonAnim,
          ]}
        >
          {isRecording ? (
            <Square size={40} color="#FFFFFF" fill="#FFFFFF" />
          ) : (
            <Radio size={46} color="#FFFFFF" strokeWidth={2.2} />
          )}
        </Animated.View>
      </View>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.text, { color: colors.text }]}
      >
        {isRecording ? 'Release to Send' : 'Hold to Transmit'}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.hint, { color: colors.textSecondary }]}
      >
        {isRecording ? 'Sending over WiFi + BLE...' : 'WiFi + BLE mesh'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: 8,
  },
  touchTarget: {
    padding: 22,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 148,
    height: 148,
    borderRadius: 74,
  },
  button: {
    width: 128,
    height: 128,
    borderRadius: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  text: {
    ...Typography.h3,
    marginTop: 10,
    textAlign: 'center' as const,
    alignSelf: 'stretch' as const,
    flexShrink: 1,
  },
  hint: {
    ...Typography.caption,
    marginTop: 2,
    textAlign: 'center' as const,
    alignSelf: 'stretch' as const,
    flexShrink: 1,
  },
});
