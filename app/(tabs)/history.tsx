import { FlatList, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import HistoryItem from '../../components/HistoryItem';
import { FontSize, Spacing } from '../../constants/theme';
import { useTheme } from '../../context/ThemeContext';

const history = [
  {
    id: '1',
    title: 'Team Meeting',
    preview: 'Discussed the progress of the project...',
    date: 'Today, 10:30 AM',
  },
  {
    id: '2',
    title: 'Class Notes',
    preview: 'Today we learned about database normalization...',
    date: 'Yesterday, 6:20 PM',
  },
  {
    id: '3',
    title: 'Project Ideas',
    preview: 'Some ideas for improving the STT application...',
    date: 'Aug 27, 3:15 PM',
  },
];

export default function History() {
  const { colors } = useTheme() as any;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <Text style={[styles.title, { color: colors.text }]}>History</Text>

      <FlatList
        data={history}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <HistoryItem
            title={item.title}
            preview={item.preview}
            date={item.date}
            onPress={() => router.push(`/transcript/${item.id}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: Spacing.md,
  },

  title: {
    fontSize: FontSize.title,
    fontWeight: 'bold',
    marginBottom: Spacing.lg,
  },
});
