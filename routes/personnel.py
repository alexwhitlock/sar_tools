# routes/personnel.py

import sqlite3

from flask import Blueprint, jsonify, request

from db.errors import ConflictError
from db.personnel_repo import (
    list_personnel_with_team,
    add_person,
    update_person,
    update_person_status,
    delete_person,
    get_person_name,
    upsert_people_from_d4h,
    find_name_matches,
    find_name_matches_batch,
    link_d4h_to_person,
    VALID_STATUSES,
)
from db.log_repo import insert_log


def _log(incident_name, message):
    try:
        insert_log(incident_name, "SYSTEM", "user_event", message)
    except Exception:
        pass

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

    notes = (data.get("notes") or "").strip() or None
    try:
        new_id = add_person(incident_name, name=name, notes=notes)
        _log(incident_name, f'Personnel "{name}" added')
        return jsonify({"ok": True, "id": new_id})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    
@bp.post("/api/personnel/update")
def api_personnel_update():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    person_key = data.get("personKey")
    name = (data.get("name") or "").strip()
    notes = (data.get("notes") or "").strip() or None
    expected_updated_at = (data.get("expectedUpdatedAt") or "").strip() or None

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if person_key in (None, ""):
        return jsonify({"ok": False, "error": "personKey is required"}), 400
    if not name:
        return jsonify({"ok": False, "error": "name is required"}), 400

    try:
        ok = update_person(incident_name, person_id=int(person_key), name=name,
                           notes=notes, expected_updated_at=expected_updated_at)
        if not ok:
            return jsonify({"ok": False, "error": "person not found"}), 404
        parts = [f'name="{name}"']
        if "notes" in data:
            parts.append(f'notes="{notes or "(none)"}"')
        _log(incident_name, f'Personnel "{name}" updated: {", ".join(parts)}')
        return jsonify({"ok": True})
    except ConflictError:
        return jsonify({"ok": False, "error": "conflict"}), 409
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
        name = get_person_name(incident_name, int(person_key)) or person_key
        ok = delete_person(incident_name, person_id=int(person_key))
        if not ok:
            return jsonify({"ok": False, "error": "person not found"}), 404
        _log(incident_name, f'Personnel "{name}" deleted')
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    
@bp.post("/api/personnel/check-name")
def api_personnel_check_name():
    """
    Body: { incidentName: "...", name: "..." }
    Returns: { exact: [...], similar: [...] }
    Used by the manual add flow to detect duplicates before saving.
    """
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    name = (data.get("name") or "").strip()

    if not incident_name or not name:
        return jsonify({"ok": False, "error": "incidentName and name are required"}), 400

    try:
        return jsonify(find_name_matches(incident_name, name))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/personnel/check-names")
def api_personnel_check_names():
    """
    Body: { incidentName: "...", members: [{name, d4hRef}, ...] }
    Returns: { results: [{name, d4hRef, status, matches?, similarity?}, ...] }
    Used by the D4H import flow to classify each incoming member before import.
    """
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    members = data.get("members") or []

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    try:
        return jsonify({"results": find_name_matches_batch(incident_name, members)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/personnel/link-d4h")
def api_personnel_link_d4h():
    """
    Body: { incidentName: "...", personId: 7, d4hRef: "1002" }
    Links a D4H member ref to an existing person (merge action).
    """
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    person_id = data.get("personId")
    d4h_ref = str(data.get("d4hRef") or "").strip()
    new_name = (data.get("name") or "").strip() or None

    if not incident_name or person_id is None or not d4h_ref:
        return jsonify({"ok": False, "error": "incidentName, personId, and d4hRef are required"}), 400

    try:
        ok = link_d4h_to_person(incident_name, person_id=int(person_id), d4h_ref=d4h_ref, new_name=new_name)
        if not ok:
            return jsonify({"ok": False, "error": "Person not found"}), 404
        name = get_person_name(incident_name, int(person_id)) or str(person_id)
        _log(incident_name, f'Personnel "{name}" linked to D4H ref {d4h_ref}')
        return jsonify({"ok": True})
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "That D4H ref is already linked to another person."}), 409
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/personnel/status")
def api_personnel_status():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    person_key = data.get("personKey")
    status = (data.get("status") or "").strip()
    expected_updated_at = (data.get("expectedUpdatedAt") or "").strip() or None

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400
    if person_key in (None, ""):
        return jsonify({"ok": False, "error": "personKey is required"}), 400
    if status not in VALID_STATUSES:
        return jsonify({"ok": False, "error": f"invalid status: {status}"}), 400

    try:
        name = get_person_name(incident_name, int(person_key)) or person_key
        ok = update_person_status(incident_name, person_id=int(person_key), status=status,
                                  expected_updated_at=expected_updated_at)
        if not ok:
            return jsonify({"ok": False, "error": "person not found"}), 404
        _log(incident_name, f'Personnel "{name}" status set to "{status}"')
        return jsonify({"ok": True})
    except ConflictError:
        return jsonify({"ok": False, "error": "conflict"}), 409
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@bp.post("/api/personnel/import-d4h")
def api_personnel_import_d4h():
    """
    Imports ATTENDING members from D4H activity into personnel table.

    Two calling modes:
      A) { incidentName, members: [{name, d4hRef}, ...] }  — frontend pre-resolved conflicts
      B) { incidentName, activityId }                       — fetch directly from D4H
    """
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    # Path A: frontend already resolved conflicts and passes members directly
    members_from_body = data.get("members")
    if isinstance(members_from_body, list):
        try:
            people = [
                (m.get("name", "").strip(), str(m.get("d4hRef", "")).strip(), m.get("memberRef") or None)
                for m in members_from_body
                if m.get("name") and m.get("d4hRef")
            ]
            stats = upsert_people_from_d4h(incident_name, people)
            _log(incident_name, f'D4H import: {stats.get("imported", 0)} added, {stats.get("updated", 0)} updated, {stats.get("skipped", 0)} skipped')
            return jsonify({"ok": True, "incidentName": incident_name, **stats})
        except Exception as e:
            return jsonify({"ok": False, "error": str(e)}), 500

    # Path B: fetch from D4H using activityId
    activity_id = str(data.get("activityId") or "").strip()
    if not activity_id:
        return jsonify({"ok": False, "error": "Either 'members' list or 'activityId' is required"}), 400

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
                people.append((name, str(mid), m.get("ref") or None))

        stats = upsert_people_from_d4h(incident_name, people)

        return jsonify({
            "ok": True,
            "incidentName": incident_name,
            "activityId": activity_id,
            **stats
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500