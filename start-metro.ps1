Set-Location $PSScriptRoot
$cands = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.IPAddress -notlike '169.254.*' }
$wifi = $cands | Where-Object { $_.InterfaceAlias -like 'Wi-Fi*' } | Select-Object -First 1
if ($wifi) { $ip = $wifi.IPAddress } else { $ip = ($cands | Select-Object -First 1).IPAddress }
if (-not $ip) { Write-Host "ERROR: no usable IPv4 found." -ForegroundColor Red; exit 1 }
Write-Host "Metro HOSTNAME = $ip" -ForegroundColor Cyan
Write-Host "  In Expo Go enter manually: exp://${ip}:8081" -ForegroundColor Cyan
$env:CI = ""
$env:EXPO_OFFLINE = "1"
$env:REACT_NATIVE_PACKAGER_HOSTNAME = $ip
npm start -- -c
