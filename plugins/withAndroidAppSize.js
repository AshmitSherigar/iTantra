const {
  withAppBuildGradle,
  withGradleProperties,
} = require('expo/config-plugins');

// Real-device ARM ABIs. x86/x86_64 are emulator-only — dropping them
// removes ~85MB of sherpa-onnx .so files from sideloaded APKs.
// (If you must run on an x86_64 emulator, temporarily revert
// `reactNativeArchitectures` in gradle.properties.)
const DEVICE_ABIS = ['armeabi-v7a', 'arm64-v8a'];

/**
 * Trims the Android binary:
 *
 * 1. Builds ARM ABIs only (drops emulator x86/x86_64).
 *
 * 2. Emits one APK per ABI (`splits.abi`) for sideloading, instead of a
 *    single universal APK carrying every .so. AAB/Play builds ignore
 *    splits and already serve per-device binaries automatically.
 *
 * 3. Enables R8 minify + resource shrinking for release builds
 *    (dex + unused resources from ~30 Expo/RN modules).
 */
module.exports = function withAndroidAppSize(config) {
  config = withGradleProperties(config, (modConfig) => {
    const setProp = (key, value) => {
      modConfig.modResults = modConfig.modResults.filter(
        (item) => item.key !== key,
      );
      modConfig.modResults.push({ type: 'property', key, value });
    };
    setProp('reactNativeArchitectures', DEVICE_ABIS.join(','));
    setProp('android.enableMinifyInReleaseBuilds', 'true');
    setProp('android.enableShrinkResourcesInReleaseBuilds', 'true');
    return modConfig;
  });

  config = withAppBuildGradle(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    if (!contents.includes('splits {')) {
      const splitsBlock = [
        '    splits {',
        '        abi {',
        '            enable true',
        '            reset()',
        `            include "${DEVICE_ABIS.join('", "')}"`,
        '            universalApk false',
        '        }',
        '    }',
        '',
      ].join('\n');
      modConfig.modResults.contents = contents.replace(
        '    buildTypes {',
        `${splitsBlock}    buildTypes {`,
      );
    }
    return modConfig;
  });

  return config;
};
