import React, { useState, useEffect } from 'react';
import { View, Text, Button, StyleSheet, Platform } from 'react-native';
import { Asset } from 'expo-asset';
import { sttEngine } from './stt-engine';

export function STTTestScreen() {
  const [transcription, setTranscription] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Initialize the STT engine on mount
    const setupSTT = async () => {
      try {
        if (Platform.OS === 'web') {
          console.log('STT is not supported on web.');
          // Don't set isReady=true so the button remains disabled
          return;
        }
        await sttEngine.init();
        setIsReady(true);
      } catch (error) {
        console.log('Failed to initialize STT:', error);
      }
    };

    setupSTT();

    return () => {
      // Cleanup STT engine on unmount
      sttEngine.cleanup();
    };
  }, []);

  const handleTranscribe = async () => {
    if (!isReady) return;
    setIsProcessing(true);
    setTranscription('');

    try {
      // Resolve the bundled test.wav to a local filesystem path
      const asset = Asset.fromModule(require('./recording.wav'));
      await asset.downloadAsync();

      if (!asset.localUri) {
        throw new Error('Failed to resolve test.wav to a local path');
      }

      // Strip the file:// prefix if present — native expects a raw path
      const filePath = asset.localUri.replace(/^file:\/\//, '');
      const text = await sttEngine.transcribeFile(filePath);
      setTranscription(text);
    } catch (error) {
      console.error('Transcription failed:', error);
      setTranscription(`Error: ${error instanceof Error ? error.message : 'Transcription failed'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>STT Test Screen</Text>

      <Text style={styles.status}>
        Engine Status: {isReady ? 'Ready' : 'Initializing...'}
      </Text>

      <View style={styles.buttonContainer}>
        <Button
          title={isProcessing ? 'Processing...' : 'Transcribe File'}
          onPress={handleTranscribe}
          disabled={!isReady || isProcessing}
        />
      </View>

      <View style={styles.resultContainer}>
        <Text style={styles.resultTitle}>Transcription Result:</Text>
        <Text style={styles.resultText}>
          {transcription || 'No transcription yet.'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#fff',
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    margin: 10,
    alignItems: 'center',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  status: {
    marginBottom: 20,
    color: '#666',
  },
  buttonContainer: {
    marginBottom: 20,
    width: '100%',
  },
  resultContainer: {
    width: '100%',
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 5,
    minHeight: 100,
  },
  resultTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
  },
  resultText: {
    fontStyle: 'italic',
    color: '#333',
  },
});
