#!/usr/bin/env bash
# =====================================================================
# REHEARSAL-29 — ابزار تمرین دمو تک‌دستوری (معادل لینوکسی tools/rehearse.ps1)
#
# هدف: سازنده قبل از اولین نصب واقعی روی VM مشتری، کل سناریوی «نصب» را روی
#      ماشین خودش، در پوشهٔ جدا و پورت جدا (3101) شبیه‌سازی و اثبات می‌کند.
#      در پایان جدول PASS/FAIL + فایل «چک‌لیست روز نصب.md» تحویل می‌دهد.
#
# مصرف:
#   bash tools/rehearse.sh [--dir=$HOME/sanatify-rehearsal] [--keep]
#   --dir=...   پوشهٔ تمرین (پیش‌فرض ~/sanatify-rehearsal — در ویندوز معادل: D:\sanatify-rehearsal)
#   --keep      پوشه‌های سناریوها (s3/s4/s5/s6) پاک نشوند
#
# مسیر تمرین (مثل روز نصب واقعی):
#   باینری dist/ → install.sh (نصب کامل در $RH/installed، پورت 3101) → HWKEY →
#   امضای tenant با demo_mode → tenant.json + license.key کنار باینری → start → پذیرش → demo-seed
#
# ایمنی مطلق (قرمز):
#   • هرگز به استقرار اصلی (web-server/web-server) نوشتن نمی‌شود — فقط خواندن
#     (باینری dist/، قالب tenant، گواهی‌ها، license.key، ابزارها).
#   • همه‌چیز در پوشهٔ تمرین و روی پورت 3101 ساخته می‌شود؛ استقرار اصلی پورت 3001.
#   • در پایان، هش server.js/index.html/sw.js با شروع مقایسه می‌شود (نگهبان داخلی).
#
# کلیدهای امضا (مثل روز نصب واقعی — فقط برای «امضا»؛ بوت‌ها عمداً بدون env = بوت سرد):
#   SANATIFY_LIC_ED_PRIV  — کلید خصوصی Ed25519 سازنده (الزامی برای امضا)
#   SANATIFY_LIC_KEY      — کلید HMAC (اگر نبود license.key موجود کپی/استفاده می‌شود)
#
# ⚠ این اسکریپت روی لینوکس/سندباکس اثبات شده؛ تست نهایی روی ویندوز سازنده با
#   tools/rehearse.ps1 انجام می‌شود (همان سناریوها، همان ترتیب).
# =====================================================================
set -u

export PORT=3101
BASE="http://127.0.0.1:${PORT}"
RH="$HOME/sanatify-rehearsal"
KEEP=0
for arg in "$@"; do
    case "$arg" in
        --dir=*) RH="${arg#--dir=}" ;;
        --keep) KEEP=1 ;;
        --help|-h) sed -n '2,32p' "$0"; exit 0 ;;
        *) echo "✗ آرگومان ناشناخته: $arg (ببینید: bash tools/rehearse.sh --help)"; exit 2 ;;
    esac
done

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"   # tools/
WEB="$(cd "$SELF_DIR/.." && pwd)"           # web-server/web-server — فقط خواندن
DIST_BIN_DIR="$WEB/dist/bin"
BIN_NAME="sanatify-mes-node18-linux-x64"
RD="${RH}/installed"                        # ریشهٔ سرور نصب‌شده (ROOT باینری = کنارش)

pass=0
fail=0
TABLE=()
PIDS=""

