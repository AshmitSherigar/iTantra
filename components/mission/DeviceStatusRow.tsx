import { Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import GlassCard from '@/components/ui/GlassCard';
import { FontSize, Radius, Spacing, Typography } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';

type DeviceStatusRowProps = {
  name: string;
  address: string;
  isConnected: boolean;
  isConnecting: boolean;
  onConnect: () => void;
};

export default function DeviceStatusRow({
  name,
  address,
  isConnected,
  isConnecting,
  onConnect,
}: DeviceStatusRowProps) {
  const { colors } = useTheme();

  return (
    <GlassCard>
      <View style={styles.row}>
        <View style={styles.info}>
          <Text
            style={[Typography.h3, { color: colors.text }]}
            numberOfLines={1}
          >
            {name}
            {isConnected ? ' • connected' : ''}
          </Text>
          <Text
            style={[Typography.caption, { color: colors.textSecondary }]}
            numberOfLines={1}
          >
            {address}
          </Text>
        </View>

        {isConnected ? (
          <View style={[styles.pill, { backgroundColor: colors.successMuted }]}>
            <Text style={[styles.pillText, { color: colors.success }]}>
              Connected
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[
              styles.button,
              {
                backgroundColor: colors.primary,
                opacity: isConnecting ? 0.6 : 1,
              },
            ]}
            onPress={onConnect}
            disabled={isConnecting}
            activeOpacity={0.85}
          >
            <Text style={[styles.buttonText, { color: colors.background }]}>
              {isConnecting ? 'Connecting…' : 'Connect'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  info: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Radius.round,
  },
  pillText: {
    fontSize: FontSize.small,
    fontWeight: '700',
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.sm,
    minWidth: 96,
    alignItems: 'center',
  },
  buttonText: {
    fontSize: FontSize.caption,
    fontWeight: '700',
  },
});
