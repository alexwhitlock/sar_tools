# db/assignments_repo.py
from typing import Dict, Optional
from .database import get_connection


def get_assignment_data(incident_name: str) -> Dict[str, dict]:
    """Return {feature_id: {type, description, notes}} for all stored assignment rows."""
    with get_connection(incident_name) as conn:
        rows = conn.execute(
            "SELECT feature_id, type, description, notes FROM assignments"
        ).fetchall()
    return {r["feature_id"]: dict(r) for r in rows}


def upsert_assignment_data(
    incident_name: str,
    feature_id: str,
    *,
    asgn_type: Optional[str],
    description: Optional[str],
    notes: Optional[str],
) -> None:
    """Save or clear local data for a CalTopo assignment feature."""
    with get_connection(incident_name) as conn:
        if asgn_type is None and description is None and notes is None:
            conn.execute("DELETE FROM assignments WHERE feature_id = ?", (feature_id,))
        else:
            conn.execute("""
                INSERT INTO assignments (feature_id, type, description, notes, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(feature_id) DO UPDATE SET
                    type        = excluded.type,
                    description = excluded.description,
                    notes       = excluded.notes,
                    updated_at  = datetime('now')
            """, (feature_id, asgn_type, description, notes))
        conn.commit()
