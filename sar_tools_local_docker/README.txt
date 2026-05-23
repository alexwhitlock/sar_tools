SAR Tools - Local Docker Deployment
=====================================

Run SAR Tools on a local Windows PC and make it accessible to other
devices on the same LAN.


PREREQUISITES
-------------
- Docker Desktop for Windows (https://www.docker.com/products/docker-desktop/)
- A config.json file with your API credentials (see config_template.json in the repo)


FOLDER SETUP
------------
Copy this folder to C:\sar_tools_local_docker on the field PC.

  C:\sar_tools_local_docker\
    docker-compose.yml
    update.bat
    push_to_pc.bat
    config.json          <- your credentials (never shared or committed)
    data/incidents/      <- incident databases (created automatically)


FIRST RUN
---------
1. Place your config.json in this folder
2. Double-click update.bat

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
  Copy the entire sar_tools_local_docker folder to a USB stick.
  On the field PC, run push_to_pc.bat from the USB stick.
  This copies the updated files to the local sar_tools folder.
  Then run update.bat as normal.


START / STOP
------------
Start:     docker compose up -d
Stop:      docker compose down
Restart:   double-click restart.bat  (also re-detects USB stick)
View logs: docker compose logs -f


AUTO-START ON BOOT
------------------
1. Open Docker Desktop -> Settings -> General
2. Enable "Start Docker Desktop when you log in"

The container will restart automatically whenever Docker Desktop launches.


DATA PERSISTENCE
----------------
Incident databases are stored in the data/incidents/ folder next to
docker-compose.yml. They persist across restarts and rebuilds.
Back up this folder to preserve incident data.


USB BACKUP STICK (one-time setup)
----------------------------------
The app automatically writes a current HTML snapshot of each incident
to a USB stick after every change. The snapshot is a self-contained
file that can be opened and printed on any computer, even if the app
is not running.

Setup steps (do once per USB stick and once per PC):

1. Insert the USB stick.

2. Assign it drive letter Z:
   - Right-click Start -> Disk Management
   - Right-click the USB stick partition -> Change Drive Letter and Paths
   - Click Change, select Z:, click OK

3. Share the Z: drive with Docker Desktop:
   - Open Docker Desktop -> Settings -> Resources -> File Sharing
   - Add Z:\ and click Apply

4. Restart the container:
   docker compose down
   docker compose up -d

The Home tab will show "USB Backup: Connected" (green) when the stick
is present. Snapshots are written to Z:\<incident-name>\ automatically.
If the stick is removed, the app falls back to internal storage and the
indicator turns red.
