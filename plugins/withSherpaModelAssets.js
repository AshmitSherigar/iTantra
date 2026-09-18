const fs = require('fs/promises');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

module.exports = function withSherpaModelAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const source = path.join(
        config.modRequest.projectRoot,
        'assets',
        'models',
      );
      const destination = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'assets',
        'models',
      );

      await fs.rm(destination, { recursive: true, force: true });
      await fs.cp(source, destination, { recursive: true });
      return config;
    },
  ]);
};
