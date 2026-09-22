#!/usr/bin/env bash
# =====================================================================
# DEPLOY-19h — نصب‌کنندهٔ لینوکس Sanatify MES (دموی تجاری روی VM مشتری)
#
# مصرف:
#   sudo bash tools/install.sh [مسیر-باینری] [--prefix=/opt/sanatify] [--port=3001] [--force-data]
#   bash tools/install.sh ./sanatify-mes-node18-linux-x64 --prefix=$HOME/sanatify-opt
#
# کارها:
#   ۱) گارد دادهٔ قدیمی (GO-LIVE-32b): اگر live.json/audit.json/web-users.json (+ .enc) در مقصد باشند ⇒ رفض نصب (مگر --force-data)
#   ۲) کپی باینری + SHA256SUMS.txt (الزام SEC-ANTI-19g: بدون آن بوت متوقف است) + tenant.json.template
#   ۳) سرویس systemd (اگر موجود) وگرنه nohup + اسکریپت start/stop
#   ۴) فایروال (ufw/iptables — اگر موجود؛ نبودش خطا نیست)
#   ۵) چاپ HWKEY ماشین + راهنمای امضای لایسنس (SEC-BIND-19f)
# =====================================================================
set -u
PREFIX="/opt/sanatify"
SERVICE="sanatify-mes"
PORT="${PORT:-3001}"
BINARY_ARG=""
FORCE_DATA="no"

for arg in "$@"; do
    case "$arg" in
        --prefix=*) PREFIX="${arg#--prefix=}" ;;
        --port=*) PORT="${arg#--port=}" ;;
        --force-data) FORCE_DATA="yes" ;;
        --help|-h) sed -n '2,17p' "$0"; exit 0 ;;
        *) if [ -z "$BINARY_ARG" ]; then BINARY_ARG="$arg"; else echo "✗ آرگومان اضافی: $arg"; exit 1; fi ;;
    esac
done

# ---------- GO-LIVE-32b: گارد دادهٔ قدیمی — نصب تمیز یعنی صفر انتقال داده ----------
# سناریو: روی VM مشتری نصب قدیمی/دموی قبلی موجود است؛ کپی تصادفی live.json/audit.json/web-users.json
# یعنی انتقال دادهٔ دیروز به سیستم امشب — دقیقاً همان چیزی که راه‌اندازی تمیز نباید داشته باشد.
OLD_DATA=""
for f in live.json audit.json web-users.json live.json.enc audit.json.enc web-users.json.enc; do
    [ -e "$PREFIX/$f" ] && OLD_DATA="$OLD_DATA $f"
done
if [ -n "$OLD_DATA" ] && [ "$FORCE_DATA" != "yes" ]; then
    echo "✗ دادهٔ قدیمی یافت شد؛ برای جلوگیری از انتقال داده، نصب متوقف شد."
    echo "  مسیر مقصد : $PREFIX"
    echo "  فایل‌ها   :$OLD_DATA"
    echo "  اگر واقعاً ارتقای همان نصب هستید و انتقال داده عمدی است: نصب را با پرچم --force-data تکرار کنید."
    exit 1
fi
[ -n "$OLD_DATA" ] && echo "⚠ --force-data: نصب روی دادهٔ موجود:$OLD_DATA (انتقال دادهٔ عمدی — مسئولیت با شماست)"

echo "━━━ DEPLOY-19h — نصب Sanatify MES ━━━"

# ---------- یافتن باینری ----------
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
BINARY=""
for c in "$BINARY_ARG" "$SELF_DIR/bin/sanatify-mes-node18-linux-x64" "./bin/sanatify-mes-node18-linux-x64" "$SELF_DIR/sanatify-mes-node18-linux-x64" "$SELF_DIR/../dist/bin/sanatify-mes-node18-linux-x64" "./sanatify-mes-node18-linux-x64" "$SELF_DIR/dist/bin/sanatify-mes-node18-linux-x64"; do
    if [ -n "$c" ] && [ -f "$c" ]; then BINARY="$(cd "$(dirname "$c")" && pwd)/$(basename "$c")"; break; fi
