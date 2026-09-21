# RUNBOOK راه‌اندازی تمیز (GO-LIVE) — Sanatify MES

> **فاز ۳۲ — استقرار تمیز فردا.** این سند گام‌به‌گام نصب روی VM مشتری است.
> اصل طلایی: **«نصب تمیز = صفر انتقال داده.»** هر فایلی که امروز روی ماشین فروشنده ساخته شده
> (دادهٔ دمو، کاربران آزمون، audit) هرگز نباید وارد VM مشتری شود.

---

## ⛔ ممنوعیت‌های مطلق روز راه‌اندازی (قرمز — استثنا ندارد)

| ⛔ | توضیح |
|---|---|
| **اجرا نکردن `tools/demo-seed.js` روی VM** | این ابزار ۳۰ روز تولید + ۵۰ بندیل + ۱۰ توقف دادهٔ نمونه می‌سازد — فقط برای دموی فروشنده است، نه مشتری. اگر اجرا شد: live.json را حذف کنید، سرویس را ری‌استارت کنید و دوباره go-live-check بگیرید. |
| **اجرای هیچ مهاجرت/کپی داده** | هیچ live.json / audit.json / web-users.json از ماشین فروشنده به VM کپی نمی‌شود (نصب‌کننده هم با گارد رفض می‌کند). |
| **تغییر رفتار ماژول‌های عملیاتی** | تولید/توقف/ضایعات/PM/برنامه‌ریزی/کیفیت دست نمی‌خورند — فقط tenant.json (دامنه/برند/لایسنس). |
| **دست زدن به `public/sw.js`** | سرویس‌ورکر بایت‌به‌بایت قفل است (SHA256 را قبل/بعد مقایسه کنید). |
| **افزودن هر وابستگی npm جدید** | محصول صفر وابستگی می‌ماند. |
| **کلید خصوصی در tenant.json یا ایمیل/چت** | کلیدها فقط inline در همان دستور امضا — هرگز export و هرگز ارسال. |

---

## الف) ماشین فروشنده — ساخت بستهٔ استقرار

```bash
cd <ریپو>/web-server/web-server
git pull origin main                       # HEAD باید GO-LIVE-32 باشد
node tools/build-protected.js --compile --package
```

خروجی: `dist-deploy/` شامل:
- `bin/sanatify-mes-node18-win-x64.exe` و/یا `bin/sanatify-mes-node18-linux-x64` + `bin/SHA256SUMS.txt`
- `install.ps1` / `install.sh` (+ uninstall)
- `tools/…` (license-doctor.js ، go-live-check.sh/ps1 و سایر ابزارها)
- `tenant.json.template` ، `RUNBOOK-GoLive-فا.md` (همین سند) ، `SHA256SUMS.txt` کل بسته

⚠ باینری بدون `SHA256SUMS.txt` کنار خودش **بالا نمی‌آید** (SEC-ANTI-19g) — هرگز آن را جدا نکنید.

---

## ب) VM مشتری — نصب و خواندن HWKEY

**ویندوز (PowerShell «Run as administrator»):**
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 -SourceDir "C:\deploy\dist-deploy\bin" -Port 3001
```

**لینوکس:**
```bash
sudo bash install.sh /path/to/sanatify-mes-node18-linux-x64 --prefix=/opt/sanatify --port=3001
```

نصب‌کننده چاپ می‌کند:
```
━━━ قفل سخت‌افزاری (SEC-BIND-19f) ━━━
  HWKEY این ماشین : HW-XXXX-XXXX-XXXX
