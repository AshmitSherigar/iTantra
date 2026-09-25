import React, { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  Bluetooth,
  House,
  Siren,
  Wifi,
  Settings as SettingsIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Shadows } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

const ICONS: Record<
  string,
  React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>
> = {
  index: House,
  bluetooth: Bluetooth,
  sos: Siren,
  wifi: Wifi,
  settings: SettingsIcon,
};

const LABELS: Record<string, string> = {
  index: 'Home',
  bluetooth: 'Bluetooth',
  sos: 'SOS, emergency',
  wifi: 'WiFi',
  settings: 'Settings',
};

function TabItem({
  routeName,
  focused,
  onPress,
  activeFill,
  activeIcon,
  muted,
  sosBg,
}: {
  routeName: string;
  focused: boolean;
  onPress: () => void;
  activeFill: string;
  activeIcon: string;
  muted: string;
  sosBg: string;
}) {
  const scale = useSharedValue(focused ? 1 : 0.92);
  const circle = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.1 : 1, {
      damping: 13,
      stiffness: 340,
    });
    circle.value = withTiming(focused ? 1 : 0, { duration: 220 });
  }, [focused, scale, circle]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const circleStyle = useAnimatedStyle(() => ({
    opacity: circle.value,
    transform: [{ scale: 0.7 + circle.value * 0.3 }],
  }));

  const isSos = routeName === 'sos';
  const Icon = ICONS[routeName] ?? House;

  if (isSos) {
    return (
      <Pressable
        onPress={() => {
          try {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
              () => {},
            );
          } catch {}
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel="SOS, emergency"
        accessibilityState={{ selected: focused }}
        style={styles.sosWrap}
        hitSlop={{ top: 16, bottom: 8, left: 10, right: 10 }}
      >
        <Animated.View
          style={[
            styles.sosButton,
            {
              backgroundColor: sosBg,
              borderColor: 'rgba(255,255,255,0.45)',
              shadowColor: sosBg,
            },
            focused && styles.sosFocused,
            iconStyle,
          ]}
        >
          <Siren size={24} color="#FFF8EC" strokeWidth={2.2} />
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => {
        try {
          void Haptics.selectionAsync?.().catch(() => {});
        } catch {}
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={LABELS[routeName] ?? routeName}
      accessibilityState={{ selected: focused }}
      style={styles.tab}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
    >
      <View style={styles.circleSlot}>
        <Animated.View
          style={[
            styles.activeCircle,
            { backgroundColor: activeFill },
            circleStyle,
          ]}
        />
        <Animated.View style={iconStyle}>
          <Icon
            size={22}
            color={focused ? activeIcon : muted}
            strokeWidth={focused ? 2.3 : 1.9}
          />
        </Animated.View>
      </View>
    </Pressable>
  );
}

/**
 * Floating tab bar in the reference style - white pill, circular icon
 * slots; the active tab becomes a filled ink circle, SOS an ember orb.
 * Only the blurred background is clipped; tabs overflow freely.
 */
export default function FloatingTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  void descriptors;
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const muted = isDark ? '#A89A83' : '#A89A83';

  return (
    <View
      style={[styles.container, { paddingBottom: Math.max(insets.bottom, 12) }]}
    >
      <View
        style={[
          styles.barWrap,
          Shadows.floating,
          {
            borderColor: colors.glassBorder,
            backgroundColor: colors.tabBar,
          },
        ]}
      >
        <View style={styles.barBg} pointerEvents="none">
          <BlurView
            intensity={isDark ? 50 : 32}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        </View>
        <View style={styles.tabRow}>
          {state.routes.map((route, index) => {
            const focused = state.index === index;
            const onPress = () => {
              const event = navigation.emit({
                type: 'tabPress',
                target: route.key,
                canPreventDefault: true,
              });
              if (!focused && !event.defaultPrevented) {
                navigation.navigate(route.name, route.params);
              }
            };
            return (
              <TabItem
                key={route.key}
                routeName={route.name}
                focused={focused}
                onPress={onPress}
                activeFill={colors.text}
                activeIcon={colors.background}
                muted={muted}
                sosBg={colors.brand}
              />
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 0,
    overflow: 'visible',
  },
  barWrap: {
    borderRadius: 999,
    borderWidth: 1,
    overflow: 'visible',
  },
  barBg: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    overflow: 'hidden',
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 70,
    paddingHorizontal: 10,
    overflow: 'visible',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 62,
  },
  circleSlot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeCircle: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  sosWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  sosButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    marginTop: -32,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 9,
  },
  sosFocused: {
    transform: [{ scale: 1.06 }],
  },
});
