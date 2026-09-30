const fs = require('fs/promises');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const PACK_NAME = 'sherpa_models';

const PACK_BUILD_GRADLE = `apply plugin: "com.android.asset-pack"

assetPack {
    packName = "${PACK_NAME}"
    dynamicDelivery {
        // Models arrive with the install as on-disk files (STORAGE_FILES),
        // so onnxruntime mmaps them directly — no extraction copy, i.e. a
        // single on-device copy. (Use "fast-follow"/"on-demand" instead if
        // the initial download size must stay small.)
        deliveryType = "install-time"
    }
}
`;

/**
 * Ships `assets/models/` to Android.
 *
 * Default (local dev / `expo run:android` APKs): copies into the app's base
 * assets. The sherpa loader then extracts them to filesDir on first use
 * (APK copy + user-data copy).
 *
 * Pack mode (`SHERPA_ASSET_PACK=1`, set by the EAS production profile):
 * writes the models into a Play Asset Delivery pack module instead and
 * removes any base-assets copy, so the AAB carries them exactly once and
 * the runtime opens them in place via `getAssetPackPath()` + type 'file'.
 * Local APK builds can't use packs (Play-only feature), hence the env flag
 * instead of a permanent switch.
 */
module.exports = function withSherpaModelAssets(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const source = path.join(
        config.modRequest.projectRoot,
        'assets',
        'models',
      );
      const platformRoot = config.modRequest.platformProjectRoot;
      const appAssetsModels = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'assets',
        'models',
      );

      if (process.env.SHERPA_ASSET_PACK === '1') {
        const packDir = path.join(platformRoot, PACK_NAME);
        const packAssetsModels = path.join(
          packDir,
          'src',
          'main',
          'assets',
          'models',
        );
        // Never bundle base-assets models in pack mode — that's the second
        // copy we're eliminating.
        await fs.rm(appAssetsModels, { recursive: true, force: true });
        await fs.rm(packAssetsModels, { recursive: true, force: true });
        await fs.mkdir(packAssetsModels, { recursive: true });
        await fs.cp(source, packAssetsModels, { recursive: true });
        await fs.writeFile(
          path.join(packDir, 'build.gradle'),
          PACK_BUILD_GRADLE,
        );

        const settingsPath = path.join(platformRoot, 'settings.gradle');
        const includeLine = `include ":${PACK_NAME}"`;
        const settings = await fs.readFile(settingsPath, 'utf8');
        if (!settings.includes(PACK_NAME)) {
          await fs.writeFile(
            settingsPath,
            settings.replace(
              "include ':app'",
              `include ':app'\n${includeLine}`,
            ),
          );
        }
        return config;
      }

      await fs.rm(appAssetsModels, { recursive: true, force: true });
      await fs.rm(path.join(platformRoot, PACK_NAME), {
        recursive: true,
        force: true,
      });
      // Drop the pack include left by a previous pack-mode prebuild —
      // otherwise Gradle fails on the missing ':sherpa_models' project.
      const settingsPath = path.join(platformRoot, 'settings.gradle');
      try {
        const settings = await fs.readFile(settingsPath, 'utf8');
        const cleaned = settings
          .split('\n')
          .filter((line) => !line.includes(PACK_NAME))
          .join('\n');
        if (cleaned !== settings) {
          await fs.writeFile(settingsPath, cleaned);
        }
      } catch {}
      const destination = appAssetsModels;
      await fs.cp(source, destination, { recursive: true });
      return config;
    },
  ]);
};
