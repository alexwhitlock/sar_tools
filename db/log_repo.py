from .database import get_connection


def insert_log(incident_name: str, role: str, type_: str, message: str, flags: str = None):
    """
    Insert a log entry.  Callable from route handlers and other repo modules alike.
    role  — who/what generated this: SYSTEM, IC, PLANS, OPS, COMMS, OTHER
    type_ — nature of entry: system, comms, note, task
    flags — comma-separated tags e.g. 'important'
    """
    with get_connection(incident_name) as conn:
        conn.execute(
            "INSERT INTO incident_log (role, type, flags, message) VALUES (?, ?, ?, ?)",
            (role, type_, flags, message),
        )


def get_logs(incident_name: str, type_filter: str = None, search: str = None, limit: int = 1000):
    with get_connection(incident_name) as conn:
        clauses = []
        params = []
        if type_filter:
            clauses.append("type = ?")
            params.append(type_filter)
        if search:
            clauses.append("(message LIKE ? OR role LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        rows = conn.execute(
            f"SELECT id, timestamp, role, type, flags, message "
            f"FROM incident_log {where} ORDER BY timestamp ASC, id ASC LIMIT ?",
            params + [limit],
        ).fetchall()
        return [dict(r) for r in rows]
