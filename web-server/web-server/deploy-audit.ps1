# deploy-audit.ps1 — Deploy sanatify-mes (branch audit-traceability) to the company PC.
# Run folder:  D:\MES  SANATIFY APP\web-server\web-server   (no git remote — files only)
# Clone folder: D:\sanatify-mes-clone                        (git pull happens there)
# Usage: powershell -ExecutionPolicy Bypass -File deploy-audit.ps1

$src = 'D:\sanatify-mes-clone\web-server\web-server'
$dst = 'D:\MES  SANATIFY APP\web-server\web-server'

Write-Host '[1/5] Backup current live.json ...'
$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
Copy-Item "$dst\live.json" "$dst\live.json.bak.$stamp" -Force
Write-Host "      backup saved: live.json.bak.$stamp"

Write-Host '[2/5] Copy new files ...'
$files = @('server.js', 'live.json', 'public\trace.html', 'public\cal.html', 'public\docs.html')
foreach ($f in $files) {
    Copy-Item "$src\$f" "$dst\$f" -Force
    Write-Host "      copied: $f"
}

Write-Host '[3/5] Restart scheduled task SanatifyMES ...'
try { schtasks /end /tn "SanatifyMES" | Out-Null } catch {}
Start-Sleep -Seconds 3
schtasks /run /tn "SanatifyMES" | Out-Null

Write-Host '[4/5] Wait for server to come up ...'
Start-Sleep -Seconds 6

Write-Host '[5/5] Health check ...'
[System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
try {
    $r = Invoke-WebRequest -Uri 'https://localhost:3000/' -UseBasicParsing -TimeoutSec 15
    Write-Host "      OK - StatusCode: $($r.StatusCode)"
} catch {
    Write-Host "      Check failed: $($_.Exception.Message)"
    Write-Host '      Open https://localhost:3000 in the browser to verify manually.'
}

Write-Host ''
Write-Host 'Done. Pages:'
Write-Host '  https://localhost:3000/trace.html'
Write-Host '  https://localhost:3000/cal.html'
Write-Host '  https://localhost:3000/docs.html'
