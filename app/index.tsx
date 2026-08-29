import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';
import { STTTestScreen } from '../features/stt/STTTestScreen';
import { TTSTestScreen } from '../features/tts';

type Tab = 'stt' | 'tts';

export default function Index() {
  const [activeTab, setActiveTab] = useState<Tab>('stt');

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'stt' && styles.tabActive]}
          onPress={() => setActiveTab('stt')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'stt' && styles.tabTextActive,
            ]}
          >
            🎤 STT
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'tts' && styles.tabActive]}
          onPress={() => setActiveTab('tts')}
        >
          <Text
            style={[
              styles.tabText,
              activeTab === 'tts' && styles.tabTextActive,
            ]}
          >
            🗣️ TTS
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === 'stt' ? <STTTestScreen /> : <TTSTestScreen />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    paddingVertical: 14,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#2196f3',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#999',
  },
  tabTextActive: {
    color: '#2196f3',
  },
  content: {
    flex: 1,
  },
});