done
[ -z "$BINARY" ] && { echo "✗ باینری یافت نشد — مسیر بدهید: install.sh /path/to/sanatify-mes-node18-linux-x64"; exit 1; }
[ -x "$BINARY" ] || chmod +x "$BINARY" || { echo "✗ باینری اجرایی نیست: $BINARY"; exit 1; }
BIN_DIR="$(dirname "$BINARY")"

# ---------- مجوزها ----------
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then SUDO="sudo";
    else echo "⚠ بدون root — نصب در $PREFIX (اگر مجاز باشد). برای /opt باید sudo/root باشید."; fi
fi

echo "  باینری : $BINARY"
echo "  مقصد   : $PREFIX"
$SUDO mkdir -p "$PREFIX" || { echo "✗ ساخت $PREFIX ناموفق (root؟ --prefix=...)"; exit 1; }
PFX_RUN=""
if [ ! -w "$PREFIX" ]; then PFX_RUN="$SUDO"; fi

# ---------- کپی فایل‌ها ----------
$PFX_RUN cp "$BINARY" "$PREFIX/sanatify-mes" || { echo "✗ کپی باینری ناموفق"; exit 1; }
$PFX_RUN chmod +x "$PREFIX/sanatify-mes"
if [ -f "$BIN_DIR/SHA256SUMS.txt" ]; then
    $PFX_RUN cp "$BIN_DIR/SHA256SUMS.txt" "$PREFIX/SHA256SUMS.txt"
    echo "  ✓ SHA256SUMS.txt کنار باینری — ضد دستکاری SEC-ANTI-19g فعال"
else
    echo "  ✖⚠ SHA256SUMS.txt کنار باینری نیست! باینری بالا نخواهد آمد (SEC-ANTI-19g)."
fi
[ -f "$BIN_DIR/../tenant.json.template" ] && $PFX_RUN cp "$BIN_DIR/../tenant.json.template" "$PREFIX/tenant.json.template"
[ -f "$SELF_DIR/tenant.json.template" ] && $PFX_RUN cp "$SELF_DIR/tenant.json.template" "$PREFIX/tenant.json.template" 2>/dev/null || true

# ---------- سرویس ----------
RUNNING="no"
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1; then
    echo "  سرویس : systemd"
    $SUDO tee /etc/systemd/system/${SERVICE}.service > /dev/null <<UNIT
[Unit]
Description=Sanatify MES Server (Steel Manufacturing)
After=network.target

[Service]
Type=simple
WorkingDirectory=${PREFIX}
ExecStart=${PREFIX}/sanatify-mes
Environment=PORT=${PORT}
Restart=always
RestartSec=3
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
UNIT
    $SUDO systemctl daemon-reload
    $SUDO systemctl enable "${SERVICE}" >/dev/null 2>&1
    $SUDO systemctl restart "${SERVICE}"
    RUNNING="systemd"
else
    echo "  سرویس : systemd نیست → nohup + اسکریپت‌های start/stop"
    $PFX_RUN tee "$PREFIX/start.sh" > /dev/null <<START
#!/usr/bin/env bash
cd "${PREFIX}"
# GO-LIVE-32c: تزریق PORT — سرور فقط متغیر محیطی PORT را می‌خواند (server.js:18 — پرچم CLI ندارد)؛
# بدون این تزریق، مسیر nohup پورتِ انتخاب‌شده در --port را گم می‌کرد و روی 3001 پیش‌فرض می‌افتاد (یافتهٔ REHEARSAL-29).
env PORT="${PORT}" nohup ./sanatify-mes > "${PREFIX}/server.log" 2>&1 &
echo \$! > "${PREFIX}/server.pid"
echo "Sanatify MES شروع شد (PID \$(cat ${PREFIX}/server.pid)) — لاگ: ${PREFIX}/server.log"
START
    $PFX_RUN tee "$PREFIX/stop.sh" > /dev/null <<STOP
