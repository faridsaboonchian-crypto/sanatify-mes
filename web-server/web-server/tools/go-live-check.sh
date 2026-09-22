#!/usr/bin/env bash
# =====================================================================
# GO-LIVE-32b — go-live-check: کنترل کامل پس از بوت برای راه‌اندازی تمیز (صفر وابستگی — فقط curl)
#
# مصرف:
#   bash go-live-check.sh --url=http://127.0.0.1:3001 --user=admin --pass=رمز \
#        [--expect-hidden=warehouse,finance,sales,purchase,genealogy,balance] [--dir=/opt/sanatify]
#
# چک‌ها: health=200 · لایسنس معتبر · demo_mode=false · hidden_tabs فعال (تطبیق با انتظار) ·
#        شمارش رکوردهای ماژول‌ها = صفر · فهرست کاربران · سرویس/پورت/گواهی
# خروج:  جدول فارسی ✓/✗/⚠ + کد خروج (۰ = همه سبز، ۱ = حداقل یک ✗)
# =====================================================================
set -u
URL0="http://127.0.0.1:3001"; USER=""; PASS=""; EXPECT=""; DIR=""
for arg in "$@"; do case "$arg" in
    --url=*) URL0="${arg#--url=}" ;;
    --user=*) USER="${arg#--user=}" ;;
    --pass=*) PASS="${arg#--pass=}" ;;
    --expect-hidden=*) EXPECT="${arg#--expect-hidden=}" ;;
    --dir=*) DIR="${arg#--dir=}" ;;
    --help|-h) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "✗ آرگومان ناشناخته: $arg"; exit 2 ;;
esac; done

PASSN=0; FAILN=0; WARNN=0
row() {
    local st="$1" label="$2" detail="$3"
    case "$st" in
        PASS) PASSN=$((PASSN+1)); printf '  ✓ %-30s %s\n' "$label" "$detail" ;;
        FAIL) FAILN=$((FAILN+1)); printf '  ✗ %-30s %s\n' "$label" "$detail" ;;
        WARN) WARNN=$((WARNN+1)); printf '  ⚠ %-30s %s\n' "$label" "$detail" ;;
        *) printf '  ℹ %-30s %s\n' "$label" "$detail" ;;
    esac
}
TMPD="$(mktemp -d 2>/dev/null || echo /tmp/golive-check-$$)"
mkdir -p "$TMPD"
trap 'rm -rf "$TMPD" 2>/dev/null' EXIT

echo "━━━ GO-LIVE-32b — go-live-check ━━━"
echo "  مقصد : $URL0"

# ---------- ۱) health ----------
HCODE=$(curl -s -m 6 -o "$TMPD/health.json" -w '%{http_code}' "$URL0/api/health" 2>/dev/null)
if [ "$HCODE" = "200" ] && grep -q '"ok":true' "$TMPD/health.json" 2>/dev/null; then
    row PASS "health" "HTTP 200 + ok:true"
else
    row FAIL "health" "HTTP=${HCODE:-بدون‌پاسخ} — سرور بالا نیست؟ (لاگ: server.log یا journalctl -u sanatify-mes)"
fi

# ---------- ۲) کانفیگ عمومی: demo / hidden_tabs / لایسنس ----------
curl -s -m 6 "$URL0/api/tenant/config" -o "$TMPD/cfg.json" 2>/dev/null
CFG_OK="no"
grep -q '"ok":true' "$TMPD/cfg.json" 2>/dev/null && CFG_OK="yes"
if [ "$CFG_OK" != "yes" ]; then
    row FAIL "config" "پاسخ /api/tenant/config خوانده نشد"
else
    if grep -q '"demo_mode":true' "$TMPD/cfg.json"; then
        row FAIL "demo_mode" "فعال است! — راه‌اندازی تمیز باید false باشد (tenant.json: demo_mode=false + امضای دوباره)"
    else
        row PASS "demo_mode" "false — بدون گیت دمو"
    fi
    if grep -q '"invalid":true' "$TMPD/cfg.json"; then
        row FAIL "license" "نامعتبر — تشخیص: node tools/license-doctor.js (در ماشین سازنده)"
    else
        row PASS "license" "معتبر (server-side verify)"
    fi
    HT32=$(sed -n 's/.*"hidden_tabs":\(\[[^]]*\]\).*/\1/p' "$TMPD/cfg.json" | head -1)
    [ -z "$HT32" ] && HT32="[]"
    if [ "$HT32" = "[]" ]; then
        row WARN "hidden_tabs" "غایب/خالی — همهٔ تب‌ها نمایان است (گیت دامنه فعال نشده؟ tenant.json را با --hide-tabs امضا و کپی کنید)"
    else
        if [ -n "$EXPECT" ]; then
            GOT32=$(echo "$HT32" | tr -d '"[] ' | tr ',' '\n' | sort | tr '\n' ',' | sed 's/,$//')
            EXP32=$(echo "$EXPECT" | tr -d '"[] ' | tr ',' '\n' | sort | tr '\n' ',' | sed 's/,$//')
            if [ "$GOT32" = "$EXP32" ]; then
                row PASS "hidden_tabs" "دقیقاً مطابق انتظار ($HT32)"
            else
                row FAIL "hidden_tabs" "مطابقت ندارد — انتظار: [$EXP32] واقعی: $HT32"
            fi
        else
            row PASS "hidden_tabs" "فعال: $HT32 (برای تطبیق دقیق: --expect-hidden=...)"
        fi
    fi
