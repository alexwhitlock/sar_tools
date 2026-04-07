# routes/pdf.py
import io
from datetime import datetime

from flask import Blueprint, jsonify, request, send_file
from fpdf import FPDF
from staticmap import StaticMap, Line, Polygon as StaticPolygon

bp = Blueprint("pdf", __name__)

# A4 landscape in mm
PAGE_W, PAGE_H = 297, 210
MARGIN = 10
CONTENT_W = PAGE_W - 2 * MARGIN  # 277 mm

# Tile image dimensions — match the map area aspect ratio on the page.
# After header (~22 mm) and footer (~10 mm): map area ≈ 168 mm tall, 277 mm wide → ratio 1.65
IMG_W, IMG_H = 1108, 672  # pixels at ~4px/mm


@bp.post("/api/assignment/map-pdf")
def assignment_map_pdf():
    data = request.get_json(silent=True) or {}
    geometry = data.get("geometry")
    title = data.get("title", "Assignment Map")
    details = data.get("details", "")

    if not geometry:
        return jsonify(error="geometry required"), 400

    geom_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return jsonify(error="invalid geometry"), 400

    try:
        map_img = _render_map(geom_type, coordinates)
        pdf_bytes = _make_pdf(title, details, map_img)
        filename = title.replace(" ", "_") + ".pdf"
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=False,
            download_name=filename,
        )
    except Exception as e:
        return jsonify(error=str(e)), 500


def _render_map(geom_type, coordinates):
    """Fetch OSM tiles and draw the assignment geometry. Returns a PIL Image."""
    m = StaticMap(
        IMG_W, IMG_H,
        url_template="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        headers={"User-Agent": "sar-tools/1.0 (SAR management application)"},
    )

    if geom_type == "Polygon":
        ring = coordinates[0]
        coords = [(pt[0], pt[1]) for pt in ring]
        m.add_polygon(StaticPolygon(coords, fill_color="#cc5e3140", outline_color="#cc5e31", simplify=True))
    elif geom_type == "LineString":
        coords = [(pt[0], pt[1]) for pt in coordinates]
        m.add_line(Line(coords, "#cc5e31", 4, simplify=True))

    return m.render()


def _make_pdf(title, details, map_img):
    """Compose A4 landscape PDF with header, map image, footer. Returns bytes."""
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    # --- Header ---
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(204, 94, 49)
    pdf.set_xy(MARGIN, MARGIN)
    pdf.cell(CONTENT_W, 7, title)
    pdf.ln(7)

    if details:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(68, 68, 68)
        pdf.set_x(MARGIN)
        pdf.cell(CONTENT_W, 5, details)
        pdf.ln(5)

    # Divider line
    divider_y = pdf.get_y() + 1
    pdf.set_draw_color(204, 94, 49)
    pdf.set_line_width(0.4)
    pdf.line(MARGIN, divider_y, PAGE_W - MARGIN, divider_y)
    map_top = divider_y + 2

    # --- Footer ---
    footer_y = PAGE_H - MARGIN - 5
    pdf.set_draw_color(200, 200, 200)
    pdf.set_line_width(0.2)
    pdf.line(MARGIN, footer_y, PAGE_W - MARGIN, footer_y)
    pdf.set_xy(MARGIN, footer_y + 1)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(136, 136, 136)
    pdf.cell(CONTENT_W, 4, f"Printed from SAR Tools  \u00b7  {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # --- Map image ---
    map_h = footer_y - map_top - 1
    img_buf = io.BytesIO()
    map_img.save(img_buf, format="PNG")
    img_buf.seek(0)
    pdf.image(img_buf, x=MARGIN, y=map_top, w=CONTENT_W, h=map_h)

    return bytes(pdf.output())
