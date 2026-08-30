# راهنمای راه‌اندازی Expo و نمایش QR Code

## روش 1: اجرای مستقیم در ترمینال (توصیه می‌شود)

در ترمینال PowerShell خودتان این دستور را اجرا کنید:

```powershell
cd D:\MyFactoryApp
& "C:\Program Files\nodejs\npx.cmd" expo start
```

یا اگر PATH تنظیم شده است:

```powershell
cd D:\MyFactoryApp
npm start
```

**QR Code به صورت خودکار در ترمینال نمایش داده می‌شود!**

## روش 2: استفاده از اسکریپت

```powershell
cd D:\MyFactoryApp
powershell.exe -ExecutionPolicy Bypass -File .\show-qr.ps1
```

## نکات مهم:

1. **QR Code در همان ترمینالی که دستور را اجرا می‌کنید نمایش داده می‌شود**
2. برای اسکن QR Code از اپلیکیشن **Expo Go** استفاده کنید:
   - Android: از Google Play Store
   - iOS: از App Store
3. بعد از اسکن QR Code، اپلیکیشن شما روی گوشی باز می‌شود

## دستورات مفید در Expo CLI:

- `w` - باز کردن در مرورگر وب
- `a` - باز کردن در Android emulator  
- `i` - باز کردن در iOS simulator
- `r` - Reload کردن اپلیکیشن
- `m` - نمایش/مخفی کردن منو
- `Ctrl+C` - توقف سرور

## عیب‌یابی:

اگر QR Code نمایش داده نمی‌شود:
1. مطمئن شوید که ترمینال به اندازه کافی بزرگ است
2. از دستور زیر استفاده کنید:
   ```powershell
   & "C:\Program Files\nodejs\npx.cmd" expo start --tunnel
   ```
3. یا از LAN mode استفاده کنید:
   ```powershell
   & "C:\Program Files\nodejs\npx.cmd" expo start --lan
   ```

## آدرس‌های احتمالی سرور:

- Metro Bundler: `http://localhost:8081`
- Expo DevTools: `http://localhost:19000`
- Tunnel URL: در ترمینال نمایش داده می‌شود

