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
MAX_SNAPSHOTS = 3


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
                   p.checkin_license_plate, p.checkin_skills, t.name AS team_name
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
            SELECT timestamp, role, type, flags, message
            FROM incident_log
            WHERE type != 'user_event'
            ORDER BY timestamp DESC
        """).fetchall()
        user_events = conn.execute("""
            SELECT timestamp, role, type, flags, message
            FROM incident_log
            WHERE type = 'user_event'
            ORDER BY timestamp DESC
        """).fetchall()
        try:
            assignments = conn.execute("""
                SELECT ac.number, ac.team, ac.caltopo_status, ac.assignment_type,
                       ac.resource_type, ac.description, a.type, a.notes, ac.op_period
                FROM assignments_cache ac
                LEFT JOIN assignments a ON a.feature_id = ac.feature_id
                ORDER BY
                    CASE WHEN ac.number IS NULL THEN 1 ELSE 0 END,
                    CAST(ac.number AS INTEGER),
                    ac.feature_id
            """).fetchall()
        except Exception:
            assignments = []
        return {
            "personnel":   [dict(r) for r in personnel],
            "teams":       [dict(r) for r in teams],
            "log":         [dict(r) for r in log_entries],
            "user_events": [dict(r) for r in user_events],
            "assignments": [dict(r) for r in assignments],
        }
    finally:
        conn.close()


def _render(incident_name, data):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # ── Build team roster ────────────────────────────────────────────────────
    team_info    = {t["name"]: t for t in data["teams"]}
    team_members = {t["name"]: [] for t in data["teams"]}
    unassigned   = []
    for p in data["personnel"]:
        tn = p["team_name"]
        if tn and tn in team_members:
            team_members[tn].append(p)
        else:
            unassigned.append(p)

    team_cards = ""
    for tname in [t["name"] for t in data["teams"]]:
        t       = team_info[tname]
        members = team_members[tname]
        leader  = t["leader_name"] or t["manual_tl"] or ""
        assign  = t["manual_assignment"] or ""
        status  = t["status"] or ""
        tnotes  = t["notes"] or ""

        meta_lines = []
        if status: meta_lines.append(f"<div><b>Status:</b> {_esc(status)}</div>")
        if leader: meta_lines.append(f"<div><b>TL:</b> {_esc(leader)}</div>")
        if assign: meta_lines.append(f"<div><b>Assignment:</b> {_esc(assign)}</div>")
        if tnotes: meta_lines.append(f"<div><b>Notes:</b> {_esc(tnotes)}</div>")
        meta_html = "".join(meta_lines)

        member_items = "".join(
            f"<li>{_esc(p['name'])} <span class='ms'>({_esc(p['status'] or 'Added')})</span></li>"
            for p in members
        ) or "<li class='empty'>No members</li>"

        team_cards += (
            f'<div class="tc">'
            f'<div class="tc-name">{_esc(tname)}</div>'
            + (f'<div class="tc-meta">{meta_html}</div>' if meta_html else "")
            + f'<ul class="tc-members">{member_items}</ul>'
            f'</div>'
        )

    if unassigned:
        ua_items = "".join(
            f"<li>{_esc(p['name'])} <span class='ms'>({_esc(p['status'] or 'Added')})</span></li>"
            for p in unassigned
        )
        team_cards += (
            f'<div class="tc tc-none">'
            f'<div class="tc-name">No Team</div>'
            f'<ul class="tc-members">{ua_items}</ul>'
            f'</div>'
        )

    # ── Personnel rows ───────────────────────────────────────────────────────
    p_rows = ""
    for p in data["personnel"]:
        ec_parts = [x for x in [p["checkin_ec_name"], p["checkin_ec_phone"]] if x]
        ec_html  = "<br>".join(_esc(x) for x in ec_parts)
        p_rows += (
            f"<tr>"
            f"<td>{_esc(p['name'])}</td>"
            f"<td>{_esc(p['status'])}</td>"
            f"<td>{_esc(p['team_name'])}</td>"
            f"<td>{_esc(p['checkin_phone'])}</td>"
            f"<td>{ec_html}</td>"
            f"<td>{_esc(p['checkin_license_plate'])}</td>"
            f"<td>{_esc(p['checkin_skills'])}</td>"
            f"<td class='note'>{_esc(p['notes'])}</td>"
            f"</tr>"
        )

    # ── Assignment rows ──────────────────────────────────────────────────────
    a_rows = "".join(
        f"<tr>"
        f"<td style='text-align:center;font-weight:700'>{_esc(a['number'])}</td>"
        f"<td>{_esc(a['team'])}</td>"
        f"<td>{_esc(a['caltopo_status'])}</td>"
        f"<td>{_esc(a['assignment_type'])}</td>"
        f"<td>{_esc(a['resource_type'])}</td>"
        f"<td>{_esc(a['description'])}</td>"
        f"<td>{_esc(a['type'])}</td>"
        f"<td class='note'>{_esc(a['notes'])}</td>"
        f"<td>{_esc(a['op_period'])}</td>"
        f"</tr>"
        for a in data["assignments"]
    )

    def _imp(e):
        return "important" in (e.get("flags") or "")

    # ── Incident log rows (no user_event, DESC) ──────────────────────────────
    l_rows = "".join(
        f"<tr{'  class=\"imp\"' if _imp(e) else ''}>"
        f"<td class='mono'>{_esc(e['timestamp'])}</td>"
        f"<td>{_esc(e['role'])}</td>"
        f"<td>{_esc(e['type'])}</td>"
        f"<td>{_esc(e['message'])}</td>"
        f"</tr>"
        for e in data["log"]
    )

    # ── User events rows (DESC) ──────────────────────────────────────────────
    u_rows = "".join(
        f"<tr>"
        f"<td class='mono'>{_esc(e['timestamp'])}</td>"
        f"<td>{_esc(e['role'])}</td>"
        f"<td>{_esc(e['message'])}</td>"
        f"</tr>"
        for e in data["user_events"]
    )

    nc        = len(data["personnel"])
    nt        = len(data["teams"])
    n_ci      = sum(1 for p in data["personnel"] if (p["status"] or "") == "Checked In")
    n_co      = sum(1 for p in data["personnel"] if (p["status"] or "") == "Checked Out")
    nc_log    = len(data["log"])
    nc_ue     = len(data["user_events"])
    nc_assign = len(data["assignments"])

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>{_esc(incident_name)} — Snapshot {ts}</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
@page{{size:landscape;margin:1.2cm 1.5cm}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;font-size:10.5pt;line-height:1.4;color:#111;background:#fff}}

@media screen{{
  body{{background:#ccc;padding:24px}}
  .page{{max-width:1200px;margin:0 auto;background:#fff;padding:24px 32px;box-shadow:0 2px 8px rgba(0,0,0,.18)}}
  .btn-bar{{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}}
  .print-btn{{padding:7px 18px;border:none;border-radius:6px;font-size:10pt;font-weight:600;cursor:pointer;background:#1a73e8;color:#fff}}
  .print-btn:hover{{background:#1558b5}}
  .print-btn.secondary{{background:#555}}
  .print-btn.secondary:hover{{background:#333}}
}}
@media print{{
  .btn-bar{{display:none}}
  /* Each section starts on a new page except the first */
  .section+.section{{page-break-before:always;break-before:page}}
  h2{{page-break-after:avoid;break-after:avoid}}
  .tc{{page-break-inside:avoid;break-inside:avoid}}
  /* Print mode: hide user events */
  body.no-user-events .s-userevents{{display:none}}
}}

h1{{font-size:16pt;font-weight:700;margin-bottom:3px}}
.meta{{font-size:9pt;color:#555;margin-bottom:10px}}
.stats{{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;font-size:9.5pt}}
.stat-item{{border:1px solid #bbb;border-radius:3px;padding:3px 10px;font-weight:600}}

h2{{font-size:11.5pt;font-weight:700;border-bottom:1.5px solid #111;padding-bottom:3px;margin:0 0 10px}}
.section{{padding-top:18px}}

/* ── Team cards ── */
.tc-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px}}
.tc{{border:1px solid #999;border-radius:3px;padding:7px 10px}}
.tc-none{{border-style:dashed;border-color:#bbb}}
.tc-name{{font-weight:700;font-size:10.5pt;margin-bottom:3px}}
.tc-meta{{font-size:8pt;color:#444;margin-bottom:5px;line-height:1.6}}
.tc-members{{list-style:none;font-size:9pt;padding-left:2px}}
.tc-members li{{padding:1px 0;border-bottom:1px solid #eee}}
.tc-members li:last-child{{border-bottom:none}}
.tc-members li.empty{{color:#999;font-style:italic}}
.ms{{color:#666;font-size:7.5pt}}

/* ── Tables ── */
table{{width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:6px}}
th{{text-align:left;padding:4px 6px;border-top:1.5px solid #111;border-bottom:1.5px solid #111;font-weight:700;font-size:8pt;white-space:nowrap}}
td{{padding:4px 6px;border-bottom:1px solid #ccc;vertical-align:top}}
tr:last-child td{{border-bottom:none}}
tr.imp td{{font-weight:600}}
.mono{{font-family:monospace;font-size:7.5pt;white-space:nowrap}}
.note{{color:#444;font-size:7.5pt}}
</style>
<script>
function printMode(cls) {{
  document.body.className = cls;
  window.print();
  setTimeout(function(){{ document.body.className = ''; }}, 500);
}}
</script>
</head>
<body>
<div class="page">

<div class="btn-bar">
  <button class="print-btn" onclick="printMode('')">Print All</button>
  <button class="print-btn secondary" onclick="printMode('no-user-events')">Print (no user events)</button>
</div>

<h1>{_esc(incident_name)}</h1>
<p class="meta">Snapshot: {ts} &nbsp;&middot;&nbsp; Read-only offline copy</p>
<div class="stats">
  <span class="stat-item">{nc} Personnel</span>
  <span class="stat-item">{n_ci} Checked In</span>
  <span class="stat-item">{n_co} Checked Out</span>
  <span class="stat-item">{nt} Teams</span>
  <span class="stat-item">{nc_assign} Assignments</span>
  <span class="stat-item">{nc_log} Log Entries</span>
  <span class="stat-item">{nc_ue} User Events</span>
</div>

<div class="section s-roster">
<h2>Teams</h2>
<div class="tc-grid">
{team_cards if team_cards else '<p style="color:#999;font-style:italic;font-size:9pt">No teams</p>'}
</div>
</div>

<div class="section s-personnel">
<h2>Personnel ({nc})</h2>
<table>
<thead><tr><th>Name</th><th>Status</th><th>Team</th><th>Phone</th><th>Emergency Contact</th><th>Plate</th><th>Skills / Equipment</th><th>Notes</th></tr></thead>
<tbody>{p_rows if p_rows else '<tr><td colspan="8" style="color:#999;font-style:italic">No personnel</td></tr>'}</tbody>
</table>
</div>

<div class="section s-assignments">
<h2>Assignments ({nc_assign})</h2>
<table>
<thead><tr><th>#</th><th>Team</th><th>Status</th><th>Type</th><th>Resource</th><th>Description</th><th>SAR Type</th><th>Notes</th><th>Op Period</th></tr></thead>
<tbody>{a_rows if a_rows else '<tr><td colspan="9" style="color:#999;font-style:italic">No assignments recorded</td></tr>'}</tbody>
</table>
</div>

<div class="section s-log">
<h2>Incident Log ({nc_log})</h2>
<table>
<thead><tr><th>Timestamp</th><th>Role</th><th>Type</th><th>Message</th></tr></thead>
<tbody>{l_rows if l_rows else '<tr><td colspan="4" style="color:#999;font-style:italic">No log entries</td></tr>'}</tbody>
</table>
</div>

<div class="section s-userevents">
<h2>User Events ({nc_ue})</h2>
<table>
<thead><tr><th>Timestamp</th><th>Role</th><th>Message</th></tr></thead>
<tbody>{u_rows if u_rows else '<tr><td colspan="3" style="color:#999;font-style:italic">No user events</td></tr>'}</tbody>
</table>
</div>

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


def latest_snapshot_path(incident_name):
    from db.database import incident_name_to_filename
    safe_name = Path(incident_name_to_filename(incident_name)).stem
    snap_dir = Path(SNAPSHOT_DIR) / safe_name
    files = sorted(snap_dir.glob(f"{safe_name}_*.html"))
    return files[-1] if files else None
