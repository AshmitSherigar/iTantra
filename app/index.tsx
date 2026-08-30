import { Button, Text, View } from 'react-native';
import {
  isBluetoothEnabled,
  requestBluetoothPermission,
} from 'react-native-bluetooth-ble';

export default function HomeScreen() {
const askForBluetoothPermission = async () => {
  const granted = await requestBluetoothPermission();

  console.log("Bluetooth permission:", granted);

  if (!granted) {
    console.log("Bluetooth permission denied");
    return;
  }

  const enabled = await isBluetoothEnabled();

  console.log("Bluetooth enabled:", enabled);

  if (!enabled) {
    console.log("Please turn Bluetooth on");
    return;
  }

  console.log("Bluetooth is ready!");
};

  return (
    <View>
      <Text>Bluetooth Chat</Text>

      <Button title="Allow Bluetooth" onPress={askForBluetoothPermission} />
    </View>
  );
}
