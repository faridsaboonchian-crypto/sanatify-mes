module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // اگر از Reanimated استفاده می‌کنید، باید خط زیر فعال باشد. فعلا غیرفعال است.
      // 'react-native-reanimated/plugin',
    ],
  };
};