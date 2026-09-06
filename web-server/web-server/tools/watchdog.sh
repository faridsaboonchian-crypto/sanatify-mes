#!/usr/bin/env bash
# ===== HARDEN-18O: watchdog — نگهبان فرآیند سرور (صفر وابستگی) =====
# هر INTERVAL ثانیه health را چک می‌کند؛ به تعداد THRESHOLD پشت‌سرهم ناموفق ⇒ ری‌استارت خودکار + لاگ
# استفاده:
#   ./tools/watchdog.sh [PORT] [INTERVAL_SEC] [THRESHOLD]
#   PORT=3001 INTERVAL=30 THRESHOLD=2 ./tools/watchdog.sh
# توقف:  touch tools/watchdog.stop   (یا Ctrl+C) — اجرای همزمان دو نمونه با lockfile مسدود است
set -u
PORT="${PORT:-${1:-3001}}"
INTERVAL="${INTERVAL:-${2:-30}}"
THRESHOLD="${THRESHOLD:-${3:-2}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"           # web-server/web-server
LOG_DIR="$ROOT/logs"; LOG="$LOG_DIR/watchdog.log"; STOPFILE="$ROOT/tools/watchdog.stop"
PIDFILE="$ROOT/tools/watchdog.pid"
URL="http://127.0.0.1:$PORT/api/health"
mkdir -p "$LOG_DIR"
# قفل اتمیک — اجرای همزمان دو نمونه ممکن نیست
if ( set -o noclobber; echo $$ > "$PIDFILE" ) 2>/dev/null; then :; else
  echo "watchdog: نمونهٔ دیگری در حال اجراست (pidfile=$PIDFILE) — خروج."; exit 1
fi
trap 'rm -f "$PIDFILE"; exit 0' INT TERM
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $*" >> "$LOG"; echo "watchdog: $*"; }
log "watchdog start → $URL (interval=${INTERVAL}s threshold=$THRESHOLD) pid=$$"
fails=0
while true; do
  if [ -f "$STOPFILE" ]; then log "watchdog stop (stopfile)"; rm -f "$STOPFILE"; rm -f "$PIDFILE"; exit 0; fi
  code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$URL" 2>/dev/null)"
  [ -z "$code" ] && code='000'
  if [ "$code" = "200" ]; then
    if [ "$fails" -gt 0 ]; then log "health OK (HTTP 200) — $fails شکست قبلی پاک شد"; fi
    fails=0
  else
    fails=$((fails+1))
    log "health FAIL (code=$code) — شکست $fails از $THRESHOLD"
    if [ "$fails" -ge "$THRESHOLD" ]; then
      log "RESTART: سرور پاسخ نمی‌دهد ($THRESHOLD بار پشت‌سرهم) — اجرای مجدد"
      pkill -f "node server.js" 2>/dev/null && log "process قدیمی kill شد" || true
      sleep 1
      ( cd "$ROOT" && PORT="$PORT" nohup node server.js >> "$LOG_DIR/server-stdout.log" 2>&1 & )
      log "RESTART: دستور اجرا شد — بررسی بعدی ${INTERVAL}s دیگر"
      fails=0
    fi
  fi
  sleep "$INTERVAL"
done
