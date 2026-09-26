import { useEffect } from 'react';
import {
  Modal,
  SafeAreaView,
  Text,
  TouchableOpacity,
  View,
  StyleSheet,
} from 'react-native';
import { TriangleAlert } from 'lucide-react-native';
import { playSosSiren, stopSosSiren } from '@/features/sos/siren';
import { FontWeight, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

type AlertOverlayProps = {
  visible: boolean;
  senderName: string;
  message: string;
  onAcknowledge: () => void;
};

export default function AlertOverlay({
  visible,
  senderName,
  message,
  onAcknowledge,
}: AlertOverlayProps) {
  const { colors } = useTheme();

  useEffect(() => {
    if (!visible) return;
    void playSosSiren();
    return () => {
      void stopSosSiren();
    };
  }, [visible]);

  const handleAcknowledge = () => {
    void stopSosSiren();
    onAcknowledge();
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <SafeAreaView
        style={[styles.safeArea, { backgroundColor: colors.error }]}
      >
        <View style={styles.content}>
          <TriangleAlert size={64} color="#FFFFFF" strokeWidth={2.2} />
          <Text style={[Typography.display, styles.title]}>ALERT</Text>
          <Text style={[Typography.bodyMedium, styles.sender]} numberOfLines={1}>
            From {senderName}
          </Text>
          <Text style={[Typography.h2, styles.message]}>{message}</Text>
        </View>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.background }]}
          onPress={handleAcknowledge}
          activeOpacity={0.85}
        >
          <Text style={[Typography.h3, styles.buttonText, { color: colors.error }]}>
            Acknowledge
          </Text>
        </TouchableOpacity>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  title: {
    color: '#FFFFFF',
  },
  sender: {
    color: '#FFFFFF',
  },
  message: {
    color: '#FFFFFF',
    textAlign: 'center',
  },
  button: {
    height: 58,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontWeight: FontWeight.extrabold,
  },
});
