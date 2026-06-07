@echo off
echo Restarting CalTopo...
docker compose -f docker-compose.caltopo.yml -p caltopo down
docker compose -f docker-compose.caltopo.yml -p caltopo up -d
echo Done. CalTopo: http://localhost:8080
pause
