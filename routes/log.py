import csv
import io
from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, Response
from fpdf import FPDF
from db.log_repo import insert_log, get_logs, toggle_important

bp = Blueprint("log", __name__)


def _utc_to_local(ts_str):
    """Convert 'YYYY-MM-DD HH:MM:SS' UTC string to local server time string."""
    if not ts_str:
        return ""
    try:
        dt = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
        return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ts_str


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
    type_filter   = request.args.get("type") or None
    role_filter   = request.args.get("role") or None
    search        = request.args.get("search") or None
    exclude_type  = request.args.get("exclude_type") or None
    rows = get_logs(incident_name, type_filter=type_filter, role_filter=role_filter,
                    search=search, exclude_type=exclude_type, order="asc")
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "timestamp", "role", "type", "flags", "message"])
    for r in rows:
        writer.writerow([r["id"], _utc_to_local(r["timestamp"]), r["role"], r["type"], r.get("flags", ""), r["message"]])
    csv_bytes = buf.getvalue().encode("utf-8")
    filename = f"{incident_name}_log_{datetime.now().strftime('%H%M%S')}.csv"
    return Response(
        csv_bytes,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _pdf_str(s):
    """Transliterate common unicode chars then strip anything outside latin-1."""
    if not s:
        return ""
    replacements = {"—": "-", "–": "-", "\u2019": "'", "\u2018": "'",
                    "\u201c": '"', "\u201d": '"', "\u2026": "..."}
    for src, dst in replacements.items():
        s = s.replace(src, dst)
    return s.encode("latin-1", errors="replace").decode("latin-1")


@bp.route("/incidents/<incident_name>/log/export/pdf")
def export_log_pdf(incident_name):
    type_filter  = request.args.get("type") or None
    role_filter  = request.args.get("role") or None
    search       = request.args.get("search") or None
    exclude_type = request.args.get("exclude_type") or None
    rows = get_logs(incident_name, type_filter=type_filter, role_filter=role_filter,
                    search=search, exclude_type=exclude_type, order="asc")

    BOTTOM_MARGIN = 10
    COL_TIME  = 38
    COL_ROLE  = 18
    COL_TYPE  = 18
    COL_MSG   = 277 - COL_TIME - COL_ROLE - COL_TYPE
    ROW_H     = 5
    HDR_H     = 6

    def _add_page(pdf):
        pdf.add_page()
        pdf.set_font("Helvetica", "B", 12)
        pdf.cell(0, 7, _pdf_str(f"Incident Log - {incident_name}"), ln=True)
        pdf.set_font("Helvetica", "", 8)
        pdf.cell(0, 5, _pdf_str(f"Exported {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"), ln=True)
        pdf.ln(2)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_fill_color(220, 220, 220)
        pdf.cell(COL_TIME, HDR_H, "Timestamp", border=1, fill=True)
        pdf.cell(COL_ROLE, HDR_H, "Role",      border=1, fill=True)
        pdf.cell(COL_TYPE, HDR_H, "Type",      border=1, fill=True)
        pdf.cell(COL_MSG,  HDR_H, "Message",   border=1, fill=True)
        pdf.ln()
        pdf.set_font("Helvetica", "", 8)

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    _add_page(pdf)

    for r in rows:
        important = "important" in (r.get("flags") or "")
        msg = _pdf_str(r["message"] or "")
        lines = pdf.multi_cell(COL_MSG, ROW_H, msg, border=0, split_only=True)
        row_h = max(ROW_H, len(lines) * ROW_H)

        # New page if this row won't fit
        if pdf.get_y() + row_h > pdf.h - BOTTOM_MARGIN:
            _add_page(pdf)

        x, y = pdf.get_x(), pdf.get_y()
        if important:
            pdf.set_fill_color(255, 255, 0)
        else:
            pdf.set_fill_color(255, 255, 255)
        pdf.cell(COL_TIME, row_h, _pdf_str(_utc_to_local(r["timestamp"])), border=1, fill=important)
        pdf.cell(COL_ROLE, row_h, _pdf_str(r["role"] or ""),               border=1, fill=important)
        pdf.cell(COL_TYPE, row_h, _pdf_str(r["type"] or ""),               border=1, fill=important)
        pdf.multi_cell(COL_MSG, ROW_H, msg, border=1, fill=important)
        pdf.set_xy(x, y + row_h)

    pdf_bytes = pdf.output()
    filename = f"{incident_name}_log_{datetime.now().strftime('%H%M%S')}.pdf"
    return Response(
        bytes(pdf_bytes),
        mimetype="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
