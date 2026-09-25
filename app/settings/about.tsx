import { View, Text, StyleSheet } from 'react-native';

export default function AboutScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.appName}>VaaniSetu</Text>

        <Text style={styles.description}>
          Offline voice + SOS for nearby phones.
        </Text>

        <Text style={styles.version}>Version 1.0.0</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 55,
    paddingBottom: 20,
  },

  back: {
    fontSize: 40,
    marginRight: 15,
  },

  title: {
    fontSize: 24,
    fontWeight: '700',
  },

  content: {
    padding: 25,
    alignItems: 'center',
  },

  appName: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 15,
  },

  description: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
    color: '#666',
  },

  version: {
    marginTop: 30,
    fontSize: 14,
    color: '#999',
  },
});
