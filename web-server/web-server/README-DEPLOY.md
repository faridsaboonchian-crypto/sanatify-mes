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
     --sign
```

> `--only` = ماژول‌های دمو (مالی/فروش/خرید ندهید — مشتری سپیدار دارد). `--expires` = پایان دمو.
> **FIX-LIC-27**: `--sign` امضای کامل می‌زند (HMAC + Ed25519 با هم) و اگر فایل `license.key` کنار server.js نباشد،
> آن را با کلید env می‌سازد (یک‌بار؛ ACL ویندوز: فقط Administrators/System). بدون `SANATIFY_LIC_ED_PRIV`
> خطای صریح می‌دهد — امضای نیمه‌کارهٔ بی‌صدا (فقط HMAC) دیگر ساخته نمی‌شود.
> **این فایل license.key را هم کنار exe در VM مشتری کپی کنید** — بوت سرد بدون هیچ env معتبر می‌ماند (بخش ۹).
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
node tools/demo-seed.js        # ۳۰ روز تولید + ۵۰ بندیل + ۱۰ توقف + ۵ PM (روی ماشین فروشنده، سپس live.json را کپی کنید)
```

> 🔴 **خط قرمز (PURGE-36):** `demo-seed` فقط با فراخوانی صریح کاربر اجرا می‌شود — در بوت/UI/اینستالر هیچ
> فراخوانی خودکاری وجود ندارد و نباید داشته باشد. روی VM مشتری هرگز demo-seed اجرا نکنید.
> کد نیز هیچ «fallback نمایشی» ندارد: پایین‌آمدن با دادهٔ خالی = داشبورد خالی یا «پایهٔ مهندسی» (COLDSTART-35)، نه دادهٔ نمونه.

### ریست کامل داده (قبل از تحویل/آموزش — PURGE-36)

```bash
node tools/reset-live.js                  # بکاپ پیش‌فرض → backups/pre-reset-<ts>/ (منتقل، نه حذف) + ساختار خالی معتبر
node tools/reset-live.js --include-users  # وب‌کاربران هم ریست می‌شوند (⚠ بعدش --create-admin لازم است)
node tools/restore-live.js --from=<ts>    # برگشت دقیق از همان نسخهٔ بکاپ
```

- ریست = live.json + audit.json + زنجیرهٔ `.bak/.corrupt` به `backups/pre-reset-<ts>/` منتقل و ساختار خالیِ معتبر ساخته می‌شود.
- سرویس هنگام ریست باید متوقف باشد؛ بعد از ریست داشبورد/جدول‌ها/پیشنهادها صفر واقعی‌اند (نه نمونه).

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
| ۸ | بوت سرد: پوستهٔ تازهٔ بدون env + license.key کنار exe | «وضعیت لایسنس : معتبر ✓» در لاگ (بخش ۹) |

---

## ۹) چک‌لیست بوت سرد — ضد بنر «لایسنس نامعتبر» بعد از ری‌استارت

این خطا دو بار در استقرار واقعی تکرار شد: کلید فقط در env پوستهٔ دستی (ترمینالی که امضا/تست را زدید) بود و
بوت خودکار — Startup → wscript → bat یا سرویس — env را ندارد؛ سرور با کلید پیش‌فرض verify می‌کرد ⇒ بنر «لایسنس نامعتبر».
از فاز ۲۱ (FIX-LIC-27) ترتیب منبع کلید HMAC سرور این است:

```
env SANATIFY_LIC_KEY  →  فایل license.key کنار server.js/exe  →  پیش‌فرض (همیشه نامعتبر)
```

و امضای **Ed25519 مسیر اصلی** است: کلید عمومی سرور embed شده و بوت سرد بدون هیچ env هم sig2 را تأیید می‌کند.

### ✅ راه درست (توصیه‌شده — صفر env)

1. روی ماشین فروشنده یک‌بار: `SANATIFY_LIC_KEY="…" SANATIFY_LIC_ED_PRIV="…" node tools/license.js --sign`
   → امضای کامل + ساخت `license.key` کنار server.js.
2. هر دو فایل `tenant.json` **و** `license.key` را کنار exe کپی کنید (گام ۵ + همین بخش).
3. تست بوت سرد واقعی: یک پوستهٔ کاملاً تازه (بدون env) باز کنید و سرویس/سرور را ری‌استارت کنید؛
   در لاگ باید «وضعیت لایسنس : معتبر ✓ [Ed25519 — کلید عمومی embedded سرور]» ببینید (خط خودآزمایی بوت، FIX-LIC-27).