```
> 📌 این HWKEY را برای گام (ج) یادداشت کنید. تا وقتی tenant.json امضاشده کنار exe نباشد، سرویس بالا نمی‌آید — **طبیعی و عمدی است.**
>
> 🛡 اگر نصب‌کننده پیام «✗ دادهٔ قدیمی یافت شد؛ … نصب متوقف شد» داد یعنی در مقصد دادهٔ قدیمی هست — نصب تمیز را رها نکنید؛ پوشهٔ مقصد را پاک کنید. پرچم `--force-data` / `-ForceData` فقط برای ارتقای عمدی همان نصب است.

---

## ج) ماشین فروشنده — امضای لایسنس با دامنهٔ فردا

> 🔑 کلید HMAC (`SANATIFY_LIC_KEY`) و کلید خصوصی Ed25519 (`SANATIFY_LIC_ED_PRIV`) **فقط inline در همین دستور** — هرگز `export` نکنید (تاریخچهٔ پوسته می‌ماند).

```bash
SANATIFY_LIC_KEY="کلید-مخفی-فروشنده" \
SANATIFY_LIC_ED_PRIV="کلید-خصوصی-Ed25519-PKCS8-base64" \
node tools/license.js \
    --hwkey=HW-XXXX-XXXX-XXXX \
    --only=summary,analytics,production,quality,inventory,maintenance,em,planning,finance \
    --max-users=25 --max-records=0 \
    --expires=2027-03-20 \
    --hide-tabs=warehouse,finance,sales,purchase,genealogy,balance \
    --demo-off \
    --sign
```

- `--hide-tabs=` **گیت دامنهٔ راه‌اندازی (فقط UI)**: این ۶ تب (انبار/موجودی، مالی، فروش، خرید، ردیابی تولید، بالانس شمش) در UI مشتری اصلاً ساخته نمی‌شوند — ناوبری + کل بخش + خروجی اکسل/چاپ از DOM حذف می‌شود. APIها دست‌نخورده‌اند (مثلاً رسید انبار از جریان تولید همچنان در سرور ثبت می‌شود).
- تب‌های نمایان فردا: خلاصه، داشبورد تحلیلی، ثبت تولید، ضایعات، توقفات، کنترل کیفیت، تعمیرات و PM (شامل زیربخش مدیریت انرژی)، برنامه‌ریزی تولید + پنل سازمان (org).
- `--hide-tabs=` (خالی) = حذف گیت. تب `org` هرگز مخفی نمی‌شود.
- خروجی: `tenant.json` امضاشده (HMAC + Ed25519) + `license.key` کنار tools (بوت سرد بدون env هم معتبر می‌ماند).
- خودآزمایی: `node tools/license.js --verify` و در صورت ابهام `node tools/license-doctor.js --dir=<مسیر-استقرار>`.

---

## د) انتقال به VM — فقط این چهار فایل

| ✅ کپی کنید | ⛔ هرگز کپی نکنید |
|---|---|
| `sanatify-mes-node18-…` (exe) | **`live.json`** (دادهٔ عملیاتی/دمو) |
| `tenant.json` (امضاشدهٔ گام ج) | **`audit.json`** (لاگ ممیزی) |
| `license.key` (کلید HMAC ساخته‌شده در ج) | **`web-users.json`** (کاربران آزمون/فروشنده) |
| `cert.pem` + `key.pem` (اگر HTTPS می‌خواهید) | هر `.enc` آن‌ها، هر `*.bak*`، `dist/` کامل |

مقصد: کنار exe — ویندوز: `C:\Program Files\SanatifyMES` ، لینوکس: `/opt/sanatify`.

---

## هـ) استارت سرویس + بوت‌استرپ ادمین + کنترل نهایی

**۱) سرویس:**
```powershell
sc.exe start SanatifyMES          # ویندوز
```
```bash
sudo systemctl start sanatify-mes   # لینوکس (یا: /opt/sanatify/start.sh)
```
لاگ کنسول/سرویس باید نشان دهد: `HWKEY ماشین : HW-…` + `وضعیت لایسنس : معتبر ✓`.

**۲) بوت‌استرپ اولین کاربر — «صاحب سیستم» (vendor)** (بن‌بست «VM تازه = هیچ‌کس لاگین نمی‌کند» را می‌بندد):
```bash
# روی VM — کنار exe:
./sanatify-mes --create-admin=admin:رمز-اولیه-۸کاراکتر-حرف‌ورقم
```
> - از **VENDOR-37** این دستور نقش **vendor (صاحب سیستم)** می‌سازد — نه admin. فقط vendor به «لایسنس + ماژول‌ها + سقف کاربر/رکورد + انقضا + ساخت/حذف admin» دسترسی دارد؛ admin معمولی فقط کاربران عملیاتی/تنظیمات/گزارش.
> - web-users روی دیسک **رمزنگاری‌شده** است (web-users.json.enc — AES-256-GCM با کلید مشتق از HWKEY)؛ IT با ویرایش دستی نمی‌تواند vendor جعل کند و plaintext رد می‌شود.
> - فقط وقتی **هیچ ادمین/صاحب‌سیستم فعالی** وجود ندارد کار می‌کند (گارد دوم — روی نصب زنده خطا می‌دهد).
> - رمز اولیه فقط inline در همان دستور؛ اولین ورود **اجبار به تغییر رمز** دارد (HARDEN-18P).
> - جایگزین: `--create-admin=admin` با env `SANATIFY_BOOTSTRAP_PW=…`.

**۳) کنترل نهایی (go-live-check):**
```bash
bash tools/go-live-check.sh --url=http://127.0.0.1:3001 \
    --user=admin --pass=رمز-جدید \
    --expect-hidden=warehouse,finance,sales,purchase,genealogy,balance \
    --dir=/opt/sanatify
