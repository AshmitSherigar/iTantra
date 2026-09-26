import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import Animated, { FadeInRight } from 'react-native-reanimated';

import { FontFamily, Radius, Shadows } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

type CategoryPillsProps = {
  categories: string[];
  selected: string;
  onSelect: (c: string) => void;
};

/**
 * Small tag pills like the reference's anxiety/energy/sleep chips -
 * cream with hairline border; active = ink fill, paper text.
 */
export default function CategoryPills({
  categories,
  selected,
  onSelect,
}: CategoryPillsProps) {
  const { colors, isDark } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {categories.map((c, i) => {
        const active = c === selected;
        return (
          <Animated.View
            key={c}
            entering={FadeInRight.delay(Math.min(i, 6) * 50)
              .springify()
              .damping(18)}
          >
            <Pressable
              onPress={() => onSelect(c)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={[
                styles.pill,
                active && {
                  backgroundColor: colors.text,
                  borderColor: colors.text,
                },
                !active && {
                  backgroundColor: colors.card,
                  borderColor: colors.glassBorder,
                },
                active && (isDark ? Shadows.glow : Shadows.card),
              ]}
            >
              <Text
                style={[
                  styles.label,
                  {
                    color: active ? colors.background : colors.textSecondary,
                  },
                ]}
              >
                {c.toLowerCase()}
              </Text>
            </Pressable>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  pill: {
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderRadius: Radius.round,
    borderWidth: 1,
  },
  label: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 13,
    fontWeight: '500',
  },
});
