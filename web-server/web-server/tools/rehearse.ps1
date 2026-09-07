<# =====================================================================
REHEARSAL-29 — ابزار تمرین دمو تک‌دستوری (ویندوز) — معادل لینوکسی: tools/rehearse.sh

هدف: فروشنده قبل از اولین نصب واقعی روی VM مشتری، کل سناریوی «نصب» را روی ماشین
خودش، در پوشهٔ جدا و پورت جدا (3101) شبیه‌سازی و اثبات می‌کند. در پایان جدول
PASS/FAIL + فایل «چک‌لیست روز نصب.md» تحویل می‌دهد.

مصرف (در PowerShell ویندوز):
  powershell -ExecutionPolicy Bypass -File tools\rehearse.ps1
  powershell -ExecutionPolicy Bypass -File tools\rehearse.ps1 -Dir E:\reh -Keep

  -Dir    پوشهٔ تمرین (پیش‌فرض D:\sanatify-rehearsal)
  -Keep   پوشه‌های سناریوها (s3/s4/s5/s6) پاک نشوند

مسیر تمرین (مثل روز نصب واقعی):
  بیلد exe (اگر dist نبود) → پوشهٔ تمرین (exe + SHA256SUMS + دادهٔ تازه) → HWKEY →
  امضای tenant با demo_mode → tenant.json + license.key کنار exe → اجرا → پذیرش → demo-seed

ایمنی مطلق (قرمز):
  • هرگز به استقرار اصلی (web-server\web-server، پورت 3001) نوشتن نمی‌شود — فقط خواندن.
  • همه‌چیز در پوشهٔ تمرین و روی پورت 3101 ساخته می‌شود.
  • در پایان، هش server.js / index.html / sw.js با شروع مقایسه می‌شود (نگهبان داخلی).

کلیدهای امضا (مثل روز نصب — فقط برای «امضا»؛ بوت‌ها عمداً بدون env = بوت سرد):
  SANATIFY_LIC_ED_PRIV — کلید خصوصی Ed25519 فروشنده (الزامی؛ بدون آن خروج با راهنما)
  SANATIFY_LIC_KEY     — کلید HMAC (اگر نبود license.key موجود استفاده/کپی می‌شود)

نکتهٔ گواهی: cert/key اگر در استقرار اصلی باشند، در <Dir>\certs\ کپی می‌شوند؛
عمداً کنار exe گذاشته نمی‌شوند تا demo-seed (فقط-HTTP) کار کند. در نصب واقعی
cert/key کنار exe می‌روند و سرویس خودکار HTTPS می‌شود.

⚠ سازگاری: Windows PowerShell 5.1 و PowerShell 7+ (فایل UTF-8 با BOM ذخیره شده).
===================================================================== #>
param(
    [string]$Dir = 'D:\sanatify-rehearsal',
    [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$Port = 3101
$script:BaseUrl = "http://127.0.0.1:$Port"
$ToolsDir = $PSScriptRoot
$WebRoot = (Resolve-Path (Join-Path $ToolsDir '..')).Path   # web-server\web-server — فقط خواندن
$ExeName = 'sanatify-mes-node18-win-x64.exe'

try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch { }
try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }
try { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } } catch { }

$script:PassCount = 0
$script:FailCount = 0
$script:Table = @()
$script:AllProcs = @()
$script:EdPriv = $null
$script:HmacKey = $null

