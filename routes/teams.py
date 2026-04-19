# routes/teams.py

from flask import Blueprint, jsonify, request

from db.teams_repo import (
    list_teams,
    list_team_members,
    create_team,
    update_team,
    delete_team,
    assign_person_to_team,
    remove_person_from_team,
    get_team_name,
    get_person_team_name,
    TEAM_STATUSES,
)
from db.errors import ConflictError
from db.personnel_repo import get_person_name
from db.log_repo import insert_log


def _log(incident_name, message):
    try:
        insert_log(incident_name, "SYSTEM", "user_event", message)
    except Exception:
        pass

bp = Blueprint("teams", __name__)


@bp.get("/api/teams")
def api_teams_list():
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    try:
        return jsonify(list_teams(incident_name))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.get("/api/teams/members")
def api_teams_members():
    incident_name = (request.args.get("incidentName") or "").strip()
    team_id = request.args.get("teamId")
    if not incident_name or not team_id:
        return jsonify({"ok": False, "error": "incidentName and teamId are required"}), 400
    try:
        return jsonify(list_team_members(incident_name, int(team_id)))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/teams/create")
def api_teams_create():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    name = (data.get("name") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400
    try:
        team_id = create_team(incident_name, name=name)
        _log(incident_name, f'Team "{name}" created')
        return jsonify({"ok": True, "id": team_id})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/teams/update")
def api_teams_update():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    team_id = data.get("teamId")
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if team_id in (None, ""):
        return jsonify({"ok": False, "error": "teamId is required"}), 400

    kwargs = {}
    if "name" in data:
        kwargs["name"] = (data["name"] or "").strip()
    if "teamLeaderId" in data:
        kwargs["team_leader_id"] = data["teamLeaderId"]  # None to clear
    if "status" in data:
        status = data["status"]
        if status not in TEAM_STATUSES:
            return jsonify({"ok": False, "error": f"invalid status: {status}"}), 400
        kwargs["status"] = status
    if "notes" in data:
        kwargs["notes"] = (data.get("notes") or "").strip() or None

    expected_updated_at = (data.get("expectedUpdatedAt") or "").strip() or None

    try:
        ok = update_team(incident_name, team_id=int(team_id),
                         expected_updated_at=expected_updated_at, **kwargs)
        if not ok:
            return jsonify({"ok": False, "error": "team not found"}), 404
        if kwargs:
            team_label = kwargs.get("name") or get_team_name(incident_name, int(team_id)) or str(team_id)
            parts = []
            if "name"           in kwargs: parts.append(f'name="{kwargs["name"]}"')
            if "status"         in kwargs: parts.append(f'status="{kwargs["status"]}"')
            if "notes"          in kwargs: parts.append(f'notes="{kwargs["notes"] or "(none)"}"')
            if "team_leader_id" in kwargs:
                ldr_id = kwargs["team_leader_id"]
                ldr = get_person_name(incident_name, ldr_id) if ldr_id else None
                parts.append(f'leader="{ldr or "(none)"}"')
            if parts:
                _log(incident_name, f'Team "{team_label}" updated: {", ".join(parts)}')
        return jsonify({"ok": True})
    except ConflictError:
        return jsonify({"ok": False, "error": "conflict"}), 409
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/teams/delete")
def api_teams_delete():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    team_id = data.get("teamId")
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if team_id in (None, ""):
        return jsonify({"ok": False, "error": "teamId is required"}), 400
    try:
        name = get_team_name(incident_name, int(team_id)) or str(team_id)
        ok = delete_team(incident_name, team_id=int(team_id))
        if not ok:
            return jsonify({"ok": False, "error": "team not found"}), 404
        _log(incident_name, f'Team "{name}" deleted')
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/teams/assign-person")
def api_teams_assign_person():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    team_id = data.get("teamId")
    person_id = data.get("personId")
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if team_id in (None, "") or person_id in (None, ""):
        return jsonify({"ok": False, "error": "teamId and personId are required"}), 400
    try:
        person_label = get_person_name(incident_name, int(person_id)) or str(person_id)
        team_label   = get_team_name(incident_name, int(team_id))     or str(team_id)
        assign_person_to_team(incident_name, team_id=int(team_id), person_id=int(person_id))
        _log(incident_name, f'"{person_label}" assigned to Team "{team_label}"')
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/teams/remove-person")
def api_teams_remove_person():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    person_id = data.get("personId")
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if person_id in (None, ""):
        return jsonify({"ok": False, "error": "personId is required"}), 400
    try:
        person_label = get_person_name(incident_name, int(person_id))       or str(person_id)
        team_label   = get_person_team_name(incident_name, int(person_id))  or "unknown team"
        remove_person_from_team(incident_name, person_id=int(person_id))
        _log(incident_name, f'"{person_label}" removed from Team "{team_label}"')
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
