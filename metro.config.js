const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    // cloud/ is the management website, nothing the app imports
    blockList: [new RegExp(`${path.join(__dirname, 'cloud').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`)],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