function Rec([string]$Id, [string]$Msg, [bool]$Ok) {
    if ($Ok) { $script:PassCount++ } else { $script:FailCount++ }
    $tag = 'FAIL'
    if ($Ok) { $tag = 'PASS' }
    $script:Table += ("[{0}] {1} — {2}" -f $tag, $Id, $Msg)
    if ($Ok) { Write-Host ("  ✓ PASS {0} — {1}" -f $Id, $Msg) }
    else { Write-Host ("  ✖ FAIL {0} — {1}" -f $Id, $Msg) }
}
function Die([string]$Msg) {
    Write-Host "✖ $Msg" -ForegroundColor Red
    Write-Host ""
    Write-Host "راهنمای سریع:"
    Write-Host "  • کلیدها را در همان پنجرهٔ PowerShell ست کنید:  `$env:SANATIFY_LIC_ED_PRIV='...'  و  `$env:SANATIFY_LIC_KEY='...'"
    Write-Host "  • کلید خصوصی Ed ندارید؟  node tools\license.js --gen-ed-keys --out=lic-ed-keys.json"
    Write-Host "  • پوشهٔ دیگر:  -Dir E:\مسیر-دیگر"
    exit 2
}
function Write-Utf8NoBom([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}
function Invoke-Http([string]$Method, [string]$Url, [string]$JsonBody, [object]$Session) {
    $h = @{ UseBasicParsing = $true; Method = $Method; Uri = $Url; TimeoutSec = 15 }
    if ($Session) { $h['WebSession'] = $Session }
    if ($JsonBody) {
        $h['Body'] = $JsonBody
        $h['ContentType'] = 'application/json'
        $h['Headers'] = @{ Origin = $script:BaseUrl }
    }
    try {
        $r = Invoke-WebRequest @h
        return @{ Status = [int]$r.StatusCode; Body = [string]$r.Content }
    } catch {
        $resp = $_.Exception.Response
        if ($resp) {
            $b = ''
            try { $sr = New-Object System.IO.StreamReader($resp.GetResponseStream()); $b = $sr.ReadToEnd() } catch { }
            return @{ Status = [int]$resp.StatusCode; Body = $b }
        }
        return @{ Status = 0; Body = $_.Exception.Message }
    }
}
function Wait-Health {
    $deadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $deadline) {
        $h = Invoke-Http 'GET' "$($script:BaseUrl)/api/health" $null $null
        if ($h.Status -eq 200 -and $h.Body -match '"ok":true') { return $true }
        Start-Sleep -Milliseconds 800
    }
    return $false
}
function Test-PortBusy([int]$P) {
    $c = $null
    try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $P); return $true }
    catch { return $false }
    finally { if ($c) { $c.Close() } }
}
function Start-ServerProc([string]$WorkDir, [string]$FilePath, [string[]]$ProcArgs, [string]$LogPath) {
    # بوت «بوت سرد»: env جریان جاری هرگز کلیدهای امضا را ندارد (در پیش‌خوان حذف شده‌اند)
    $p = Start-Process -FilePath $FilePath -ArgumentList $ProcArgs -WorkingDirectory $WorkDir -WindowStyle Hidden -RedirectStandardOutput $LogPath -RedirectStandardError "$LogPath.err" -PassThru
    $script:AllProcs += $p
    return $p
}
function Run-ToExit([string]$WorkDir, [string]$FilePath, [string[]]$ProcArgs, [string]$LogPath, [int]$TimeoutMs) {
    $p = Start-ServerProc $WorkDir $FilePath $ProcArgs $LogPath
    if (-not $p.WaitForExit($TimeoutMs)) {
        try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { }
        return @{ ExitCode = -999; TimedOut = $true }
    }
    Start-Sleep -Milliseconds 300
    return @{ ExitCode = $p.ExitCode; TimedOut = $false }
}
function Stop-ServerProc($Proc) {
    if ($Proc -and -not $Proc.HasExited) { try { Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue } catch { } }
    $deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $deadline) {
        $h = Invoke-Http 'GET' "$($script:BaseUrl)/api/health" $null $null
        if ($h.Status -eq 0) { return }   # 0 = اتصال رد شد ⇒ پورت آزاد
        Start-Sleep -Milliseconds 500
    }
}
function Read-LogText([string]$Path) {
    $t = ''
    if (Test-Path $Path) { $t = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) }
    if (Test-Path "$Path.err") { $t = $t + [System.IO.File]::ReadAllText("$Path.err", [System.Text.Encoding]::UTF8) }
    return $t
}
function Invoke-Sign([string]$WorkDir, [string[]]$SignArgs) {
    # کلیدها فقط برای همین دستور — env جریان جاری تمیز می‌ماند (بوت‌های بعدی = بوت سرد)
    $env:SANATIFY_LIC_ED_PRIV = $script:EdPriv
    if ($script:HmacKey) { $env:SANATIFY_LIC_KEY = $script:HmacKey }
    Push-Location $WorkDir
    try { & node .\tools\license.js @SignArgs; $code = $LASTEXITCODE } finally { Pop-Location }
    Remove-Item Env:\SANATIFY_LIC_ED_PRIV -ErrorAction SilentlyContinue
    Remove-Item Env:\SANATIFY_LIC_KEY -ErrorAction SilentlyContinue
    return ($code -eq 0)
}

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ ۰) ایمنی و پیش‌نیازها — پورت $Port، پوشهٔ تمرین جدا ━━━"
# ══════════════════════════════════════════════════════════════════
try { $null = Get-Command node -ErrorAction Stop; $script:NodeExe = (Get-Command node).Source } catch { Die 'node پیدا نشد — Node.js 18+ لازم است (بیلد/امضا/کمک‌ابزارها با node اجرا می‌شوند)' }
try { New-Item -ItemType Directory -Force -Path $Dir -ErrorAction Stop | Out-Null } catch { Die ("ساخت پوشهٔ تمرین ناموفق: $Dir — درایو D موجود نیست؟ با -Dir مسیر دیگر بدهید") }
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'logs') | Out-Null

