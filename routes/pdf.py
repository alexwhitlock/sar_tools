# routes/pdf.py
import io
import math
import re
from datetime import datetime

import mgrs as mgrs_lib
from flask import Blueprint, jsonify, request, send_file
from fpdf import FPDF
from PIL import ImageDraw, ImageFont
from staticmap import StaticMap, Line, Polygon as StaticPolygon

bp = Blueprint("pdf", __name__)

# A4 landscape in mm
PAGE_W, PAGE_H = 297, 210
MARGIN = 10
CONTENT_W = PAGE_W - 2 * MARGIN   # 277 mm

# Staticmap tile image dimensions.
# Aspect ratio matches map area on page: 277mm wide × ~168mm tall → ~1.65:1
IMG_W, IMG_H = 1108, 672  # pixels


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@bp.post("/api/assignment/map-pdf")
def assignment_map_pdf():
    data = request.get_json(silent=True) or {}
    geometry     = data.get("geometry")
    title        = data.get("title", "Assignment Map")
    details      = data.get("details", "")
    center       = data.get("center")        # [lon, lat] from Leaflet, or None
    zoom         = data.get("zoom")          # int from Leaflet, or None
    show_vertices = bool(data.get("show_vertices", False))

    if not geometry:
        return jsonify(error="geometry required"), 400

    geom_type   = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return jsonify(error="invalid geometry"), 400

    try:
        map_img, x_center, y_center, render_zoom = _render_map(
            geom_type, coordinates, center, zoom
        )

        vertices = []
        if show_vertices and geom_type == "Polygon":
            ring = coordinates[0]
            vertices = ring[:-1]   # drop the repeated closing point
            map_img = _draw_vertex_markers(
                map_img, vertices, x_center, y_center, render_zoom
            )

        pdf_bytes = _make_pdf(title, details, map_img, vertices)
        filename  = title.replace(" ", "_") + ".pdf"
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=False,
            download_name=filename,
        )
    except Exception as e:
        return jsonify(error=str(e)), 500


# ---------------------------------------------------------------------------
# Map rendering
# ---------------------------------------------------------------------------

def _lon_to_x(lon, zoom):
    return ((lon + 180) / 360) * (2 ** zoom)


