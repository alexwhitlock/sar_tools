"""
Database schema migrations

This file defines the ordered history of schema changes for incident databases.
Each migration represents a forward-only change to the database structure.

IMPORTANT RULES:
- Migrations are immutable once applied. Do NOT edit or reorder old migrations.
- To change the schema (add columns, tables, indexes), create a NEW migration.
- New incident databases run ALL migrations from version 1 onward.
- Existing incident databases only run migrations they have not yet applied.

WHY THIS EXISTS:
- Incident databases are stored as separate SQLite files.
- Each incident DB may be created at a different time.
- Migrations ensure all DBs converge to the same schema safely.

GUIDELINES:
- migration_001 should contain the initial schema only.
- All schema changes after initial release must be in migration_002, migration_003, etc.
- Data access logic belongs in repository modules, not here.
"""


def run_migrations(conn):
    """
    Database schema migrations (incident DB files)

    NOTE (pre-release):
    - Since we're still in initial development, we are allowed to edit migration_001.
    - Once real incident DBs are created/used operationally, do NOT edit old migrations.
      Add new migrations instead (migration_002, migration_003, ...).
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)

    current_version = conn.execute(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations"
    ).fetchone()[0]

    migrations = [
        (1, migration_001_initial_schema),
        (2, migration_002_settings),
        (3, migration_003_personnel_status),
        (4, migration_004_personnel_previous_status),
        (5, migration_005_teams_leader_and_status),
        (6, migration_006_incident_log),
    ]

    for version, migration in migrations:
        if version > current_version:
            migration(conn)
            conn.execute(
                "INSERT INTO schema_migrations (version) VALUES (?)",
                (version,)
            )


def migration_001_initial_schema(conn):
    """
    Initial incident schema:
    - personnel: people participating in this incident
    - teams: named teams for this incident
    - team_members: join table enforcing ONE team per person (DB-enforced)
    """

    # Personnel
    conn.execute("""
        CREATE TABLE IF NOT EXISTS personnel (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,
            d4h_ref TEXT,
            source TEXT NOT NULL DEFAULT 'MANUAL',

            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """)

    # Teams
    conn.execute("""
        CREATE TABLE IF NOT EXISTS teams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Out of Service',

            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),

            UNIQUE(name)
        );
    """)

    # Join table enforcing: ONE team per person
    #
    # PRIMARY KEY(personnel_id) means a given person can appear only once in this table,
    # so they can only be assigned to one team at a time.
    conn.execute("""
        CREATE TABLE IF NOT EXISTS team_members (
            personnel_id INTEGER NOT NULL,
            team_id INTEGER NOT NULL,

            created_at TEXT NOT NULL DEFAULT (datetime('now')),

            PRIMARY KEY (personnel_id),
            FOREIGN KEY (personnel_id) REFERENCES personnel(id) ON DELETE CASCADE,
            FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
        );
    """)
    
    # Helpful indexes
    conn.execute("CREATE INDEX IF NOT EXISTS idx_personnel_name ON personnel(name);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);")
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_personnel_d4h_ref ON personnel(d4h_ref);")


def migration_004_personnel_previous_status(conn):
    """
    Adds previous_status to personnel to track the state before the last status change.
    Used to determine whether Undo Check In is applicable.
    """
    conn.execute("""
        ALTER TABLE personnel ADD COLUMN previous_status TEXT;
    """)


def migration_003_personnel_status(conn):
    """
    Adds a status field to personnel.
    Tracks where each person is in the incident lifecycle.
    Existing rows default to 'Added'.
    """
    conn.execute("""
        ALTER TABLE personnel ADD COLUMN status TEXT NOT NULL DEFAULT 'Added';
    """)


def migration_005_teams_leader_and_status(conn):
    """
    Adds team_leader_id (FK to personnel) to teams table.
    Migrates legacy 'draft' status to 'Out of Service'.
    """
    conn.execute("ALTER TABLE teams ADD COLUMN team_leader_id INTEGER REFERENCES personnel(id)")
    conn.execute("UPDATE teams SET status = 'Out of Service' WHERE status = 'draft'")


def migration_002_settings(conn):
    """
    Adds a key-value settings table for per-incident configuration.
    Used to store linked D4H activity ID and CalTopo map ID.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    """)


def migration_006_incident_log(conn):
    """
    Adds the incident_log table for capturing all incident timeline events.
    Stores system-generated events, comms log entries, notes, and tasks.
    """
    conn.execute("""
        CREATE TABLE IF NOT EXISTS incident_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
            role        TEXT NOT NULL DEFAULT 'SYSTEM',
            type        TEXT NOT NULL DEFAULT 'note',
            flags       TEXT,
            message     TEXT NOT NULL
        );
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_log_timestamp ON incident_log(timestamp);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_log_type     ON incident_log(type);")