# نگهبان قرمز — هش فایل‌های حیاتی استقرار اصلی، قبل از هر کاری
$GuardBefore = @{ }
foreach ($gf in @('server.js', 'public\index.html', 'public\sw.js')) {
    $GuardBefore[$gf] = (Get-FileHash -Path (Join-Path $WebRoot $gf) -Algorithm SHA256).Hash
}

# کلیدها — مثل روز نصب (فقط در متغیر ابزار؛ از env حذف می‌شوند تا بوت‌ها سرد باشند)
$script:EdPriv = $env:SANATIFY_LIC_ED_PRIV
$script:HmacKey = $env:SANATIFY_LIC_KEY
if ($script:EdPriv -like 'SANATIFY_LIC_ED_PRIV=*') {
    $script:EdPriv = $script:EdPriv.Substring('SANATIFY_LIC_ED_PRIV='.Length)
    Write-Host "  ⚠ کلید Ed با پیشوند «SANATIFY_LIC_ED_PRIV=» چسبیده بود — خودکار جدا شد"
}
if ($script:HmacKey -like 'SANATIFY_LIC_KEY=*') {
    $script:HmacKey = $script:HmacKey.Substring('SANATIFY_LIC_KEY='.Length)
    Write-Host "  ⚠ کلید HMAC با پیشوند «SANATIFY_LIC_KEY=» چسبیده بود — خودکار جدا شد"
}
if (-not $script:EdPriv) {
    Die "SANATIFY_LIC_ED_PRIV تنظیم نیست — امضای Ed25519 مسیر اصلی است و بدون آن تمرین معنا ندارد.`n  نمونه:  `$env:SANATIFY_LIC_ED_PRIV='...'  (خروجی tools\license.js --gen-ed-keys)"
}
if ($script:HmacKey) {
    Write-Host "  کلید HMAC : env (license.key تازه کنار exe تمرین ساخته می‌شود)"
} elseif (Test-Path (Join-Path $Dir 'license.key')) {
    Write-Host "  کلید HMAC : license.key موجود در پوشهٔ تمرین (اجرای قبلی)"
} elseif (Test-Path (Join-Path $WebRoot 'license.key')) {
    Copy-Item (Join-Path $WebRoot 'license.key') (Join-Path $Dir 'license.key') -Force
    Write-Host "  کلید HMAC : license.key استقرار اصلی کپی شد (فقط‌خواندن از اصلی)"
} else {
    Die 'هیچ منبع کلید HMAC نیست — نه env: SANATIFY_LIC_KEY و نه license.key (کنار server.js یا پوشهٔ تمرین)'
}
Remove-Item Env:\SANATIFY_LIC_ED_PRIV -ErrorAction SilentlyContinue
Remove-Item Env:\SANATIFY_LIC_KEY -ErrorAction SilentlyContinue

