import os
import sqlite3
import threading
import logging
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
INCIDENT_DIR = os.path.join(BASE_DIR, "data", "incidents")
SNAPSHOT_DIR = os.path.join(BASE_DIR, "html_backups")
MAX_SNAPSHOTS = 50


def _esc(s):
    return str(s or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _incident_names():
    inc_dir = Path(INCIDENT_DIR)
    if not inc_dir.exists():
        return []
    return [p.stem for p in inc_dir.glob("*.sqlite3")]


def _query(incident_name):
    from db.database import get_db_path_for_incident
    db_path = get_db_path_for_incident(incident_name)
    if not Path(db_path).exists():
        return None
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        personnel = conn.execute("""
            SELECT p.name, p.status, p.notes,
                   p.checkin_phone, p.checkin_ec_name, p.checkin_ec_phone,
                   p.checkin_license_plate, t.name AS team_name
            FROM personnel p
            LEFT JOIN team_members tm ON tm.personnel_id = p.id
            LEFT JOIN teams t ON t.id = tm.team_id
            ORDER BY p.name
        """).fetchall()
        teams = conn.execute("""
            SELECT t.name, t.status, t.manual_tl, t.manual_assignment, t.notes,
                   p.name AS leader_name
            FROM teams t
            LEFT JOIN personnel p ON p.id = t.team_leader_id
            ORDER BY t.name
        """).fetchall()
        log_entries = conn.execute("""
            SELECT timestamp, role, type, message
            FROM incident_log
            ORDER BY timestamp DESC
            LIMIT 200
        """).fetchall()
        return {
            "personnel": [dict(r) for r in personnel],
            "teams": [dict(r) for r in teams],
            "log": [dict(r) for r in log_entries],
        }
    finally:
        conn.close()


def _render(incident_name, data):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def status_class(s):
        s = (s or "").lower().replace(" ", "-")
        return f"st-{s}" if s else ""

    p_rows = "".join(
        f"<tr>"
        f"<td>{_esc(p['name'])}</td>"
        f"<td><span class='badge {status_class(p['status'])}'>{_esc(p['status'])}</span></td>"
        f"<td>{_esc(p['team_name'])}</td>"
        f"<td>{_esc(p['checkin_phone'])}</td>"
        f"<td>{_esc(p['checkin_ec_name'])}</td>"
        f"<td>{_esc(p['checkin_ec_phone'])}</td>"
        f"<td>{_esc(p['checkin_license_plate'])}</td>"
        f"<td class='note'>{_esc(p['notes'])}</td>"
        f"</tr>"
        for p in data["personnel"]
    )

    t_rows = "".join(
        f"<tr>"
        f"<td><strong>{_esc(t['name'])}</strong></td>"
        f"<td><span class='badge {status_class(t['status'])}'>{_esc(t['status'])}</span></td>"
        f"<td>{_esc(t['leader_name'] or t['manual_tl'])}</td>"
        f"<td>{_esc(t['manual_assignment'])}</td>"
        f"<td class='note'>{_esc(t['notes'])}</td>"
        f"</tr>"
        for t in data["teams"]
    )

    l_rows = "".join(
        f"<tr>"
        f"<td class='mono'>{_esc(e['timestamp'])}</td>"
        f"<td>{_esc(e['role'])}</td>"
        f"<td>{_esc(e['type'])}</td>"
        f"<td>{_esc(e['message'])}</td>"
        f"</tr>"
        for e in data["log"]
    )

    nc = len(data["personnel"])
    nt = len(data["teams"])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{_esc(incident_name)} — Snapshot {ts}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:14px;color:#111;background:#f5f5f5;padding:24px}}
.page{{max-width:1200px;margin:0 auto;background:#fff;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.12);padding:24px 28px}}
h1{{font-size:1.6rem;font-weight:700;margin-bottom:4px}}
.meta{{color:#666;font-size:0.85rem;margin-bottom:24px}}
h2{{font-size:1.05rem;font-weight:600;margin:24px 0 10px;padding-bottom:4px;border-bottom:2px solid #e5e5e5}}
table{{width:100%;border-collapse:collapse;font-size:0.875rem}}
th{{text-align:left;padding:6px 10px;background:#f0f0f0;font-weight:600;border-bottom:2px solid #ddd}}
td{{padding:6px 10px;border-bottom:1px solid #eee;vertical-align:top}}
tr:last-child td{{border-bottom:none}}
tr:hover td{{background:#fafafa}}
.mono{{font-family:monospace;font-size:0.8rem;white-space:nowrap}}
.note{{color:#555;font-size:0.8rem;max-width:240px}}
.badge{{display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600;background:#e5e5e5;color:#444}}
.st-checked-in{{background:#d1fae5;color:#065f46}}
.st-available{{background:#dbeafe;color:#1e40af}}
.st-deployed{{background:#fef3c7;color:#92400e}}
.st-signed-out{{background:#fee2e2;color:#991b1b}}
.st-out-of-service{{background:#f3f4f6;color:#6b7280}}
.st-in-service{{background:#ede9fe;color:#5b21b6}}
.summary{{display:flex;gap:24px;margin-bottom:20px;flex-wrap:wrap}}
.stat{{background:#f8f8f8;border:1px solid #e5e5e5;border-radius:6px;padding:10px 18px;text-align:center}}
.stat-n{{font-size:1.8rem;font-weight:700;line-height:1}}
.stat-l{{font-size:0.75rem;color:#666;margin-top:2px}}
@media print{{body{{background:#fff;padding:0}}.page{{box-shadow:none;padding:12px}}}}
</style>
</head>
<body>
<div class="page">
<h1>{_esc(incident_name)}</h1>
<p class="meta">Snapshot generated {ts} &nbsp;·&nbsp; Read-only offline copy</p>

<div class="summary">
  <div class="stat"><div class="stat-n">{nc}</div><div class="stat-l">Personnel</div></div>
  <div class="stat"><div class="stat-n">{nt}</div><div class="stat-l">Teams</div></div>
  <div class="stat"><div class="stat-n">{len(data['log'])}</div><div class="stat-l">Log Entries (recent)</div></div>
</div>

<h2>Personnel ({nc})</h2>
<table>
<thead><tr><th>Name</th><th>Status</th><th>Team</th><th>Phone</th><th>EC Name</th><th>EC Phone</th><th>Plate</th><th>Notes</th></tr></thead>
<tbody>{p_rows if p_rows else '<tr><td colspan="8" style="color:#999;font-style:italic">No personnel</td></tr>'}</tbody>
</table>

<h2>Teams ({nt})</h2>
<table>
<thead><tr><th>Team</th><th>Status</th><th>Leader</th><th>Assignment</th><th>Notes</th></tr></thead>
<tbody>{t_rows if t_rows else '<tr><td colspan="5" style="color:#999;font-style:italic">No teams</td></tr>'}</tbody>
</table>

<h2>Incident Log ({len(data['log'])} most recent)</h2>
<table>
<thead><tr><th>Timestamp</th><th>Role</th><th>Type</th><th>Message</th></tr></thead>
<tbody>{l_rows if l_rows else '<tr><td colspan="4" style="color:#999;font-style:italic">No log entries</td></tr>'}</tbody>
</table>
</div>
</body>
</html>"""


def _write_to(snap_dir, safe_name, html):
    snap_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    final_path = snap_dir / f"{safe_name}_{ts}.html"
    tmp_path = snap_dir / f"{safe_name}_{ts}.html.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(html)
        f.flush()
        os.fsync(f.fileno())
    os.replace(str(tmp_path), str(final_path))
    snapshots = sorted(snap_dir.glob(f"{safe_name}_*.html"))
    for old in snapshots[:-MAX_SNAPSHOTS]:
        try:
            old.unlink()
        except OSError:
            pass


def write_snapshot(incident_name):
    try:
        from db.database import incident_name_to_filename
        data = _query(incident_name)
        if data is None:
            return
        html = _render(incident_name, data)
        safe_name = Path(incident_name_to_filename(incident_name)).stem
        _write_to(Path(SNAPSHOT_DIR) / safe_name, safe_name, html)
    except Exception as exc:
        log.warning("Snapshot write failed for %s: %s", incident_name, exc)


def snapshot_incident_async(incident_name):
    threading.Thread(target=write_snapshot, args=(incident_name,), daemon=True).start()


def snapshot_all_async():
    for name in _incident_names():
        snapshot_incident_async(name)