#!/usr/bin/env bash
if [ -f "${PREFIX}/server.pid" ]; then
    kill "\$(cat ${PREFIX}/server.pid)" 2>/dev/null && rm -f "${PREFIX}/server.pid" && echo "متوقف شد."
else
    pkill -f "${PREFIX}/sanatify-mes" && echo "متوقف شد (pkill)."
fi
STOP
    $PFX_RUN chmod +x "$PREFIX/start.sh" "$PREFIX/stop.sh"
    $PFX_RUN "$PREFIX/start.sh"
    RUNNING="nohup"
fi

# ---------- فایروال (اختیاری) ----------
if command -v ufw >/dev/null 2>&1; then
    $SUDO ufw allow "${PORT}/tcp" >/dev/null 2>&1 && echo "  فایروال: ufw allow ${PORT}/tcp ✓" || echo "  ⚠ ufw موجود ولی اعمال نشد (دستی: ufw allow ${PORT}/tcp)"
elif command -v iptables >/dev/null 2>&1; then
    $SUDO iptables -C INPUT -p tcp --dport "${PORT}" -j ACCEPT 2>/dev/null || $SUDO iptables -A INPUT -p tcp --dport "${PORT}" -j ACCEPT 2>/dev/null && echo "  فایروال: iptables ${PORT}/tcp ✓" || echo "  ⚠ iptables اعمال نشد (دستی اضافه کنید)"
else
    echo "  فایروال: ufw/iptables یافت نشد — اگر فعال است دستی پورت ${PORT}/tcp را باز کنید"
fi

# ---------- انتظار برای health ----------
echo -n "  health "
if [ -f "$PREFIX/tenant.json" ] || [ -f "$PREFIX/tenant.json.enc" ]; then
    OK="no"
    for i in $(seq 1 30); do
        if curl -s -m 2 "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '"ok":true'; then OK="yes"; break; fi
        echo -n "."
        sleep 1
    done
    echo
    if [ "$OK" = "yes" ]; then echo "  ✓ سرور روی پورت ${PORT} پاسخ می‌دهد (health: ok)"; else echo "  ✖ سرور بالا نیامد — لاگ: ${PREFIX}/server.log یا journalctl -u ${SERVICE}"; fi
else
    echo
    echo "  ℹ tenant.json امضاشده هنوز نیست ⇒ باینری تا کپی لایسنس بالا نمی‌آید (SEC-ANTI-19h — طبیعی و عمدی)."
    echo "    ادامهٔ راه در پایین: HWKEY را بفرستید → tenant.json بگیرید → در ${PREFIX} کپی → سرویس را start کنید."
fi

# ---------- HWKEY + راهنمای لایسنس ----------
HWKEY="$($PREFIX/sanatify-mes --print-hwkey 2>/dev/null | tail -1)"
echo "━━━ قفل سخت‌افزاری (SEC-BIND-19f) ━━━"
echo "  HWKEY این ماشین : ${HWKEY:-?}"
echo
echo "  گام بعدی (روی ماشین سازنده، tools/ نصب است):"
echo "    node tools/license.js --hwkey=${HWKEY:-HW-XXXX-XXXX-XXXX} --only=summary,production,inventory,quality,maintenance --expires=YYYY-MM-DD --sign --sign-ed"
echo "    → tenant.json امضاشده را کنار باینری ($PREFIX) کپی کنید و سرویس را ری‌استارت کنید:"
[ "$RUNNING" = "systemd" ] && echo "    sudo systemctl restart ${SERVICE}" || echo "    $PREFIX/stop.sh && $PREFIX/start.sh"
echo
echo "  مدیریت سرویس:"
if [ "$RUNNING" = "systemd" ]; then
    echo "    systemctl status|restart|stop ${SERVICE}   |   journalctl -u ${SERVICE} -f"
else
    echo "    ${PREFIX}/start.sh   |   ${PREFIX}/stop.sh   |   tail -f ${PREFIX}/server.log"
fi
echo "  وب اپ : http://<این-VM>:${PORT}"
echo "  حذف نصب : bash tools/uninstall.sh --prefix=${PREFIX}"
echo "━━━ نصب کامل شد ━━━"