```
```powershell
powershell -ExecutionPolicy Bypass -File tools\go-live-check.ps1 -Url http://127.0.0.1:3001 `
    -User admin -Pass رمز-جدید -ExpectHidden warehouse,finance,sales,purchase,genealogy,balance `
    -Dir "C:\Program Files\SanatifyMES"
```
انتظار: **✗ صفر** و جدول شامل `records/*  ۰ رکورد — تمیز` برای همهٔ ماژول‌ها. کد خروج ۰ = سبز.

**۴) ساخت بقیهٔ کاربران از UI:** ورود با صاحب سیستم (vendor) بوت‌استرپ → تغییر اجباری رمز → تب **org** → کاربران و نقش‌ها (اپراتور، سرپرست، برنامه‌ریز، کنترل کیفیت، و در صورت نیاز admin — ساخت admin فقط از دست vendor).

**۵) recovery صاحب سیستم (فقط فروشنده — با کلید خصوصی Ed25519):** اگر آخرین vendor حذف/قفل شد یا فایل کاربران رد شد:
```bash
SANATIFY_LIC_ED_PRIV="کلید-خصوصی-PKCS8-پایه64" ./sanatify-mes --recover-vendor=vendor1:رمز-اولیه
```
> - vendor با **امضای Ed25519 فروشنده** (vendor_sig) ساخته/بازنشانی می‌شود؛ IT بدون کلید خصوصی نمی‌تواند.
> - کاربران سالم موجود حفظ می‌شوند؛ vendorهای بی‌امضا/جعلی حذف می‌شوند.
> - بوت با نبود vendor فعال **متوقف نمی‌شود** — هشدار فارسی + همین راه‌حل را چاپ می‌کند (VENDOR-37).

---

## و) برندینگ + تست نقش اپراتور

1. تب **org**: نام شرکت + لوگو (PNG/JPG ≤ ۳۰۰KB) + رنگ برند → ذخیره.
2. خروج و ورود با یک کاربر **اپراتور**: باید فقط ۳ تب ببیند (ثبت تولید، ضایعات، توقفات) — نه org و نه تب‌های مخفی.
3. یک ثبت آزمایشی واقعی (مثلاً یک توقف) از UI → شمارش در go-live-check دیگر صفر نیست — **این طبیعی است**؛ چک «تمیز» فقط قبل از اولین ثبت عملیاتی معنا دارد.

---

## ز) رول‌بک — اگر هر گام FAIL شد

