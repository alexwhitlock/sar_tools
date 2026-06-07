import json
import os
from flask import Blueprint, jsonify, request, send_file
from db.personnel_repo import list_personnel_with_team
from db.teams_repo import list_teams
from db.log_repo import get_logs
from db.database import get_connection

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


@bp.get("/api/command-summary")
def api_command_summary():
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName required"}), 400
    try:
        people = list_personnel_with_team(incident_name)
        available = [p for p in people if p["status"] == "Checked In" and not p["team"]]
        deployed  = [p for p in people if p["status"] == "Checked In" and p["team"]]
        released  = [p for p in people if p["status"] == "Checked Out"]
        added     = [p for p in people if p["status"] == "Added"]

        teams = list_teams(incident_name)
        on_assignment_statuses = {"On Assignment", "Travelling to Assignment", "Returning from Assignment"}
        teams_active = sum(1 for t in teams if t.get("status") in on_assignment_statuses)

        try:
            with get_connection(incident_name) as conn:
                asgn_rows = conn.execute(
                    "SELECT caltopo_status, local_status FROM assignments_cache"
                ).fetchall()
            asgn_counts = {}
            for r in asgn_rows:
                s = r["local_status"] or r["caltopo_status"] or "Unknown"
                asgn_counts[s] = asgn_counts.get(s, 0) + 1
        except Exception:
            try:
                with get_connection(incident_name) as conn:
                    asgn_rows = conn.execute(
                        "SELECT caltopo_status FROM assignments_cache"
                    ).fetchall()
                asgn_counts = {}
                for r in asgn_rows:
                    s = r["caltopo_status"] or "Unknown"
                    asgn_counts[s] = asgn_counts.get(s, 0) + 1
            except Exception:
                asgn_counts = {}

        logs = get_logs(incident_name, order="desc", limit=8)

        return jsonify({
            "ok": True,
            "personnel": {
                "available": len(available),
                "deployed":  len(deployed),
                "released":  len(released),
                "added":     len(added),
                "total":     len(people),
            },
            "teams": teams,
            "teamsActive": teams_active,
            "assignments": asgn_counts,
            "recentLog": logs,
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500


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
