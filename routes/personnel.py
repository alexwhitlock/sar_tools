# routes/personnel.py

from flask import Blueprint, jsonify, request

from db.personnel_repo import (
    list_personnel_with_team,
    add_person,
    update_person,
    delete_person
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