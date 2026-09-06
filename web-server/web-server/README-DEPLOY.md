# 🚀 راهنمای استقرار دمو — Sanatify MES روی VM مشتری

> نسخهٔ بسته‌شده (باینری) — بدون نیاز به Node.js روی VM مشتری.
> جریان کامل: **نصب → HWKEY → امضای لایسنس → کپی tenant.json → ری‌استارت → دمو**

---

## ۱) کپی بسته

فایل `dist-deploy.zip` را روی VM مشتری کپی و استخراج کنید (مثلاً به `C:\Sanatify` یا `/tmp/sanatify`).

## ۲) اجرای نصب‌کننده

**ویندوز** — PowerShell با **Run as administrator**:

```powershell
powershell -ExecutionPolicy Bypass -File tools\install.ps1
```

**لینوکس**:

```bash
sudo bash tools/install.sh          # یا: bash tools/install.sh --prefix=/opt/sanatify
```

نصب‌کننده: باینری + `SHA256SUMS.txt` را کنار هم کپی می‌کند، سرویس می‌سازد، پورت `3001/tcp` را باز می‌کند و **HWKEY ماشین را چاپ می‌کند**.

## ۳) خواندن HWKEY

از خروجی نصب‌کننده، یا هر زمان بعد از آن:

```
& "C:\Program Files\SanatifyMES\sanatify-mes.exe" --print-hwkey     # ویندوز
/opt/sanatify/sanatify-mes --print-hwkey                            # لینوکس
```

نمونه: `HW-3F2A-91BC-04DE` — این کد **اثر انگشت سخت‌افزاری همین VM** است (ثابت در ری‌استارت/کپونینگ).

## ۴) امضای لایسنس (روی ماشین فروشنده)

```bash
node tools/license.js --hwkey=HW-3F2A-91BC-04DE \
     --only=summary,production,inventory,quality,maintenance \
     --expires=2026-10-01 \
     --sign --sign-ed
```

> `--only` = ماژول‌های دمو (مالی/فروش/خرید ندهید — مشتری سپیدار دارد). `--expires` = پایان دمو.
> اختیاری/امنیت بیشتر — رمزنگاری پیکربندی (AES-256-GCM، کلید از HWKEY مشتری):
> `node tools/encrypt-config.js --file=tenant.json --hwkey=HW-3F2A-91BC-04DE`
> (نکته: کلید از `SANATIFY_LIC_KEY + HWKEY` مشتق می‌شود — همان env هنگام اجرای سرور باید موجود باشد؛ پیش‌فرض هر دو = کلید داخلی کد.)

## ۵) کپی tenant.json کنار باینری

فایل امضاشدهٔ `tenant.json` (یا `tenant.json.enc`) را کنار exe کپی کنید:

```
C:\Program Files\SanatifyMES\tenant.json        # ویندوز
/opt/sanatify/tenant.json                       # لینوکس
```

⚠ بدون این فایل — یا با امضای خراب — باینری عمداً بالا نمی‌آید (`SEC-ANTI-19h`). `SHA256SUMS.txt` هم باید کنار exe بماند (`SEC-ANTI-19g` ضد دستکاری).

## ۶) ری‌استارت سرویس

```
sc.exe stop SanatifyMES ; sc.exe start SanatifyMES        # ویندوز
sudo systemctl restart sanatify-mes                        # لینوکس (یا: start.sh/stop.sh)
```

## ۷) دادهٔ دمو

```bash
node tools/demo-seed.js        # ۳۰ روز تولید + ۵۰ باندل + ۱۰ توقف + ۵ PM (روی ماشین فروشنده، سپس live.json را کپی کنید)
```

## ۸) چک‌لیست تست دمو

| # | بررسی | انتظار |
|---|-------|--------|
| ۱ | `/api/health` | `ok:true` |
| ۲ | ورود به وب اپ | لاگین موفق |
| ۳ | بنر بالای صفحه | 🎯 «حالت دمو — فقط ماژول‌های فنی فعال» |
| ۴ | تب‌ها | فقط فنی (خلاصه/تولید/کیفیت/انبار/PM) — مالی/فروش/خرید غایب |
| ۵ | API مالی/فروش/خرید با URL دستی | `403 DEMO_MODE` |
| ۶ | اجرای باینری روی VM دیگر | بوت نمی‌شود (قفل HWKEY) |
| ۷ | تغییر یک بایت در tenant.json | بوت نمی‌شود (امضا نامعتبر) |

---

## عیب‌یابی

| نشانه | علت محتمل | راه‌حل |
|-------|-----------|--------|
| سرویس بالا نمی‌آید؛ پیام «tenant.json امضاشده کنار باینری نیست» | فایل لایسنس کپی نشده | گام ۴-۵ را کامل کنید |
| پیام «این نسخه فقط روی ماشینِ دارای لایسنس اجرا می‌شود» | HWKEY لایسنس ≠ این ماشین | HWKEY واقعی را با `--print-hwkey` بخوانید و دوباره امضا کنید |
| پیام «مانیفست صحت (SHA256SUMS.txt) کنار باینری نیست» / «باینری دستکاری شده» | فایل manifest حذف/باینری تغییر کرده | بستهٔ اصلی را دوباره کپی کنید |
| وب باز نمی‌شود ولی سرور بالا است | فایروال پورت 3001 | `netsh advfirewall firewall add rule name="Sanatify MES" dir=in action=allow protocol=TCP localport=3001` (یا `ufw allow 3001/tcp`) |
| مرورگر نسخهٔ قدیمی/خالی | کش PWA (Service Worker) | Ctrl+Shift+R یا از تنظیمات مرورگر «Clear site data» |

---

## یادداشت‌های حفاظت (فروشنده)

- **حالت source** (`node server.js` روی لپ‌تاپ فروشنده) هرگز این گاردها را ندارد — فقط باینری (`process.pkg`).
- **Anti-Debug** (فقط exe): inspector/پرچم‌ها/والد مشکوک ⇒ خروج. برای دیباگ فروشنده روی VM: env `SANATIFY_ANTIDBG=off`.
- **رمزنگاری پیکربندی** اختیاری است؛ plaintext همیشه پشتیبانی می‌شود. اگر سرور فایل را به‌روز کند، `.enc` حذف می‌شود (هشدار در لاگ) — دوباره `encrypt-config.js` بزنید.
- کلیدهای Ed25519/HMAC فقط نزد فروشنده (env) — هرگز روی VM مشتری.
