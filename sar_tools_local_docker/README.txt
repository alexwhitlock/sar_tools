SAR Tools - Local Docker Deployment
=====================================

Run SAR Tools on a local Windows PC and make it accessible to other
devices on the same LAN.


PREREQUISITES
-------------
- Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/)
- A config.json file with your API credentials (see config_template.json)


FOLDER SETUP
------------
Install to %USERPROFILE%\sar_tools  (e.g. C:\Users\alex\sar_tools)
Installing under your user profile ensures Docker Desktop can reliably
read and write all files.

  sar_tools\
    docker-compose.yml
    update.bat
    restart.bat
    push_to_pc.bat
    config.json          <- your credentials (never shared or committed)
    data\incidents\      <- incident databases (created automatically)
    html_backups\        <- HTML snapshots of each incident (created automatically)


FIRST RUN
---------
1. Copy this folder to %USERPROFILE%\sar_tools
2. Copy config_template.json to config.json and fill in your credentials
3. Double-click update.bat

This pulls the latest code from GitHub, builds the Docker image, and
starts the container.


ACCESSING THE APP
-----------------
Host PC:           http://localhost:5000
Other LAN devices: http://<host-ip>:5000

To find the host PC's IP address: open Command Prompt and run "ipconfig".
Look for the IPv4 address on your local network adapter (e.g. 192.168.1.x).


UPDATING TO THE LATEST VERSION
-------------------------------
Code updates (Docker image):
  Double-click update.bat. It pulls the latest code from GitHub,
  rebuilds the Docker image, and restarts the container.

Deployment file updates (docker-compose.yml, update.bat, etc.):
  Copy the entire sar_tools folder to a USB stick.
  On the field PC, run push_to_pc.bat from the USB stick.
  This copies the updated files to the local sar_tools folder.
  Then run update.bat as normal.


START / STOP
------------
Start:     docker compose up -d
Stop:      docker compose down
Restart:   double-click restart.bat
View logs: docker compose logs -f


AUTO-START ON BOOT
------------------
1. Open Docker Desktop -> Settings -> General
2. Enable "Start Docker Desktop when you log in"

The container will restart automatically whenever Docker Desktop launches.


DATA PERSISTENCE
----------------
Incident databases are stored in the data\incidents\ folder.
HTML backups are stored in the html_backups\ folder.
Both persist across container restarts and rebuilds.
Back up these folders to preserve incident data.
