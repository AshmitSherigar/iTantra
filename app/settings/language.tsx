import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import React, { useState } from 'react';

export default function LanguageScreen() {
  const [selectedLanguage, setSelectedLanguage] = useState('English');

  const languages = [
    'English',
    'Hindi',
    'Gujarati',
    'Marathi',
    'Kannada',
    'Malayalam',
    'Tamil',
    'Telugu',
    'Odia',
    'Bengali',
  ];

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.heading}>Select Language</Text>

        {languages.map((language) => (
          <TouchableOpacity
            key={language}
            style={styles.option}
            activeOpacity={0.7}
            onPress={() => setSelectedLanguage(language)}
          >
            <Text style={styles.optionText}>{language}</Text>

            {selectedLanguage === language && (
              <Text style={styles.check}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
    borderBottomColor: '#eee',
  },

  optionText: {
    fontSize: 17,
  },

  check: {
    fontSize: 20,
    fontWeight: '700',
  },
});
