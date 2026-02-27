# db/personnel_repo.py
from typing import List, Dict, Any, Iterable, Tuple
from .database import get_connection
from .migrations import run_migrations


def list_personnel_with_team(incident_name: str) -> List[Dict[str, Any]]:
    with get_connection(incident_name) as conn:
        rows = conn.execute("""
            SELECT
                p.id AS id,
                p.name AS name,
                t.name AS team,
                p.source AS source,
                p.d4h_ref AS d4hRef
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
    } for r in rows]


def add_person(incident_name: str, *, name: str) -> int:
    with get_connection(incident_name) as conn:
        cur = conn.execute(
            "INSERT INTO personnel (name) VALUES (?)",
            (name,)
        )
        conn.commit()
        return cur.lastrowid

def update_person(incident_name: str, *, person_id: int, name: str) -> bool:
    """
    Update a person's name. Returns True if a row was updated.
    """
    with get_connection(incident_name) as conn:
        cur = conn.execute(
            "UPDATE personnel SET name = ? WHERE id = ?",
            (name, person_id),
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
    people: Iterable[Tuple[str, str]],
) -> Dict[str, int]:
    """
    Upsert a batch of people from D4H.

    people: iterable of (name, d4h_ref) where d4h_ref is the D4H member id (string/int).
    """
    imported = 0
    updated = 0
    skipped = 0

    with get_connection(incident_name) as conn:
        # Ensure migrations ran (safe even if already created)
        run_migrations(conn)

        # Unique index for D4H linkage
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_personnel_d4h_ref ON personnel(d4h_ref);")

        for name, d4h_ref in people:
            name = (name or "").strip()
            d4h_ref = str(d4h_ref or "").strip()

            if not name or not d4h_ref:
                skipped += 1
                continue

            existed = conn.execute(
                "SELECT 1 FROM personnel WHERE d4h_ref = ? LIMIT 1",
                (d4h_ref,),
            ).fetchone() is not None

            conn.execute("""
                INSERT INTO personnel (name, d4h_ref, source, updated_at)
                VALUES (?, ?, 'D4H', datetime('now'))
                ON CONFLICT(d4h_ref) DO UPDATE SET
                    name = excluded.name,
                    source = 'D4H',
                    updated_at = datetime('now')
            """, (name, d4h_ref))

            if existed:
                updated += 1
            else:
                imported += 1

        conn.commit()

    return {"imported": imported, "updated": updated, "skipped": skipped}