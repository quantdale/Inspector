$ErrorActionPreference = "SilentlyContinue"
Write-Host "== StartApps matches =="
Get-StartApps | Where-Object { $_.Name -match "calc|paint|notepad" } | Select-Object -First 6 Name, AppID | Format-Table -AutoSize
Write-Host "== System32 =="
Write-Host ("calc.exe: " + (Test-Path "C:\Windows\System32\calc.exe"))
Write-Host ("mspaint.exe: " + (Test-Path "C:\Windows\System32\mspaint.exe"))
Write-Host ("notepad.exe: " + (Test-Path "C:\Windows\System32\notepad.exe"))
Write-Host "== Notepad Appx =="
Get-AppxPackage -Name "*Notepad*" | Select-Object -First 1 Name, Version | Format-List
