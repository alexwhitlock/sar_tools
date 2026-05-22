# routes/kiosk.py
from flask import Blueprint, jsonify, request

from db.members_db import get_members_connection, run_members_migrations
from db.database import get_connection
from db.personnel_repo import update_person_status, update_checkin_info
from db.log_repo import insert_log

bp = Blueprint("kiosk", __name__)


def _log(incident_name, message):
    try:
        insert_log(incident_name, "SYSTEM", "user_event", message)
    except Exception:
        pass


# ── Member directory search ──────────────────────────────────────────────────

@bp.get("/api/kiosk/search")
def kiosk_search():
    q             = (request.args.get("q") or "").strip()
    incident_name = (request.args.get("incidentName") or "").strip()
    if len(q) < 2:
        return jsonify([])
    run_members_migrations()
    wild        = f"%{q}%"
    start_first = f"{q}%"
    start_last  = f"% {q}%"
    with get_members_connection() as conn:
        rows = conn.execute("""
            SELECT id, name, d4h_ref, d4h_member_ref, phone,
                   emergency_contact_name, emergency_contact_phone, license_plate
            FROM members
            WHERE name LIKE ? OR phone LIKE ? OR d4h_member_ref LIKE ? OR d4h_ref LIKE ?
            ORDER BY
                CASE
                    WHEN name LIKE ? THEN 0
                    WHEN name LIKE ? THEN 1
                    ELSE 2
                END,
                name COLLATE NOCASE
            LIMIT 25
        """, (wild, wild, wild, wild, start_first, start_last)).fetchall()

    # Build set of d4h_refs (and names) that are already Checked In in the incident,
    # and also fetch incident personnel that match the search query (to supplement results).
    checked_in_refs  = set()
    checked_in_names = set()
    incident_rows    = []
    if incident_name:
        try:
            with get_connection(incident_name) as iconn:
                ci_rows = iconn.execute(
                    "SELECT name, d4h_ref FROM personnel WHERE status='Checked In'"
                ).fetchall()
                for p in ci_rows:
                    if p["d4h_ref"]:
                        checked_in_refs.add(str(p["d4h_ref"]))
                    checked_in_names.add((p["name"] or "").strip().lower())

                incident_rows = iconn.execute("""
                    SELECT id, name, d4h_ref, d4h_member_ref, status
                    FROM personnel
                    WHERE name LIKE ?
                    ORDER BY
                        CASE
                            WHEN name LIKE ? THEN 0
                            WHEN name LIKE ? THEN 1
                            ELSE 2
                        END,
                        name COLLATE NOCASE
                    LIMIT 25
                """, (wild, start_first, start_last)).fetchall()
        except Exception:
            pass

    def is_checked_in(r):
        if r["d4h_ref"] and str(r["d4h_ref"]) in checked_in_refs:
            return True
        return (r["name"] or "").strip().lower() in checked_in_names

    results = [{
        "id":           r["id"],
        "name":         r["name"],
        "d4hRef":       r["d4h_ref"],
        "memberRef":    r["d4h_member_ref"],
        "phone":        r["phone"],
        "ecName":       r["emergency_contact_name"],
        "ecPhone":      r["emergency_contact_phone"],
        "licensePlate": r["license_plate"],
        "checkedIn":    is_checked_in(r),
    } for r in rows]

    # Append incident-only people not already covered by the members directory results
    covered_refs  = {str(r["d4h_ref"]) for r in rows if r["d4h_ref"]}
    covered_names = {(r["name"] or "").strip().lower() for r in rows}
    for p in incident_rows:
        ref    = str(p["d4h_ref"]) if p["d4h_ref"] else None
        p_name = (p["name"] or "").strip()
        p_name_l = p_name.lower()
        if ref and ref in covered_refs:
            continue
        if p_name_l in covered_names:
            continue
        results.append({
            "id":           None,
            "name":         p_name,
            "d4hRef":       p["d4h_ref"],
            "memberRef":    p["d4h_member_ref"],
            "phone":        None,
            "ecName":       None,
            "ecPhone":      None,
            "licensePlate": None,
            "checkedIn":    p["status"] == "Checked In",
        })
        covered_names.add(p_name_l)
        if ref:
            covered_refs.add(ref)

    return jsonify(results)


