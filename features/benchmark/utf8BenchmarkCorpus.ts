import { Utf8TestCase } from './types';

export const UTF8_BENCHMARK_CORPUS: Utf8TestCase[] = [
  // 1. ASCII English Basic & Commands
  {
    id: 'ascii_01',
    category: 'ascii',
    text: 'HELP',
    description: 'Short 4-byte ASCII command',
  },
  {
    id: 'ascii_02',
    category: 'ascii',
    text: 'Immediate assistance required at sector 4.',
    description: 'Medium ASCII sentence (42 bytes)',
  },
  {
    id: 'ascii_03',
    category: 'ascii',
    text: 'All units proceed immediately to extraction grid 7Alpha. Maintain radio silence until rendezvous.',
    description: 'Long ASCII sentence (99 bytes)',
  },
  {
    id: 'ascii_04',
    category: 'ascii',
    text: 'Coordinates: 12.9716 N, 77.5946 E. Altitude: 920m. Battery: 84%.',
    description: 'Alphanumeric numbers and punctuation',
  },

  // 2. Hindi Devanagari (3 bytes per glyph + combining matras)
  {
    id: 'hindi_01',
    category: 'hindi',
    text: 'मदद चाहिए',
    description: 'Short Hindi command with matras',
  },
  {
    id: 'hindi_02',
    category: 'hindi',
    text: 'यहाँ तुरंत पानी और प्राथमिक उपचार की आवश्यकता है।',
    description: 'Standard Hindi emergency sentence with danda',
  },
  {
    id: 'hindi_03',
    category: 'hindi',
    text: 'गाड़ी संख्या 402 मुख्य मार्ग पर रुक गई है। हम सुरक्षित हैं।',
    description: 'Hindi with numerals, conjuncts (ख्, थ्य), and full stops',
  },
  {
    id: 'hindi_04',
    category: 'hindi',
    text: 'अंतरिक्ष, विज्ञान, प्रौद्योगिकी और भारतीय भाषाओं का समन्वय अत्यंत आवश्यक है।',
    description: 'Complex Hindi conjuncts (क्ष, ज्ञ, त्र, न्य) and nukta',
  },

  // 3. Kannada (3 bytes per glyph + vattu/virama conjuncts)
  {
    id: 'kannada_01',
    category: 'kannada',
    text: 'ಸಹಾಯ ಬೇಕು',
    description: 'Short Kannada emergency request',
  },
  {
    id: 'kannada_02',
    category: 'kannada',
    text: 'ನಾವು ತಕ್ಷಣ ಇಲ್ಲಿಂದ ಹೊರಡಬೇಕಾಗಿದೆ, ದಯವಿಟ್ಟು ಬೇಗ ಬನ್ನಿ.',
    description: 'Standard conversational Kannada with vattu',
  },
  {
    id: 'kannada_03',
    category: 'kannada',
    text: 'ವಾಹನ ಸಂಖ್ಯೆ ೧೫ ರಸ್ತೆ ಬದಿಯಲ್ಲಿ ನಿಂತಿದೆ. ಎಲ್ಲರೂ ಸುರಕ್ಷಿತವಾಗಿದ್ದಾರೆ.',
    description: 'Kannada with native numerals and complex conjuncts',
  },
  {
    id: 'kannada_04',
    category: 'kannada',
    text: 'ಕನ್ನಡ ಸಾಹಿತ್ಯ, ಸಂಸ್ಕೃತಿ ಮತ್ತು ತಂತ್ರಜ್ಞಾನದ ಸಮ್ಮಿಲನ ಅದ್ಭುತವಾಗಿದೆ.',
    description: 'Complex Kannada conjuncts (ಸ್ಕೃ, ಂತ್ರ, ಜ್ಞ, ದ್ಭು)',
  },

  // 4. Code-Mixed (Hinglish & Kanglish)
  {
    id: 'mixed_01',
    category: 'mixed',
    text: 'Station par jaldi aao, train 10 baje nikal jayegi.',
    description: 'Hinglish Latin script conversational',
  },
  {
    id: 'mixed_02',
    category: 'mixed',
    text: 'Sector 4 me आग लग गई है, send fire brigade immediately!',
    description: 'Interleaved Hindi Devanagari and English ASCII',
  },
  {
    id: 'mixed_03',
    category: 'mixed',
    text: 'Office ge ಬೇಗ ಬನ್ನಿ, client meeting start ಆಗಿದೆ.',
    description: 'Interleaved Kannada script and English words',
  },
  {
    id: 'mixed_04',
    category: 'mixed',
    text: 'GPS coordinates: 13.0827° N, 80.2707° E. खतरा है, do not enter!',
    description: 'Punctuation, coordinates, Hindi warning and English directive',
  },

  // 5. Boundary Stress Tests (Engineered for 20-byte packet boundaries)
  // 20-byte fallback: exactly splits 3-byte Indic chars across packet 1 and 2
  {
    id: 'boundary_19b',
    category: 'boundary',
    text: '1234567890123456789', // 19 ASCII bytes (1 byte under packet limit)
    description: 'Exact 19-byte ASCII string',
  },
  {
    id: 'boundary_20b',
    category: 'boundary',
    text: '12345678901234567890', // Exact 20 bytes (fits in exactly 1 chunk)
    description: 'Exact 20-byte ASCII boundary',
  },
  {
    id: 'boundary_21b',
    category: 'boundary',
    text: '123456789012345678901', // 21 bytes (forces 1-byte spillover into chunk 2)
    description: '21-byte boundary (1-byte spillover)',
  },
  {
    id: 'boundary_indic_split_01',
    category: 'boundary',
    // 18 ASCII bytes + 'अ' (3 bytes: E0 A4 85) = 21 bytes total.
    // Chunk 1 gets 18 ASCII + E0 A4 (2 bytes of 'अ')!
    // Chunk 2 gets 85 (remaining 1 byte of 'अ')!
    text: '123456789012345678अ',
    description: 'Critical: Splits 3-byte Hindi Devanagari character across 20-byte BLE boundary',
  },
  {
    id: 'boundary_indic_split_02',
    category: 'boundary',
    // 19 ASCII bytes + 'ಅ' (3 bytes: E0 B0 85) = 22 bytes total.
    // Chunk 1 gets 19 ASCII + E0 (1st byte of 'ಅ')!
    // Chunk 2 gets B0 85 (remaining 2 bytes of 'ಅ')!
    text: '1234567890123456789ಅ',
    description: 'Critical: Splits 3-byte Kannada character across 20-byte BLE boundary (1 byte in chunk 1, 2 in chunk 2)',
  },
  {
    id: 'boundary_40b',
    category: 'boundary',
    text: '1234567890123456789012345678901234567890', // Exact 40 bytes (2 full chunks)
    description: 'Exact 40-byte 2-chunk boundary',
  },
  {
    id: 'boundary_multisplit',
    category: 'boundary',
    // Repeated Hindi characters forcing splits at byte 20, 40, 60, 80...
    text: 'भारत देश महान है। हम सब मिलकर इस आपदा से निपटेंगे।',
    description: 'Continuous Devanagari causing multiple boundary fragmentations',
  },

  // 6. Extended Unicode & Emojis (4-byte sequences)
  {
    id: 'emoji_01',
    category: 'emoji',
    text: 'SOS 🆘 Battery 🪫 Radio 📻 Over and out.',
    description: 'Emergency symbols with 4-byte UTF-8 emojis',
  },
  {
    id: 'emoji_02',
    category: 'emoji',
    // 18 ASCII bytes + '🚀' (4 bytes: F0 9F 9Head 92) = 22 bytes total.
    // Splits 4-byte emoji across 20-byte boundary!
    text: 'Launch in T-minus 🚀',
    description: 'Splits 4-byte emoji across 20-byte packet boundary',
  },
  {
    id: 'emoji_03',
    category: 'emoji',
    text: 'जय हिन्द! 🇮🇳 ಭಾರತ ಮಾತೆ 🇮🇳',
    description: 'Multilingual Indic with ZWJ national flag emoji sequences',
  },

  // 7. Long Stress Payloads (> 300 characters / multiple BLE fragments)
  {
    id: 'stress_long_en',
    category: 'stress',
    text:
      'This is an extended reliability stress test payload designed to evaluate the multi-packet transmission, ' +
      'reassembly buffer state-machine, and zero-loss integrity of iTantra neural radio access over low-bandwidth ' +
      'Bluetooth Low Energy channels with 20-byte fallback fragmentation enabled.',
    description: 'Long English message (270+ bytes / ~14 BLE fragments)',
  },
  {
    id: 'stress_long_hi',
    category: 'stress',
    text:
      'यह आई-तंत्र (iTantra) तंत्रिका रेडियो संचार प्रणाली के लिए एक विस्तृत परीक्षण संदेश है। ' +
      'इसका उद्देश्य कम-रैम वाले उपकरणों पर बिना किसी डेटा हानि के हिंदी और कन्नड़ जैसी भारतीय भाषाओं के ' +
      'यूटीएफ-८ (UTF-8) संचरण और विखंडन-पुनर्संयोजन (Fragmentation and Reassembly) की विश्वसनीयता को मापना है।',
    description: 'Long Hindi message (350+ bytes / ~18 BLE fragments)',
  },
  {
    id: 'stress_long_kn',
    category: 'stress',
    text:
      'ಇದು ಐ-ತಂತ್ರ (iTantra) ನರ ಸಂವಹನ ವ್ಯವಸ್ಥೆಯ ನಿಖರತೆಯನ್ನು ಪರೀಕ್ಷಿಸಲು ರಚಿಸಲಾದ ವಿಸ್ತೃತ ಸಂದೇಶವಾಗಿದೆ. ' +
      'ಕಡಿಮೆ ರಾಮ್ ಹೊಂದಿರುವ ಆಂಡ್ರಾಯ್ಡ್ ಫೋನ್‌ಗಳಲ್ಲಿ ಬ್ಲೂಟೂತ್ ಮೂಲಕ ಕನ್ನಡ ಮತ್ತು ಭಾರತೀಯ ಭಾಷೆಗಳ ಪಠ್ಯವನ್ನು ' +
      'ಯಾವುದೇ ದೋಷವಿಲ್ಲದೆ ಕಳುಹಿಸಲು ಮತ್ತು ಸ್ವೀಕರಿಸಲು ಈ ಪರೀಕ್ಷೆ ಅತ್ಯಗತ್ಯವಾಗಿದೆ.',
    description: 'Long Kannada message (360+ bytes / ~19 BLE fragments)',
  },
];
