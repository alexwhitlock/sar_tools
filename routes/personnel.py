# routes/personnel.py

from flask import Blueprint, jsonify, request

from db.personnel_repo import (
    list_personnel_with_team,
    add_person,
    update_person,
    delete_person,
    upsert_people_from_d4h,
)

from routes.d4h import (
    _get_d4h_config,
    _fetch_all_attendance_attending,
    _extract_member_ids,
    _fetch_members_by_ids,
)

bp = Blueprint("personnel", __name__)

#==================
# API Routes
#==================

@bp.get("/api/personnel")
def api_personnel_list():
    incident_name = (request.args.get("incidentName") or "").strip()
    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    try:
        rows = list_personnel_with_team(incident_name)
        return jsonify(rows)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@bp.post("/api/personnel/add")
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
    
@bp.post("/api/personnel/update")
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


@bp.post("/api/personnel/delete")
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
    
@bp.post("/api/personnel/import-d4h")
def api_personnel_import_d4h():
    """
    Body: { incidentName: "...", activityId: "330704" }

    Imports ATTENDING members from D4H activity into personnel table.
    """
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    activity_id = str(data.get("activityId") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if not activity_id:
        return jsonify({"ok": False, "error": "activityId is required"}), 400

    try:
        base_url, token, team_id = _get_d4h_config()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

        attendance = _fetch_all_attendance_attending(base_url, team_id, headers, activity_id)
        member_ids = _extract_member_ids(attendance)

        members_raw = _fetch_members_by_ids(base_url, team_id, headers, member_ids)

        members_by_id = {}
        for m in members_raw:
            mid = m.get("id")
            if isinstance(mid, int):
                members_by_id[mid] = m
            elif isinstance(mid, str) and mid.isdigit():
                members_by_id[int(mid)] = m

        people = []
        for mid in member_ids:
            m = members_by_id.get(mid, {})
            name = (m.get("name") or m.get("fullName") or m.get("displayName") or "").strip()
            if name:
                people.append((name, str(mid)))  # d4h_ref == member id

        stats = upsert_people_from_d4h(incident_name, people)

        return jsonify({
            "ok": True,
            "incidentName": incident_name,
            "activityId": activity_id,
            **stats
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500