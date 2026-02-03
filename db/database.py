import os
import sqlite3
import re
from contextlib import contextmanager

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(__file__))
INCIDENT_DIR = os.path.join(BASE_DIR, "data", "incidents")


def ensure_dirs():
    """Ensure incident DB directory exists."""
    os.makedirs(INCIDENT_DIR, exist_ok=True)


def incident_name_to_filename(name: str) -> str:
    """
    Convert a user-entered incident name into a safe SQLite filename.
    """
    name = name.strip()
    name = re.sub(r"\s+", "_", name)                 # spaces → underscores
    name = re.sub(r"[^A-Za-z0-9_\-]", "", name)      # drop unsafe chars
    return f"{name}.sqlite3"

def get_db_path_for_incident(incident_name: str) -> str:
    """
    Return the filesystem path for an incident SQLite DB file.
    This is the single source of truth for incident DB locations.
    """
    ensure_dirs()
    filename = incident_name_to_filename(incident_name)
    return os.path.join(INCIDENT_DIR, filename)


@contextmanager
def get_connection(incident_name: str):
    """
    Open a SQLite connection for a specific incident.
    One incident == one database file.
    """
    ensure_dirs()

    db_path = get_db_path_for_incident(incident_name)

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")

    try:
        yield conn
        conn.commit()
    finally:
        conn.close()
