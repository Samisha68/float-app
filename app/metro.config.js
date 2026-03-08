const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// ── Solana / Anchor polyfills for React Native ────────────────────────────────
// These Node.js built-ins don't exist in Hermes/JavaScriptCore.
// We map them to React Native-compatible shims.
config.resolver.extraNodeModules = {
  // Core Node built-ins
  crypto: require.resolve("react-native-get-random-values"),
  stream: require.resolve("readable-stream"),
  url:    require.resolve("react-native-url-polyfill"),
  buffer: require.resolve("@craftzdog/react-native-buffer"),
  // Stubs for modules that aren't needed at runtime on mobile
  fs:     require.resolve("./src/utils/emptyModule.js"),
  path:   require.resolve("./src/utils/emptyModule.js"),
  os:     require.resolve("./src/utils/emptyModule.js"),
  net:    require.resolve("./src/utils/emptyModule.js"),
  tls:    require.resolve("./src/utils/emptyModule.js"),
  zlib:   require.resolve("./src/utils/emptyModule.js"),
  http:   require.resolve("./src/utils/emptyModule.js"),
  https:  require.resolve("./src/utils/emptyModule.js"),
  dns:    require.resolve("./src/utils/emptyModule.js"),
};

module.exports = config;
