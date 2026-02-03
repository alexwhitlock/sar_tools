from typing import List, Optional, Dict, Any
from .database import get_connection


def add_personnel(
    incident_name: str,
    *,
    callsign: str,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    role: Optional[str] = None,
    status: Optional[str] = None,
) -> int:
    """
    Insert a personnel record and return its ID.
    """
    with get_connection(incident_name) as conn:
        cur = conn.execute(
            """
            INSERT INTO personnel (callsign, first_name, last_name, role, status)
            VALUES (?, ?, ?, ?, ?)
            """,
            (callsign, first_name, last_name, role, status),
        )
        return cur.lastrowid


def list_personnel(incident_name: str) -> List[Dict[str, Any]]:
    """
    Return all personnel records for an incident.
    """
    with get_connection(incident_name) as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM personnel
            ORDER BY callsign
            """
        ).fetchall()

    return [dict(r) for r in rows]


def get_personnel_by_callsign(
    incident_name: str, callsign: str
) -> Optional[Dict[str, Any]]:
    with get_connection(incident_name) as conn:
        row = conn.execute(
            """
            SELECT *
            FROM personnel
            WHERE callsign = ?
            """,
            (callsign,),
        ).fetchone()

    return dict(row) if row else None
