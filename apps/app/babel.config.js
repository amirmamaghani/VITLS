// NativeWind v5 needs no nativewind/babel plugin — babel-preset-expo handles it (verified Expo 57 docs).
module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"] };
};
