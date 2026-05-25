@echo off
setlocal

set DEFAULT=%USERPROFILE%\sar_tools
set IS_NEW=0

echo SAR Tools - Push to PC
echo ======================
echo.
choice /c NU /m "Is this a (N)ew install or (U)pdate to an existing installation"
if errorlevel 2 goto :update
if errorlevel 1 goto :new_install


:: ── New install ──────────────────────────────────────────────
:new_install
set IS_NEW=1
echo.
choice /c YN /m "Install to default location (%DEFAULT%)"
if errorlevel 2 goto :new_custom
if errorlevel 1 (
    set DEST=%DEFAULT%
    goto :do_copy
)

:new_custom
set /p DEST=Enter installation path:
goto :do_copy


:: ── Update ───────────────────────────────────────────────────
:update
if exist "%DEFAULT%\update.bat" (
    set DEST=%DEFAULT%
    goto :do_copy
)
echo Default location %DEFAULT% not found.
set /p DEST=Enter path to existing installation:

if not exist "%DEST%\update.bat" (
    echo ERROR: Could not find an existing installation at %DEST%
    pause
    exit /b 1
)
goto :do_copy


:: ── Copy files ───────────────────────────────────────────────
:do_copy
if "%IS_NEW%"=="1" (
    if not exist "%DEST%" (
        mkdir "%DEST%"
        if %errorlevel% neq 0 (
            echo ERROR: Could not create folder %DEST%
            echo Check that the path is valid and you have permission to create it.
            pause
            exit /b 1
        )
        echo Created %DEST%
    ) else (
        echo Folder already exists: %DEST%
    )
)

echo.
echo Copying files to %DEST%...
echo push_to_pc.bat > "%TEMP%\xcopy_exclude.txt"
xcopy /Y /EXCLUDE:"%TEMP%\xcopy_exclude.txt" "%~dp0*" "%DEST%\"
del "%TEMP%\xcopy_exclude.txt"

echo.
echo Done. Run update.bat from %DEST% to rebuild and restart the container.
if "%IS_NEW%"=="1" echo Note: fill in config.json with your credentials before running update.bat.
pause
exit /b 0
