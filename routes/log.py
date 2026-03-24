import csv
import io
from flask import Blueprint, jsonify, request, Response
from db.log_repo import insert_log, get_logs, toggle_important

bp = Blueprint("log", __name__)


@bp.route("/incidents/<incident_name>/log", methods=["GET"])
def list_log(incident_name):
    type_filter = request.args.get("type") or None
    role_filter = request.args.get("role") or None
    search = request.args.get("search") or None
    exclude_type = request.args.get("exclude_type") or None
    order = request.args.get("order") or "asc"
    rows = get_logs(incident_name, type_filter=type_filter, role_filter=role_filter, search=search, exclude_type=exclude_type, order=order)
    return jsonify(success=True, log=rows)


@bp.route("/incidents/<incident_name>/log", methods=["POST"])
def add_log(incident_name):
    data = request.get_json(force=True)
    role = (data.get("role") or "OTHER").strip().upper()
    type_ = (data.get("type") or "note").strip().lower()
    message = (data.get("message") or "").strip()
    flags = (data.get("flags") or None)
    if not message:
        return jsonify(success=False, error="Message is required"), 400
    insert_log(incident_name, role, type_, message, flags)
    return jsonify(success=True)


@bp.route("/incidents/<incident_name>/log/<int:log_id>/important", methods=["POST"])
def toggle_important_flag(incident_name, log_id):
    found = toggle_important(incident_name, log_id)
    return jsonify(success=found)


@bp.route("/incidents/<incident_name>/log/export")
def export_log(incident_name):
    rows = get_logs(incident_name)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "timestamp", "role", "type", "flags", "message"])
    for r in rows:
        writer.writerow([r["id"], r["timestamp"], r["role"], r["type"], r.get("flags", ""), r["message"]])
    csv_bytes = buf.getvalue().encode("utf-8")
    filename = f"{incident_name}_log.csv"
    return Response(
        csv_bytes,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
