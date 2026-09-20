import { Stack } from 'expo-router';

export default function SettingsLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="language"
        options={{
          title: 'Language',
        }}
      />

      <Stack.Screen
        name="appearance"
        options={{
          title: 'Appearance',
        }}
      />

      <Stack.Screen
        name="about"
        options={{
          title: 'About App',
        }}
      />
    </Stack>
  );
}