if (Test-PortBusy $Port) { Die "پورت $Port اشغال سرویس دیگری است — تمرین همیشه روی $Port است؛ ابتدا آن سرویس را متوقف کنید" }
Write-Host "  ✓ پیش‌نیازها سبز است"

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ ۱) exe تمرین — dist\ نبود ⇒ بیلد حفاظت‌شده ━━━"
# ══════════════════════════════════════════════════════════════════
$DistBin = Join-Path $WebRoot 'dist\bin'
$MainExe = Join-Path $DistBin $ExeName
$MainSums = Join-Path $DistBin 'SHA256SUMS.txt'
if (-not (Test-Path $MainExe)) {
    Write-Host "  بیلد شروع شد (چند دقیقه)…"
    Push-Location $ToolsDir
    try { & node .\build-protected.js --compile --target=node18-win-x64; $bld = $LASTEXITCODE } finally { Pop-Location }
    if ($bld -ne 0) { Die 'بیلد حفاظت‌شده ناموفق بود — پیام بالا را ببینید' }
}
if (-not (Test-Path $MainExe)) { Die "exe پیدا/ساخته نشد: $MainExe" }
if (-not (Test-Path $MainSums)) { Die 'SHA256SUMS.txt کنار exe نیست — الزام SEC-ANTI-19g (بوت بدون آن متوقف است)' }
Write-Host "  ✓ exe: $MainExe"

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ ۲) پوشهٔ تمرین — $Dir ━━━"
# ══════════════════════════════════════════════════════════════════
$RD = $Dir   # ریشهٔ سرور تمرین (ROOT کنار exe)
Copy-Item $MainExe (Join-Path $RD $ExeName) -Force
Copy-Item $MainSums (Join-Path $RD 'SHA256SUMS.txt') -Force
New-Item -ItemType Directory -Force -Path (Join-Path $RD 'tools'), (Join-Path $Dir 'certs') | Out-Null
$ExePath = Join-Path $RD $ExeName
if ((Test-Path (Join-Path $WebRoot 'cert.pem')) -and (Test-Path (Join-Path $WebRoot 'key.pem'))) {
    Copy-Item (Join-Path $WebRoot 'cert.pem') (Join-Path $Dir 'certs\cert.pem') -Force
    Copy-Item (Join-Path $WebRoot 'key.pem') (Join-Path $Dir 'certs\key.pem') -Force
    Write-Host "  گواهی : cert/key در $Dir\certs\ کپی شد"
    Write-Host "  ⚠ در تمرین گواهی عمداً کنار exe گذاشته نمی‌شود (demo-seed فقط-HTTP است)؛"
    Write-Host "    در نصب واقعی cert/key کنار exe می‌روند ⇒ سرویس خودکار HTTPS می‌شود."
} else {
    Write-Host "  گواهی : در استقرار اصلی نبود — تمرین روی HTTP (مثل نصب بدون گواهی)"
}

# live.json تازهٔ خالی — شکل دقیق emptyDataset سرور (صفر دادهٔ واقعی مشتری)
Write-Utf8NoBom (Join-Path $RD 'live.json') '{"generated_at":null,"production_logs":[],"waste_logs":[],"downtime_logs":[],"quality_inspections":[],"billets":[],"furnace_logs":[],"rebar_bundles":[]}'

# web-users.json تازه — فقط یک ادمین موقت با رمز تصادفی (هش scrypt عیناً مثل auth.js)
$mkUser = 'const c=require("crypto"),f=require("fs");const ab="abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";let p="";const b=c.randomBytes(14);for(const x of b){p+=ab[x%ab.length];}const salt=c.randomBytes(16);const key=c.scryptSync(p,salt,64,{N:16384,r:8,p:1});const u=[{username:"admin",role:"admin",name:"\u0645\u062f\u06cc\u0631 \u062a\u0645\u0631\u06cc\u0646 \u062f\u0645\u0648",password_hash:"scrypt$16384$8$1$"+salt.toString("base64")+"$"+key.toString("base64")}];f.writeFileSync("web-users.json",JSON.stringify(u,null,2));console.log(p);'
Push-Location $RD
try { $Pw = ([string](& node -e $mkUser | Select-Object -Last 1)).Trim() } finally { Pop-Location }
if (-not $Pw) { Die 'ساخت کاربر ادمین موقت ناموفق' }
Write-Host "  کاربر موقت: admin / رمز: $Pw"

