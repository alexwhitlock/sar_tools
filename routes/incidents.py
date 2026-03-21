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


_ALLOWED_SETTINGS_KEYS = {"linked_d4h_activity_id", "linked_caltopo_map_id"}


@bp.get("/api/incident/settings")
def api_incident_get_settings():
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName required"}), 400

    with get_connection(incident_name) as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()

    s = {row[0]: row[1] for row in rows}
    return jsonify({
        "ok": True,
        "d4hActivityId": s.get("linked_d4h_activity_id"),
        "caltopoMapId": s.get("linked_caltopo_map_id"),
    })


@bp.post("/api/incident/settings")
def api_incident_save_settings():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    key = (data.get("key") or "").strip()
    value = data.get("value")  # None = delete the setting

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName required"}), 400
    if key not in _ALLOWED_SETTINGS_KEYS:
        return jsonify({"ok": False, "error": f"invalid key: {key}"}), 400

    with get_connection(incident_name) as conn:
        if value is None:
            conn.execute("DELETE FROM settings WHERE key = ?", (key,))
        else:
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, str(value))
            )

    return jsonify({"ok": True})