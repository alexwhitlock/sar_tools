SAR Tools + CalTopo - Local Docker Deployment
==============================================

Runs SAR Tools and CalTopo Desktop as Docker containers on a Windows PC,
accessible to all devices on the same LAN.


PREREQUISITES
-------------
- Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/)
  Settings > General > enable "Start Docker Desktop when you log in"
- A config.json with your API credentials (see config_template.json)
- CalTopo desktop.jar (download from caltopo.com/downloads, "jar only")


FOLDER LAYOUT (after install)
------------------------------
%USERPROFILE%\sar_tools_caltopo_docker_deployment\   <- management scripts
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

%USERPROFILE%\sar-tools\                             <- SAR Tools data
  config.json                                        <- your credentials
  data\incidents\                                    <- incident databases
  html_backups\                                      <- HTML snapshots

%USERPROFILE%\CalTopo\                               <- CalTopo data
  desktop.jar                                        <- place here manually
  topo.properties                                    <- auto-created on first run
  (tiles, maps, etc.)


FIRST INSTALL ON A NEW PC
--------------------------
1. Run push_to_pc.bat from the USB stick — choose (N)ew install
   Creates %USERPROFILE%\sar_tools_caltopo_docker_deployment\ and copies scripts
2. Run setup.bat as Administrator
   Creates sar-tools\ and CalTopo\ data folders, sets browser policies,
   creates USB backup Task Scheduler task
3. Copy desktop.jar to %USERPROFILE%\CalTopo\
4. Edit %USERPROFILE%\sar-tools\config.json with your credentials
5. Double-click update_sar_tools.bat
6. Double-click update_caltopo.bat


ACCESSING THE APP
-----------------
SAR Tools:  http://<host-ip>:5000
CalTopo:    http://<host-ip>:8080

To find the host IP: open Command Prompt and run "ipconfig"
Look for the IPv4 address on your local network adapter (e.g. 192.168.1.x).


UPDATING SAR TOOLS (code updates)
----------------------------------
Double-click update_sar_tools.bat. Pulls latest from GitHub, rebuilds
the image, and restarts the container. CalTopo is unaffected.


UPDATING CALTOPO
----------------
1. Download the new desktop.jar from caltopo.com/downloads ("jar only")
2. Place it in %USERPROFILE%\CalTopo\
3. Double-click update_caltopo.bat


UPDATING DEPLOYMENT FILES (scripts, compose files, etc.)
---------------------------------------------------------
Run push_to_pc.bat from the USB stick — choose (U)pdate.
Then run update_sar_tools.bat and update_caltopo.bat as normal.


START / STOP / RESTART
-----------------------
Restart SAR Tools:  double-click restart_sar_tools.bat
Restart CalTopo:    double-click restart_caltopo.bat
View SAR logs:      docker compose -f docker-compose.sar-tools.yml -p sar-tools logs -f
View CalTopo logs:  docker compose -f docker-compose.caltopo.yml -p caltopo logs -f


USB BACKUP
----------
SAR Tools automatically snapshots each incident to sar-tools\html_backups\
(last 3 kept). If a USB stick labelled "sar-tools-backup" is plugged in,
snapshots are mirrored to it automatically in the background. The USB files
are readable in any browser on any PC — no server needed.


WINDOWS UPDATE CHECKLIST
-------------------------
After any Windows update on this PC, verify:
  1. Docker Desktop starts cleanly
  2. SAR Tools is running:  http://localhost:5000
  3. CalTopo is running:    http://localhost:8080
  4. USB backup task ran recently (check Task Scheduler)