# ── Incident personnel search (checkout mode) ────────────────────────────────

@bp.get("/api/kiosk/incident-search")
def kiosk_incident_search():
    """Search checked-in personnel in the incident DB (used for checkout flow)."""
    incident_name = (request.args.get("incidentName") or "").strip()
    q = (request.args.get("q") or "").strip()
    if not incident_name or len(q) < 2:
        return jsonify([])
    wild        = f"%{q}%"
    start_first = f"{q}%"
    start_last  = f"% {q}%"
    with get_connection(incident_name) as conn:
        rows = conn.execute("""
            SELECT id, name, d4h_ref, d4h_member_ref
            FROM personnel
            WHERE status = 'Checked In'
              AND (name LIKE ? OR d4h_member_ref LIKE ? OR d4h_ref LIKE ?)
            ORDER BY
                CASE
                    WHEN name LIKE ? THEN 0
                    WHEN name LIKE ? THEN 1
                    ELSE 2
                END,
                name COLLATE NOCASE
            LIMIT 25
        """, (wild, wild, wild, start_first, start_last)).fetchall()
    return jsonify([{
        "id":        r["id"],
        "name":      r["name"],
        "d4hRef":    r["d4h_ref"],
        "memberRef": r["d4h_member_ref"],
    } for r in rows])


# ── Check in / out ────────────────────────────────────────────────────────────

@bp.post("/api/kiosk/action")
def kiosk_action():
    data          = request.get_json() or {}
    incident_name = (data.get("incidentName") or "").strip()
    action        = (data.get("action") or "checkin").lower()
    member_id     = data.get("memberId")
    name          = (data.get("name") or "").strip()
    phone         = (data.get("phone") or "").strip() or None
    ec_name       = (data.get("ecName") or "").strip() or None
    ec_phone      = (data.get("ecPhone") or "").strip() or None
    plate         = (data.get("licensePlate") or "").strip() or None

    if not incident_name or not name:
        return jsonify({"error": "incidentName and name required"}), 400

    target_status = "Checked In" if action == "checkin" else "Checked Out"

    run_members_migrations()

    # 1. Update / create members directory entry
    d4h_ref = d4h_member_ref = None

    if member_id:
        with get_members_connection() as conn:
            conn.execute("""
                UPDATE members
                SET phone=?, emergency_contact_name=?, emergency_contact_phone=?,
                    license_plate=?, local_modified=1, updated_at=datetime('now')
                WHERE id=?
            """, (phone, ec_name, ec_phone, plate, member_id))
            row = conn.execute(
                "SELECT d4h_ref, d4h_member_ref FROM members WHERE id=?", (member_id,)
            ).fetchone()
            if row:
                d4h_ref = row["d4h_ref"]
                d4h_member_ref = row["d4h_member_ref"]
    else:
        with get_members_connection() as conn:
            existing = conn.execute(
                "SELECT id FROM members WHERE name=? COLLATE NOCASE", (name,)
            ).fetchone()
            if existing:
                conn.execute("""
                    UPDATE members
                    SET phone=?, emergency_contact_name=?, emergency_contact_phone=?,
                        license_plate=?, local_modified=1, updated_at=datetime('now')
                    WHERE id=?
                """, (phone, ec_name, ec_phone, plate, existing["id"]))
            else:
                conn.execute("""
                    INSERT INTO members (name, phone, emergency_contact_name,
                        emergency_contact_phone, license_plate, local_modified)
                    VALUES (?, ?, ?, ?, ?, 1)
                """, (name, phone, ec_name, ec_phone, plate))

    # 2. Find or create person in incident personnel
    person_id = None
    is_new = False
    try:
        with get_connection(incident_name) as conn:
            if d4h_ref:
                row = conn.execute(
                    "SELECT id FROM personnel WHERE d4h_ref=?", (str(d4h_ref),)
                ).fetchone()
                if row:
                    person_id = row["id"]

            if not person_id:
                row = conn.execute(
                    "SELECT id FROM personnel WHERE name=? COLLATE NOCASE", (name,)
                ).fetchone()
                if row:
                    person_id = row["id"]

            if not person_id:
                cur = conn.execute(
                    """INSERT INTO personnel
                       (name, d4h_ref, d4h_member_ref, source, status, previous_status)
                       VALUES (?, ?, ?, 'KIOSK', ?, 'Added')""",
                    (name, str(d4h_ref) if d4h_ref else None, d4h_member_ref, target_status)
                )
                person_id = cur.lastrowid
                is_new = True

    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # 3. Save check-in info to incident personnel record
    try:
        update_checkin_info(
            incident_name, person_id=person_id,
            phone=phone, ec_name=ec_name, ec_phone=ec_phone, license_plate=plate,
        )
    except Exception:
        pass  # non-fatal

    # 4. Update status (existing persons) or just log + return (new persons)
    verb = "checked in" if target_status == "Checked In" else "checked out"
    if is_new:
        _log(incident_name, f'"{name}" {verb} via Kiosk (new)')
        return jsonify({"ok": True, "personId": person_id, "addedToIncident": True})

    try:
        update_person_status(incident_name, person_id=person_id, status=target_status)
        _log(incident_name, f'"{name}" {verb} via Kiosk')
        return jsonify({"ok": True, "personId": person_id, "addedToIncident": False})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Admin: member directory management ───────────────────────────────────────

