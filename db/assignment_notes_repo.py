# db/assignment_notes_repo.py
from typing import Dict
from .database import get_connection


def get_notes(incident_name: str) -> Dict[str, str]:
    """Return {feature_id: notes} for all assignments that have notes."""
    with get_connection(incident_name) as conn:
        rows = conn.execute(
            "SELECT feature_id, notes FROM assignment_notes WHERE notes IS NOT NULL"
        ).fetchall()
    return {r["feature_id"]: r["notes"] for r in rows}


def upsert_notes(incident_name: str, feature_id: str, notes: str | None) -> None:
    """Set or clear notes for a CalTopo assignment feature."""
    with get_connection(incident_name) as conn:
        if notes:
            conn.execute("""
                INSERT INTO assignment_notes (feature_id, notes, updated_at)
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(feature_id) DO UPDATE SET
                    notes = excluded.notes,
                    updated_at = datetime('now')
            """, (feature_id, notes))
        else:
            conn.execute("DELETE FROM assignment_notes WHERE feature_id = ?", (feature_id,))
        conn.commit()
