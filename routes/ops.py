# routes/ops.py
"""
OPS workflow endpoints.
Handles state transitions that span teams and CalTopo assignments.

State machine (team status → CalTopo assignment status):
  Briefed                    → INPROGRESS
  Returning from Assignment  → COMPLETED
  (all other transitions)    → no assignment change
"""
from flask import Blueprint, jsonify, request
from db.teams_repo import update_team, get_team_name, list_teams, TEAM_STATUSES
from db.database import get_connection
from db.log_repo import insert_log
from db.personnel_repo import list_personnel_with_team

bp = Blueprint("ops", __name__)

# Team status → CalTopo assignment status
_TEAM_TO_ASGN = {
    "Briefed":                   "INPROGRESS",
    "Returning from Assignment": "COMPLETED",
}


# ── helpers ──────────────────────────────────────────────────────

def _get_caltopo_config(incident_name: str):
    """Return (map_id, mode) from incident settings, or (None, 'online')."""
    try:
        with get_connection(incident_name) as conn:
            rows = conn.execute(
                "SELECT key, value FROM settings "
                "WHERE key IN ('linked_caltopo_map_id', 'caltopo_mode')"
            ).fetchall()
        s = {r["key"]: r["value"] for r in rows}
        return s.get("linked_caltopo_map_id"), s.get("caltopo_mode", "online")
    except Exception:
        return None, "online"


def _get_feature_id(incident_name: str, assignment_number: str):
    """Look up the CalTopo feature_id for an assignment by its number string."""
    try:
        with get_connection(incident_name) as conn:
            row = conn.execute(
                "SELECT feature_id FROM assignments_cache WHERE number = ?",
                (str(assignment_number),)
            ).fetchone()
        return row["feature_id"] if row else None
    except Exception:
        return None


def _update_caltopo_status(incident_name: str, feature_id: str,
                           map_id: str, mode: str, new_status: str) -> bool:
    """Push assignment status change to CalTopo. Returns True on success."""
    try:
        from routes.caltopo import (
            get_from_caltopo,
            _parse_assignment_title,
            _build_assignment_title,
            _post_assignment_update,
        )
        map_data = get_from_caltopo(f"/api/v1/map/{map_id}/since/0", mode=mode)
        features = map_data.get("state", {}).get("features", [])
        feature  = next((f for f in features if f.get("id") == feature_id), None)
        if not feature:
            return False

        props = dict(feature.get("properties", {}))
        _completed_x, number, team = _parse_assignment_title(props.get("title", ""))

        props["status"] = new_status.upper()
        completed_x = (props["status"] == "COMPLETED")
        props["title"] = _build_assignment_title(completed_x, number, team)

        if mode == "offline":
            if "letter" in props:
                props["letter"] = props["title"]
            if "number" in props:
                props["number"] = ""

        status_code, _ = _post_assignment_update(
            map_id, feature_id, {**feature, "properties": props}, mode=mode
        )
        return status_code == 200
    except Exception:
        return False


def _bump_version(incident_name: str):
    try:
        with get_connection(incident_name) as conn:
            conn.execute("UPDATE sync_state SET version = version + 1 WHERE id = 1")
            conn.commit()
    except Exception:
        pass


def _log_ops(incident_name: str, message: str):
    try:
        insert_log(incident_name, "OPS", "user_event", message)
    except Exception:
        pass


# ── endpoints ─────────────────────────────────────────────────────

@bp.get("/ops")
def ops_page():
    from flask import render_template
    return render_template("ops.html")


