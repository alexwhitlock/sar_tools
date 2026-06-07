@echo off
echo Restarting SAR Tools...
docker compose -f docker-compose.sar-tools.yml -p sar-tools down
docker compose -f docker-compose.sar-tools.yml -p sar-tools up -d
echo Done. SAR Tools: http://localhost:5000
pause
