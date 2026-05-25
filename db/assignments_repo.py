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


def upsert_assignments_from_caltopo(incident_name: str, assignments: list) -> None:
    """Cache CalTopo-derived fields in assignments_cache (no sync triggers → no fetch loop)."""
    with get_connection(incident_name) as conn:
        for a in assignments:
            fid = a.get("id")
            if not fid:
                continue
            num = str(a["number"]) if a.get("number") is not None else None
            conn.execute("""
                INSERT INTO assignments_cache
                    (feature_id, number, team, caltopo_status, assignment_type,
                     resource_type, description, op_period, cached_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                ON CONFLICT(feature_id) DO UPDATE SET
                    number          = excluded.number,
                    team            = excluded.team,
                    caltopo_status  = excluded.caltopo_status,
                    assignment_type = excluded.assignment_type,
                    resource_type   = excluded.resource_type,
                    description     = excluded.description,
                    op_period       = excluded.op_period,
                    cached_at       = datetime('now')
            """, (fid, num, a.get("team"), a.get("status"),
                  a.get("assignmentType"), a.get("resourceType"),
                  a.get("description"), a.get("op")))
        conn.commit()


def upsert_assignment_data(
    incident_name: str,
    feature_id: str,
    *,
    asgn_type: Optional[str],
    notes: Optional[str],
) -> None:
    """Save or clear local data (type, notes) for a CalTopo assignment feature."""
    with get_connection(incident_name) as conn:
        if asgn_type is None and notes is None:
            conn.execute("DELETE FROM assignments WHERE feature_id = ?", (feature_id,))
        else:
            conn.execute("""
                INSERT INTO assignments (feature_id, type, notes, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(feature_id) DO UPDATE SET
                    type       = excluded.type,
                    notes      = excluded.notes,
                    updated_at = datetime('now')
            """, (feature_id, asgn_type, notes))
        conn.commit()
