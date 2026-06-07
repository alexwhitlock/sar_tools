@echo off
setlocal

echo === SAR Tools + CalTopo Setup ===
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Run this script as Administrator.
    pause
    exit /b 1
)

:: ── Create SAR Tools data folders ──────────────────────────────
echo Creating SAR Tools data folders...
mkdir "%USERPROFILE%\sar-tools\data\incidents" 2>nul
mkdir "%USERPROFILE%\sar-tools\html_backups" 2>nul

:: ── Create CalTopo data folder ──────────────────────────────────
echo Creating CalTopo data folder...
mkdir "%USERPROFILE%\CalTopo" 2>nul

:: ── Copy config template if first install ──────────────────────
if not exist "%USERPROFILE%\sar-tools\config.json" (
    copy "%~dp0config_template.json" "%USERPROFILE%\sar-tools\config.json" >nul
    echo Created config.json from template.
)

:: ── Chrome: allow HTTP downloads from SAR Tools ────────────────
echo Setting Chrome download policy...
reg add "HKLM\SOFTWARE\Policies\Google\Chrome\InsecureContentAllowedForUrls" /v "1" /t REG_SZ /d "http://*:5000" /f >nul

:: ── Edge: allow HTTP downloads from SAR Tools ──────────────────
echo Setting Edge download policy...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge\InsecureContentAllowedForUrls" /v "1" /t REG_SZ /d "http://*:5000" /f >nul

:: ── Task Scheduler: USB backup ─────────────────────────────────
echo Creating USB backup task...
schtasks /create /tn "SAR Tools USB Backup" ^
  /tr "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%~dp0usb-backup.ps1\"" ^
  /sc onlogon /ru "%USERDOMAIN%\%USERNAME%" /f >nul

echo.
echo === Setup Complete ===
echo.
echo Next steps:
echo   1. Copy desktop.jar to %USERPROFILE%\CalTopo\
echo   2. Edit %USERPROFILE%\sar-tools\config.json with your credentials
echo   3. Run update_sar_tools.bat to build and start SAR Tools
echo   4. Run update_caltopo.bat to build and start CalTopo
echo.
pause
