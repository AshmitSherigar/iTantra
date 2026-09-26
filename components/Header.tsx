import { StyleSheet, Text, View } from 'react-native';
import { AudioLines } from 'lucide-react-native';

import { Radius, Typography } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';

/** Premium app header - gradient mark + bold title + muted subtitle. */
export default function Header() {
  const { colors } = useTheme() as any;

  return (
    <View style={styles.container}>
      <View style={styles.mark}>
        <AudioLines size={20} color="#FFFFFF" strokeWidth={2.2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[Typography.h2, { color: colors.text }]}>VaaniSetu</Text>
        <Text style={[Typography.caption, { color: colors.textSecondary }]}>
          Offline voice + SOS
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 4,
  },
  mark: {
    width: 42,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: '#CF5C36',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