step() { echo; echo "━━━ $* ━━━"; }
rec() {
    local st="$1" id="$2" msg="$3"
    if [ "$st" = "PASS" ]; then pass=$((pass+1)); else fail=$((fail+1)); fi
    TABLE+=("[${st}] ${id} — ${msg}")
    if [ "$st" = "PASS" ]; then echo "  ✓ PASS ${id} — ${msg}"; else echo "  ✖ FAIL ${id} — ${msg}"; fi
}
die() {
    echo "✖ $*" >&2
    echo
    echo "راهنمای سریع:"
    echo "  • کلیدها را در همان شل ست کنید:  export SANATIFY_LIC_ED_PRIV=... SANATIFY_LIC_KEY=..."
    echo "  • کلید خصوصی Ed ندارید؟ روی ماشین سازنده:  node tools/license.js --gen-ed-keys --out=lic-ed-keys.json"
    echo "  • پوشهٔ دیگر:  bash tools/rehearse.sh --dir=/مسیر/دیگر"
    cleanup
    exit 2
}
cleanup() {
    if [ -f "${RD}/stop.sh" ]; then ( cd "${RD}" && bash stop.sh ) >/dev/null 2>&1; fi
    for p in $PIDS; do kill "$p" 2>/dev/null; done
    for pf in "${RH}"/logs/*.pid "${RD}"/server.pid; do
        [ -f "$pf" ] && kill "$(cat "$pf")" 2>/dev/null
    done
}
trap cleanup EXIT INT TERM

wait_health() {
    local deadline=$((SECONDS + 90))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if curl -s -m 2 "${BASE}/api/health" 2>/dev/null | grep -q '"ok":true'; then return 0; fi
        sleep 0.8
    done
    return 1
}
# شروع/توقف «سرویس» اصلی تمرین — عیناً با اسکریپت‌های تولیدشدهٔ install.sh (مسیر واقعی روز نصب)
# بوت «بوت سرد»: سرور هرگز env کلیدها را نمی‌بیند — verify فقط با license.key + Ed embedded
start_main_server() {
    ( cd "${RD}" && env -u SANATIFY_LIC_KEY -u SANATIFY_LIC_ED_PRIV PORT="${PORT}" bash start.sh ) >/dev/null 2>&1
}
stop_main_server() {
    if [ -f "${RD}/stop.sh" ]; then ( cd "${RD}" && bash stop.sh ) >/dev/null 2>&1; fi
    local i=0
    while [ ${i} -lt 20 ]; do
        curl -s -m 1 "${BASE}/api/health" >/dev/null 2>&1 || return 0
        i=$((i+1))
        sleep 0.5
    done
}
# بوت‌های سناریویی (پوشه‌های دستی s3/s4/s5) — pidfile درست (نه زیرپوسته)
boot_bg() { # boot_bg <dir> <logfile> <pidfile> <cmd...>
    local d="$1" log="$2" pidf="$3"
    shift 3
    (
        cd "${d}" || exit 1
        nohup env -u SANATIFY_LIC_KEY -u SANATIFY_LIC_ED_PRIV PORT="${PORT}" "$@" > "${log}" 2>&1 &
        echo $! > "${pidf}"
    )
    PIDS="${PIDS} $(cat "${pidf}")"
}
stop_server() { # stop_server <pidfile> — توقف و انتظار برای آزادشدن پورت
    local pf="$1"
    if [ -f "${pf}" ]; then kill "$(cat "${pf}")" 2>/dev/null; fi
    local i=0
    while [ ${i} -lt 20 ]; do
        curl -s -m 1 "${BASE}/api/health" >/dev/null 2>&1 || return 0
        i=$((i+1))
        sleep 0.5
    done
}
# امضا — کلیدها فقط برای همین دستور (env پدر همیشه تمیز می‌ماند ⇒ بوت‌ها سرد هستند)
sign_tenant() { # sign_tenant <dir> <args license.js...>
    local d="$1"
    shift
    local envs=( SANATIFY_LIC_ED_PRIV="${EDPRIV}" )
    [ -n "${HMACK}" ] && envs+=( SANATIFY_LIC_KEY="${HMACK}" )
    ( cd "${d}" && env "${envs[@]}" node tools/license.js "$@" )
}

# ══════════════════════════════════════════════════════════════════
step "۰) ایمنی و پیش‌نیازها — پورت ${PORT}، پوشهٔ تمرین جدا"
# ══════════════════════════════════════════════════════════════════
command -v node >/dev/null 2>&1 || die "node پیدا نشد — Node.js 18+ لازم است (بیلد/امضا/کمک‌ابزارها با node اجرا می‌شوند)"
command -v curl >/dev/null 2>&1 || die "curl پیدا نشد"
command -v timeout >/dev/null 2>&1 || die "timeout (coreutils) پیدا نشد"
mkdir -p "${RH}/logs" || die "ساخت پوشهٔ تمرین ناموفق: ${RH}"

# نگهبان قرمز — هش فایل‌های حیاتی استقرار اصلی، قبل از هر کاری
GUARD_BEFORE=""
for gf in server.js public/index.html public/sw.js; do
    GUARD_BEFORE="${GUARD_BEFORE}$(sha256sum "${WEB}/${gf}" | cut -d' ' -f1)"
done

# کلیدها — مثل روز نصب (فقط در متغیر ابزار؛ هرگز export نمی‌شوند)
EDPRIV="${SANATIFY_LIC_ED_PRIV:-}"
HMACK="${SANATIFY_LIC_KEY:-}"
# تحمل اشتباه رایج: کل «کلید=مقدار» چسبیده paste شده باشد
case "${EDPRIV}" in
    SANATIFY_LIC_ED_PRIV=*) EDPRIV="${EDPRIV#SANATIFY_LIC_ED_PRIV=}"; echo "  ⚠ کلید Ed با پیشوند «SANATIFY_LIC_ED_PRIV=» چسبیده بود — خودکار جدا شد" ;;
esac
case "${HMACK}" in
    SANATIFY_LIC_KEY=*) HMACK="${HMACK#SANATIFY_LIC_KEY=}"; echo "  ⚠ کلید HMAC با پیشوند «SANATIFY_LIC_KEY=» چسبیده بود — خودکار جدا شد" ;;
esac
if [ -z "${EDPRIV}" ]; then
    die "SANATIFY_LIC_ED_PRIV تنظیم نیست — امضای Ed25519 مسیر اصلی است و بدون آن تمرین معنا ندارد.
  نمونه:  export SANATIFY_LIC_ED_PRIV=\"...\"  (خروجی tools/license.js --gen-ed-keys)"
fi
if [ -n "${HMACK}" ]; then
    echo "  کلید HMAC : env (license.key تازه کنار باینری تمرین ساخته می‌شود)"
elif [ -f "${RD}/license.key" ] || [ -f "${RH}/license.key" ]; then
    echo "  کلید HMAC : license.key موجود در پوشهٔ تمرین (اجرای قبلی)"
elif [ -f "${WEB}/license.key" ]; then
    cp -f "${WEB}/license.key" "${RH}/license.key" && echo "  کلید HMAC : license.key استقرار اصلی کپی شد (فقط‌خواندن از اصلی)"
else
    die "هیچ منبع کلید HMAC نیست — نه env: SANATIFY_LIC_KEY و نه license.key (کنار server.js یا پوشهٔ تمرین)"
fi

# پورت اشغال؟ (اجرای قبلی تمرین = توقف؛ سرویس دیگر = خطا)
if curl -s -m 1 "${BASE}/api/health" >/dev/null 2>&1; then
    cleanup
    sleep 1
    if curl -s -m 1 "${BASE}/api/health" >/dev/null 2>&1; then
        die "پورت ${PORT} اشغال سرویس دیگری است — تمرین همیشه روی ${PORT} است؛ ابتدا آن سرویس را متوقف کنید"
    fi
fi
echo "  ✓ پیش‌نیازها سبز است"

# ══════════════════════════════════════════════════════════════════
step "۱) باینری تمرین (معادل exe) — dist/ نبود ⇒ بیلد حفاظت‌شده"
# ══════════════════════════════════════════════════════════════════
BIN="${DIST_BIN_DIR}/${BIN_NAME}"
SUMS="${DIST_BIN_DIR}/SHA256SUMS.txt"
if [ ! -f "${BIN}" ]; then
    echo "  بیلد شروع شد (چند دقیقه)…"
    ( cd "${SELF_DIR}" && node build-protected.js --compile --target=node18-linux-x64 ) || die "بیلد حفاظت‌شده ناموفق بود"
fi
[ -f "${BIN}" ] || die "باینری پیدا/ساخته نشد: ${BIN}"
[ -f "${SUMS}" ] || die "SHA256SUMS.txt کنار باینری نیست — الزام SEC-ANTI-19g (بوت بدون آن متوقف است)"
echo "  ✓ باینری: ${BIN}"

# ══════════════════════════════════════════════════════════════════
step "۱٫۵) شبیه‌سازی نصب روی VM مشتری — با install.sh خودِ پروژه (پورت ${PORT})"
# ══════════════════════════════════════════════════════════════════
bash "${SELF_DIR}/install.sh" "${BIN}" "--prefix=${RD}" "--port=${PORT}" > "${RH}/logs/install.log" 2>&1 \
    || die "install.sh ناموفق بود — لاگ: ${RH}/logs/install.log"
[ -x "${RD}/sanatify-mes" ] || die "باینری نصب نشد: ${RD}/sanatify-mes"
[ -f "${RD}/SHA256SUMS.txt" ] || die "نصب بدون SHA256SUMS.txt — الزام SEC-ANTI-19g"
if grep -q 'HWKEY این ماشین' "${RH}/logs/install.log"; then
    echo "  ✓ install.sh کامل: باینری + مانیفست + قالب + سرویس nohup + چاپ HWKEY"
    echo "  ℹ بوت اولیه بدون tenant عمداً متوقف شده (SEC-ANTI-19h) — مثل VM واقعی؛ ادامه با امضا."
else
    echo "  ✓ install.sh کامل شد (لاگ: ${RH}/logs/install.log)"
fi

# ══════════════════════════════════════════════════════════════════
step "۲) پوشهٔ تمرین — داده‌های نصب کنار باینری در ${RD}"
# ══════════════════════════════════════════════════════════════════
mkdir -p "${RD}/tools" "${RH}/certs"
if [ -f "${WEB}/cert.pem" ] && [ -f "${WEB}/key.pem" ]; then
    cp -f "${WEB}/cert.pem" "${RH}/certs/cert.pem"
    cp -f "${WEB}/key.pem" "${RH}/certs/key.pem"
    echo "  گواهی : cert/key در ${RH}/certs/ کپی شد"
    echo "  ⚠ در تمرین گواهی عمداً کنار باینری گذاشته نمی‌شود (demo-seed فقط-HTTP است)؛"
    echo "    در نصب واقعی cert/key کنار exe می‌روند ⇒ سرویس خودکار HTTPS می‌شود."
else
    echo "  گواهی : در استقرار اصلی نبود — تمرین روی HTTP (مثل نصب بدون گواهی)"
fi

# live.json تازهٔ خالی — شکل دقیق emptyDataset سرور (صفر دادهٔ واقعی مشتری)
node -e 'const t={generated_at:null,production_logs:[],waste_logs:[],downtime_logs:[],quality_inspections:[],billets:[],furnace_logs:[],rebar_bundles:[]};require("fs").writeFileSync(process.argv[1],JSON.stringify(t,null,2));' "${RD}/live.json" || die "ساخت live.json خالی ناموفق"

# web-users.json تازه — فقط یک ادمین موقت با رمز تصادفی (هش scrypt عیناً مثل auth.js)
PW="$( cd "${RD}" && node -e 'const c=require("crypto"),f=require("fs");const ab="abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";let p="";const b=c.randomBytes(14);for(const x of b){p+=ab[x%ab.length];}const salt=c.randomBytes(16);const key=c.scryptSync(p,salt,64,{N:16384,r:8,p:1});const u=[{username:"admin",role:"admin",name:"\u0645\u062f\u06cc\u0631 \u062a\u0645\u0631\u06cc\u0646 \u062f\u0645\u0648",password_hash:"scrypt$16384$8$1$"+salt.toString("base64")+"$"+key.toString("base64")}];f.writeFileSync("web-users.json",JSON.stringify(u,null,2));console.log(p);' )"
[ -n "${PW}" ] || die "ساخت کاربر ادمین موقت ناموفق"
echo "  کاربر موقت: admin / رمز: ${PW}"

# tenant.json از قالب (هرگز tenant واقعی مشتری) + demo_mode=true + امضای کامل Ed+HMAC
TPL="${RD}/tenant.json.template"
[ -f "${TPL}" ] || TPL="${WEB}/tenant.json.template"
cp -f "${TPL}" "${RD}/tenant.json" || die "کپی قالب tenant ناموفق"
node -e 'const f=require("fs");const p=process.argv[1];const j=JSON.parse(f.readFileSync(p,"utf8"));j.demo_mode=true;f.writeFileSync(p,JSON.stringify(j,null,2));' "${RD}/tenant.json" || die "ست‌کردن demo_mode ناموفق"
cp -f "${SELF_DIR}/license.js" "${RD}/tools/license.js" || die "کپی license.js ناموفق"
echo "  امضای tenant (رونوشت محلی license.js ⇒ همه‌نوشتن‌ها داخل پوشهٔ تمرین)…"
sign_tenant "${RD}" --tenant=sanatify --name='تمرین دمو — صنعتی فای' --max-users=25 --max-records=200000 --sign \
    || die "امضای tenant ناموفق — پیام بالا را ببینید"
node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));if(!j.demo_mode||!j.license_sig2||!j.license_sig){console.error("✖ امضای تمرین ناقص است (sig/sig2/demo_mode)");process.exit(1);}' "${RD}/tenant.json" \
    || die "راستی‌آزمایی امضای tenant ناموفق"
[ -f "${RD}/license.key" ] || die "license.key کنار باینری تمرین ساخته/موجود نیست — بوت سرد معتبر نخواهد بود"
echo "  ✓ tenant.json امضاشده + license.key + live.json خالی + web-users.json تازه"

{
    echo "اعتبارنامهٔ موقت تمرین دمو — REHEARSAL-29 — $(date '+%Y-%m-%d %H:%M')"
    echo "  کاربر : admin"
    echo "  رمز   : ${PW}"
    echo "  پوشهٔ تمرین : ${RD}   (پورت ${PORT} — HTTP)"
    echo "  ⚠ پس از دمو واقعی روی VM مشتری این رمز عوض شود."
} > "${RH}/rehearsal-credentials.txt"

# ══════════════════════════════════════════════════════════════════
step "S1) بوت سالم روی ${PORT} + بنر دمو + قفل مالی + بوت سرد (بدون env)"
# ══════════════════════════════════════════════════════════════════
start_main_server
if wait_health; then
    rec "PASS" "S1-boot" "health 200 روی پورت ${PORT} (سرویس نصب‌شده با start.sh)"
else
    rec "FAIL" "S1-boot" "بوت/health ناموفق — لاگ: ${RD}/server.log"
fi
if grep -q 'معتبر ✓' "${RD}/server.log" 2>/dev/null; then
    rec "PASS" "S1-lic" "بوت سرد بدون env ⇒ «وضعیت لایسنس: معتبر ✓» (Ed25519 embedded / license.key)"
else
    rec "FAIL" "S1-lic" "خط «معتبر ✓» در لاگ بوت نیست — ${RD}/server.log"
fi
TENCFG="$(curl -s -m 5 "${BASE}/api/tenant/config")"
if echo "${TENCFG}" | grep -q '"demo_mode":true'; then
    rec "PASS" "S1-demoapi" "config (عمومی): demo_mode=true سمت سرور"
else
    rec "FAIL" "S1-demoapi" "demo_mode در config نیست: $(echo "${TENCFG}" | head -c 120)"
fi
LOGIN1="$(curl -s -m 5 -H "Origin: ${BASE}" -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"${PW}\"}" -c "${RH}/logs/cookie.txt" "${BASE}/api/auth/login")"
if echo "${LOGIN1}" | grep -q '"ok":true' && curl -s -m 5 -b "${RH}/logs/cookie.txt" "${BASE}/" 2>/dev/null | grep -q 'demoBanner19d'; then
    rec "PASS" "S1-banner" "ورود ادمین موقت + بنر دمو (demoBanner19d) در پوستهٔ اپ حاضر است"
else
    rec "FAIL" "S1-banner" "بنر دمو در پوستهٔ اپ یافت نشد / ورود ناموفق — $(echo "${LOGIN1}" | head -c 100)"
fi
C403="$(curl -s -o /dev/null -w '%{http_code}' -m 5 "${BASE}/api/finance")"
if [ "${C403}" = "403" ]; then
    rec "PASS" "S1-finance403" "API مالی → 403 (گیت دمو — مالی مشتری در سپیدار)"
else
    rec "FAIL" "S1-finance403" "API مالی → ${C403} (انتظار 403)"
fi

# ══════════════════════════════════════════════════════════════════
step "S2) demo-seed روی ${PORT} → KPI غیرصفر"
# ══════════════════════════════════════════════════════════════════
if ( cd "${SELF_DIR}" && node demo-seed.js --url="${BASE}" --user=admin --pass="${PW}" --days=30 --bundles=50 --stops=10 --pms=5 > "${RH}/logs/s2-seed.log" 2>&1 ); then
    rec "PASS" "S2-seed" "demo-seed اجرا شد (لاگ: logs/s2-seed.log)"
else
    rec "FAIL" "S2-seed" "demo-seed ناموفق — ${RH}/logs/s2-seed.log"
fi
SUMMARY="$(curl -s -m 5 -b "${RH}/logs/cookie.txt" "${BASE}/api/summary")"
KPI="$(node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);console.log((Number(j.production_30d)||0)+(Number(j.bundle_count)||0));}catch(e){console.log(0);}});' <<<"${SUMMARY}")"
if [ "${KPI:-0}" -gt 0 ] 2>/dev/null; then
    rec "PASS" "S2-kpi" "KPI غیرصفر (تولید۳۰روز + بندیل = ${KPI})"
else
    rec "FAIL" "S2-kpi" "KPI صفر/نامعتبر: $(echo "${SUMMARY}" | head -c 120)"
fi
# پایان سهم سرور اصلی تمرین — پورت برای سناریوهای بعد آزاد می‌شود
stop_main_server

# ══════════════════════════════════════════════════════════════════
step "S3) tenant موقت با hwkey غلط → exit 1 + پیام فارسی قفل سخت‌افزاری"
# ══════════════════════════════════════════════════════════════════
S3="${RH}/s3-wrong-hwkey"
rm -rf "${S3}"; mkdir -p "${S3}/tools"
cp -f "${RD}/sanatify-mes" "${S3}/"; cp -f "${RD}/SHA256SUMS.txt" "${S3}/"
cp -f "${RD}/tenant.json" "${S3}/tenant.json"
cp -f "${SELF_DIR}/license.js" "${S3}/tools/"
[ -f "${RD}/license.key" ] && cp -f "${RD}/license.key" "${S3}/license.key"
if sign_tenant "${S3}" --hwkey=HW-0000-0000-0000 --sign > "${RH}/logs/s3-sign.log" 2>&1; then
    timeout 120 bash -c "cd '${S3}' && ./sanatify-mes" > "${RH}/logs/s3.log" 2>&1
    EX3=$?
    if [ "${EX3}" -eq 1 ] && grep -q 'SEC-BIND-19f' "${RH}/logs/s3.log"; then
        rec "PASS" "S3" "exit=1 + پیام قفل سخت‌افزاری (HW-0000-0000-0000 رد شد — سرور هرگز گوش نداد)"
    else
        rec "FAIL" "S3" "exit=${EX3} (انتظار 1) یا پیام SEC-BIND-19f در لاگ نیست — logs/s3.log"
    fi
else
    rec "FAIL" "S3" "امضای tenant با hwkey غلط ناموفق — logs/s3-sign.log"
fi

# ══════════════════════════════════════════════════════════════════
step "S4) hwkey صحیح همین ماشین → بوت سالم"
# ══════════════════════════════════════════════════════════════════
HWKEY="$( "${RD}/sanatify-mes" --print-hwkey 2>/dev/null | tail -1 | tr -d '\r' )"
if printf '%s' "${HWKEY}" | grep -qE '^HW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'; then
    echo "  HWKEY ماشین تمرین: ${HWKEY}"
    S4="${RH}/s4-own-hwkey"
    rm -rf "${S4}"; mkdir -p "${S4}/tools"
    cp -f "${RD}/sanatify-mes" "${S4}/"; cp -f "${RD}/SHA256SUMS.txt" "${S4}/"
    cp -f "${RD}/tenant.json" "${S4}/tenant.json"
    cp -f "${SELF_DIR}/license.js" "${S4}/tools/"
    [ -f "${RD}/license.key" ] && cp -f "${RD}/license.key" "${S4}/license.key"
    if sign_tenant "${S4}" --hwkey="${HWKEY}" --sign > "${RH}/logs/s4-sign.log" 2>&1; then
        boot_bg "${S4}" "${RH}/logs/s4.log" "${RH}/logs/s4.pid" ./sanatify-mes
        if wait_health; then
            if grep -q 'معتبر ✓' "${RH}/logs/s4.log" 2>/dev/null; then
                rec "PASS" "S4" "بوت سالم با قفل HWKEY همین ماشین (${HWKEY}) + لایسنس معتبر"
            else
                rec "FAIL" "S4" "health OK ولی خط «معتبر ✓» در لاگ نیست — logs/s4.log"
            fi
        else
            rec "FAIL" "S4" "بوت با hwkey صحیح ناموفق — logs/s4.log"
        fi
        stop_server "${RH}/logs/s4.pid"
    else
        rec "FAIL" "S4" "امضای tenant با hwkey ماشین ناموفق — logs/s4-sign.log"
    fi
else
    rec "FAIL" "S4" "خواندن HWKEY ماشین ناموفق (خروجی: '${HWKEY}')"
fi

# ══════════════════════════════════════════════════════════════════
step "S5) دستکاری max_users → لایسنس پایه (بوت سورس) + doctor کد مرتبط"
# ══════════════════════════════════════════════════════════════════
S5="${RH}/s5-tamper"
rm -rf "${S5}"; mkdir -p "${S5}"
cp -f "${WEB}/dist/server.js" "${S5}/server.js" 2>/dev/null
cp -f "${WEB}/dist/auth.js" "${S5}/auth.js" 2>/dev/null
cp -f "${WEB}/dist/package.json" "${S5}/package.json" 2>/dev/null
if [ -f "${S5}/server.js" ]; then
    cp -f "${RD}/tenant.json" "${S5}/tenant.json"
    cp -f "${RD}/web-users.json" "${S5}/web-users.json"   # برای ورود و آزمون گیت ماژول در سرور تازه (نشست‌ها حافظه‌ای‌اند)
    node -e 'const f=require("fs");const p=process.argv[1];const j=JSON.parse(f.readFileSync(p,"utf8"));j.max_users=99999;f.writeFileSync(p,JSON.stringify(j,null,2));' "${S5}/tenant.json"
    boot_bg "${S5}" "${RH}/logs/s5.log" "${RH}/logs/s5.pid" node server.js
    if wait_health; then
        rec "PASS" "S5-boot" "سرور سورس با tenant دستکاری‌شده بالا آمد (health 200) — فروپاشی نه، لایسنس پایه"
    else
        rec "FAIL" "S5-boot" "بوت سورس با tenant دستکاری‌شده ناموفق — logs/s5.log"
    fi
    if grep -q 'نامعتبر ✗' "${RH}/logs/s5.log" 2>/dev/null; then
        rec "PASS" "S5-log" "خودآزمایی بوت: «وضعیت لایسنس: نامعتبر ✗» با علت دقیق"
    else
        rec "FAIL" "S5-log" "خط «نامعتبر ✗» در لاگ بوت نیست — logs/s5.log"
    fi
    LOGIN5="$(curl -s -m 5 -H "Origin: ${BASE}" -H 'Content-Type: application/json' -d "{\"username\":\"admin\",\"password\":\"${PW}\"}" -c "${RH}/logs/cookie-s5.txt" "${BASE}/api/auth/login")"
    A403="$(curl -s -o /dev/null -w '%{http_code}' -m 5 -b "${RH}/logs/cookie-s5.txt" "${BASE}/api/analytics")"
    if [ "${A403}" = "403" ]; then
        rec "PASS" "S5-gate" "analytics با لایسنس پایه → 403 (فقط summary/production/inventory باز است)"
    else
        rec "FAIL" "S5-gate" "analytics → ${A403} (انتظار 403 در لایسنس پایه) — ورود: $(echo "${LOGIN5}" | head -c 80)"
    fi
    ( cd "${SELF_DIR}" && node license-doctor.js "--dir=${S5}" ; echo $? > "${RH}/logs/s5-doctor.exit" ) > "${RH}/logs/s5-doctor.log" 2>&1
    DOC="$(cat "${RH}/logs/s5-doctor.exit" 2>/dev/null || echo '?')"
    if [ "${DOC}" -ge 10 ] 2>/dev/null && [ "${DOC}" -le 16 ] 2>/dev/null; then
        rec "PASS" "S5-doctor" "license-doctor کد ${DOC} داد (انتظار: 13 = امضای Ed نامعتبر) — گزارش: logs/s5-doctor.log"
    else
        rec "FAIL" "S5-doctor" "doctor کد ${DOC} داد (انتظار 10..16) — logs/s5-doctor.log"
    fi
    stop_server "${RH}/logs/s5.pid"
else
    rec "FAIL" "S5" "نسخهٔ dist/server.js برای سناریوی سورس پیدا نشد — اول بیلد را اجرا کنید"
fi

# ══════════════════════════════════════════════════════════════════
step "S6) کپی باینری تنها (بدون SHA256SUMS/tenant/license.key) → رفتار مستند"
# ══════════════════════════════════════════════════════════════════
S6="${RH}/s6-naked-exe"
rm -rf "${S6}"; mkdir -p "${S6}"
cp -f "${RD}/sanatify-mes" "${S6}/"
timeout 120 bash -c "cd '${S6}' && ./sanatify-mes" > "${RH}/logs/s6.log" 2>&1
EX6=$?
if [ "${EX6}" -eq 1 ] && grep -qE 'SHA256SUMS|tenant' "${RH}/logs/s6.log"; then
    rec "PASS" "S6" "exit=1 — رفتار مستند: باینری تنها بالا نمی‌آید ($(grep -m1 -oE 'antitamper\.[a-z_]+|hwbind\.[a-z_]+' "${RH}/logs/s6.log" || echo 'پیام فارسی'))"
else
    rec "FAIL" "S6" "exit=${EX6} (انتظار 1) یا پیام مستند در لاگ نیست — logs/s6.log"
fi

# ══════════════════════════════════════════════════════════════════
step "جدول نتایج — REHEARSAL-29"
# ══════════════════════════════════════════════════════════════════
for line in "${TABLE[@]}"; do echo "  ${line}"; done
echo
echo "  جمع: ${pass} PASS / ${fail} FAIL"

# ══════════════════════════════════════════════════════════════════
step "نوشتن «چک‌لیست روز نصب.md»"
# ══════════════════════════════════════════════════════════════════
CHECKLIST="${RH}/چک‌لیست روز نصب.md"
cat > "${CHECKLIST}" <<'CHECKLIST_EOF'
# ✅ چک‌لیست روز نصب — Sanatify MES (فولاد)

> همین صفحه را چاپ کنید و روز نصب گام‌به‌گام جلو بروید.
> ⚠ دو قانون طلایی: (۱) باینری همیشه با SHA256SUMS.txt کنارش است؛ (۲) tenant.json + license.key همیشه کنار exe هستند.

## الف) شب قبل — روی ماشین سازنده
- [ ] ۱. بیلد نهایی: `node tools/build-protected.js --compile --target=node18-win-x64 --package`
- [ ] ۲. کلید خصوصی امضا را چک کنید: `SANATIFY_LIC_ED_PRIV` (مدیر رمز) — بدون آن امضا ممکن نیست
- [ ] ۳. تمرین کامل: `powershell -ExecutionPolicy Bypass -File tools\rehearse.ps1` ⇒ همهٔ S1..S6 = PASS
- [ ] ۴. خروجی `dist-deploy/` (یا `dist/`) را روی فلش/شبیه‌سرور کپی کنید

## ب) صبح نصب — روی VM مشتری
- [ ] ۵. پوشهٔ مقصد (مثلاً `C:\SanatifyMES`) بسازید و کپی کنید: **exe + SHA256SUMS.txt** (این دو همیشه کنار هم)
- [ ] ۶. گواهی HTTPS (در صورت داشتن cert.pem/key.pem) کنار exe — سرویس خودکار HTTPS می‌شود
- [ ] ۷. نصب سرویس/استارتاپ: `install.ps1` (سرویس sc.exe) یا Startup→wscript→bat
      ⚠ کلیدها/env را در سطح سرویس ست کنید نه فقط شل دستی (بخش ۹ README-DEPLOY — چک‌لیست بوت سرد)
- [ ] ۸. سرویس را یک‌بار اجرا کنید → در کنسول/لاگ خط **«HWKEY ماشین»** را بردارید
      (میانبر: `sanatify-mes-node18-win-x64.exe --print-hwkey`)

## ج) امضا — روی ماشین سازنده
- [ ] ۹. با HWKEY مرحله ۸ امضا بزنید:
      `set SANATIFY_LIC_KEY=... & set SANATIFY_LIC_ED_PRIV=...`
      `node tools\license.js --hwkey=<HWKEY-VM> --only=summary,production,inventory,quality,maintenance --expires=YYYY-MM-DD --sign`
- [ ] ۱۰. دو فایل را کنار exe روی VM کپی کنید: **tenant.json + license.key**
- [ ] ۱۱. سرویس را ری‌استارت کنید (یا `stop.bat`/`start.bat`)

## د) پذیرش — روی VM مشتری
- [ ] ۱۲. کنسول/لاگ: خط **«وضعیت لایسنس : معتبر ✓»** — اگر نه: `node tools\license-doctor.js --dir="C:\SanatifyMES"`
- [ ] ۱۳. مرورگر: `https://<VM>:3001` → بنر دمو + ورود admin + KPI
- [ ] ۱۴. تست‌های پذیرش: ثبت تولید / ضایعات (تناژ) / توقف / QC / برنامهٔ PM؛ تب‌های مالی/فروش/خرید باید مخفی و APIشان 403 باشد
- [ ] ۱۵. دادهٔ دمو: `node tools\demo-seed.js --url=https://<VM>:3001 --user=admin --pass=*** --bundles=50`
- [ ] ۱۶. آموزش کاربران (اپراتور/انبار/کیفیت) + تحویل رمز ادمین موقت + تغییر رمز

## هـ) بستن روز نصب
- [ ] ۱۷. یک‌بار ری‌استارت کامل VM (بوت سرد واقعی) → لایسنس باید **بدون هیچ env** معتبر بماند (license.key کنار exe)
- [ ] ۱۸. ۲۴ ساعت مانیتور: لاگ سرویس + health + بکاپ‌گیری پوشهٔ داده

## کد خروج license-doctor (عیب‌یابی سریع)
| کد | معنا | اصلاح |
|----|------|-------|
| 0 | معتبر ✓ | — |
| 10 | tenant.json غایب/JSON خراب | فایل سالم کنار exe + امضا |
| 11 | قفل سخت‌افزاری (HWKEY) ناهم‌خوان | HWKEY ماشین را بفرستید و دوباره امضا کنید |
| 12 | منقضی/تاریخ بد | `--expires=YYYY-MM-DD --sign` |
| 13 | امضای Ed25519 نامعتبر | امضای مجدد با SANATIFY_LIC_ED_PRIV درست |
| 14 | امضای HMAC ناهم‌خوان | فقط اگر Ed هم نامعتبر است مهم می‌شود — امضای مجدد |
| 15 | HWKEY در امضا نیست ولی باید باشد | `--hwkey=... --sign` |
| 16 | هیچ امضایی نیست | `--sign` کامل (HMAC+Ed) |
CHECKLIST_EOF
{
    echo
    echo "---"
    echo "## خروجی همین تمرین ($(date '+%Y-%m-%d %H:%M'))"
    echo "- نصب تمرینی با install.sh در: \`${RD}\` — پورت \`${PORT}\` (HTTP؛ در نصب واقعی با cert/key کنار exe ⇒ HTTPS)"
    echo "- HWKEY ماشین تمرین: \`${HWKEY:-?}\`"
    echo "- کاربر موقت: \`admin\` / رمز: \`${PW}\` (در \`rehearsal-credentials.txt\`)"
    echo "- نتیجهٔ تمرین: **${pass} PASS / ${fail} FAIL** — لاگ‌ها: \`${RH}/logs/\`"
    echo "- ⚠ تست نهایی روی ویندوز سازنده: \`powershell -ExecutionPolicy Bypass -File tools\\rehearse.ps1\`"
} >> "${CHECKLIST}"
echo "  ✓ ${CHECKLIST}"

# ══════════════════════════════════════════════════════════════════
step "نگهبان قرمز — استقرار اصلی بایت‌به‌بایت؟"
# ══════════════════════════════════════════════════════════════════
GUARD_AFTER=""
for gf in server.js public/index.html public/sw.js; do
    GUARD_AFTER="${GUARD_AFTER}$(sha256sum "${WEB}/${gf}" | cut -d' ' -f1)"
done
if [ "${GUARD_BEFORE}" = "${GUARD_AFTER}" ]; then
    rec "PASS" "REDLINE" "استقرار اصلی دست‌نخورده (server.js / index.html / sw.js — هش برابر)"
else
    rec "FAIL" "REDLINE" "هش استقرار اصلی عوض شده! فوراً بررسی کنید"
fi

# پاکسازی
cleanup
if [ "${KEEP}" != "1" ]; then
    rm -rf "${S3:-/nonexistent__}" "${S4:-/nonexistent__}" "${S5:-/nonexistent__}" "${S6:-/nonexistent__}" 2>/dev/null
    echo
    echo "  پوشه‌های سناریو (s3/s4/s5/s6) پاک شد — با --keep بمانند"
fi

echo
echo "مسیرها:"
echo "  نصب تمرینی (VM شبیه‌سازی‌شده): ${RD}"
echo "  چک‌لیست روز نصب              : ${CHECKLIST}"
echo "  اعتبارنامهٔ موقت             : ${RH}/rehearsal-credentials.txt (admin / ${PW})"
echo "  لاگ‌ها                       : ${RH}/logs/"
echo
echo "⚠ تست نهایی روی ویندوز سازنده:  powershell -ExecutionPolicy Bypass -File tools\\rehearse.ps1"
if [ "${fail}" -gt 0 ]; then
    echo
    echo "✖ ${fail} سناریو FAIL شد — قبل از نصب واقعی رفع/بررسی شود."
    exit 1
fi
echo
echo "🎉 همهٔ سناریوها PASS — آمادهٔ نصب واقعی. 🫡"
exit 0
