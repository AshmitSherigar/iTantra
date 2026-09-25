import React from 'react';
import Animated, { FadeInUp } from 'react-native-reanimated';

type AnimatedListItemProps = {
  index?: number;
  children: React.ReactNode;
};

/**
 * Staggered fade-in + subtle slide-up entrance.
 * Follows Moti/Reanimated pattern: delay = index * 60ms, capped.
 */
export default function AnimatedListItem({
  index = 0,
  children,
}: AnimatedListItemProps) {
  return (
    <Animated.View
      entering={FadeInUp.delay(Math.min(index, 8) * 60)
        .springify()
        .damping(18)}
    >
      {children}
    </Animated.View>
  );
}
