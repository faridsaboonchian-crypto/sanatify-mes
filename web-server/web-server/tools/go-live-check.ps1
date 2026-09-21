# =====================================================================
# GO-LIVE-32b — go-live-check (ویندوز) — کنترل کامل پس از بوت برای راه‌اندازی تمیز
# صفر وابستگی — فقط PowerShell 5.1+ (ConvertFrom-Json داخلی)
#
# مصرف:
#   powershell -ExecutionPolicy Bypass -File go-live-check.ps1 -Url http://127.0.0.1:3001 -User admin -Pass رمز `
#        [-ExpectHidden warehouse,finance,sales,purchase,genealogy,balance] [-Dir "C:\Program Files\SanatifyMES"]
#
# خروج: جدول فارسی ✓/✗/⚠ + کد خروج (۰ = همه سبز، ۱ = حداقل یک ✗)
# =====================================================================
param(
    [string]$Url = "http://127.0.0.1:3001",
    [string]$User = "",
    [string]$Pass = "",
    [string]$ExpectHidden = "",
    [string]$Dir = ""
)
$ErrorActionPreference = "Continue"
$script:PassN = 0; $script:FailN = 0; $script:WarnN = 0
function Row($st, $label, $detail) {
    if ($st -eq "P") { $script:PassN++; Write-Host ("  ✓ " + $label.PadRight(30) + " " + $detail) }
    elseif ($st -eq "F") { $script:FailN++; Write-Host ("  ✗ " + $label.PadRight(30) + " " + $detail) -ForegroundColor Red }
    elseif ($st -eq "W") { $script:WarnN++; Write-Host ("  ⚠ " + $label.PadRight(30) + " " + $detail) -ForegroundColor Yellow }
    else { Write-Host ("  ℹ " + $label.PadRight(30) + " " + $detail) }
}
Write-Host "━━━ GO-LIVE-32b — go-live-check ━━━"
Write-Host ("  مقصد : " + $Url)

# ---------- ۱) health ----------
$healthOk = $false
try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 -Uri ($Url + "/api/health")
    if ($r.StatusCode -eq 200 -and $r.Content -match '"ok":true') { $healthOk = $true }
} catch { }
if ($healthOk) { Row "P" "health" "HTTP 200 + ok:true" }
else { Row "F" "health" "بدون پاسخ — سرور بالا نیست؟ (Event Viewer یا اجرای دستی exe کنسولی)" }

# ---------- ۲) کانفیگ عمومی: demo / hidden_tabs / لایسنس ----------
$cfg = $null
try { $r2 = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 -Uri ($Url + "/api/tenant/config"); $cfg = $r2.Content | ConvertFrom-Json } catch { }
if (-not $cfg -or -not $cfg.ok) {
    Row "F" "config" "پاسخ /api/tenant/config خوانده نشد"
} else {
    if ($cfg.tenant.demo_mode) { Row "F" "demo_mode" "فعال است! — راه‌اندازی تمیز باید false باشد (tenant.json: demo_mode=false + امضای دوباره)" }
    else { Row "P" "demo_mode" "false — بدون گیت دمو" }
    if ($cfg.tenant.license.invalid) { Row "F" "license" "نامعتبر — تشخیص: node tools/license-doctor.js (در ماشین فروشنده)" }
    else { Row "P" "license" "معتبر (server-side verify)" }
    $ht = @($cfg.tenant.hidden_tabs)
    if ($ht.Count -eq 0) {
        Row "W" "hidden_tabs" "غایب/خالی — همهٔ تب‌ها نمایان است (tenant.json را با --hide-tabs امضا و کپی کنید)"
    } elseif ($ExpectHidden -ne "") {
        $got = ($ht | Sort-Object) -join ","
        $exp = ($ExpectHidden.Split(",") | ForEach-Object { $_.Trim() } | Sort-Object) -join ","
        if ($got -eq $exp) { Row "P" "hidden_tabs" ("دقیقاً مطابق انتظار (" + $got + ")") }
        else { Row "F" "hidden_tabs" ("مطابقت ندارد — انتظار: [" + $exp + "] واقعی: [" + $got + "]") }
    } else {
        Row "P" "hidden_tabs" ("فعال: [" + (($ht | Sort-Object) -join ",") + "] — برای تطبیق دقیق: -ExpectHidden")
    }
}

