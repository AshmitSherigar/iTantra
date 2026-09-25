const fs = require('fs/promises');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

// Marker so repeated prebuilds don't duplicate the rules.
const MARKER = '# vaaniSetu-sherpa-jni-keep';

const KEEP_RULES = `${MARKER}
# VaaniSetu: react-native-sherpa-onnx talks to its native .so via JNI,
# looking up com.k2fsa.sherpa.onnx config classes/fields BY NAME at runtime
# (e.g. OfflineNemoEncDecCtcModelConfig when creating the speech recognizer).
# R8 minify (enabled for release by withAndroidAppSize) renames those classes
# without these rules, and STT/TTS init then throws
# "Exception creating recognizer: failed to get field ..." on-device while
# debug builds (minify off) work fine. Keep the whole bridge unobfuscated.
-keep class com.k2fsa.sherpa.onnx.** { *; }
-keep class com.sherpaonnx.** { *; }
-keep class ai.onnxruntime.** { *; }
# General JNI insurance for the remaining native modules (BLE, sockets):
# never rename native methods or their declaring classes.
-keepclasseswithmembernames class * {
    native <methods>;
}
`;

module.exports = function withSherpaProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const proguardPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'proguard-rules.pro',
      );
      let contents = '';
      try {
        contents = await fs.readFile(proguardPath, 'utf8');
      } catch {
        contents = '';
      }
      if (!contents.includes(MARKER)) {
        if (contents.length > 0 && !contents.endsWith('\n')) contents += '\n';
        contents += `\n${KEEP_RULES}`;
        await fs.writeFile(proguardPath, contents);
      }
      return config;
    },
  ]);
};
