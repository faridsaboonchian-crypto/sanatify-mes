# ===== HARDEN-18O: watchdog ویندوز (PowerShell — صفر وابستگی؛ برای استقرار کارخانه) =====
# استفاده:
#   powershell -ExecutionPolicy Bypass -File tools\watchdog.ps1 -Port 3001 [-IntervalSec 30] [-Threshold 2]
# توقف: فایل tools\watchdog.stop بسازید یا Ctrl+C
param(
    [int]$Port = 3001,
    [int]$IntervalSec = 30,
    [int]$Threshold = 2
)
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)   # web-server\web-server
$LogDir = Join-Path $Root 'logs'
$Log = Join-Path $LogDir 'watchdog.log'
$StopFile = Join-Path $Root 'tools\watchdog.stop'
$Url = "http://127.0.0.1:$Port/api/health"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
function Write-WdLog([string]$msg) {
    $line = ("{0} watchdog: {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'), $msg)
    Add-Content -Path $Log -Value $line
    Write-Host $line
}
Write-WdLog "start -> $Url (interval=${IntervalSec}s threshold=$Threshold)"
$fails = 0
while ($true) {
    if (Test-Path $StopFile) { Write-WdLog 'stop (stopfile)'; Remove-Item $StopFile -ErrorAction SilentlyContinue; exit 0 }
    $code = '000'
    try {
        $resp = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
        $code = [string]$resp.StatusCode
    } catch {
        if ($_.Exception.Response) { $code = [string][int]$_.Exception.Response.StatusCode } else { $code = '000' }
    }
    if ($code -eq '200') {
        if ($fails -gt 0) { Write-WdLog "health OK (200) — $fails شکست قبلی پاک شد" }
        $fails = 0
    } else {
        $fails++
        Write-WdLog "health FAIL (code=$code) — شکست $fails از $Threshold"
        if ($fails -ge $Threshold) {
            Write-WdLog 'RESTART: سرور پاسخ نمی‌دهد — اجرای مجدد'
            Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -and (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)" -ErrorAction SilentlyContinue).CommandLine -match 'server\.js' } | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
            Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir 'server-stdout.log') -RedirectStandardError (Join-Path $LogDir 'server-stderr.log')
            Write-WdLog "RESTART: دستور اجرا شد — بررسی بعدی ${IntervalSec}s دیگر"
            $fails = 0
        }
    }
    Start-Sleep -Seconds $IntervalSec
}
