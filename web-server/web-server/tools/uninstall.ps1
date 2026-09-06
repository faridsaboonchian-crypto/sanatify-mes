# =====================================================================
# DEPLOY-19h — حذف نصب ویندوز Sanatify MES (متقارن با install.ps1)
# اجرا با PowerShell «Run as administrator»
#
# مصرف:
#   powershell -ExecutionPolicy Bypass -File tools\uninstall.ps1 [-KeepData]
# =====================================================================
param(
    [string]$InstallDir = "$env:ProgramFiles\SanatifyMES",
    [switch]$KeepData
)
$ErrorActionPreference = "Continue"
$ServiceName = "SanatifyMES"

Write-Host "━━━ DEPLOY-19h — حذف نصب Sanatify MES ━━━"

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Write-Host "✗ با «Run as administrator» اجرا کنید." -ForegroundColor Red; exit 1 }

# ---------- سرویس ----------
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($svc) {
    Write-Host "  سرویس: توقف + حذف $ServiceName"
    sc.exe stop $ServiceName | Out-Null
    Start-Sleep -Seconds 2
    sc.exe delete $ServiceName | Out-Null
    Write-Host "  ✓ سرویس حذف شد"
} else {
    Write-Host "  سرویس موجود نبود"
}

# ---------- فایروال ----------
netsh advfirewall firewall delete rule name="Sanatify MES" | Out-Null
Write-Host "  ✓ قاعدهٔ فایروال «Sanatify MES» حذف شد (اگر بود)"

# ---------- میانبر ----------
$lnkPath = Join-Path ([Environment]::GetFolderPath("Programs")) "Sanatify MES.lnk"
if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force; Write-Host "  ✓ میانبر Start Menu حذف شد" }

# ---------- فایل‌ها ----------
if (Test-Path $InstallDir) {
    if ($KeepData) {
        Write-Host "  --KeepData: exe/مانیفست حذف، داده‌ها (live.json/audit.json/...) می‌ماند"
        Remove-Item (Join-Path $InstallDir "sanatify-mes.exe"), (Join-Path $InstallDir "SHA256SUMS.txt"), (Join-Path $InstallDir "tenant.json.template") -Force -ErrorAction SilentlyContinue
        Write-Host "  داده‌ها در $InstallDir باقی است (حذف دستی: Remove-Item -Recurse -Force `"$InstallDir`")"
    } else {
        Write-Host "  ⚠ حذف کامل $InstallDir (شامل داده‌ها) در ۵ ثانیه… Ctrl+C برای انصراف"
        Start-Sleep -Seconds 5
        Remove-Item -Recurse -Force $InstallDir
        Write-Host "  ✓ $InstallDir حذف شد"
    }
} else {
    Write-Host "  $InstallDir موجود نبود"
}
Write-Host "━━━ حذف نصب کامل شد ━━━"