@bp.get("/api/kiosk/admin/members")
def admin_members():
    run_members_migrations()
    with get_members_connection() as conn:
        rows = conn.execute("""
            SELECT id, name, d4h_ref, d4h_member_ref, phone,
                   emergency_contact_name, emergency_contact_phone, license_plate,
                   local_modified, updated_at
            FROM members ORDER BY name COLLATE NOCASE
        """).fetchall()
    return jsonify([dict(r) for r in rows])


@bp.post("/api/kiosk/admin/sync-d4h")
def admin_sync_d4h():
    try:
        from routes.d4h import _get_d4h_config, _d4h_get_json
        base_url, token, team_id = _get_d4h_config()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

        url = f"{base_url}/v3/team/{team_id}/members"
        page, page_size = 0, 100
        d4h_members = []
        while True:
            payload = _d4h_get_json(url, headers=headers, params={
                "page": page, "size": page_size, "sort": "id", "order": "asc"
            })
            chunk = payload.get("results") or []
            if not chunk:
                break
            d4h_members.extend(m for m in chunk if m.get("status") != "RETIRED")
            total = payload.get("totalSize")
            if isinstance(total, int) and len(d4h_members) >= total:
                break
            page += 1

        run_members_migrations()
        added, updated, conflicts = [], [], []

        def _s(val):
            """Coerce a D4H field value to a plain stripped string."""
            if not val:
                return ""
            if isinstance(val, str):
                return val.strip()
            if isinstance(val, list):
                return _s(val[0]) if val else ""
            if isinstance(val, dict):
                for k in ("value", "number", "phone", "text", "name"):
                    if val.get(k):
                        return _s(val[k])
            return ""

        def _fmt_phone(raw):
            """Format a phone number as XXX-XXX-XXXX, stripping leading +1/1."""
            digits = "".join(c for c in (raw or "") if c.isdigit())
            if len(digits) == 11 and digits.startswith("1"):
                digits = digits[1:]
            if len(digits) == 10:
                return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"
            return raw or ""  # return as-is if unrecognised format

        with get_members_connection() as conn:
            for m in d4h_members:
                d4h_ref = str(m.get("id") or "").strip()
                if not d4h_ref:
                    continue
                name       = _s(m.get("name")) or _s(m.get("fullName")) or _s(m.get("displayName"))
                member_ref = _s(m.get("ref")) or None
                d4h_phone  = _fmt_phone(_s(m.get("mobile")) or _s(m.get("mobilephone")) or _s(m.get("phone"))) or None

                # Extract up to two emergency contacts, store concatenated with " / "
                ec_parts = []
                for ec_dict in [
                    m.get("primaryEmergencyContact") or {},
                    m.get("secondaryEmergencyContact") or {},
                ]:
                    ec_n = (ec_dict.get("name") or "").strip()
                    if ec_n:
                        ec_p = _fmt_phone((ec_dict.get("primaryPhone") or "").strip())
                        ec_parts.append((ec_n, ec_p))
                d4h_ec_name  = " / ".join(n for n, p in ec_parts) or None
                d4h_ec_phone = " / ".join(p for n, p in ec_parts) or None

                existing = conn.execute(
                    """SELECT id, name, phone, d4h_member_ref,
                              emergency_contact_name, emergency_contact_phone
                       FROM members WHERE d4h_ref=?""",
                    (d4h_ref,)
                ).fetchone()

                if not existing:
                    conn.execute("""
                        INSERT INTO members
                            (name, d4h_ref, d4h_member_ref, phone,
                             emergency_contact_name, emergency_contact_phone)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (name, d4h_ref, member_ref, d4h_phone, d4h_ec_name, d4h_ec_phone))
                    added.append(name)
                else:
                    fills = {}
                    conflict_fields = {}

                    def _check(field, local_val, d4h_val):
                        if not d4h_val:
                            return
                        if not local_val:
                            fills[field] = d4h_val
                        elif local_val != d4h_val:
                            conflict_fields[field] = {"local": local_val, "d4h": d4h_val}

                    _check("name",                    existing["name"],                    name)
                    _check("phone",                   existing["phone"],                   d4h_phone)
                    _check("emergency_contact_name",  existing["emergency_contact_name"],  d4h_ec_name)
                    _check("emergency_contact_phone", existing["emergency_contact_phone"], d4h_ec_phone)
                    if member_ref and existing["d4h_member_ref"] != member_ref:
                        fills["d4h_member_ref"] = member_ref

                    if fills:
                        set_clause = ", ".join(f"{k}=?" for k in fills)
                        conn.execute(
                            f"UPDATE members SET {set_clause}, updated_at=datetime('now') WHERE d4h_ref=?",
                            [*fills.values(), d4h_ref]
                        )
                        updated.append(existing["name"])

                    if conflict_fields:
                        conflicts.append({
                            "id":         existing["id"],
                            "d4hRef":     d4h_ref,
                            "localName":  existing["name"],
                            "d4hName":    conflict_fields.get("name",  {}).get("d4h", name),
                            "localPhone": existing["phone"],
                            "d4hPhone":   conflict_fields.get("phone", {}).get("d4h", None),
                        })

        return jsonify({
            "ok":         True,
            "added":      len(added),
            "addedNames": added,
            "updated":    len(updated),
            "conflicts":  conflicts,
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.post("/api/kiosk/admin/resolve-conflict")
def admin_resolve_conflict():
    data      = request.get_json() or {}
    member_id = data.get("memberId")
    use_d4h   = data.get("useD4H", False)
    if not member_id:
        return jsonify({"error": "memberId required"}), 400
    with get_members_connection() as conn:
        if use_d4h:
            conn.execute("""
                UPDATE members
                SET name=?, phone=?, emergency_contact_name=?, emergency_contact_phone=?,
                    local_modified=0, updated_at=datetime('now')
                WHERE id=?
            """, (data.get("d4hName"), data.get("d4hPhone"),
                  data.get("d4hEcName"), data.get("d4hEcPhone"), member_id))
        else:
            conn.execute(
                "UPDATE members SET local_modified=0, updated_at=datetime('now') WHERE id=?",
                (member_id,)
            )
    return jsonify({"ok": True})


@bp.delete("/api/kiosk/admin/member/<int:member_id>")
def admin_delete_member(member_id):
    with get_members_connection() as conn:
        conn.execute("DELETE FROM members WHERE id=?", (member_id,))
    return jsonify({"ok": True})
