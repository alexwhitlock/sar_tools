# db/teams_repo.py
from typing import List, Dict, Any
from .database import get_connection

TEAM_STATUSES = [
    "Out of Service",
    "Staged",
    "Travelling to Assignment",
    "On Assignment",
    "Returning from Assignment",
    "Awaiting Debrief",
    "Retired",
]


def list_teams(incident_name: str) -> List[Dict[str, Any]]:
    with get_connection(incident_name) as conn:
        rows = conn.execute("""
            SELECT
                t.id,
                t.name,
                t.status,
                t.team_leader_id,
                leader.name AS leader_name,
                COUNT(tm.personnel_id) AS member_count,
                GROUP_CONCAT(CAST(member.id AS TEXT) || ':' || member.name, '|') AS member_data
            FROM teams t
            LEFT JOIN personnel leader ON leader.id = t.team_leader_id
            LEFT JOIN team_members tm ON tm.team_id = t.id
            LEFT JOIN personnel member ON member.id = tm.personnel_id
            GROUP BY t.id
            ORDER BY t.name COLLATE NOCASE
        """).fetchall()
    return [{
        "id": r["id"],
        "name": r["name"],
        "status": r["status"] or "Out of Service",
        "teamLeaderId": r["team_leader_id"],
        "teamLeaderName": r["leader_name"],
        "memberCount": r["member_count"],
        "memberData": r["member_data"] or "",
    } for r in rows]


def list_team_members(incident_name: str, team_id: int) -> List[Dict[str, Any]]:
    with get_connection(incident_name) as conn:
        rows = conn.execute("""
            SELECT p.id, p.name
            FROM team_members tm
            JOIN personnel p ON p.id = tm.personnel_id
            WHERE tm.team_id = ?
            ORDER BY p.name COLLATE NOCASE
        """, (team_id,)).fetchall()
    return [{"id": r["id"], "name": r["name"]} for r in rows]


def create_team(incident_name: str, *, name: str) -> int:
    with get_connection(incident_name) as conn:
        cur = conn.execute("INSERT INTO teams (name) VALUES (?)", (name,))
        conn.commit()
        return cur.lastrowid


def update_team(incident_name: str, *, team_id: int, **kwargs) -> bool:
    """Update team fields. Accepts: name, team_leader_id, status."""
    sets = []
    params = []

    if "name" in kwargs:
        sets.append("name = ?")
        params.append(kwargs["name"])
    if "team_leader_id" in kwargs:
        sets.append("team_leader_id = ?")
        params.append(kwargs["team_leader_id"])  # None clears it
    if "status" in kwargs:
        sets.append("status = ?")
        params.append(kwargs["status"])

    if not sets:
        return False

    sets.append("updated_at = datetime('now')")
    params.append(team_id)

    with get_connection(incident_name) as conn:
        cur = conn.execute(
            f"UPDATE teams SET {', '.join(sets)} WHERE id = ?",
            params,
        )
        conn.commit()
        return cur.rowcount > 0


def delete_team(incident_name: str, *, team_id: int) -> bool:
    with get_connection(incident_name) as conn:
        cur = conn.execute("DELETE FROM teams WHERE id = ?", (team_id,))
        conn.commit()
        return cur.rowcount > 0


def assign_person_to_team(incident_name: str, *, team_id: int, person_id: int) -> None:
    """Assign a person to a team (upsert — replaces any existing team assignment)."""
    with get_connection(incident_name) as conn:
        conn.execute("""
            INSERT INTO team_members (personnel_id, team_id)
            VALUES (?, ?)
            ON CONFLICT(personnel_id) DO UPDATE SET team_id = excluded.team_id
        """, (person_id, team_id))
        conn.commit()


def remove_person_from_team(incident_name: str, *, person_id: int) -> None:
    """Remove a person from whichever team they are currently in."""
    with get_connection(incident_name) as conn:
        conn.execute("DELETE FROM team_members WHERE personnel_id = ?", (person_id,))
        conn.commit()