# tenant.json از قالب (هرگز tenant واقعی مشتری) + demo_mode=true + امضای کامل Ed+HMAC
$Tpl = Join-Path $WebRoot 'tenant.json.template'
Copy-Item $Tpl (Join-Path $RD 'tenant.json') -Force
& node -e 'const f=require("fs");const p=process.argv[1];const j=JSON.parse(f.readFileSync(p,"utf8"));j.demo_mode=true;f.writeFileSync(p,JSON.stringify(j,null,2));' (Join-Path $RD 'tenant.json')
Copy-Item (Join-Path $ToolsDir 'license.js') (Join-Path $RD 'tools\license.js') -Force
Write-Host "  امضای tenant (رونوشت محلی license.js ⇒ همه‌نوشتن‌ها داخل پوشهٔ تمرین)…"
$signOk = Invoke-Sign $RD @('--tenant=sanatify', '--name=تمرین دمو — صنعتی فای', '--max-users=25', '--max-records=200000', '--sign')
if (-not $signOk) { Die 'امضای tenant ناموفق — پیام بالا را ببینید' }
$tenJson = $null
try { $tenJson = [System.IO.File]::ReadAllText((Join-Path $RD 'tenant.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json } catch { }
if (-not ($tenJson -and $tenJson.demo_mode -and $tenJson.license_sig2 -and $tenJson.license_sig)) { Die 'راستی‌آزمایی امضای tenant ناموفق (sig/sig2/demo_mode)' }
if (-not (Test-Path (Join-Path $RD 'license.key'))) { Die 'license.key کنار exe تمرین ساخته/موجود نیست — بوت سرد معتبر نخواهد بود' }
Write-Host "  ✓ tenant.json امضاشده + license.key + live.json خالی + web-users.json تازه"

$credText = "اعتبارنامهٔ موقت تمرین دمو — REHEARSAL-29 — $(Get-Date -Format 'yyyy-MM-dd HH:mm')`r`n  کاربر : admin`r`n  رمز   : $Pw`r`n  پوشهٔ تمرین : $RD   (پورت $Port — HTTP)`r`n  ⚠ پس از دمو واقعی روی VM مشتری این رمز عوض شود."
Write-Utf8NoBom (Join-Path $Dir 'rehearsal-credentials.txt') $credText

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ S1) بوت سالم روی $Port + بنر دمو + قفل مالی + بوت سرد (بدون env) ━━━"
# ══════════════════════════════════════════════════════════════════
$S1Proc = Start-ServerProc $RD $ExePath @() (Join-Path $Dir 'logs\s1.log')
if (Wait-Health) { Rec 'S1-boot' "health 200 روی پورت $Port" $true }
else { Rec 'S1-boot' "بوت/health ناموفق — لاگ: $Dir\logs\s1.log" $false }
$s1log = Read-LogText (Join-Path $Dir 'logs\s1.log')
Rec 'S1-lic' 'بوت سرد بدون env ⇒ «وضعیت لایسنس: معتبر ✓» (Ed25519 embedded / license.key)' ($s1log -match 'معتبر ✓')
$tenCfg = Invoke-Http 'GET' "$($script:BaseUrl)/api/tenant/config" $null $null
Rec 'S1-demoapi' 'config (عمومی): demo_mode=true سمت سرور' ($tenCfg.Status -eq 200 -and $tenCfg.Body -match '"demo_mode":true')
$loginOk = $false
try {
    $lr = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($script:BaseUrl)/api/auth/login" -Body (@{ username = 'admin'; password = $Pw } | ConvertTo-Json -Compress) -ContentType 'application/json' -Headers @{ Origin = $script:BaseUrl } -SessionVariable Sess1 -TimeoutSec 15
    if ($lr.Content -match '"ok":true') { $script:WebSession1 = $Sess1; $loginOk = $true }
} catch { }
$homePage = Invoke-Http 'GET' "$($script:BaseUrl)/" $null $script:WebSession1
Rec 'S1-banner' 'ورود ادمین موقت + بنر دمو (demoBanner19d) در پوستهٔ اپ حاضر است' ($loginOk -and $homePage.Status -eq 200 -and $homePage.Body -match 'demoBanner19d')
$finResp = Invoke-Http 'GET' "$($script:BaseUrl)/api/finance" $null $null
Rec 'S1-finance403' 'API مالی → 403 (گیت دمو — مالی مشتری در سپیدار)' ($finResp.Status -eq 403)

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ S2) demo-seed روی $Port → KPI غیرصفر ━━━"
# ══════════════════════════════════════════════════════════════════
$seedOk = $true
Push-Location $ToolsDir
try { & node .\demo-seed.js "--url=$($script:BaseUrl)" --user=admin "--pass=$Pw" --days=30 --bundles=50 --stops=10 --pms=5 | Out-Null; if ($LASTEXITCODE -ne 0) { $seedOk = $false } } finally { Pop-Location }
Rec 'S2-seed' 'demo-seed اجرا شد (لاگ: کنسول بالا)' $seedOk
$sumResp = Invoke-Http 'GET' "$($script:BaseUrl)/api/summary" $null $script:WebSession1
$kpi = 0
try {
    $sObj = $sumResp.Body | ConvertFrom-Json
    if ($sObj.production_30d) { $kpi = [double]$sObj.production_30d }
    elseif ($sObj.bundle_count) { $kpi = [double]$sObj.bundle_count }
} catch { }
Rec 'S2-kpi' ("KPI غیرصفر (تولید۳۰روز + بندیل = {0})" -f $kpi) ($kpi -gt 0)
# پایان سهم سرور اصلی تمرین — پورت برای سناریوهای بعد آزاد می‌شود
Stop-ServerProc $S1Proc

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ S3) tenant موقت با hwkey غلط → exit 1 + پیام فارسی قفل سخت‌افزاری ━━━"
# ══════════════════════════════════════════════════════════════════
$S3 = Join-Path $Dir 's3-wrong-hwkey'
New-Item -ItemType Directory -Force -Path (Join-Path $S3 'tools') | Out-Null
Copy-Item $ExePath $S3 -Force
Copy-Item (Join-Path $RD 'SHA256SUMS.txt') $S3 -Force
Copy-Item (Join-Path $RD 'tenant.json') (Join-Path $S3 'tenant.json') -Force
Copy-Item (Join-Path $ToolsDir 'license.js') (Join-Path $S3 'tools\license.js') -Force
if (Test-Path (Join-Path $RD 'license.key')) { Copy-Item (Join-Path $RD 'license.key') $S3 -Force }
$S3Exe = Join-Path $S3 $ExeName
if (Invoke-Sign $S3 @('--hwkey=HW-0000-0000-0000', '--sign')) {
    $r3 = Run-ToExit $S3 $S3Exe @() (Join-Path $Dir 'logs\s3.log') 120000
    $l3 = Read-LogText (Join-Path $Dir 'logs\s3.log')
    Rec 'S3' 'exit=1 + پیام قفل سخت‌افزاری (HW-0000-0000-0000 رد شد — سرور هرگز گوش نداد)' (($r3.ExitCode -eq 1) -and ($l3 -match 'SEC-BIND-19f'))
} else {
    Rec 'S3' 'امضای tenant با hwkey غلط ناموفق — logs\s3-sign.log' $false
}

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ S4) hwkey صحیح همین ماشین → بوت سالم ━━━"
# ══════════════════════════════════════════════════════════════════
Push-Location $RD
try { $hwLines = & $ExePath --print-hwkey } finally { Pop-Location }
$Hwkey = ([string]($hwLines | Select-Object -Last 1)).Trim()
if ($Hwkey -match '^HW-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$') {
    Write-Host "  HWKEY ماشین تمرین: $Hwkey"
    $S4 = Join-Path $Dir 's4-own-hwkey'
    New-Item -ItemType Directory -Force -Path (Join-Path $S4 'tools') | Out-Null
    Copy-Item $ExePath $S4 -Force
    Copy-Item (Join-Path $RD 'SHA256SUMS.txt') $S4 -Force
    Copy-Item (Join-Path $RD 'tenant.json') (Join-Path $S4 'tenant.json') -Force
    Copy-Item (Join-Path $ToolsDir 'license.js') (Join-Path $S4 'tools\license.js') -Force
    if (Test-Path (Join-Path $RD 'license.key')) { Copy-Item (Join-Path $RD 'license.key') $S4 -Force }
    if (Invoke-Sign $S4 @("--hwkey=$Hwkey", '--sign')) {
        $S4Exe = Join-Path $S4 $ExeName
        $S4Proc = Start-ServerProc $S4 $S4Exe @() (Join-Path $Dir 'logs\s4.log')
        if (Wait-Health) {
            $l4 = Read-LogText (Join-Path $Dir 'logs\s4.log')
            Rec 'S4' "بوت سالم با قفل HWKEY همین ماشین ($Hwkey) + لایسنس معتبر" ($l4 -match 'معتبر ✓')
        } else {
            Rec 'S4' "بوت با hwkey صحیح ناموفق — logs\s4.log" $false
        }
        Stop-ServerProc $S4Proc
    } else {
        Rec 'S4' 'امضای tenant با hwkey ماشین ناموفق — logs\s4-sign.log' $false
    }
} else {
    Rec 'S4' "خواندن HWKEY ماشین ناموفق (خروجی: '$Hwkey')" $false
}

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ S5) دستکاری max_users → لایسنس پایه (بوت سورس) + doctor کد مرتبط ━━━"
# ══════════════════════════════════════════════════════════════════
$S5 = Join-Path $Dir 's5-tamper'
New-Item -ItemType Directory -Force -Path $S5 | Out-Null
Copy-Item (Join-Path $WebRoot 'dist\server.js') (Join-Path $S5 'server.js') -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WebRoot 'dist\auth.js') (Join-Path $S5 'auth.js') -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $WebRoot 'dist\package.json') (Join-Path $S5 'package.json') -Force -ErrorAction SilentlyContinue
if (Test-Path (Join-Path $S5 'server.js')) {
    Copy-Item (Join-Path $RD 'tenant.json') (Join-Path $S5 'tenant.json') -Force
    Copy-Item (Join-Path $RD 'web-users.json') (Join-Path $S5 'web-users.json') -Force   # برای ورود و آزمون گیت ماژول در سرور تازه (نشست‌ها حافظه‌ای‌اند)
    & node -e 'const f=require("fs");const p=process.argv[1];const j=JSON.parse(f.readFileSync(p,"utf8"));j.max_users=99999;f.writeFileSync(p,JSON.stringify(j,null,2));' (Join-Path $S5 'tenant.json')
    $S5Proc = Start-ServerProc $S5 $script:NodeExe @('server.js') (Join-Path $Dir 'logs\s5.log')
    if (Wait-Health) { Rec 'S5-boot' 'سرور سورس با tenant دستکاری‌شده بالا آمد (health 200) — فروپاشی نه، لایسنس پایه' $true }
    else { Rec 'S5-boot' "بوت سورس با tenant دستکاری‌شده ناموفق — logs\s5.log" $false }
    $l5 = Read-LogText (Join-Path $Dir 'logs\s5.log')
    Rec 'S5-log' 'خودآزمایی بوت: «وضعیت لایسنس: نامعتبر ✗» با علت دقیق' ($l5 -match 'نامعتبر ✗')
    $login5Ok = $false
    try {
        $lr5 = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$($script:BaseUrl)/api/auth/login" -Body (@{ username = 'admin'; password = $Pw } | ConvertTo-Json -Compress) -ContentType 'application/json' -Headers @{ Origin = $script:BaseUrl } -SessionVariable Sess5 -TimeoutSec 15
        if ($lr5.Content -match '"ok":true') { $login5Ok = $true }
    } catch { }
    $anaResp = Invoke-Http 'GET' "$($script:BaseUrl)/api/analytics" $null $Sess5
    Rec 'S5-gate' 'analytics با لایسنس پایه → 403 (فقط summary/production/inventory باز است)' (($anaResp.Status -eq 403) -and $login5Ok)
    Push-Location $ToolsDir
    try { & node .\license-doctor.js "--dir=$S5"; $docExit = $LASTEXITCODE } finally { Pop-Location }
    Rec 'S5-doctor' "license-doctor کد $docExit داد (انتظار: 13 = امضای Ed نامعتبر)" (($docExit -ge 10) -and ($docExit -le 16))
    Stop-ServerProc $S5Proc
} else {
    Rec 'S5' 'نسخهٔ dist\server.js برای سناریوی سورس پیدا نشد — اول بیلد را اجرا کنید' $false
}

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ S6) کپی exe تنها (بدون SHA256SUMS/tenant/license.key) → رفتار مستند ━━━"
# ══════════════════════════════════════════════════════════════════
$S6 = Join-Path $Dir 's6-naked-exe'
New-Item -ItemType Directory -Force -Path $S6 | Out-Null
Copy-Item $ExePath $S6 -Force
$r6 = Run-ToExit $S6 (Join-Path $S6 $ExeName) @() (Join-Path $Dir 'logs\s6.log') 120000
$l6 = Read-LogText (Join-Path $Dir 'logs\s6.log')
Rec 'S6' 'exit=1 — رفتار مستند: باینری تنها بالا نمی‌آید (پیام فارسی مانیفست/tenant)' (($r6.ExitCode -eq 1) -and ($l6 -match 'SHA256SUMS|tenant'))

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ جدول نتایج — REHEARSAL-29 ━━━"
# ══════════════════════════════════════════════════════════════════
foreach ($line in $script:Table) { Write-Host "  $line" }
Write-Host ""
Write-Host ("  جمع: {0} PASS / {1} FAIL" -f $script:PassCount, $script:FailCount)

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ نوشتن «چک‌لیست روز نصب.md» ━━━"
# ══════════════════════════════════════════════════════════════════
$Checklist = Join-Path $Dir 'چک‌لیست روز نصب.md'
$checkBody = @'
# ✅ چک‌لیست روز نصب — Sanatify MES (فولاد)

