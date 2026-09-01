import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet } from 'react-native';
import { useWifiTransport } from '../transport/useWifiTransport';

// Throwaway UI: a text box stands in for STT output, the received list stands
// in for what TTS would speak. Run this on two phones to prove the transport
// loop works before either model exists. Wire this screen into your
// navigator temporarily (or make it the initial route) to try it.
export default function WifiTestScreen() {
  const [deviceName] = useState(() => `phone-${Math.floor(Math.random() * 1000)}`);
  const [inputText, setInputText] = useState('');
  const { status, messages, peers, startHosting, connectTo, sendText, disconnect } =
    useWifiTransport(deviceName);

  const handleSend = () => {
    const trimmed = inputText.trim();
    if (!trimmed) return;
    sendText(trimmed);
    setInputText('');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WiFi transport test — {deviceName}</Text>
      <Text style={styles.status}>Status: {status}</Text>

      <View style={styles.row}>
        <Pressable style={styles.button} onPress={startHosting}>
          <Text style={styles.buttonText}>Host</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={disconnect}>
          <Text style={styles.buttonText}>Disconnect</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Nearby devices</Text>
      <FlatList
        data={peers}
        keyExtractor={(p) => p.address}
        ListEmptyComponent={<Text style={styles.empty}>Searching...</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.peer}>
              {item.name} ({item.address})
            </Text>
            <Pressable style={styles.button} onPress={() => connectTo(item.address)}>
              <Text style={styles.buttonText}>Connect</Text>
            </Pressable>
          </View>
        )}
      />

      <Text style={styles.section}>Send (simulates STT output)</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a sentence..."
          onSubmitEditing={handleSend}
        />
        <Pressable style={styles.button} onPress={handleSend}>
          <Text style={styles.buttonText}>Send</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Received (simulates TTS input)</Text>
      <FlatList
        data={messages}
        keyExtractor={(m) => `${m.seq}-${m.ts}`}
        ListEmptyComponent={<Text style={styles.empty}>Nothing yet</Text>}
        renderItem={({ item }) => (
          <Text style={styles.message}>
            [{item.type}] {item.text} — {new Date(item.ts).toLocaleTimeString()}
          </Text>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 18, fontWeight: '600', marginBottom: 4 },
  status: { fontSize: 14, color: '#555', marginBottom: 8 },
  section: { fontSize: 14, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  button: {
    backgroundColor: '#2b6cb0',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginLeft: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 8,
  },
  peer: { flex: 1 },
  message: { paddingVertical: 2 },
  empty: { color: '#999', fontStyle: 'italic' },
});
