from flask import Blueprint, jsonify, request
from db.nfc_repo import lookup_tag, link_tag
from db.members_db import get_members_connection, run_members_migrations
from db.database import get_connection

bp = Blueprint("nfc", __name__)


@bp.get("/api/nfc/lookup")
def api_nfc_lookup():
    serial = (request.args.get("serial") or "").strip()
    incident_name = (request.args.get("incidentName") or "").strip()
    if not serial:
        return jsonify({"ok": False, "error": "serial required"}), 400

    run_members_migrations()
    tag = lookup_tag(serial)
    if not tag:
        return jsonify({"ok": True, "found": False})

    d4h_ref = tag["d4h_ref"]

    with get_members_connection() as conn:
        member = conn.execute(
            """SELECT id, name, phone, emergency_contact_name,
                      emergency_contact_phone, license_plate
               FROM members WHERE d4h_ref = ?""",
            (d4h_ref,),
        ).fetchone()

    if not member:
        return jsonify({"ok": True, "found": False})

    result = {
        "ok": True,
        "found": True,
        "d4hRef": d4h_ref,
        "membersId": member["id"],
        "name": member["name"],
        "phone": member["phone"],
        "ecName": member["emergency_contact_name"],
        "ecPhone": member["emergency_contact_phone"],
        "licensePlate": member["license_plate"],
        "checkedIn": False,
    }

    if incident_name:
        try:
            with get_connection(incident_name) as conn:
                row = conn.execute(
                    "SELECT id, status FROM personnel WHERE d4h_ref = ?",
                    (d4h_ref,),
                ).fetchone()
                if row:
                    result["incidentPersonId"] = row["id"]
                    result["checkedIn"] = row["status"] == "Checked In"
        except Exception:
            pass

    return jsonify(result)


@bp.post("/api/nfc/link")
def api_nfc_link():
    data = request.get_json(force=True) or {}
    serial = (data.get("serial") or "").strip()
    d4h_ref = (data.get("d4hRef") or "").strip()
    if not serial or not d4h_ref:
        return jsonify({"ok": False, "error": "serial and d4hRef required"}), 400

    run_members_migrations()
    result = link_tag(serial, d4h_ref)
    return jsonify({"ok": True, **result})
