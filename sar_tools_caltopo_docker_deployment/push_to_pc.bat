@echo off
setlocal

set DEFAULT=%USERPROFILE%\sar_tools_caltopo_docker_deployment
set IS_NEW=0

echo SAR Tools - Push to PC
echo ======================
echo.
choice /c NUC /m "Is this a (N)ew install, (U)pdate to an existing installation, or (C)ancel"
if errorlevel 3 goto :cancel
if errorlevel 2 goto :update
if errorlevel 1 goto :new_install


:: ── New install ──────────────────────────────────────────────
:new_install
set IS_NEW=1
echo.
choice /c YNC /m "Install to default location (%DEFAULT%) — (Y)es, (N)o (choose path), (C)ancel"
if errorlevel 3 goto :cancel
if errorlevel 2 goto :new_custom
set DEST=%DEFAULT%
goto :check_dest

:new_custom
set DEST=
set /p DEST=Enter installation path (or press Enter to cancel):
if "%DEST%"=="" goto :cancel
goto :check_dest

:check_dest
if not exist "%DEST%" goto :do_mkdir
echo.
echo Folder already exists: %DEST%
choice /c OUC /m "Would you like to (O)verwrite existing files, switch to (U)pdate mode, or (C)ancel"
if errorlevel 3 goto :cancel
if errorlevel 2 goto :switch_to_update
goto :do_copy

:switch_to_update
set IS_NEW=0
goto :do_copy

:do_mkdir
mkdir "%DEST%"
if not exist "%DEST%" (
    echo ERROR: Could not create folder %DEST%
    echo Check that the path is valid and you have permission to create it.
    echo You can try creating the folder manually first, then re-run this script.
    pause
    exit /b 1
)
echo Created %DEST%
goto :do_copy


:: ── Update ───────────────────────────────────────────────────
:update
if exist "%DEFAULT%\update_sar_tools.bat" (
    set DEST=%DEFAULT%
    goto :do_copy
)
echo Default location %DEFAULT% not found.
set DEST=
set /p DEST=Enter path to existing installation (or press Enter to cancel):
if "%DEST%"=="" goto :cancel

if not exist "%DEST%\update_sar_tools.bat" (
    echo ERROR: Could not find an existing installation at %DEST%
    pause
    exit /b 1
)
goto :do_copy


:: ── Copy files ───────────────────────────────────────────────
:do_copy
echo.
echo Copying files to %DEST%...
for %%f in (
    docker-compose.sar-tools.yml
    docker-compose.caltopo.yml
    Dockerfile.caltopo
    update_sar_tools.bat
    update_caltopo.bat
    restart_sar_tools.bat
    restart_caltopo.bat
    setup.bat
    usb-backup.ps1
    config_template.json
    .env
    README.txt
) do copy /Y "%~dp0%%f" "%DEST%\%%f"

echo.
echo Done.
if "%IS_NEW%"=="1" (
    echo.
    echo New install: run setup.bat next to finish configuring the PC.
) else (
    echo Run update_sar_tools.bat to rebuild and restart the containers.
)
pause
exit /b 0


:: ── Cancel ───────────────────────────────────────────────────
:cancel
echo.
echo Cancelled.
exit /b 0
