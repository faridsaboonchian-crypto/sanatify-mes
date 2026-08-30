const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// ✅ پشتیبانی از فایل‌های wasm (موتور دیتابیس وب)
config.resolver.assetExts.push('wasm');

// ✅ هدرهای لازم برای SharedArrayBuffer (مورد نیاز expo-sqlite در وب)
config.server.enhanceMiddleware = (middleware) => {
    return (req, res, next) => {
        res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        middleware(req, res, next);
    };
};

module.exports = config;