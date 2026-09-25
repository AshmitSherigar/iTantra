import { Tabs } from 'expo-router';

import FloatingTabBar from '../../components/FloatingTabBar';

/**
 * Premium floating pill tab bar - glassmorphic blur + Reanimated indicator.
 * Screens add bottom padding (~110px) so content clears the floating bar.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
      }}
      tabBar={(props) => <FloatingTabBar {...props} />}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="bluetooth" options={{ title: 'Bluetooth' }} />
      <Tabs.Screen name="sos" options={{ title: 'SOS' }} />
      <Tabs.Screen name="wifi" options={{ title: 'WiFi' }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
    </Tabs>
  );
}
