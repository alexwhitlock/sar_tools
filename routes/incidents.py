# routes/incidents.py
import os
from pathlib import Path

from flask import Blueprint, jsonify, request

from db.database import get_connection, get_db_path_for_incident
from db.migrations import run_migrations

bp = Blueprint("incidents", __name__)

# ===============================
# API Routes
# ===============================

@bp.post("/api/incident/create")
def api_incident_create():
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
        "incidentId": incident_id
    })

@bp.post("/api/incident/open")
def api_incident_open():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    # If it doesn't exist, fail (create is separate)
    db_path = get_db_path_for_incident(incident_name)
    if not Path(db_path).exists():
        return jsonify({"ok": False, "error": "incident does not exist"}), 404

    # Ensure schema is current
    with get_connection(incident_name) as conn:
        run_migrations(conn)

    incident_id = os.path.splitext(os.path.basename(db_path))[0]

    return jsonify({
        "ok": True,
        "incidentName": incident_name,
        "incidentId": incident_id
    })

@bp.get("/api/get_incidents")
def api_get_incidents():
    probe_path = Path(get_db_path_for_incident("__probe__"))
    inc_dir = probe_path.parent
    suffix = probe_path.suffix

    inc_dir.mkdir(parents=True, exist_ok=True)

    incidents = [{"incidentName": p.stem} for p in inc_dir.glob(f"*{suffix}")]
    incidents.sort(key=lambda x: x["incidentName"].lower())

    return jsonify({"ok": True, "incidents": incidents})