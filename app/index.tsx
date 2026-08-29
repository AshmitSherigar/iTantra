import { View } from 'react-native';
import { STTTestScreen } from '../features/stt/STTTestScreen';

export default function Index() {
  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f0f0f0',
      }}
    >
      <STTTestScreen />
    </View>
  );
}
