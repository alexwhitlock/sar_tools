import csv
import io
from datetime import datetime
from flask import Blueprint, jsonify, request, Response
from fpdf import FPDF
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
        writer.writerow([r["id"], r["timestamp"], r["role"], r["type"], r.get("flags", ""), r["message"]])
    csv_bytes = buf.getvalue().encode("utf-8")
    filename = f"{incident_name}_log.csv"
    return Response(
        csv_bytes,
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@bp.route("/incidents/<incident_name>/log/export/pdf")
def export_log_pdf(incident_name):
    type_filter  = request.args.get("type") or None
    role_filter  = request.args.get("role") or None
    search       = request.args.get("search") or None
    exclude_type = request.args.get("exclude_type") or None
    rows = get_logs(incident_name, type_filter=type_filter, role_filter=role_filter,
                    search=search, exclude_type=exclude_type, order="asc")

    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=10)
    pdf.add_page()

    # Title
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 7, f"Incident Log — {incident_name}", ln=True)
    pdf.set_font("Helvetica", "", 8)
    pdf.cell(0, 5, f"Exported {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC", ln=True)
    pdf.ln(2)

    # Column widths (landscape A4 = 277mm usable)
    COL_TIME  = 38
    COL_ROLE  = 18
    COL_TYPE  = 18
    COL_MSG   = 277 - COL_TIME - COL_ROLE - COL_TYPE

    # Header
    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(220, 220, 220)
    pdf.cell(COL_TIME, 6, "Timestamp",  border=1, fill=True)
    pdf.cell(COL_ROLE, 6, "Role",       border=1, fill=True)
    pdf.cell(COL_TYPE, 6, "Type",       border=1, fill=True)
    pdf.cell(COL_MSG,  6, "Message",    border=1, fill=True)
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    for r in rows:
        important = "important" in (r.get("flags") or "")
        if important:
            pdf.set_fill_color(255, 255, 0)
        else:
            pdf.set_fill_color(255, 255, 255)

        # Use multi_cell for the message column; track y before row
        x_start = pdf.get_x()
        y_start = pdf.get_y()

        # Measure message height
        msg = r["message"] or ""
        lines = pdf.multi_cell(COL_MSG, 5, msg, border=0, split_only=True)
        row_h = max(5, len(lines) * 5)

        pdf.set_xy(x_start, y_start)
        pdf.cell(COL_TIME, row_h, r["timestamp"] or "", border=1, fill=important)
        pdf.cell(COL_ROLE, row_h, r["role"] or "",      border=1, fill=important)
        pdf.cell(COL_TYPE, row_h, r["type"] or "",      border=1, fill=important)

        # Multi-cell for message (resets x)
        x_msg = pdf.get_x()
        y_msg = pdf.get_y()
        pdf.multi_cell(COL_MSG, 5, msg, border=1, fill=important)
        pdf.set_xy(x_start, y_start + row_h)

    pdf_bytes = pdf.output()
    filename = f"{incident_name}_log.pdf"
    return Response(
        bytes(pdf_bytes),
        mimetype="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
