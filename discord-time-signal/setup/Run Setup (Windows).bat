@echo off
REM launch PowerShell setup from ../scripts/
cd /d "%~dp0\.."
powershell -ExecutionPolicy Bypass -File "scripts\setup.ps1"
pause
