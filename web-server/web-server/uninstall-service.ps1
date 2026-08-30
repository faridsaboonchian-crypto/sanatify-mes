# =====================================================================
#  uninstall-service.ps1 - Remove auto-start service
# =====================================================================
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'SanatifyMES_WebServer.lnk'

& "$here\stop-server.ps1"
Remove-Item $lnk -ErrorAction SilentlyContinue
Write-Host "[REMOVED] Auto-start service removed." -ForegroundColor Yellow
Write-Host "  Manual run forever: node web-server\web-server\server.js" -ForegroundColor Cyan