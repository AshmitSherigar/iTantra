import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '../constants/theme';

import { useTheme } from '../context/ThemeContext';

type RecordButtonProps = {
  isRecording: boolean;
  onPress: () => void;
};

export default function RecordButton({
  isRecording,
  onPress,
}: RecordButtonProps) {
  const { colors } = useTheme() as any;

  return (
    <View style={styles.container}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: isRecording ? colors.error : colors.primary,
          },
          pressed && styles.pressed,
        ]}
      >
        <Ionicons
          name={isRecording ? 'stop' : 'mic'}
          size={38}
          color={colors.surface}
        />
      </Pressable>

      <Text style={[styles.text, { color: colors.text }]}>
        {isRecording ? 'Stop Speaking' : 'Start Speaking'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginTop: Spacing.lg,
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
