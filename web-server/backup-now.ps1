# =====================================================================
#  backup-now.ps1 - manual immediate backup of local data files
#  Use BEFORE making changes, or whenever you want an extra snapshot.
# =====================================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$backupDir = Join-Path $here 'backups'
if (-not (Test-Path $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$stamp = (Get-Date).ToString('yyyyMMdd_HHmm')
$copied = 0
foreach ($f in @('live.json', 'data.json')) {
    $src = Join-Path $here $f
    if (Test-Path $src) {
        $name = [IO.Path]::GetFileNameWithoutExtension($f)
        Copy-Item $src (Join-Path $backupDir ($name + '_' + $stamp + '.json')) -Force
        $copied++
        Write-Host "[OK] $f backed up" -ForegroundColor Green
    }
    else {
        Write-Host "[--] $f not found" -ForegroundColor Gray
    }
}
Write-Host "Manual backup done: $copied file(s) -> $backupDir" -ForegroundColor Cyan