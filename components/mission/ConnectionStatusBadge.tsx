import { Text, View, StyleSheet } from 'react-native';
import type { WifiConnectionStatus } from '@/features/wifi';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

type ConnectionStatusBadgeProps = {
  wifiStatus: WifiConnectionStatus;
  wifiConnectedCount: number;
  bleConnectedCount: number;
};

function wifiStatusLabel(status: WifiConnectionStatus): string {
  switch (status) {
    case 'connected':
      return 'Linked';
    case 'listening':
      return 'Hosting';
    case 'connecting':
      return 'Connecting…';
    case 'disconnected':
      return 'Dropped';
    default:
      return 'Idle';
  }
}

export default function ConnectionStatusBadge({
  wifiStatus,
  wifiConnectedCount,
  bleConnectedCount,
}: ConnectionStatusBadgeProps) {
  const { colors } = useTheme();
  const isLinked = wifiConnectedCount + bleConnectedCount > 0;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: isLinked
            ? colors.successMuted
            : colors.inputBackground,
        },
      ]}
    >
      <View
        style={[
          styles.dot,
          { backgroundColor: isLinked ? colors.success : colors.textSecondary },
        ]}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.text,
          { color: isLinked ? colors.success : colors.textSecondary },
        ]}
      >
        {wifiStatusLabel(wifiStatus)} · WiFi {wifiConnectedCount} · BLE{' '}
        {bleConnectedCount}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.sm,
    marginTop: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    fontSize: FontSize.small,
    fontWeight: '700',
  },
});
