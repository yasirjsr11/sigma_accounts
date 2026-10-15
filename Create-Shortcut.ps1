# Create-Shortcut.ps1
# Run this script once to create (or update) the "Sigma Height PMS" desktop shortcut.
# Usage: Right-click > Run with PowerShell

$AppDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$StartBat = Join-Path $AppDir "start.bat"
$IcoFile  = Join-Path $AppDir "public\img\icons\app-icon.ico"
$Desktop  = [Environment]::GetFolderPath("Desktop")
$LinkPath = Join-Path $Desktop "Sigma Height PMS.lnk"

$WShell = New-Object -ComObject WScript.Shell
$Shortcut = $WShell.CreateShortcut($LinkPath)
$Shortcut.TargetPath       = $StartBat
$Shortcut.WorkingDirectory = $AppDir
$Shortcut.IconLocation     = "$IcoFile,0"
$Shortcut.Description      = "Sigma Height PMS - Project Management System"
$Shortcut.WindowStyle      = 1
$Shortcut.Save()

Write-Host "Shortcut created: $LinkPath" -ForegroundColor Green
Write-Host "Icon: $IcoFile"
