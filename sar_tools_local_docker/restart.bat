@echo off
echo Restarting SAR Tools...
docker compose down
if exist "Z:\" (
    echo USB stick detected - enabling USB backup.
    docker compose -f docker-compose.yml -f docker-compose.usb.yml up -d
) else (
    echo No USB stick on Z: - running without USB backup.
    docker compose up -d
)
echo Done. Open http://localhost:5000
pause
