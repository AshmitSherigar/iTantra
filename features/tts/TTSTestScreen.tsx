import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { hindiTTS, TTSStatus } from './index';

const SAMPLE_TEXTS = [
  'नमस्ते, आप कैसे हैं?',
  'आज मौसम बहुत अच्छा है।',
  'भारत एक महान देश है।',
  'मुझे हिंदी बोलना पसंद है।',
];

export function TTSTestScreen() {
  const [text, setText] = useState(SAMPLE_TEXTS[0]);
  const [status, setStatus] = useState<TTSStatus>({
    isInitialized: false,
    isSpeaking: false,
  });
  const [isInitializing, setIsInitializing] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev, `[${ts}] ${msg}`]);
  };

  // Refresh status periodically while speaking
  useEffect(() => {
    const interval = setInterval(() => {
      setStatus({ ...hindiTTS.getStatus() });
    }, 300);
    return () => clearInterval(interval);
  }, []);

  const handleInit = async () => {
    if (Platform.OS === 'web') {
      addLog('❌ TTS is not supported on web.');
      return;
    }
    setIsInitializing(true);
    addLog('⏳ Initializing TTS engine...');
    try {
      await hindiTTS.initialize({ debug: true });
      const s = hindiTTS.getStatus();
      setStatus({ ...s });
      addLog(
        `✅ Initialized! Sample rate: ${s.sampleRate}, Speakers: ${s.numSpeakers}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ Init failed: ${msg}`);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSpeak = async () => {
    if (!text.trim()) {
      addLog('⚠️ Enter some text first.');
      return;
    }
    addLog(`🔊 Speaking: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`);
    try {
      await hindiTTS.speak(text);
      addLog('✅ Speech started (streaming).');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ Speak failed: ${msg}`);
    }
  };

  const handleStop = async () => {
    addLog('⏹️ Stopping...');
    try {
      await hindiTTS.stop();
      addLog('✅ Stopped.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ Stop failed: ${msg}`);
    }
  };

  const handleDestroy = async () => {
    addLog('🗑️ Destroying engine...');
    try {
      await hindiTTS.destroy();
      setStatus({ ...hindiTTS.getStatus() });
      addLog('✅ Engine destroyed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(`❌ Destroy failed: ${msg}`);
    }
  };

  const isReady = status.isInitialized;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
    >
      <View style={styles.container}>
        <Text style={styles.title}>🗣️ Hindi TTS Test</Text>

        {/* Status badge */}
        <View
          style={[
            styles.statusBadge,
            {
              backgroundColor: isReady
                ? status.isSpeaking
                  ? '#e8f5e9'
                  : '#e3f2fd'
                : '#fff3e0',
            },
          ]}
        >
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor: isReady
                  ? status.isSpeaking
                    ? '#4caf50'
                    : '#2196f3'
                  : '#ff9800',
              },
            ]}
          />
          <Text style={styles.statusText}>
            {isInitializing
              ? 'Initializing...'
              : isReady
                ? status.isSpeaking
                  ? 'Speaking...'
                  : 'Ready'
                : 'Not initialized'}
          </Text>
          {status.sampleRate && (
            <Text style={styles.statusMeta}>
              {status.sampleRate}Hz · {status.numSpeakers} speaker(s)
            </Text>
          )}
        </View>

        {status.error && (
          <Text style={styles.errorText}>Error: {status.error}</Text>
        )}

        {/* Init button */}
        {!isReady && (
          <TouchableOpacity
            style={[styles.button, styles.initButton]}
            onPress={handleInit}
            disabled={isInitializing}
          >
            {isInitializing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.buttonText}>Initialize Engine</Text>
            )}
          </TouchableOpacity>
        )}

        {/* Text input */}
        {isReady && (
          <>
            <Text style={styles.label}>Enter Hindi text:</Text>
            <TextInput
              style={styles.textInput}
              value={text}
              onChangeText={setText}
              multiline
              numberOfLines={3}
              placeholder="Type Hindi text here..."
            />

            {/* Sample text chips */}
            <Text style={styles.label}>Quick samples:</Text>
            <View style={styles.chipRow}>
              {SAMPLE_TEXTS.map((sample, i) => (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.chip,
                    text === sample && styles.chipActive,
                  ]}
                  onPress={() => setText(sample)}
                >
                  <Text
                    style={[
                      styles.chipText,
                      text === sample && styles.chipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {sample}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Action buttons */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.speakButton,
                  status.isSpeaking && styles.buttonDisabled,
                ]}
                onPress={handleSpeak}
                disabled={status.isSpeaking}
              >
                <Text style={styles.buttonText}>
                  {status.isSpeaking ? '🔊 Speaking...' : '▶️ Speak'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.button,
                  styles.stopButton,
                  !status.isSpeaking && styles.buttonDisabled,
                ]}
                onPress={handleStop}
                disabled={!status.isSpeaking}
              >
                <Text style={styles.buttonText}>⏹️ Stop</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, styles.destroyButton]}
              onPress={handleDestroy}
            >
              <Text style={[styles.buttonText, { color: '#d32f2f' }]}>
                🗑️ Destroy Engine
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Log output */}
      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>📋 Log</Text>
        <ScrollView
          ref={scrollRef}
          style={styles.logScroll}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {log.length === 0 ? (
            <Text style={styles.logEmpty}>
              Tap "Initialize Engine" to get started.
            </Text>
          ) : (
            log.map((entry, i) => (
              <Text key={i} style={styles.logEntry}>
                {entry}
              </Text>
            ))
          )}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  screenContent: {
    padding: 16,
    paddingBottom: 40,
  },
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: '#1a1a1a',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontWeight: '600',
    fontSize: 14,
    color: '#333',
  },
  statusMeta: {
    marginLeft: 'auto',
    fontSize: 12,
    color: '#666',
  },
  errorText: {
    color: '#d32f2f',
    fontSize: 13,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  label: {
    fontWeight: '600',
    fontSize: 14,
    color: '#555',
    marginBottom: 6,
    marginTop: 8,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 12,
    backgroundColor: '#fafafa',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#e0e0e0',
    maxWidth: '48%',
  },
  chipActive: {
    backgroundColor: '#e3f2fd',
    borderColor: '#2196f3',
  },
  chipText: {
    fontSize: 13,
    color: '#555',
  },
  chipTextActive: {
    color: '#1976d2',
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  initButton: {
    backgroundColor: '#2196f3',
    marginTop: 8,
  },
  speakButton: {
    backgroundColor: '#4caf50',
  },
  stopButton: {
    backgroundColor: '#ff9800',
  },
  destroyButton: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#d32f2f',
    marginBottom: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  logContainer: {
    marginTop: 16,
    backgroundColor: '#1e1e1e',
    borderRadius: 12,
    padding: 14,
    maxHeight: 220,
  },
  logTitle: {
    color: '#aaa',
    fontWeight: '600',
    fontSize: 13,
    marginBottom: 8,
  },
  logScroll: {
    maxHeight: 170,
  },
  logEmpty: {
    color: '#666',
    fontStyle: 'italic',
    fontSize: 13,
  },
  logEntry: {
    color: '#e0e0e0',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 3,
    lineHeight: 18,
  },
});