# ---------- ۳) doctor (اگر node + ابزار موجود بود) ----------
$doctorJs = ""
if ($Dir -ne "" -and (Test-Path (Join-Path $Dir "tools\license-doctor.js"))) { $doctorJs = Join-Path $Dir "tools\license-doctor.js" }
if ($doctorJs -ne "" -and (Get-Command node -ErrorAction SilentlyContinue)) {
    $out = & node $doctorJs --dir="$Dir" 2>&1
    $dc = $LASTEXITCODE
    if ($dc -eq 0) { Row "P" "license-doctor" "کد خروج ۰ — سالم" }
    else { Row "F" "license-doctor" ("کد خروج " + $dc + " — " + ($out | Select-Object -Last 1)) }
} else {
    Write-Host "  ℹ license-doctor                     رد شد (node یا tools/ در این ماشین نیست — قضاوت لایسنس با چک server-side بالا انجام شد)"
}

# ---------- ۴) شمارش رکوردها = صفر (نیازمند نشست ادمین) ----------
if ($User -ne "") {
    $loginOk = $false; $sess = $null
    try {
        $body = @{ username = $User; password = $Pass } | ConvertTo-Json
        $lr = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 -Uri ($Url + "/api/auth/login") -Method POST -ContentType "application/json" -Body $body -SessionVariable sess
        if ($lr.StatusCode -eq 200 -and $lr.Content -match '"ok":true') { $loginOk = $true }
    } catch { }
    if (-not $loginOk) { Row "F" "login" "ورود ناموفق (کاربر/رمز؟)" }
    else {
        Row "P" "login" "نشست ادمین ساخته شد"
        foreach ($ep in @("production","waste","downtime","quality","bundles","billets")) {
            try {
                $rr = Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -WebSession $sess -Uri ($Url + "/api/" + $ep)
                $arr = $rr.Content | ConvertFrom-Json
                $n = @($arr).Count
                if ($n -eq 0) { Row "P" ("records/" + $ep) "۰ رکورد — تمیز" }
                else { Row "F" ("records/" + $ep) ($n.ToString() + " رکورد! — دادهٔ قدیمی منتقل شده؟ (راه‌اندازی تمیز = صفر)") }
            } catch { Row "W" ("records/" + $ep) "پاسخ خوانده نشد (احتمالاً ۴۰۳ نقش/ماژول)" }
        }
        try {
            $ur = Invoke-WebRequest -UseBasicParsing -TimeoutSec 6 -WebSession $sess -Uri ($Url + "/api/admin/users")
            $uj = $ur.Content | ConvertFrom-Json
            Row "P" "users" "فهرست کاربران ساخته‌شده روی این VM:"
            foreach ($u in $uj.list) { Write-Host ("       - " + $u.username + " (" + $u.role + ")") }
        } catch { Row "W" "users" "GET /api/admin/users خوانده نشد (نقش ادمین؟)" }
    }
} else {
    Write-Host "  ℹ records/users                       رد شد — -User/-Pass ندهید تا فقط چک‌های عمومی اجرا شود"
}

# ---------- ۵) سرویس / گواهی ----------
$svc = Get-Service -Name "SanatifyMES" -ErrorAction SilentlyContinue
if ($svc) {
    if ($svc.Status -eq "Running") { Row "P" "service" "سرویس ویندوز SanatifyMES: Running" }
    else { Row "F" "service" ("سرویس ویندوز SanatifyMES: " + $svc.Status + " — sc.exe start SanatifyMES") }
} else {
    Row "W" "service" "سرویس SanatifyMES یافت نشد — اگر نصب nohup/دستی است، exe را کنسولی اجرا کنید"
}
if ($Dir -ne "" -and (Test-Path (Join-Path $Dir "cert.pem")) -and (Test-Path (Join-Path $Dir "key.pem"))) {
    Row "P" "tls" "cert.pem/key.pem کنار exe — حالت HTTPS (تک‌پورت با redirect)"
} else {
    Write-Host "  ℹ tls                              HTTP حالت (cert.pem/key.pem کنار exe نیست — برای HTTPS کنار exe بگذارید)"
}

Write-Host ("━━━ نتیجه: ✓" + $script:PassN + "  ✗" + $script:FailN + "  ⚠" + $script:WarnN + " ━━━")
if ($script:FailN -eq 0) {
    Write-Host "  ✅ همهٔ چک‌های الزامی سبز است — آمادهٔ راه‌اندازی تمیز."
    exit 0
} else {
    Write-Host ("  ❌ " + $script:FailN + " چک الزامی قرمز است — قبل از راه‌اندازی برطرف کنید (فصل «ز — رول‌بک» در RUNBOOK-GoLive).") -ForegroundColor Red
    exit 1
}
