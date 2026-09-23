import { useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '../constants/theme';

import { useTheme } from '../context/ThemeContext';

type RecordButtonProps = {
  isRecording: boolean;
  /** While transcribing/sending — dims the button and ignores NEW presses. */
  disabled?: boolean;
  /** Press-and-hold entry: start recording. */
  onPressIn: () => void;
  /** Release entry: stop and transcribe into the transcript box. */
  onPressOut: () => void;
};

/**
 * Push-to-talk mic button, built on the responder system (not Pressable).
 *
 * Why: Pressable cancels the gesture (without a guaranteed `onPressOut`)
 * when `disabled` flips mid-hold or the finger slides past the retention
 * offset — both left the mic running with no owner on-device. Here the
 * release path is guaranteed:
 * - `onResponderRelease` fires even when the finger lifts OFF the button.
 * - `onResponderTerminate` (call, notification shade, system steal) is
 *   treated as a release too.
 * - `disabled` only gates NEW presses (`onStartShouldSetResponder`); an
 *   in-flight hold always keeps its release.
 * - `onResponderTerminationRequest` returns false so a stray gesture never
 *   steals the hold mid-sentence.
 *
 * Both release paths funnel into `onPressOut`, which is idempotent
 * (guarded by the holder's session ref), so double delivery is harmless.
 */
export default function RecordButton({
  isRecording,
  disabled = false,
  onPressIn,
  onPressOut,
}: RecordButtonProps) {
  const { colors } = useTheme() as any;
  const [pressed, setPressed] = useState(false);

  // Latest props for responder callbacks that span renders mid-gesture.
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const pressInRef = useRef(onPressIn);
  pressInRef.current = onPressIn;
  const pressOutRef = useRef(onPressOut);
  pressOutRef.current = onPressOut;
  const activeRef = useRef(false);

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
        <View
          style={[
            styles.button,
            {
              backgroundColor: isRecording ? colors.error : colors.primary,
              opacity: disabled && !isRecording ? 0.55 : 1,
            },
            (pressed || isRecording) && styles.pressed,
          ]}
        >
          <Ionicons
            name={isRecording ? 'stop' : 'mic'}
            size={38}
            color={colors.surface}
          />
        </View>
      </View>

      <Text style={[styles.text, { color: colors.text }]}>
        {isRecording ? 'Release to Stop' : 'Hold to Talk'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: Spacing.lg,
  },

  // Transparent grab area larger than the visible circle so edge touches
  // and slight finger drift never lose the hold.
  touchTarget: {
    padding: Spacing.md,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },

  button: {
    width: 90,
    height: 90,
    borderRadius: Radius.round,
    alignItems: 'center',
    justifyContent: 'center',
  },

  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.95 }],
  },

  text: {
    marginTop: Spacing.sm,
    fontSize: FontSize.medium,
    fontWeight: '600',
  },
});
