@echo off
echo Restarting SAR Tools...
docker compose down
docker compose up -d
echo Done. Open http://localhost:5000
pause
