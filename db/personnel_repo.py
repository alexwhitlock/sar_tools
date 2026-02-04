# db/personnel_repo.py
from typing import List, Dict, Any
from .database import get_connection
from .migrations import run_migrations


def list_personnel_with_team(incident_name: str) -> List[Dict[str, Any]]:
    """
    Return all personnel with their assigned team name (if any).
    One row per person.
    """
    with get_connection(incident_name) as conn:
        rows = conn.execute("""
            SELECT
                p.id AS id,
                p.name AS name,
                t.name AS team
            FROM personnel p
            LEFT JOIN team_members tm ON tm.personnel_id = p.id
            LEFT JOIN teams t ON t.id = tm.team_id
            ORDER BY p.name COLLATE NOCASE;
        """).fetchall()

    return [{
        "id": r["id"],
        "name": r["name"],
        "team": r["team"]
    } for r in rows]


def add_person(incident_name: str, *, name: str) -> int:
    """
    Add a person to the incident and return the new ID.
    """
    with get_connection(incident_name) as conn:
        cur = conn.execute(
            "INSERT INTO personnel (name) VALUES (?)",
            (name,)
        )
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

