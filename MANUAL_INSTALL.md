# راهنمای نصب دستی

## مشکل
npm install در محیط فعلی به درستی اجرا نمی‌شود. لطفاً مراحل زیر را در ترمینال PowerShell خودتان انجام دهید.

## مراحل نصب

### 1. باز کردن ترمینال PowerShell
یک پنجره PowerShell جدید باز کنید.

### 2. رفتن به پوشه پروژه
```powershell
cd D:\MyFactoryApp
```

### 3. تنظیم PATH (اگر node پیدا نشد)
```powershell
$env:Path += ";C:\Program Files\nodejs"
```

### 4. بررسی Node.js و npm
```powershell
node -v
npm -v
```

هر دو باید نسخه را نمایش دهند.

### 5. نصب وابستگی‌ها
```powershell
npm install
```

این دستور ممکن است 2-5 دقیقه طول بکشد.

### 6. بررسی نصب
بعد از اتمام، بررسی کنید:
```powershell
Test-Path "node_modules\@react-navigation\native"
Test-Path "node_modules\react-native-paper"
Test-Path "node_modules\expo-sqlite"
```

همه باید `True` برگردانند.

### 7. راه‌اندازی Expo
```powershell
npm start
```

یا:

```powershell
npx expo start --clear
```

## عیب‌یابی

### اگر npm install خطا داد:
1. مطمئن شوید که Node.js نصب است
2. دستور زیر را امتحان کنید:
   ```powershell
   npm cache clean --force
   npm install
   ```

### اگر پکیج‌ها نصب نشدند:
```powershell
npm install @react-navigation/native @react-navigation/native-stack react-native-paper expo-sqlite react-native-chart-kit react-native-svg --legacy-peer-deps
```

## QR Code
بعد از اجرای `npm start`، QR Code در همان ترمینال نمایش داده می‌شود.