fi

# ---------- ۳) doctor (اگر node + ابزار موجود بود — روی VM معمولاً node نیست؛ جانشین: چک لایسنس بالا) ----------
DOCTOR_BIN=""
if [ -n "$DIR" ] && [ -f "$DIR/tools/license-doctor.js" ]; then DOCTOR_BIN="$DIR/tools/license-doctor.js"; fi
if command -v node >/dev/null 2>&1 && [ -n "$DOCTOR_BIN" ]; then
    node "$DOCTOR_BIN" --dir="$DIR" > "$TMPD/doctor.txt" 2>&1
    DC=$?
    if [ $DC -eq 0 ]; then row PASS "license-doctor" "کد خروج ۰ — سالم"
    else row FAIL "license-doctor" "کد خروج $DC — $(tail -1 "$TMPD/doctor.txt" | head -c 120)"; fi
else
    echo "  ℹ license-doctor                     رد شد (node یا tools/ در این ماشین نیست — قضاوت لایسنس با چک server-side بالا انجام شد)"
fi

# ---------- ۴) شمارش رکوردها = صفر (نیازمند نشست ادمین) ----------
if [ -n "$USER" ]; then
    ESC_PASS=$(printf '%s' "$PASS" | sed 's/\\/\\\\/g; s/"/\\"/g')
    LCODE=$(curl -s -m 6 -c "$TMPD/jar" -o "$TMPD/login.json" -w '%{http_code}' -X POST "$URL0/api/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$USER\",\"password\":\"$ESC_PASS\"}" 2>/dev/null)
    if [ "$LCODE" != "200" ] || ! grep -q '"ok":true' "$TMPD/login.json" 2>/dev/null; then
        row FAIL "login" "HTTP=$LCODE — ورود ناموفق (کاربر/رمز؟)"
    else
        row PASS "login" "نشست ادمین ساخته شد"
        for ep in production waste downtime quality bundles billets; do
            curl -s -m 8 -b "$TMPD/jar" "$URL0/api/$ep" -o "$TMPD/$ep.json" 2>/dev/null
            N=$(grep -o '"id":' "$TMPD/$ep.json" 2>/dev/null | wc -l | tr -d ' ')
            if [ "${N:-x}" = "0" ]; then
                row PASS "records/$ep" "۰ رکورد — تمیز"
            elif echo "${N:-}" | grep -qE '^[0-9]+$'; then
                row FAIL "records/$ep" "$N رکورد! — دادهٔ قدیمی منتقل شده؟ (راه‌اندازی تمیز = صفر؛ فایل live.json را بررسی/حذف کنید)"
            else
                row WARN "records/$ep" "پاسخ خوانده نشد (احتمالاً ۴۰۳ نقش/ماژول)"
            fi
        done
        UCODE=$(curl -s -m 6 -b "$TMPD/jar" -o "$TMPD/users.json" -w '%{http_code}' "$URL0/api/admin/users" 2>/dev/null)
        if [ "$UCODE" = "200" ]; then
            row PASS "users" "فهرست کاربران ساخته‌شده روی این VM:"
            sed -n 's/.*"username":"\([^"]*\)","name":"\([^"]*\)","role":"\([^"]*\)".*/       - \1 (\3)/p' "$TMPD/users.json" 2>/dev/null | head -20
            echo ""
        else
            row WARN "users" "GET /api/admin/users پاسخ $UCODE (نقش ادمین؟)"
        fi
    fi
else
    row WARN "records/users" "رد شد — --user/--pass ندهید تا فقط چک‌های عمومی اجرا شود"
fi

# ---------- ۵) سرویس / پورت / گواهی ----------
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q '^sanatify-mes'; then
    ST=$(systemctl is-active sanatify-mes 2>/dev/null)
    [ "$ST" = "active" ] && row PASS "service" "systemd: sanatify-mes active" || row FAIL "service" "systemd: $ST — journalctl -u sanatify-mes -n 50"
elif [ -n "$DIR" ] && [ -f "$DIR/server.pid" ]; then
    PID32=$(cat "$DIR/server.pid" 2>/dev/null)
    if [ -n "$PID32" ] && kill -0 "$PID32" 2>/dev/null; then row PASS "service" "nohup: PID $PID32 زنده است"
    else row WARN "service" "nohup: pid فایل هست ولی پروسه زنده نیست — $DIR/start.sh"; fi
else
    row WARN "service" "نه systemd یافت شد و نه pid — اگر nohup است: <نصب>/start.sh و tail -f <نصب>/server.log"
fi
if [ -n "$DIR" ] && [ -f "$DIR/cert.pem" ] && [ -f "$DIR/key.pem" ]; then
    row PASS "tls" "cert.pem/key.pem کنار باینری — حالت HTTPS (تک‌پورت با redirect)"
else
    echo "  ℹ tls                              HTTP حالت (cert.pem/key.pem کنار باینری نیست — برای HTTPS فایل‌ها را کنار exe بگذارید)"
fi

echo "━━━ نتیجه: ✓$PASSN  ✗$FAILN  ⚠$WARNN ━━━"
if [ $FAILN -eq 0 ]; then
    echo "  ✅ همهٔ چک‌های الزامی سبز است — آمادهٔ راه‌اندازی تمیز."
    exit 0
else
    echo "  ❌ $FAILN چک الزامی قرمز است — قبل از راه‌اندازی برطرف کنید (فصل «ز — رول‌بک» در RUNBOOK-GoLive)."
    exit 1
fi
