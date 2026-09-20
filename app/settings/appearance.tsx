import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import React from 'react';

import { useTheme } from '../../context/ThemeContext';

export default function AppearanceScreen() {
  const { theme, setTheme, isDark } = useTheme();

  const themes = ['Light', 'Dark', 'System Default'] as const;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: isDark ? '#111' : '#fff',
        },
      ]}
    >
      <View style={styles.content}>
        <Text
          style={[
            styles.heading,
            {
              color: isDark ? '#fff' : '#111',
            },
          ]}
        >
          Choose Appearance
        </Text>

        {themes.map((item) => (
          <TouchableOpacity
            key={item}
            style={[
              styles.option,
              {
                borderBottomColor: isDark ? '#333' : '#eee',
              },
            ]}
            activeOpacity={0.7}
            onPress={() => setTheme(item)}
          >
            <Text
              style={[
                styles.optionText,
                {
                  color: isDark ? '#fff' : '#111',
                },
              ]}
            >
              {item}
            </Text>

            {theme === item && <Text style={styles.check}>✓</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  content: {
    padding: 20,
  },

  heading: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 20,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: 1,
  },

  optionText: {
    fontSize: 17,
  },

  check: {
    fontSize: 20,
    fontWeight: '700',
  },
});