### راه جایگزین — env در سطح سرویس/bat (نه پوستهٔ دستی)

| محیط | راه ست‌کردن env برای بوت خودکار |
|------|-------------------------------|
| bat در Startup (wscript) | خط اول خودِ bat: `set "SANATIFY_LIC_KEY=…"` — env پوستهٔ دستی به bat نمی‌رسد |
| سرویس sc.exe ویندوز | `reg add "HKLM\SYSTEM\CurrentControlSet\Services\SanatifyMES\Environment" /v SANATIFY_LIC_KEY /t REG_SZ /d "…" /f` سپس `sc stop && sc start` |
| systemd لینوکس | در unit: `Environment=SANATIFY_LIC_KEY=…` یا `EnvironmentFile=/opt/sanatify/license.env` |

⚠ اگر `tenant.json.enc` (رمزنگاری‌شده) مستقر می‌کنید، رمزگشایی آن به `SANATIFY_LIC_KEY` در envِ همان پروسه نیاز دارد —
یا env سرویس را حتماً ست کنید یا plaintext + امضا + license.key را ترجیح دهید.

### تشخیص

```bash
node tools/license-doctor.js --dir="C:\Program Files\SanatifyMES"
```

همان زنجیرهٔ تأیید سرور را گام‌به‌گام اجرا می‌کند: tenant → hwkey → انقضا → Ed25519 (مسیر اصلی) → HMAC (با کدام منبع کلید؟)
و «علت» + «دستور اصلاح» چاپ می‌کند. کدهای خروج متمایز: ۰ سالم | ۱۰ tenant | ۱۱ hwkey | ۱۲ انقضا | ۱۳ Ed | ۱۴ HMAC | ۱۵ بدون منبع کلید (تلهٔ بوت سرد) | ۱۶ بدون امضای فروشنده.

---

## عیب‌یابی

| نشانه | علت محتمل | راه‌حل |
|-------|-----------|--------|
| سرویس بالا نمی‌آید؛ پیام «tenant.json امضاشده کنار باینری نیست» | فایل لایسنس کپی نشده | گام ۴-۵ را کامل کنید |
| پیام «این نسخه فقط روی ماشینِ دارای لایسنس اجرا می‌شود» | HWKEY لایسنس ≠ این ماشین | HWKEY واقعی را با `--print-hwkey` بخوانید و دوباره امضا کنید |
| پیام «مانیفست صحت (SHA256SUMS.txt) کنار باینری نیست» / «باینری دستکاری شده» | فایل manifest حذف/باینری تغییر کرده | بستهٔ اصلی را دوباره کپی کنید |
| وب باز نمی‌شود ولی سرور بالا است | فایروال پورت 3001 | `netsh advfirewall firewall add rule name="Sanatify MES" dir=in action=allow protocol=TCP localport=3001` (یا `ufw allow 3001/tcp`) |
| بنر «لایسنس نامعتبر» بعد از ری‌استارت (بوت سرد) | کلید فقط در env پوستهٔ دستی بود؛ بوت خودکار env ندارد | بخش ۹ — `license.key` کنار exe + تست با پوستهٔ تازه؛ تشخیص: `node tools/license-doctor.js` |
| مرورگر نسخهٔ قدیمی/خالی | کش PWA (Service Worker) | Ctrl+Shift+R یا از تنظیمات مرورگر «Clear site data» |

---

## یادداشت‌های حفاظت (فروشنده)

- **حالت source** (`node server.js` روی لپ‌تاپ فروشنده) هرگز این گاردها را ندارد — فقط باینری (`process.pkg`).
- **Anti-Debug** (فقط exe): inspector/پرچم‌ها/والد مشکوک ⇒ خروج. برای دیباگ فروشنده روی VM: env `SANATIFY_ANTIDBG=off`.
- **رمزنگاری پیکربندی** اختیاری است؛ plaintext همیشه پشتیبانی می‌شود. اگر سرور فایل را به‌روز کند، `.enc` حذف می‌شود (هشدار در لاگ) — دوباره `encrypt-config.js` بزنید.
- کلیدهای HMAC/Ed25519 فقط نزد فروشنده (env یا `license.key`) — هرگز روی VM مشتری `SANATIFY_LIC_ED_PRIV`.
- **FIX-LIC-27**: کلید عمومی Ed25519 در سرور embed شده (راز نیست؛ env `SANATIFY_LIC_ED_PUB` فقط برای چرخش کلید).
  کلید خصوصی Ed را در جایی امن نگه دارید — اگر از دست برود، صدور لایسنس جدید مستلزم embedِ کلید عمومی تازه در سرور است.