@bp.get("/api/ops/data")
def api_ops_data():
    """All data the OPS page needs in one call."""
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName required"}), 400
    try:
        teams = list_teams(incident_name)

        # Parse inline member data into a list
        for t in teams:
            members = []
            raw = t.get("memberData") or ""
            for part in raw.split("|"):
                if ":" in part:
                    pid, pname = part.split(":", 1)
                    try:
                        members.append({"id": int(pid), "name": pname})
                    except ValueError:
                        pass
            t["members"] = members

        with get_connection(incident_name) as conn:
            rows = conn.execute("""
                SELECT ac.feature_id, ac.number, ac.team,
                       ac.caltopo_status, ac.assignment_type,
                       ac.resource_type,  ac.description, ac.op_period,
                       a.type  AS local_type,
                       a.notes AS local_notes
                FROM   assignments_cache ac
                LEFT JOIN assignments a ON a.feature_id = ac.feature_id
                ORDER BY ac.number COLLATE NOCASE
            """).fetchall()

        assignments = [{
            "featureId":      r["feature_id"],
            "number":         r["number"],
            "team":           r["team"],
            "status":         (r["caltopo_status"] or "DRAFT").upper(),
            "assignmentType": r["assignment_type"],
            "resourceType":   r["resource_type"],
            "description":    r["description"],
            "opPeriod":       r["op_period"],
            "localType":      r["local_type"],
            "notes":          r["local_notes"],
        } for r in rows]

        people   = list_personnel_with_team(incident_name)
        available = [p for p in people
                     if p["status"] == "Checked In" and not p["team"]]

        return jsonify({
            "ok": True,
            "teams": teams,
            "assignments": assignments,
            "availablePersonnel": available,
        })
    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/ops/deploy")
def api_ops_deploy():
    """
    Brief a team for an assignment (Staged → Briefed).
    Links team to assignment and fires the INPROGRESS transition in CalTopo.
    """
    data          = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName")    or "").strip()
    team_id       = data.get("teamId")
    asgn_number   = (data.get("assignmentNumber") or "").strip()

    if not incident_name or team_id is None or not asgn_number:
        return jsonify({"ok": False,
                        "error": "incidentName, teamId, assignmentNumber required"}), 400
    try:
        team_name = get_team_name(incident_name, int(team_id)) or str(team_id)

        # 1. Update team: link assignment + set status Briefed
        update_team(incident_name, team_id=int(team_id),
                    manual_assignment=asgn_number, status="Briefed")

        # 2. Push INPROGRESS to CalTopo
        map_id, mode = _get_caltopo_config(incident_name)
        caltopo_ok   = False
        if map_id:
            fid = _get_feature_id(incident_name, asgn_number)
            if fid:
                caltopo_ok = _update_caltopo_status(
                    incident_name, fid, map_id, mode, "INPROGRESS"
                )

        # 3. Auto-log
        _log_ops(incident_name,
                 f'Team "{team_name}" briefed for assignment {asgn_number}')

        _bump_version(incident_name)
        return jsonify({"ok": True, "caltopoUpdated": caltopo_ok})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/ops/set-team-status")
def api_ops_set_team_status():
    """
    Change team status with automatic CalTopo assignment transitions:
      Briefed                   → assignment INPROGRESS
      Returning from Assignment → assignment COMPLETED
    Auto-generates a log entry for every transition.
    """
    data          = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    team_id       = data.get("teamId")
    new_status    = (data.get("status")       or "").strip()

    if not incident_name or team_id is None:
        return jsonify({"ok": False, "error": "incidentName and teamId required"}), 400
    if new_status not in TEAM_STATUSES:
        return jsonify({"ok": False, "error": f"Invalid status: {new_status}"}), 400

    try:
        team_name = get_team_name(incident_name, int(team_id)) or str(team_id)

        # Grab current assignment before update
        with get_connection(incident_name) as conn:
            row = conn.execute(
                "SELECT manual_assignment FROM teams WHERE id = ?", (int(team_id),)
            ).fetchone()
        asgn_number = row["manual_assignment"] if row else None

        # Update team status
        update_team(incident_name, team_id=int(team_id), status=new_status)

        # Auto-drive assignment status
        asgn_new_status = _TEAM_TO_ASGN.get(new_status)
        caltopo_ok = False
        if asgn_new_status and asgn_number:
            map_id, mode = _get_caltopo_config(incident_name)
            if map_id:
                fid = _get_feature_id(incident_name, asgn_number)
                if fid:
                    caltopo_ok = _update_caltopo_status(
                        incident_name, fid, map_id, mode, asgn_new_status
                    )

        # Auto-log
        msg = f'Team "{team_name}" → {new_status}'
        if asgn_number:
            msg += f' (assignment {asgn_number})'
        if asgn_new_status and asgn_number:
            msg += f' — assignment auto-set to {asgn_new_status}'
        _log_ops(incident_name, msg)

        _bump_version(incident_name)
        return jsonify({"ok": True, "caltopoUpdated": caltopo_ok})

    except Exception as e:
        import traceback; traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500
