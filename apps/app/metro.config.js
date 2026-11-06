// Metro config: NativeWind v5 transformer + the AI SDK (@ai-sdk/*) resolver tweaks.
// Package exports + browser/react-native conditions make Metro resolve the RN-safe build of
// @ai-sdk/provider-utils (its Node-only `import(id)` path is otherwise rejected).
const { getDefaultConfig } = require("expo/metro-config");
const { withNativewind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ["react-native", "browser", "import", "require"];
module.exports = withNativewind(config);
