import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Mic, Square } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { Radius, Shadows, Typography } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

type RecordButtonProps = {
  isRecording: boolean;
  disabled?: boolean;
  onPressIn: () => void;
  onPressOut: () => void;
};

/**
 * Premium push-to-talk mic - Electric Indigo idle, red LIVE state,
 * spring press feedback + pulsing halo while recording.
 * Responder-system hold logic preserved (guaranteed release path).
 */
export default function RecordButton({
  isRecording,
  disabled = false,
  onPressIn,
  onPressOut,
}: RecordButtonProps) {
  const { colors, isDark } = useTheme() as any;
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
    scale.value = withSpring(pressed || isRecording ? 0.94 : 1, {
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

  const bg = isRecording ? '#EF4444' : colors.brand;

  return (
    <View style={styles.container}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={
          isRecording ? 'Release to stop recording' : 'Hold to talk'
        }
        accessibilityHint="Press and hold to record, release to transcribe"
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
              shadowColor: '#EF4444',
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.4,
              shadowRadius: 20,
              elevation: 8,
            },
            buttonAnim,
          ]}
        >
          {isRecording ? (
            <Square size={30} color="#FFFFFF" fill="#FFFFFF" />
          ) : (
            <Mic size={34} color="#FFFFFF" strokeWidth={2.2} />
          )}
        </Animated.View>
      </View>

      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.text, { color: colors.text }]}
      >
        {isRecording ? 'Release to Stop' : 'Hold to Talk'}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={[styles.hint, { color: colors.textSecondary }]}
      >
        {isRecording ? 'Listening...' : 'Press & hold'}
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
    padding: 18,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
  },
  button: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  text: {
    ...Typography.h3,
    marginTop: 8,
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
