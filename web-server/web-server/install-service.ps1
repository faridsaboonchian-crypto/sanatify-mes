# =====================================================================
#  install-service.ps1 - Install auto-start service for Sanatify MES web server
#  No download, no Admin rights. Uses Startup folder + VBScript watchdog.
# =====================================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverJs = Join-Path $here 'server.js'
$vbsPath = Join-Path $here 'start-server.vbs'
$flagPath = Join-Path $here 'stop.flag'

if (-not (Test-Path $serverJs)) { Write-Host "ERROR: server.js not found in $here" -ForegroundColor Red; exit 1 }

# 1) find node.exe from PATH
$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { Write-Host "ERROR: node.exe not found in PATH." -ForegroundColor Red; exit 1 }

# 2) remove stop flag if leftover
Remove-Item $flagPath -ErrorAction SilentlyContinue

# 3) build VBScript watchdog (hidden + restart on crash + backoff + stop flag)
$vbsTpl = @'
' Sanatify MES Web Server - hidden watchdog launcher (no console window)
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
nodeExe  = "__NODE__"
serverJs = "__SERVER__"
flagPath = "__FLAG__"
failCount = 0
Do
  If fso.FileExists(flagPath) Then Exit Do
  t0 = Timer
  ' window 0 = hidden, True = wait until node exits
  WshShell.Run Chr(34) & nodeExe & Chr(34) & " " & Chr(34) & serverJs & Chr(34), 0, True
  t1 = Timer
  If fso.FileExists(flagPath) Then Exit Do
  ' if node died too fast (<5s, e.g. port busy), increase counter
  If (t1 - t0) < 5 Then
    failCount = failCount + 1
    If failCount >= 5 Then Exit Do
  Else
    failCount = 0
  End If
  WScript.Sleep 3000
Loop
'@
$vbs = $vbsTpl.Replace('__NODE__', $nodeExe).Replace('__SERVER__', $serverJs).Replace('__FLAG__', $flagPath)
[System.IO.File]::WriteAllText($vbsPath, $vbs, (New-Object System.Text.UTF8Encoding($false)))

# 4) create Shortcut in Startup folder (auto-run on logon, no window)
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'SanatifyMES_WebServer.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = 'wscript.exe'
$sc.Arguments = "`"$vbsPath`""
$sc.WorkingDirectory = $here
$sc.WindowStyle = 7
$sc.Description = 'Sanatify MES Web Server (auto-start on logon)'
$sc.Save()

Write-Host ""
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  Sanatify MES service installed OK" -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
Write-Host "  node.exe   : $nodeExe"
Write-Host "  launcher   : $vbsPath"
Write-Host "  startup lnk: $lnk"
Write-Host ""
Write-Host "  From next logon, server starts automatically (hidden)." -ForegroundColor Cyan
Write-Host "  Run now (no wait):  .\start-server.ps1" -ForegroundColor Cyan
Write-Host "  Stop manually:      .\stop-server.ps1" -ForegroundColor Cyan
Write-Host "  Uninstall service:  .\uninstall-service.ps1" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Green