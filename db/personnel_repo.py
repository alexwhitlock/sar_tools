# db/personnel_repo.py
import difflib
import sqlite3
from typing import List, Dict, Any, Iterable, Tuple
from .database import get_connection
from .migrations import run_migrations
from .errors import ConflictError

_FUZZY_THRESHOLD = 0.75


def _match_rows(name: str, rows, exclude_d4h_ref=None):
    """Classify existing personnel rows as exact or similar matches for `name`."""
    norm = name.strip().lower()
    exact, similar = [], []
    for r in rows:
        if exclude_d4h_ref and r["d4h_ref"] == str(exclude_d4h_ref):
            continue
        ratio = difflib.SequenceMatcher(None, norm, (r["name"] or "").strip().lower()).ratio()
        rec = {"id": r["id"], "name": r["name"], "source": r["source"], "d4hRef": r["d4h_ref"]}
        if ratio == 1.0:
            exact.append(rec)
        elif ratio >= _FUZZY_THRESHOLD:
            rec["ratio"] = round(ratio, 3)
            similar.append(rec)
    similar.sort(key=lambda x: x["ratio"], reverse=True)
    return {"exact": exact, "similar": similar}


def find_name_matches(incident_name: str, name: str, exclude_d4h_ref=None) -> dict:
    """Return exact and similar name matches for `name` within an incident's personnel."""
    with get_connection(incident_name) as conn:
        rows = conn.execute("SELECT id, name, source, d4h_ref FROM personnel").fetchall()
    return _match_rows(name, rows, exclude_d4h_ref)


def find_name_matches_batch(incident_name: str, members: list) -> list:
    """
    Check a list of {name, d4hRef} members against existing personnel.

    Returns a list of result dicts, each with:
      status: "linked"        - d4h_ref already in DB (no action needed)
              "new"           - no d4h_ref match, no name match (safe to import)
              "name_conflict" - no d4h_ref match but name match found (needs resolution)
      matches: list of matching existing personnel (for name_conflict only)
      similarity: "exact" | "similar" (for name_conflict only)
    """
    with get_connection(incident_name) as conn:
        rows = conn.execute("SELECT id, name, source, d4h_ref FROM personnel").fetchall()
    known_refs = {str(r["d4h_ref"]) for r in rows if r["d4h_ref"]}

    results = []
    for m in members:
        name = (m.get("name") or "").strip()
        d4h_ref = str(m.get("d4hRef") or "").strip()
        if not name or not d4h_ref:
            continue
        if d4h_ref in known_refs:
            results.append({"name": name, "d4hRef": d4h_ref, "status": "linked",
                             "matches": None, "similarity": None})
            continue
        found = _match_rows(name, rows)
        if found["exact"] or found["similar"]:
            all_matches = found["exact"] + found["similar"]
            results.append({"name": name, "d4hRef": d4h_ref, "status": "name_conflict",
                             "matches": all_matches,
                             "similarity": "exact" if found["exact"] else "similar"})
        else:
            results.append({"name": name, "d4hRef": d4h_ref, "status": "new",
                             "matches": None, "similarity": None})
    return results


def link_d4h_to_person(incident_name: str, *, person_id: int, d4h_ref: str, new_name: str | None = None) -> bool:
    """
    Link a D4H ref to an existing person: sets d4h_ref, source='D4H', and
    optionally updates the name to the D4H name.
    Raises sqlite3.IntegrityError if the d4h_ref is already linked to another person.
    Returns True if a row was updated, False if person_id not found.
    """
    with get_connection(incident_name) as conn:
        if new_name:
            cur = conn.execute(
                "UPDATE personnel SET d4h_ref = ?, name = ?, source = 'D4H', updated_at = datetime('now') WHERE id = ?",
                (str(d4h_ref), new_name.strip(), person_id),
            )
        else:
            cur = conn.execute(
                "UPDATE personnel SET d4h_ref = ?, source = 'D4H', updated_at = datetime('now') WHERE id = ?",
                (str(d4h_ref), person_id),
            )
        conn.commit()
        return cur.rowcount > 0


VALID_STATUSES = ["Added", "Checked In", "Checked Out"]


def list_personnel_with_team(incident_name: str) -> List[Dict[str, Any]]:
    with get_connection(incident_name) as conn:
        rows = conn.execute("""
            SELECT
                p.id AS id,
                p.name AS name,
                t.name AS team,
                p.source AS source,
                p.d4h_ref AS d4hRef,
                p.d4h_member_ref AS d4hMemberRef,
                p.status AS status,
                p.previous_status AS previousStatus,
                p.notes AS notes,
                p.updated_at AS updatedAt
            FROM personnel p
            LEFT JOIN team_members tm ON tm.personnel_id = p.id
            LEFT JOIN teams t ON t.id = tm.team_id
            ORDER BY p.name COLLATE NOCASE;
        """).fetchall()

    return [{
        "id": r["id"],
        "name": r["name"],
        "team": r["team"],
        "source": r["source"],
        "d4hRef": r["d4hRef"],
        "d4hMemberRef": r["d4hMemberRef"],
        "status": r["status"],
        "previousStatus": r["previousStatus"],
        "notes": r["notes"],
        "updatedAt": r["updatedAt"],
    } for r in rows]


