module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo already adds react-native-worklets/plugin (used by
    // reanimated 4); listing it again would run the worklet transform twice.
    presets: ['babel-preset-expo'],
  };
};
