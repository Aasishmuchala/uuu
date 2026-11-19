@echo off
rem Company Engine: sets this PC up for the Mac that made this stick. Double-click it.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0files\setup.ps1"
echo.
pause