def update_person_status(incident_name: str, *, person_id: int, status: str, expected_updated_at: str | None = None) -> bool:
    """Update a person's status, storing the previous status. Returns True if a row was updated.
    If expected_updated_at is provided, raises ConflictError if the record has been modified."""
    with get_connection(incident_name) as conn:
        if expected_updated_at:
            cur = conn.execute(
                """UPDATE personnel
                   SET previous_status = status, status = ?, updated_at = datetime('now')
                   WHERE id = ? AND updated_at = ?""",
                (status, person_id, expected_updated_at),
            )
            conn.commit()
            if cur.rowcount == 0:
                exists = conn.execute("SELECT 1 FROM personnel WHERE id = ?", (person_id,)).fetchone()
                if exists:
                    raise ConflictError()
                return False
        else:
            cur = conn.execute(
                """UPDATE personnel
                   SET previous_status = status, status = ?, updated_at = datetime('now')
                   WHERE id = ?""",
                (status, person_id),
            )
            conn.commit()
        return cur.rowcount > 0


def get_person_name(incident_name: str, person_id: int) -> str | None:
    with get_connection(incident_name) as conn:
        row = conn.execute("SELECT name FROM personnel WHERE id = ?", (person_id,)).fetchone()
        return row["name"] if row else None


def add_person(incident_name: str, *, name: str, notes: str | None = None) -> int:
    with get_connection(incident_name) as conn:
        cur = conn.execute(
            "INSERT INTO personnel (name, notes) VALUES (?, ?)",
            (name, notes or None)
        )
        conn.commit()
        return cur.lastrowid

def update_person(incident_name: str, *, person_id: int, name: str, notes: str | None = None, expected_updated_at: str | None = None) -> bool:
    """Update a person's name and notes. Returns True if a row was updated.
    If expected_updated_at is provided, raises ConflictError if the record has been modified."""
    with get_connection(incident_name) as conn:
        if expected_updated_at:
            cur = conn.execute(
                "UPDATE personnel SET name = ?, notes = ?, updated_at = datetime('now') WHERE id = ? AND updated_at = ?",
                (name, notes or None, person_id, expected_updated_at),
            )
            conn.commit()
            if cur.rowcount == 0:
                exists = conn.execute("SELECT 1 FROM personnel WHERE id = ?", (person_id,)).fetchone()
                if exists:
                    raise ConflictError()
                return False
        else:
            cur = conn.execute(
                "UPDATE personnel SET name = ?, notes = ?, updated_at = datetime('now') WHERE id = ?",
                (name, notes or None, person_id),
            )
            conn.commit()
        return cur.rowcount > 0


def delete_person(incident_name: str, *, person_id: int) -> bool:
    """
    Delete a person. Returns True if a row was deleted.
    """
    with get_connection(incident_name) as conn:
        cur = conn.execute(
            "DELETE FROM personnel WHERE id = ?",
            (person_id,),
        )
        conn.commit()
        return cur.rowcount > 0

def upsert_people_from_d4h(
    incident_name: str,
    people: Iterable[Tuple],
) -> Dict[str, int]:
    """
    Upsert a batch of people from D4H.

    people: iterable of (name, d4h_ref[, member_ref]) where d4h_ref is the D4H numeric member
    id and member_ref is the human-readable membership ref (e.g. '19-871').
    """
    imported = 0
    updated = 0
    skipped = 0

    with get_connection(incident_name) as conn:
        # Ensure migrations ran (safe even if already created)
        run_migrations(conn)

        for row in people:
            name = (row[0] or "").strip()
            d4h_ref = str(row[1] or "").strip()
            member_ref = str(row[2] or "").strip() if len(row) > 2 else None

            if not name or not d4h_ref:
                skipped += 1
                continue

            existed = conn.execute(
                "SELECT 1 FROM personnel WHERE d4h_ref = ? LIMIT 1",
                (d4h_ref,),
            ).fetchone() is not None

            conn.execute("""
                INSERT INTO personnel (name, d4h_ref, d4h_member_ref, source, updated_at)
                VALUES (?, ?, ?, 'D4H', datetime('now'))
                ON CONFLICT(d4h_ref) DO UPDATE SET
                    name = excluded.name,
                    d4h_member_ref = excluded.d4h_member_ref,
                    source = 'D4H',
                    updated_at = datetime('now')
            """, (name, d4h_ref, member_ref or None))

            if existed:
                updated += 1
            else:
                imported += 1

        conn.commit()

    return {"imported": imported, "updated": updated, "skipped": skipped}