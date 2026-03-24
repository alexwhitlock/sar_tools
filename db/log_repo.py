from .database import get_connection


def insert_log(incident_name: str, role: str, type_: str, message: str, flags: str = None):
    """
    Insert a log entry.  Callable from route handlers and other repo modules alike.
    role  — who/what generated this: SYSTEM, IC, PLANS, OPS, COMMS, OTHER
    type_ — nature of entry: system, comms, note
    flags — comma-separated tags e.g. 'important'
    """
    with get_connection(incident_name) as conn:
        conn.execute(
            "INSERT INTO incident_log (role, type, flags, message) VALUES (?, ?, ?, ?)",
            (role, type_, flags, message),
        )


def toggle_important(incident_name: str, log_id: int):
    with get_connection(incident_name) as conn:
        row = conn.execute("SELECT flags FROM incident_log WHERE id = ?", (log_id,)).fetchone()
        if row is None:
            return False
        flags = set(f.strip() for f in (row["flags"] or "").split(",") if f.strip())
        if "important" in flags:
            flags.discard("important")
        else:
            flags.add("important")
        conn.execute("UPDATE incident_log SET flags = ? WHERE id = ?",
                     (",".join(sorted(flags)) or None, log_id))
        return True


def get_logs(incident_name: str, type_filter: str = None, role_filter: str = None,
             search: str = None, exclude_type: str = None, limit: int = 1000, order: str = "asc"):
    with get_connection(incident_name) as conn:
        clauses = []
        params = []
        if type_filter:
            types = [t.strip() for t in type_filter.split(",") if t.strip()]
            if len(types) == 1:
                clauses.append("type = ?")
                params.append(types[0])
            elif len(types) > 1:
                placeholders = ",".join("?" * len(types))
                clauses.append(f"type IN ({placeholders})")
                params.extend(types)
        if role_filter:
            clauses.append("UPPER(role) = ?")
            params.append(role_filter.upper())
        if search:
            clauses.append("(message LIKE ? OR role LIKE ?)")
            params.extend([f"%{search}%", f"%{search}%"])
        if exclude_type:
            types = [t.strip() for t in exclude_type.split(",") if t.strip()]
            if types:
                placeholders = ",".join("?" * len(types))
                clauses.append(f"type NOT IN ({placeholders})")
                params.extend(types)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        direction = "DESC" if order == "desc" else "ASC"
        rows = conn.execute(
            f"SELECT id, timestamp, role, type, flags, message "
            f"FROM incident_log {where} ORDER BY timestamp {direction}, id {direction} LIMIT ?",
            params + [limit],
        ).fetchall()
        return [dict(r) for r in rows]
