@echo off
echo Fetching latest commit info from GitHub...
for /f %%i in ('powershell -Command "(Invoke-RestMethod https://api.github.com/repos/alexwhitlock/sar_tools/commits/main).sha.Substring(0,7)"') do set GIT_HASH=%%i
for /f %%i in ('powershell -Command "(Invoke-RestMethod https://api.github.com/repos/alexwhitlock/sar_tools/commits/main).commit.author.date"') do set GIT_DATE=%%i

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

echo Starting container...
docker compose up -d --force-recreate
echo Done. Open http://localhost:5000
pause
