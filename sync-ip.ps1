$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$file = Join-Path $root 'src\services\supabaseClient.ts'
$cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }
$wifi = $cands | Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' } | Select-Object -First 1
if ($wifi) { $ip = $wifi.IPAddress } else { $ip = ($cands | Select-Object -First 1).IPAddress }
if (-not $ip) { Write-Host "ERROR: no usable IPv4 found." -ForegroundColor Red; exit 1 }
$utf8 = New-Object System.Text.UTF8Encoding($false)
$content = [System.IO.File]::ReadAllText($file, $utf8)
$pattern = "(INTERNAL_SERVER_URL\s*=\s*')http://[^']+(')"
if ($content -notmatch $pattern) { Write-Host "ERROR: INTERNAL_SERVER_URL line not found." -ForegroundColor Red; exit 1 }
$new = [regex]::Replace($content, $pattern, "`${1}http://${ip}:3000`${2}")
[System.IO.File]::WriteAllText($file, $new, $utf8)
Write-Host "[OK] INTERNAL_SERVER_URL -> http://${ip}:3000" -ForegroundColor Green
Write-Host "  Now reload Metro / Expo Go to apply." -ForegroundColor Cyan
