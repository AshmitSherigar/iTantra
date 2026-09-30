import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react';
import {
  Alert as RNAlert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { FontFamily, Radius, Shadows } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';
import SpringButton from './SpringButton';

export type AppAlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void | Promise<void>;
};

type AlertRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AppAlertButton[];
  resolve: (index: number) => void;
};

let nextId = 1;
let enqueue: ((req: Omit<AlertRequest, 'id'>) => void) | null = null;

/**
 * Themed replacement for `Alert.alert` - same button API, resolves with
 * the pressed button index. Falls back to the native alert when the
 * provider isn't mounted (e.g. background callbacks).
 */
export function showAppAlert(
  title: string,
  message?: string,
  buttons?: AppAlertButton[],
): Promise<number> {
  const list =
    buttons && buttons.length > 0 ? buttons : [{ text: 'OK' as const }];
  if (!enqueue) {
    RNAlert.alert(title, message, list as never);
    return Promise.resolve(0);
  }
  return new Promise<number>((resolve) => {
    enqueue?.({ title, message, buttons: list, resolve });
  });
}

function ThemedAlertCard({
  req,
  onPick,
}: {
  req: AlertRequest;
  onPick: (i: number) => void;
}) {
  const { colors } = useTheme();
  const cancelIdx = req.buttons.findIndex((b) => b.style === 'cancel');
  return (
    <View style={styles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => onPick(cancelIdx >= 0 ? cancelIdx : -1)}
        accessibilityRole="button"
        accessibilityLabel="Dismiss dialog"
      />
      <Animated.View
        entering={FadeInDown.springify().damping(22)}
        style={[
          styles.card,
          Shadows.floating,
          {
            backgroundColor: colors.card,
            borderColor: colors.glassBorder,
          },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]}>{req.title}</Text>
        {req.message ? (
          <Text style={[styles.message, { color: colors.textSecondary }]}>
            {req.message}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          {req.buttons.map((b, i) => {
            if (b.style === 'cancel') return null;
            const variant = b.style === 'destructive' ? 'danger' : 'ink';
            return (
              <SpringButton
                key={`${req.id}-${i}`}
                title={b.text}
                variant={variant as 'danger' | 'ink'}
                onPress={() => onPick(i)}
              />
            );
          })}
          {req.buttons.map((b, i) =>
            b.style === 'cancel' ? (
              <Pressable
                key={`${req.id}-${i}`}
                onPress={() => onPick(i)}
                accessibilityRole="button"
                hitSlop={8}
                style={styles.cancelRow}
              >
                <Text
                  style={[styles.cancelText, { color: colors.textSecondary }]}
                >
                  {b.text}
                </Text>
              </Pressable>
            ) : null,
          )}
        </View>
      </Animated.View>
    </View>
  );
}

const ModalContext = createContext<null>(null);
export function useAppModal() {
  return useContext(ModalContext);
}

export function AppModalProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<AlertRequest[]>([]);
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const pick = useCallback((req: AlertRequest, index: number) => {
    setQueue((q) => q.filter((r) => r.id !== req.id));
    req.resolve(index);
    const btn = index >= 0 ? req.buttons[index] : undefined;
    if (btn?.onPress) {
      try {
        void btn.onPress();
      } catch {}
    }
  }, []);

  React.useEffect(() => {
    enqueue = (req) => {
      const id = nextId++;
      setQueue((q) => [...q, { ...req, id }]);
    };
    return () => {
      enqueue = null;
    };
  }, []);

  const current = queue[0] ?? null;

  return (
    <>
      {children}
      <Modal
        visible={current !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          if (current) pick(current, -1);
        }}
      >
        {current ? (
          <Animated.View entering={FadeIn.duration(160)} style={{ flex: 1 }}>
            <ThemedAlertCard req={current} onPick={(i) => pick(current, i)} />
          </Animated.View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 5, 23, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    borderRadius: Radius.card,
    borderWidth: 1,
    padding: 22,
  },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: 21,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
    lineHeight: 26,
    textAlign: 'center',
  },
  message: {
    fontFamily: FontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  buttons: {
    marginTop: 18,
    gap: 4,
  },
  cancelRow: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelText: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 14,
    fontWeight: '500' as const,
  },
});
