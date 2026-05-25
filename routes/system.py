import json
import os
from flask import Blueprint, jsonify, request, send_file

bp = Blueprint("system", __name__)

_VERSION_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "version.json")


@bp.get("/snapshot/latest")
def snapshot_latest():
    from routes.snapshot import _query, _render
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return "incidentName is required", 400
    data = _query(incident_name)
    if data is None:
        return "Incident not found", 404
    html = _render(incident_name, data)
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


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
