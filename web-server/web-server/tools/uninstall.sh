#!/usr/bin/env bash
# =====================================================================
# DEPLOY-19h — حذف نصب Sanatify MES (متقارن با install.sh)
#
# مصرف:
#   sudo bash tools/uninstall.sh [--prefix=/opt/sanatify] [--keep-data]
#   --keep-data : live.json/audit.json/بکاپ‌ها در $PREFIX می‌ماند (فقط باینری/سرویس حذف)
# =====================================================================
set -u
PREFIX="/opt/sanatify"
SERVICE="sanatify-mes"
KEEP_DATA="no"
for arg in "$@"; do
    case "$arg" in
        --prefix=*) PREFIX="${arg#--prefix=}" ;;
        --keep-data) KEEP_DATA="yes" ;;
        --help|-h) sed -n '2,8p' "$0"; exit 0 ;;
        *) echo "✗ آرگومان ناشناخته: $arg"; exit 1 ;;
    esac
done
echo "━━━ DEPLOY-19h — حذف نصب Sanatify MES از $PREFIX ━━━"

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then SUDO="sudo"; fi
fi
PFX_RUN=""
[ -d "$PREFIX" ] && [ ! -w "$PREFIX" ] && PFX_RUN="$SUDO"

# ---------- توقف سرویس ----------
if [ -d /run/systemd/system ] && command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"; then
    echo "  systemd: توقف + غیرفعال‌سازی ${SERVICE}"
    $SUDO systemctl stop "${SERVICE}" 2>/dev/null
    $SUDO systemctl disable "${SERVICE}" >/dev/null 2>&1
    $SUDO rm -f "/etc/systemd/system/${SERVICE}.service"
    $SUDO systemctl daemon-reload
    echo "  ✓ unit حذف شد"
elif [ -f "$PREFIX/stop.sh" ]; then
    echo "  nohup: توقف با stop.sh"
    $PFX_RUN bash "$PREFIX/stop.sh" 2>/dev/null || $PFX_RUN pkill -f "$PREFIX/sanatify-mes" 2>/dev/null || true
fi
pkill -f "$PREFIX/sanatify-mes" 2>/dev/null && sleep 1 || true

# ---------- فایروال (اگر نصب‌کننده اضافه کرده) ----------
if command -v ufw >/dev/null 2>&1; then
    $SUDO ufw delete allow 3001/tcp >/dev/null 2>&1 && echo "  فایروال: ufw 3001/tcp حذف شد"
fi

# ---------- فایل‌ها ----------
if [ -d "$PREFIX" ]; then
    if [ "$KEEP_DATA" = "yes" ]; then
        echo "  --keep-data: باینری/اسکریپت‌ها حذف، داده‌ها (live.json/audit.json/...) می‌ماند"
        $PFX_RUN rm -f "$PREFIX/sanatify-mes" "$PREFIX/SHA256SUMS.txt" "$PREFIX/tenant.json.template" "$PREFIX/start.sh" "$PREFIX/stop.sh" "$PREFIX/server.pid" "$PREFIX/server.log"
        echo "  داده‌ها در $PREFIX باقی است (حذف دستی: rm -rf $PREFIX)"
    else
        echo "  ⚠ حذف کامل $PREFIX (شامل داده‌ها) در ۵ ثانیه… Ctrl+C برای انصراف"
        sleep 5
        $PFX_RUN rm -rf "$PREFIX"
        echo "  ✓ $PREFIX حذف شد"
    fi
else
    echo "  $PREFIX موجود نیست — کاری نکرد"
fi
echo "━━━ حذف نصب کامل شد ━━━"