| علامت | علت محتمل | اقدام دقیق |
|---|---|---|
| سرویس استارت نمی‌شود؛ لاگ: «tenant.json امضاشده کنار باینری نیست» | فایل‌های گام (د) ناقص کپی شده | (د) را کامل کنید؛ `sc.exe start` / `systemctl start` دوباره |
| لاگ: «امضای لایسنس نامعتبر/دستکاری‌شده» | tenant.json با کلید دیگری امضا شده یا دستکاری شده | روی ماشین فروشنده دوباره (ج) با همان کلیدها؛ فقط tenant.json را جایگزین کنید؛ سرویس را ری‌استارت کنید |
| لاگ: قفل سخت‌افزاری — HWKEY تطبیق ندارد | HWKEY اشتباه (VM دیگری؟) | `./sanatify-mes --print-hwkey` روی VM → خروجی را در (ج) بگذارید → tenant.json تازه |
| go-live-check: `health ✗` | پورت/سرویس | `curl http://127.0.0.1:3001/api/health` دستی؛ لاگ سرویس؛ فایروال پورت 3001 |
| go-live-check: `demo_mode ✗ فعال` | tenant دمو به اشتباه کپی شده | (ج) را با `--demo-off` تکرار → فقط tenant.json جایگزین |
| go-live-check: `records/* ✗ n رکورد` | دادهٔ قدیمی منتقل شده (یا demo-seed اجرا شده!) | سرویس stop → `live.json` (و `live.json.bak*`) را در پوشهٔ نصب **حذف** کنید → استارت → go-live-check دوباره |
| go-live-check: `hidden_tabs ✗ مطابقت ندارد` | امضا بدون --hide-tabs یا نسخهٔ کهنه | (ج) با `--hide-tabs=…` → tenant.json جایگزین → ری‌استارت (نیازی به تغییر باینری نیست) |
| نصب‌کننده: «دادهٔ قدیمی یافت شد» | مقصد قبلاً نصب/دمو داشته | اگر ارتقا نیست: پوشهٔ مقصد را پاک کنید و نصب تمیز را از (ب) تکرار کنید |
| UI: تب‌های مخفی باز می‌گردند | tenant.json بعد از بوت عوض شده (سرور mtime را کش می‌کند — بدون ری‌استارت اعمال می‌شود، ولی اگر فایل اشتباه کپی شده باشد) | tenant.json درست را بگذارید؛ اگر حل نشد ری‌استارت سرویس |
| «ادمین دوم گارد» هنگام --create-admin | نصب زنده است | از پنل org کاربر بسازید؛ این پرچم فقط برای نصب تمیز است |
| «صاحب سیستم (vendor) فعال موجود است» هنگام --create-admin | vendor از قبل هست (VENDOR-37) | با همان vendor وارد شوید؛ recovery فقط با کلید خصوصی فروشنده: `--recover-vendor` |

**رول‌بک کامل (پاک‌سازی برای تلاش دوباره):**
```powershell
sc.exe stop SanatifyMES ; sc.exe delete SanatifyMES
Remove-Item "C:\Program Files\SanatifyMES\live.json","C:\Program Files\SanatifyMES\audit.json","C:\Program Files\SanatifyMES\web-users.json*" -ErrorAction SilentlyContinue
```
```bash
sudo systemctl stop sanatify-mes || /opt/sanatify/stop.sh
sudo rm -f /opt/sanatify/{live.json,live.json.bak*,audit.json,web-users.json,web-users.json.enc}
```
سپس از گام (ب) دوباره شروع کنید. باینری و tenant.json سالم را نگه دارید.

---

## پیوست — کدهای خروج `license-doctor.js`

| کد | معنا | اصلاح |
|---|---|---|
| ۰ | لایسنس معتبر | — |
| ۱۰ | tenant.json غایب/خراب | گام (د)/(ج) |
| ۱۱ | HWKEY این ماشین نیست | HWKEY واقعی با `--print-hwkey` → امضای دوباره |
| ۱۲ | منقضی شده | `--expires` تازه → امضای دوباره |
| ۱۳ | Ed25519 (license_sig2) نامعتبر | امضا با `SANATIFY_LIC_ED_PRIV` درست |
| ۱۴ | HMAC تأیید نمی‌شود | کلید/فایل license.key — امضای دوباره |
| ۱۵ | هیچ منبع کلید HMAC نیست | `license.key` کنار exe را کپی کنید (گام د) |
| ۱۶ | اصلاً امضا ندارد | گام (ج) کامل |

*تهیه‌شده در GO-LIVE-32 — گیت دامنهٔ راه‌اندازی (hidden_tabs) + نصب بدون دادهٔ قدیمی + کنترل نهایی.*
