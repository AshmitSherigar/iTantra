import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { Typography } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type SectionHeaderProps = {
  overline: string;
  count?: number;
  actionLabel?: string;
  onAction?: () => void;
  accent?: string;
};

/** Overline + count badge + optional action - clean hierarchy. */
export default function SectionHeader({
  overline,
  count,
  actionLabel,
  onAction,
  accent,
}: SectionHeaderProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text style={[Typography.overline, { color: colors.textSecondary }]}>
          {overline}
        </Text>
        {typeof count === 'number' ? (
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  count > 0
                    ? (accent ?? colors.primary)
                    : colors.inputBackground,
              },
            ]}
          >
            <Text
              style={[
                styles.badgeText,
                { color: count > 0 ? '#FFF' : colors.textSecondary },
              ]}
            >
              {count}
            </Text>
          </View>
        ) : null}
      </View>
      {actionLabel && onAction ? (
        <TouchableOpacity onPress={onAction} hitSlop={10} activeOpacity={0.6}>
          <Text style={[styles.action, { color: colors.primary }]}>
            {actionLabel}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  left: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { fontSize: 12, fontWeight: '800' },
  action: { fontSize: 13, fontWeight: '700' },
});
