# db/schema_dump.py
import os
from datetime import datetime

def write_schema_dump(conn, db_path: str, incident_name: str) -> str:
  
    schema_path = os.path.splitext(db_path)[0] + ".schema.sql"
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    rows = conn.execute("""
        SELECT type, name, sql
        FROM sqlite_master
        WHERE sql IS NOT NULL
          AND type IN ('table', 'index', 'trigger', 'view')
        ORDER BY
          CASE type
            WHEN 'table' THEN 1
            WHEN 'view' THEN 2
            WHEN 'trigger' THEN 3
            WHEN 'index' THEN 4
            ELSE 5
          END,
          name;
    """).fetchall()

    with open(schema_path, "w", encoding="utf-8") as f:
        f.write(f"-- Schema dump for: {incident_name}\n")
        f.write(f"-- Generated: {now}\n\n")
        for r in rows:
            f.write(r["sql"].strip() + ";\n\n")

    return schema_path
