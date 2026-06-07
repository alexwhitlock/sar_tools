@echo off
setlocal enabledelayedexpansion

echo === SAR Tools Update ===
echo.

:: Detect host LAN IP (always works, no internet needed)
echo Detecting host LAN IP...
for /f "delims=" %%i in ('powershell -NoProfile -Command "$a=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notmatch '^(127\.|172\.|169\.)'}| Sort-Object PrefixLength | Select-Object -First 1 -ExpandProperty IPAddress; $a"') do set HOST_IP=%%i
if defined HOST_IP (echo Detected: %HOST_IP%) else (echo Warning: could not detect host IP)
echo.

:: Check GitHub connectivity
echo Checking GitHub connectivity...
powershell -NoProfile -Command "try { Invoke-RestMethod 'https://api.github.com/repos/alexwhitlock/sar_tools/commits/main' -TimeoutSec 8 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 goto :no_internet

:: ── Full update (GitHub reachable) ───────────────────────────────────────────
echo GitHub reachable. Fetching latest commit info...
for /f %%i in ('powershell -NoProfile -Command "(Invoke-RestMethod https://api.github.com/repos/alexwhitlock/sar_tools/commits/main).sha.Substring(0,7)"') do set GIT_HASH=%%i
for /f %%i in ('powershell -NoProfile -Command "(Invoke-RestMethod https://api.github.com/repos/alexwhitlock/sar_tools/commits/main).commit.author.date"') do set GIT_DATE=%%i

echo Commit: %GIT_HASH%  Deployed: %GIT_DATE%
echo.

echo Building sar_tools image from GitHub...
docker build https://github.com/alexwhitlock/sar_tools.git#main ^
  --build-arg GIT_HASH=%GIT_HASH% ^
  --build-arg GIT_DATE=%GIT_DATE% ^
  --build-arg HOST_HOSTNAME=%COMPUTERNAME% ^
  --build-arg HOST_DB_PATH=/app/data ^
  -t sar_tools:local
if %errorlevel% neq 0 (
    echo Build failed.
    pause
    exit /b 1
)
goto :start_container


:: ── No internet — offer HOST_IP-only update ───────────────────────────────────
:no_internet
echo Cannot reach GitHub - no internet or GitHub is down.
echo Full code update is not possible.
echo.

:: Get the HOST_IP currently running in the container
docker inspect sar_tools --format "{{range .Config.Env}}{{println .}}{{end}}" 2>nul | findstr /B "HOST_IP=" > "%TEMP%\_sar_host_ip.txt" 2>nul
set CURRENT_HOST_IP=(not set)
for /f "tokens=2 delims==" %%i in (%TEMP%\_sar_host_ip.txt) do set CURRENT_HOST_IP=%%i
del "%TEMP%\_sar_host_ip.txt" 2>nul

echo   Current HOST_IP (in container) : %CURRENT_HOST_IP%
echo   Detected HOST_IP (this machine) : %HOST_IP%
echo.
choice /c YC /m "Update HOST_IP and restart container (Y), or Cancel (C)"
if errorlevel 2 goto :cancelled
goto :start_container


:: ── Start/restart container ───────────────────────────────────────────────────
:start_container
echo.
echo Starting container...
docker compose -f docker-compose.sar-tools.yml -p sar-tools up -d --force-recreate
if %errorlevel% neq 0 (
    echo Failed to start container.
    pause
    exit /b 1
)
echo Done. Open http://localhost:5000
pause
exit /b 0


:cancelled
echo Cancelled.
pause
exit /b 0