def _lat_to_y(lat, zoom):
    lat_r = math.radians(lat)
    return (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * (2 ** zoom)


def _latlon_to_px(lat, lon, x_center, y_center, zoom):
    """Convert a lat/lon to pixel coordinates on the rendered staticmap image."""
    x = (_lon_to_x(lon, zoom) - x_center) * 256 + IMG_W / 2
    y = (_lat_to_y(lat, zoom) - y_center) * 256 + IMG_H / 2
    return int(round(x)), int(round(y))


def _render_map(geom_type, coordinates, center=None, zoom=None):
    """Fetch OSM tiles and draw the assignment geometry. Returns (PIL Image, x_center, y_center, zoom)."""
    m = StaticMap(
        IMG_W, IMG_H,
        url_template="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        headers={"User-Agent": "sar-tools/1.0 (SAR management application)"},
    )

    if geom_type == "Polygon":
        ring   = coordinates[0]
        coords = [(pt[0], pt[1]) for pt in ring]
        m.add_polygon(StaticPolygon(
            coords,
            fill_color="#cc5e3140",
            outline_color="#cc5e31",
            simplify=True,
        ))
    elif geom_type == "LineString":
        coords = [(pt[0], pt[1]) for pt in coordinates]
        m.add_line(Line(coords, "#cc5e31", 4, simplify=True))

    render_zoom   = int(zoom)   if zoom   else None
    render_center = center      if center else None   # [lon, lat]

    img = m.render(zoom=render_zoom, center=render_center)

    # Compute tile-space center ourselves (staticmap internals are not public API).
    # When center was provided by the client we already know it exactly.
    # When auto-fit was used we fall back to computing from the geometry bounds.
    if render_center and render_zoom is not None:
        lon_c, lat_c = render_center
        x_center = _lon_to_x(lon_c, render_zoom)
        y_center = _lat_to_y(lat_c, render_zoom)
        final_zoom = render_zoom
    else:
        # Auto-fit: approximate center from feature bounds for vertex placement.
        all_lons = [pt[0] for pt in (coordinates[0] if geom_type == "Polygon" else coordinates)]
        all_lats = [pt[1] for pt in (coordinates[0] if geom_type == "Polygon" else coordinates)]
        lon_c = (min(all_lons) + max(all_lons)) / 2
        lat_c = (min(all_lats) + max(all_lats)) / 2
        # Determine zoom from what staticmap chose (try common attribute names)
        final_zoom = getattr(m, "_zoom", getattr(m, "zoom", 14))
        x_center = _lon_to_x(lon_c, final_zoom)
        y_center = _lat_to_y(lat_c, final_zoom)

    return img, x_center, y_center, final_zoom


def _draw_vertex_markers(img, vertices, x_center, y_center, zoom):
    """Draw numbered circles at each vertex on the PIL image."""
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.load_default(size=16)
    except TypeError:
        font = ImageFont.load_default()

    r = 13  # circle radius in pixels

    for i, (lon, lat) in enumerate(vertices):
        px, py = _latlon_to_px(lat, lon, x_center, y_center, zoom)
        label  = str(i + 1)

        # White halo then filled circle
        draw.ellipse([px - r - 1, py - r - 1, px + r + 1, py + r + 1],
                     fill="white")
        draw.ellipse([px - r, py - r, px + r, py + r],
                     fill="#cc5e31", outline="white", width=2)

        # Centre the label in the circle
        bbox = draw.textbbox((0, 0), label, font=font)
        tw   = bbox[2] - bbox[0]
        th   = bbox[3] - bbox[1]
        draw.text((px - tw / 2, py - th / 2), label, fill="white", font=font)

    return img


# ---------------------------------------------------------------------------
# MGRS coordinate formatting
# ---------------------------------------------------------------------------

_mgrs = mgrs_lib.MGRS()

def _to_mgrs(lat, lon):
    """Return a formatted 10-digit MGRS string, e.g. '10U EF 12345 67890'."""
    raw   = _mgrs.toMGRS(lat, lon, MGRSPrecision=5)
    match = re.match(r'(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})', raw)
    if match:
        zone, square, east, north = match.groups()
        return f"{zone} {square} {east} {north}"
    return raw   # fallback: unformatted


# ---------------------------------------------------------------------------
# PDF composition
# ---------------------------------------------------------------------------

def _make_pdf(title, details, map_img, vertices):
    """Compose A4 landscape PDF. Returns bytes."""
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
    pdf.cell(CONTENT_W, 4,
             f"Printed from SAR Tools  \u00b7  {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # --- Vertex coordinate table (optional) ---
    table_top = None
    if vertices:
        n_verts    = len(vertices)
        n_cols     = 2
        n_rows     = math.ceil(n_verts / n_cols)
        row_h      = 5.0
        table_h    = 7 + n_rows * row_h   # 7mm for section header

        table_top = footer_y - table_h - 2
        col_w     = CONTENT_W / n_cols

        # Section header
        pdf.set_xy(MARGIN, table_top)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(68, 68, 68)
        pdf.cell(CONTENT_W, 5, "Vertex Coordinates (MGRS)")
        pdf.ln(5)

        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(50, 50, 50)

        for idx, (lon, lat) in enumerate(vertices):
            col   = idx % n_cols
            row   = idx // n_cols
            x     = MARGIN + col * col_w
            y     = pdf.get_y() if col == 0 else table_top + 7 + row * row_h
            coord = _to_mgrs(lat, lon)
            pdf.set_xy(x, y)
            pdf.cell(col_w, row_h, f"{idx + 1}.  {coord}")

    # --- Map image ---
    map_bottom = (table_top - 2) if table_top else footer_y
    map_h      = map_bottom - map_top

    img_buf = io.BytesIO()
    map_img.save(img_buf, format="PNG")
    img_buf.seek(0)
    pdf.image(img_buf, x=MARGIN, y=map_top, w=CONTENT_W, h=map_h)

    return bytes(pdf.output())
