import json
import os
from flask import Blueprint, jsonify, request, send_file

bp = Blueprint("system", __name__)

_VERSION_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "version.json")


@bp.get("/snapshot/latest")
def snapshot_latest():
    from routes.snapshot import latest_snapshot_path
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return "incidentName is required", 400
    path = latest_snapshot_path(incident_name)
    if not path:
        return "No snapshot available yet", 404
    return send_file(path, mimetype="text/html")


@bp.get("/api/system-info")
def api_system_info():
    version = {}
    try:
        with open(_VERSION_FILE, "r") as f:
            version = json.load(f)
    except Exception:
        pass
    return jsonify({
        "gitHash":  version.get("gitHash",  "unknown"),
        "gitDate":  version.get("gitDate",  "unknown"),
        "hostname": version.get("hostname", "unknown"),
        "dbPath":   version.get("dbPath",   "unknown"),
    })