> همین صفحه را چاپ کنید و روز نصب گام‌به‌گام جلو بروید.
> ⚠ دو قانون طلایی: (۱) باینری همیشه با SHA256SUMS.txt کنارش است؛ (۲) tenant.json + license.key همیشه کنار exe هستند.

## الف) شب قبل — روی ماشین فروشنده
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

## ج) امضا — روی ماشین فروشنده
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
'@
$checkTail = @"

---

## خروجی همین تمرین ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))
- پوشهٔ تمرین: ``$RD`` — پورت ``$Port`` (HTTP؛ در نصب واقعی با cert/key کنار exe ⇒ HTTPS)
- HWKEY ماشین تمرین: ``$Hwkey``
- کاربر موقت: ``admin`` / رمز: ``$Pw`` (در ``rehearsal-credentials.txt``)
- نتیجهٔ تمرین: **$($script:PassCount) PASS / $($script:FailCount) FAIL** — لاگ‌ها: ``logs\``
- ⚠ این فایل روی لینوکس/سندباکس هم با tools/rehearse.sh تولید و اثبات شده است.
"@
Write-Utf8NoBom $Checklist ($checkBody + $checkTail)
Write-Host "  ✓ $Checklist"

# ══════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "━━━ نگهبان قرمز — استقرار اصلی بایت‌به‌بایت؟ ━━━"
# ══════════════════════════════════════════════════════════════════
$redlineOk = $true
foreach ($gf in @('server.js', 'public\index.html', 'public\sw.js')) {
    $now = (Get-FileHash -Path (Join-Path $WebRoot $gf) -Algorithm SHA256).Hash
    if ($now -ne $GuardBefore[$gf]) { $redlineOk = $false }
}
Rec 'REDLINE' 'استقرار اصلی دست‌نخورده (server.js / index.html / sw.js — هش برابر)' $redlineOk

