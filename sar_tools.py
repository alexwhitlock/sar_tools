import json
import os
import threading
import webbrowser
from pathlib import Path


import logging
logging.basicConfig(level=logging.INFO)

from flask import Flask, jsonify, request, render_template, send_from_directory

from db.database import get_connection, get_db_path_for_incident
from db.migrations import run_migrations
from db.schema_dump import write_schema_dump

from db.personnel_repo import (
    list_personnel_with_team,
    add_person,
    update_person,
    delete_person
)



# ================= Flask App =================
app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)

# ============== Regiser the blueprints (routes in other files)
from routes.caltopo import bp as caltopo_bp
app.register_blueprint(caltopo_bp)

# ================= Load Config File =================
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")

try:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
        CRED_ID = config.get("cred_id", "").strip()
        CRED_SECRET_B64 = config.get("cred_secret_b64", "").strip()
        if not CRED_ID or not CRED_SECRET_B64:
            raise ValueError("Missing cred_id or cred_secret_b64")
except Exception as e:
    raise RuntimeError(f"Failed to load API config: {e}")

app.config["CRED_ID"] = CRED_ID
app.config["CRED_SECRET_B64"] = CRED_SECRET_B64

# ================= Routes =================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify(success=True, status="OK")


@app.route("/help/<path:filename>")
def help_files(filename):
    return send_from_directory("help", filename)


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp

# ==================  Create Incident ==========================
@app.post("/api/incident/init")
def api_incident_init():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    with get_connection(incident_name) as conn:
        run_migrations(conn)
        db_path = get_db_path_for_incident(incident_name)

    incident_id = os.path.splitext(os.path.basename(db_path))[0]

    return jsonify({
        "ok": True,
        "incidentName": incident_name,
        "incidentId": incident_id   # ✅ THIS is the key
    })




# ======================= Personnel ===================================
@app.get("/api/personnel")
def api_personnel_list():
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    try:
        rows = list_personnel_with_team(incident_name)
        return jsonify(rows)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.post("/api/personnel/add")
def api_personnel_add():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    name = (data.get("name") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    try:
        new_id = add_person(incident_name, name=name)
        return jsonify({"ok": True, "id": new_id})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    
@app.post("/api/personnel/update")
def api_personnel_update():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    person_key = data.get("personKey")
    name = (data.get("name") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if person_key in (None, ""):
        return jsonify({"ok": False, "error": "personKey is required"}), 400
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    try:
        ok = update_person(incident_name, person_id=int(person_key), name=name)
        if not ok:
            return jsonify({"ok": False, "error": "person not found"}), 404
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.post("/api/personnel/delete")
def api_personnel_delete():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    person_key = data.get("personKey")

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if person_key in (None, ""):
        return jsonify({"ok": False, "error": "personKey is required"}), 400

    try:
        ok = delete_person(incident_name, person_id=int(person_key))
        if not ok:
            return jsonify({"ok": False, "error": "person not found"}), 404
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

   

#================== Get Incidents ============================
@app.get("/api/incidents")
def api_incidents_list():
    probe_path = Path(get_db_path_for_incident("__probe__"))  # e.g. .../foo.sqlite3
    inc_dir = probe_path.parent
    suffix = probe_path.suffix  # ".sqlite3"

    inc_dir.mkdir(parents=True, exist_ok=True)

    incidents = [{"incidentName": p.stem} for p in inc_dir.glob(f"*{suffix}")]
    incidents.sort(key=lambda x: x["incidentName"].lower())

    return jsonify({"ok": True, "incidents": incidents})


# ================= Startup =================

def open_browser():
    webbrowser.open("http://localhost:5000")


if __name__ == "__main__":
    threading.Timer(1, open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
