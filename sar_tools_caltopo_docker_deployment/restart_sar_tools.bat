@echo off
echo Restarting SAR Tools...
for /f "delims=" %%i in ('powershell -NoProfile -Command "$a=Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.IPAddress -notmatch '^(127\.|172\.|169\.)'}| Sort-Object PrefixLength | Select-Object -First 1 -ExpandProperty IPAddress; $a"') do set HOST_IP=%%i
docker compose -f docker-compose.sar-tools.yml -p sar-tools down
docker compose -f docker-compose.sar-tools.yml -p sar-tools up -d
echo Done. SAR Tools: http://localhost:5000
pause