# پاکسازی
foreach ($p in $script:AllProcs) {
    if ($p -and -not $p.HasExited) { try { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue } catch { } }
}
if (-not $Keep) {
    foreach ($d in @('s3-wrong-hwkey', 's4-own-hwkey', 's5-tamper', 's6-naked-exe')) {
        Remove-Item -Recurse -Force (Join-Path $Dir $d) -ErrorAction SilentlyContinue
    }
    Write-Host ""
    Write-Host "  پوشه‌های سناریو (s3/s4/s5/s6) پاک شد — با -Keep بمانند"
}

Write-Host ""
Write-Host "مسیرها:"
Write-Host "  پوشهٔ تمرین     : $RD"
Write-Host "  چک‌لیست روز نصب : $Checklist"
Write-Host "  اعتبارنامهٔ موقت: $Dir\rehearsal-credentials.txt (admin / $Pw)"
Write-Host "  لاگ‌ها          : $Dir\logs\"
Write-Host ""
Write-Host "⚠ معادل لینوکسی همین ابزار (tools/rehearse.sh) در سندباکس با install.sh اجرا و 14/14 سبز شده است."
if ($script:FailCount -gt 0) {
    Write-Host ""
    Write-Host "✖ $($script:FailCount) سناریو FAIL شد — قبل از نصب واقعی رفع/بررسی شود."
    exit 1
}
Write-Host ""
Write-Host "🎉 همهٔ سناریوها PASS — آمادهٔ نصب واقعی. 🫡"
exit 0
