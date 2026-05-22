import os
import sqlite3
from contextlib import contextmanager

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
MEMBERS_DB_PATH = os.path.join(BASE_DIR, "data", "members.sqlite3")


def _ensure_dir():
    os.makedirs(os.path.dirname(MEMBERS_DB_PATH), exist_ok=True)


@contextmanager
def get_members_connection():
    _ensure_dir()
    conn = sqlite3.connect(MEMBERS_DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def run_members_migrations():
    with get_members_connection() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS members (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                name                    TEXT NOT NULL,
                d4h_ref                 TEXT UNIQUE,
                d4h_member_ref          TEXT,
                phone                   TEXT,
                email                   TEXT,
                emergency_contact_name  TEXT,
                emergency_contact_phone TEXT,
                license_plate           TEXT,
                local_modified          INTEGER NOT NULL DEFAULT 0,
                created_at              TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_members_name    ON members (name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_members_d4h_ref ON members (d4h_ref);
            CREATE INDEX IF NOT EXISTS idx_members_phone   ON members (phone);
        """)
