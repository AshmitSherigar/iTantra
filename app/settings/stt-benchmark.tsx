import { useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { isLanguageInstalled } from '../../features/models/languages';
import { useVoiceMessage } from '../../features/audio/useVoiceMessage';
import { calculateTextAccuracy } from '../../features/benchmark';

type Trial = {
  at: string;
  language: string;
  caseId: string;
  condition: string;
  reference: string;
  recognized: string;
  wordEdits: number | null;
  wordCount: number;
  characterEdits: number | null;
  characterCount: number;
  status: 'success' | 'empty_or_failed';
};

export default function SttBenchmarkScreen() {
  const { colors } = useTheme();
  const { selectedLanguage } = useLanguage();
  const [reference, setReference] = useState('');
  const [caseId, setCaseId] = useState('');
  const [condition, setCondition] = useState('quiet');
  const [trials, setTrials] = useState<Trial[]>([]);
  const [busy, setBusy] = useState(false);
  const {
    isRecording,
    isTranscribing,
    error,
    startVoice,
    stopVoice,
    ensureSttReady,
    getSttStatus,
  } = useVoiceMessage();

  const summary = useMemo(() => {
    const scored = trials.filter((trial) => trial.wordEdits !== null);
    const totalRefWords = scored.reduce(
      (sum, trial) => sum + trial.wordCount,
      0,
    );
    const totalWordEdits = scored.reduce(
      (sum, trial) => sum + (trial.wordEdits ?? 0),
      0,
    );
    const totalRefChars = scored.reduce(
      (sum, trial) => sum + trial.characterCount,
      0,
    );
    const totalCharEdits = scored.reduce(
      (sum, trial) => sum + (trial.characterEdits ?? 0),
      0,
    );
    return {
      wer: totalRefWords ? totalWordEdits / totalRefWords : null,
      cer: totalRefChars ? totalCharEdits / totalRefChars : null,
      empty: trials.filter((trial) => trial.status !== 'success').length,
    };
  }, [trials]);

  async function toggleRecording() {
    if (busy || isTranscribing) return;
    if (isRecording) {
      setBusy(true);
      try {
        const recognized = (await stopVoice()) ?? '';
        const score = reference.trim()
          ? calculateTextAccuracy(reference, recognized)
          : null;
        setTrials((current) => [
          {
            at: new Date().toISOString(),
            language: selectedLanguage.id,
            caseId: caseId.trim(),
            condition: condition.trim(),
            reference: reference.trim(),
            recognized,
            wordEdits: score?.wordEdits ?? null,
            wordCount: score?.referenceWords ?? 0,
            characterEdits: score?.characterEdits ?? null,
            characterCount: score?.referenceCharacters ?? 0,
            status: recognized ? 'success' : 'empty_or_failed',
          },
          ...current,
        ]);
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!reference.trim()) {
      Alert.alert(
        'Add the reference transcript',
        'Enter the exact words spoken for this trial before recording.',
      );
      return;
    }
    if (
      !isLanguageInstalled(selectedLanguage) ||
      !selectedLanguage.sttAssetPath
    ) {
      Alert.alert(
        'Model unavailable',
        'Choose a language with a bundled speech model before starting a trial.',
      );
      return;
    }
    setBusy(true);
    try {
      await ensureSttReady(selectedLanguage.sttAssetPath);
      if (!getSttStatus().isInitialized) {
        Alert.alert(
          'Speech model failed',
          getSttStatus().lastError ?? 'The selected model did not initialize.',
        );
        return;
      }
      await startVoice();
    } finally {
      setBusy(false);
    }
  }

  async function exportTrials() {
    const header = [
      'at',
      'language',
      'case_id',
      'condition',
      'reference',
      'recognized',
      'word_edits',
      'reference_words',
      'character_edits',
      'reference_characters',
      'status',
    ];
    const quote = (value: string | number) =>
      `"${String(value).replace(/"/g, '""')}"`;
    const csv = [
      header.join(','),
      ...trials.map((trial) =>
        [
          trial.at,
          trial.language,
          trial.caseId,
          trial.condition,
          trial.reference,
          trial.recognized,
          trial.wordEdits ?? '',
          trial.wordCount,
          trial.characterEdits ?? '',
          trial.characterCount,
          trial.status,
        ]
          .map(quote)
          .join(','),
      ),
    ].join('\n');
    await Share.share({ title: 'STT accuracy trials CSV', message: csv });
  }

  const disabled = busy || isTranscribing;
  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={['top', 'bottom']}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={[styles.title, { color: colors.text }]}>
          STT Accuracy Trials
        </Text>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          Speak the reference text, then stop to save the transcription and its
          word/character edit counts. Use a fixed test set and enter the same
          case ID and noise condition each time. WER uses whitespace-delimited
          words; CER counts NFC-normalized Unicode code points. Punctuation is
          ignored and whitespace is normalized.
        </Text>
        <Text style={[styles.label, { color: colors.text }]}>
          Model language: {selectedLanguage.label}
        </Text>
        <TextInput
          value={caseId}
          onChangeText={setCaseId}
          placeholder="Test case ID (for example hi-short-01)"
          placeholderTextColor={colors.textSecondary}
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        />
        <TextInput
          value={condition}
          onChangeText={setCondition}
          placeholder="Condition (quiet / moderate-noise / noisy)"
          placeholderTextColor={colors.textSecondary}
          style={[
            styles.input,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        />
        <TextInput
          value={reference}
          onChangeText={setReference}
          placeholder="Exact reference transcript"
          placeholderTextColor={colors.textSecondary}
          multiline
          style={[
            styles.input,
            styles.multiline,
            {
              color: colors.text,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            },
          ]}
        />
        <TouchableOpacity
          disabled={disabled}
          onPress={() => void toggleRecording()}
          style={[
            styles.button,
            {
              backgroundColor: isRecording ? colors.error : colors.primary,
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          <Text style={styles.buttonText}>
            {isRecording
              ? 'Stop & score trial'
              : isTranscribing
                ? 'Transcribing…'
                : busy
                  ? 'Preparing model…'
                  : 'Start recording trial'}
          </Text>
        </TouchableOpacity>
        {!!error && (
          <Text style={[styles.error, { color: colors.error }]}>{error}</Text>
        )}

        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.label, { color: colors.text }]}>
            Current session ({trials.length} trials)
          </Text>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            Pooled WER:{' '}
            {summary.wer === null ? '—' : `${(summary.wer * 100).toFixed(2)}%`}{' '}
            • Pooled CER:{' '}
            {summary.cer === null ? '—' : `${(summary.cer * 100).toFixed(2)}%`}{' '}
            • empty/failed: {summary.empty}
          </Text>
          <TouchableOpacity
            onPress={() => void exportTrials()}
            disabled={!trials.length}
            style={[
              styles.secondary,
              { borderColor: colors.border, opacity: trials.length ? 1 : 0.5 },
            ]}
          >
            <Text style={[styles.secondaryText, { color: colors.text }]}>
              Export trial data CSV
            </Text>
          </TouchableOpacity>
          {trials.slice(0, 20).map((trial, index) => (
            <View
              key={`${trial.at}-${index}`}
              style={[styles.trial, { borderTopColor: colors.border }]}
            >
              <Text style={[styles.label, { color: colors.text }]}>
                {trial.caseId || 'Unlabelled'} • {trial.language} •{' '}
                {trial.condition}
              </Text>
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                WER edits: {trial.wordEdits ?? 'n/a'}/{trial.wordCount} • CER
                edits: {trial.characterEdits ?? 'n/a'}/{trial.characterCount} •{' '}
                {trial.status}
              </Text>
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                Heard: {trial.recognized || '(empty)'}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: 16, paddingBottom: 36 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  note: { fontSize: 12, lineHeight: 18, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    fontSize: 14,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  button: {
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginVertical: 8,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  error: { fontSize: 13, marginVertical: 8 },
  card: { borderWidth: 1, borderRadius: 10, padding: 14, marginTop: 14 },
  secondary: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    marginBottom: 8,
  },
  secondaryText: { fontWeight: '600' },
  trial: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 8,
  },
});
