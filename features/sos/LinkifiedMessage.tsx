import React, { useMemo } from 'react';
import {
  Alert,
  Linking,
  Text,
  type StyleProp,
  type TextStyle,
} from 'react-native';

const URL_RE = /(https?:\/\/[^\s)]+|geo:[^\s)]+)/g;

type Props = {
  message: string;
  textStyle?: StyleProp<TextStyle>;
  linkColor?: string;
};

/**
 * Renders broadcast text with every URL tappable (opens Maps/browser).
 * Long SOS messages stay readable — only the link portion is styled.
 */
export default function LinkifiedMessage({
  message,
  textStyle,
  linkColor,
}: Props) {
  const parts = useMemo(() => {
    const out: { key: string; text: string; url: string | null }[] = [];
    if (!message) return out;
    let last = 0;
    URL_RE.lastIndex = 0;
    let i = 0;
    for (;;) {
      const m = URL_RE.exec(message);
      if (!m) break;
      if (m.index > last) {
        out.push({
          key: `t${i++}`,
          text: message.slice(last, m.index),
          url: null,
        });
      }
      const raw = m[0].replace(/[.,;!?]+$/, '');
      out.push({ key: `l${i++}`, text: raw, url: raw });
      last = m.index + m[0].length;
      if (out.length > 40) break;
    }
    if (last < message.length) {
      out.push({ key: `t${i++}`, text: message.slice(last), url: null });
    }
    return out;
  }, [message]);

  async function openUrl(url: string) {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert('Cannot open link', url, [{ text: 'OK' }]);
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      console.warn('[SOS] open link failed:', e);
      Alert.alert('Cannot open link', url, [{ text: 'OK' }]);
    }
  }

  if (parts.length === 0) {
    return <Text style={textStyle}>{message}</Text>;
  }

  return (
    <Text style={textStyle}>
      {parts.map((p) =>
        p.url ? (
          <Text
            key={p.key}
            style={{
              color: linkColor ?? '#2563EB',
              textDecorationLine: 'underline',
            }}
            onPress={() => void openUrl(p.url as string)}
          >
            {p.text}
          </Text>
        ) : (
          <Text key={p.key}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}
