@echo off
echo === CalTopo Update ===
echo.
echo Ensure desktop.jar is in %USERPROFILE%\CalTopo\, then press any key to continue.
echo.
pause

echo Building and starting CalTopo...
docker compose -f docker-compose.caltopo.yml -p caltopo up -d --build --force-recreate
echo Done. CalTopo running at http://localhost:8080
pause
