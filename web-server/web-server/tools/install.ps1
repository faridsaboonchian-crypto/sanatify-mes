# =====================================================================
# DEPLOY-19h — نصب‌کنندهٔ ویندوز Sanatify MES (دموی تجاری روی VM مشتری)
# اجرا با PowerShell «Run as administrator»
#
# مصرف:
#   powershell -ExecutionPolicy Bypass -File tools\install.ps1 [-SourceDir "...\dist\bin"] [-Port 3001]
#
# کارها: کپی باینری+مانیفست به Program Files → سرویس sc.exe → فایروال 3001 →
#        میانبر Start Menu → چاپ HWKEY + راهنمای امضای لایسنس (SEC-BIND-19f)
# =====================================================================
param(
    [string]$SourceDir = "",
    [int]$Port = 3001,
    [string]$InstallDir = "$env:ProgramFiles\SanatifyMES"
)
$ErrorActionPreference = "Stop"
$ServiceName = "SanatifyMES"

Write-Host "━━━ DEPLOY-19h — نصب Sanatify MES ━━━"

# ---------- گارد ادمین ----------
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "✗ با «Run as administrator» اجرا کنید." -ForegroundColor Red; exit 1 }

# ---------- یافتن باینری ----------
if ($SourceDir -eq "") {
    $candidates = @(
        (Join-Path $PSScriptRoot "bin"),
        (Join-Path $PSScriptRoot "..\dist\bin"),
        (Join-Path $PSScriptRoot),
        (Get-Location).Path
    )
    foreach ($c in $candidates) { if (Test-Path (Join-Path $c "sanatify-mes-node18-win-x64.exe")) { $SourceDir = $c; break } }
}
$exe = Join-Path $SourceDir "sanatify-mes-node18-win-x64.exe"
if (-not (Test-Path $exe)) { Write-Host "✗ باینری یافت نشد: $exe — با -SourceDir مسیر بدهید." -ForegroundColor Red; exit 1 }
Write-Host "  باینری : $exe"
Write-Host "  مقصد   : $InstallDir"

# ---------- کپی ----------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
# توقف سرویس قبلی هنگام ارتقا (فایل قفل نمی‌ماند)
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) { Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 2 }
Copy-Item $exe (Join-Path $InstallDir "sanatify-mes.exe") -Force
$sums = Join-Path $SourceDir "SHA256SUMS.txt"
if (Test-Path $sums) { Copy-Item $sums (Join-Path $InstallDir "SHA256SUMS.txt") -Force; Write-Host "  ✓ SHA256SUMS.txt کنار exe — ضد دستکاری SEC-ANTI-19g فعال" }
else { Write-Host "  ✖⚠ SHA256SUMS.txt کنار باینری نیست! exe بالا نخواهد آمد (SEC-ANTI-19g)." -ForegroundColor Red }
$tpl = Join-Path $SourceDir "..\tenant.json.template"
if (Test-Path $tpl) { Copy-Item $tpl (Join-Path $InstallDir "tenant.json.template") -Force }

# ---------- سرویس ویندوز ----------
if (-not $svc) {
    sc.exe create $ServiceName binPath= "`"$InstallDir\sanatify-mes.exe`"" start= auto DisplayName= "Sanatify MES" | Out-Null
    sc.exe description $ServiceName "Sanatify MES - Server (Steel Manufacturing)" | Out-Null
    Write-Host "  ✓ سرویس $ServiceName ساخته شد (auto-start)"
}
sc.exe start $ServiceName | Out-Null
Write-Host "  ✓ سرویس شروع شد"

# ---------- فایروال ----------
$rule = netsh advfirewall firewall show rule name="Sanatify MES" 2>$null
if ($rule -match "No rules match") {
    netsh advfirewall firewall add rule name="Sanatify MES" dir=in action=allow protocol=TCP localport=$Port | Out-Null
    Write-Host "  ✓ فایروال: پورت $Port/tcp باز شد"
} else {
    Write-Host "  فایروال: قاعدهٔ قبلی موجود است"
}

# ---------- میانبر Start Menu ----------
try {
    $sm = [Environment]::GetFolderPath("Programs")
    $wsh = New-Object -ComObject WScript.Shell
    $lnk = $wsh.CreateShortcut((Join-Path $sm "Sanatify MES.lnk"))
    $lnk.TargetPath = "http://localhost:$Port"
    $lnk.Description = "Sanatify MES Web Panel"
    $lnk.Save()
    Write-Host "  ✓ میانبر Start Menu ساخته شد"
} catch { Write-Host "  ⚠ میانبر ساخته نشد (غیرمرگبار): $($_.Exception.Message)" }

# ---------- انتظار برای health ----------
Write-Host -NoNewline "  health "
$hasTenant = (Test-Path (Join-Path $InstallDir "tenant.json")) -or (Test-Path (Join-Path $InstallDir "tenant.json.enc"))
$ok = $false
if ($hasTenant) {
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri "http://127.0.0.1:$Port/api/health"
            if ($r.Content -match '"ok":true') { $ok = $true; break }
        } catch { }
        Write-Host -NoNewline "."
        Start-Sleep -Seconds 1
    }
}
Write-Host ""
if ($ok) { Write-Host "  ✓ سرور روی پورت $Port پاسخ می‌دهد" -ForegroundColor Green }
elseif (-not $hasTenant) {
    Write-Host "  ℹ tenant.json امضاشده هنوز نیست ⇒ باینری تا کپی لایسنس بالا نمی‌آید (SEC-ANTI-19h — طبیعی و عمدی)."
    Write-Host "    ادامهٔ راه در پایین: HWKEY را بفرستید → tenant.json بگیرید → در $InstallDir کپی → sc.exe start $ServiceName"
}
else { Write-Host "  ✖ سرور بالا نیامد — لاگ: Event Viewer یا اجرای دستی exe کنسولی" -ForegroundColor Red }

# ---------- HWKEY + راهنمای لایسنس ----------
$hwkey = & (Join-Path $InstallDir "sanatify-mes.exe") --print-hwkey 2>$null | Select-Object -Last 1
Write-Host "━━━ قفل سخت‌افزاری (SEC-BIND-19f) ━━━"
Write-Host "  HWKEY این ماشین : $hwkey"
Write-Host ""
Write-Host "  گام بعدی (روی ماشین فروشنده):"
Write-Host "    node tools/license.js --hwkey=$hwkey --only=summary,production,inventory,quality,maintenance --expires=YYYY-MM-DD --sign --sign-ed"
Write-Host "    → tenant.json امضاشده را کنار exe ($InstallDir) کپی کنید، سپس:"
Write-Host "    sc.exe stop $ServiceName ; sc.exe start $ServiceName"
Write-Host ""
Write-Host "  مدیریت سرویس:  sc.exe query $ServiceName | sc.exe stop $ServiceName | sc.exe start $ServiceName | sc.exe delete $ServiceName"
Write-Host "  وب اپ :  http://localhost:$Port"
Write-Host "  حذف نصب :  powershell -File tools\uninstall.ps1"
Write-Host "━━━ نصب کامل شد ━━━"
