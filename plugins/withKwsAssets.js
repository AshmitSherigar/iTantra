const fs = require('fs/promises');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

/**
 * Copies `assets/kws/*.ppn` (Porcupine wake-word files you train once in
 * the Picovoice Console) into the native projects at prebuild time, so
 * Porcupine can load them by relative path with zero network at runtime.
 *
 * - Android: <project>/app/src/main/assets/<file>.ppn
 * - iOS: <project>/kws/<file>.ppn — then confirm the files are members of
 *   the app target ("Copy Bundle Resources" in Xcode) on first setup.
 *
 * Missing folder = skipped silently (listener reports `missing-setup`).
 */
module.exports = function withKwsAssets(config) {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const source = path.join(config.modRequest.projectRoot, 'assets', 'kws');
      const destination = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
      );
      try {
        await fs.access(source);
      } catch {
        return config;
      }
      await fs.mkdir(destination, { recursive: true });
      for (const file of await fs.readdir(source)) {
        if (!file.endsWith('.ppn')) continue;
        await fs.copyFile(
          path.join(source, file),
          path.join(destination, file),
        );
      }
      return config;
    },
  ]);
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const source = path.join(config.modRequest.projectRoot, 'assets', 'kws');
      const destination = path.join(
        config.modRequest.platformProjectRoot,
        'kws',
      );
      try {
        await fs.access(source);
      } catch {
        return config;
      }
      await fs.mkdir(destination, { recursive: true });
      for (const file of await fs.readdir(source)) {
        if (!file.endsWith('.ppn')) continue;
        await fs.copyFile(
          path.join(source, file),
          path.join(destination, file),
        );
      }
      return config;
    },
  ]);
  return config;
};
