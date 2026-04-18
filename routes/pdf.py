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

# ── Page geometry ─────────────────────────────────────────────────────────────
PAGE_W, PAGE_H = 297, 210          # A4 landscape (mm)
MARGIN         = 12.7              # 0.5 inch all sides
CONTENT_W      = PAGE_W - 2 * MARGIN   # 271.6 mm
CONTENT_H      = PAGE_H - 2 * MARGIN   # 184.6 mm
BOTTOM_H       = 25.4              # 1 inch data strip (inside border)

# Bottom-strip column layout (x positions are page-absolute)
_INFO_COL_W    = 70.0              # title / details / timestamp on the left
_COORD_COL_X   = MARGIN + _INFO_COL_W + 5.0   # 87.7 mm
_COORD_COL_W   = 80.0
_BEARING_COL_X = _COORD_COL_X + _COORD_COL_W + 5.0   # 172.7 mm
_BEARING_COL_W = 80.0

# Bottom-strip row metrics
_VTAB_SEC_H = 4.5
_VTAB_ROW_H = 4.0

PDF_DPI = 150


# ── Route ─────────────────────────────────────────────────────────────────────

@bp.post("/api/assignment/map-pdf")
def assignment_map_pdf():
    data          = request.get_json(silent=True) or {}
    geometry      = data.get("geometry")
    title         = data.get("title", "Assignment Map")
    details       = data.get("details", "")
    center        = data.get("center")
    zoom          = data.get("zoom")
    show_vertices = bool(data.get("show_vertices", False))
    show_bearings = bool(data.get("show_bearings", False))

    if not geometry:
        return jsonify(error="geometry required"), 400

    geom_type   = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return jsonify(error="invalid geometry"), 400

    ring     = coordinates[0][:-1] if geom_type == "Polygon" else []
    vertices = ring if show_vertices else []

    bearings = []
    if show_bearings and ring:
        n = len(ring)
        for i in range(n):
            lon1, lat1 = ring[i]
            lon2, lat2 = ring[(i + 1) % n]
            b = _bearing(lat1, lon1, lat2, lon2)
            bearings.append(f"{i + 1}-{(i + 1) % n + 1}: {b:05.1f}\u00b0T")

    try:
        layout  = _calc_layout()
        map_img, x_center, y_center, render_zoom = _render_map(
            geom_type, coordinates, center, zoom,
            img_w=_mm_to_px(CONTENT_W),
            img_h=_mm_to_px(layout["map_h"]),
        )

        if vertices:
            map_img = _draw_vertex_markers(
                map_img, vertices, x_center, y_center, render_zoom
            )

        pdf_bytes = _make_pdf(title, details, map_img, vertices, bearings, layout)
        filename  = title.replace(" ", "_") + ".pdf"
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=False,
            download_name=filename,
        )
    except Exception as e:
        return jsonify(error=str(e)), 500


# ── Layout calculation ─────────────────────────────────────────────────────────

def _calc_layout():
    """Fixed layout: map fills content area above the 1-inch data strip."""
    map_top    = MARGIN
    bottom_top = PAGE_H - MARGIN - BOTTOM_H   # 171.9 mm
    return {
        "map_top":    map_top,
        "map_h":      bottom_top - map_top,    # 159.2 mm
        "bottom_top": bottom_top,
    }


def _mm_to_px(mm):
    return int(round(mm / 25.4 * PDF_DPI))


# ── Bearing calculation ────────────────────────────────────────────────────────

def _bearing(lat1, lon1, lat2, lon2):
    lat1r = math.radians(lat1)
    lat2r = math.radians(lat2)
    dlon  = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(lat2r)
    y = math.cos(lat1r) * math.sin(lat2r) - math.sin(lat1r) * math.cos(lat2r) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


# ── Map rendering ──────────────────────────────────────────────────────────────

def _lon_to_x(lon, zoom):
    return ((lon + 180) / 360) * (2 ** zoom)


def _lat_to_y(lat, zoom):
    lat_r = math.radians(lat)
    return (1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * (2 ** zoom)


def _latlon_to_px(lat, lon, x_center, y_center, zoom, img_w, img_h):
    x = (_lon_to_x(lon, zoom) - x_center) * 256 + img_w / 2
    y = (_lat_to_y(lat, zoom) - y_center) * 256 + img_h / 2
    return int(round(x)), int(round(y))


def _render_map(geom_type, coordinates, center, zoom, img_w, img_h):
    m = StaticMap(
        img_w, img_h,
        url_template="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        headers={"User-Agent": "sar-tools/1.0 (SAR management application)"},
    )

    if geom_type == "Polygon":
        coords = [(pt[0], pt[1]) for pt in coordinates[0]]
        m.add_line(Line(coords, "#cc0000", 5, simplify=True))
    elif geom_type == "LineString":
        coords = [(pt[0], pt[1]) for pt in coordinates]
        m.add_line(Line(coords, "#cc0000", 5, simplify=True))

    render_zoom   = int(zoom) if zoom   else None
    render_center = center    if center else None
    img = m.render(zoom=render_zoom, center=render_center)

    if render_center and render_zoom is not None:
        lon_c, lat_c = render_center
        x_center   = _lon_to_x(lon_c, render_zoom)
        y_center   = _lat_to_y(lat_c, render_zoom)
        final_zoom = render_zoom
    else:
        src  = coordinates[0] if geom_type == "Polygon" else coordinates
        lons = [p[0] for p in src];  lats = [p[1] for p in src]
        lon_c = (min(lons) + max(lons)) / 2
        lat_c = (min(lats) + max(lats)) / 2
        final_zoom = getattr(m, "_zoom", getattr(m, "zoom", 14))
        x_center   = _lon_to_x(lon_c, final_zoom)
        y_center   = _lat_to_y(lat_c, final_zoom)

    return img, x_center, y_center, final_zoom


def _draw_vertex_markers(img, vertices, x_center, y_center, zoom):
    draw  = ImageDraw.Draw(img)
    img_w, img_h = img.size

    font_size = max(18, img_w // 75)
    try:
        font = ImageFont.load_default(size=font_size)
    except TypeError:
        font = ImageFont.load_default()

    dot_r  = max(5, img_w // 280)
    lbl_dx = dot_r + 6
    lbl_dy = -(font_size + dot_r + 2)

    for i, (lon, lat) in enumerate(vertices):
        px, py = _latlon_to_px(lat, lon, x_center, y_center, zoom, img_w, img_h)
        draw.ellipse([px - dot_r, py - dot_r, px + dot_r, py + dot_r],
                     fill="#cc0000", outline="white", width=2)
        draw.text((px + lbl_dx, py + lbl_dy), str(i + 1),
                  fill="#cc0000", font=font, stroke_width=2, stroke_fill="white")

    return img


# ── MGRS formatting ────────────────────────────────────────────────────────────

_mgrs = mgrs_lib.MGRS()

def _to_mgrs(lat, lon):
    raw   = _mgrs.toMGRS(lat, lon, MGRSPrecision=5)
    match = re.match(r'(\d{1,2}[A-Z])([A-Z]{2})(\d{5})(\d{5})', raw)
    if match:
        zone, square, east, north = match.groups()
        return f"{zone} {square} {east} {north}"
    return raw


# ── PDF composition ────────────────────────────────────────────────────────────

def _make_pdf(title, details, map_img, vertices, bearings, layout):
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(0, 0, 0)
    pdf.add_page()

    # ── Map image ──
    img_buf = io.BytesIO()
    map_img.save(img_buf, format="PNG")
    img_buf.seek(0)
    pdf.image(img_buf, x=MARGIN, y=MARGIN, w=CONTENT_W)

    # ── Bottom data strip (light background) ──
    bt = layout["bottom_top"]
    pdf.set_fill_color(248, 248, 248)
    pdf.rect(MARGIN, bt, CONTENT_W, BOTTOM_H, style="F")

    # Divider line between map and data strip
    pdf.set_draw_color(140, 140, 140)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, bt, MARGIN + CONTENT_W, bt)

    # ── Left info column: title, details, timestamp ──
    pdf.set_text_color(20, 20, 20)
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_xy(MARGIN + 2, bt + 2)
    pdf.cell(_INFO_COL_W - 2, 6, title)

    if details:
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(80, 80, 80)
        pdf.set_xy(MARGIN + 2, bt + 8.5)
        pdf.cell(_INFO_COL_W - 2, 4, details)

    pdf.set_font("Helvetica", "", 6)
    pdf.set_text_color(130, 130, 130)
    pdf.set_xy(MARGIN + 2, bt + BOTTOM_H - 5)
    pdf.cell(_INFO_COL_W - 2, 4,
             f"SAR Tools  \u00b7  {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # ── Vertex coordinates column ──
    if vertices:
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_text_color(80, 80, 80)
        pdf.set_xy(_COORD_COL_X, bt + 1)
        pdf.cell(_COORD_COL_W, _VTAB_SEC_H - 1, "Vertex Coordinates (MGRS)")

        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(20, 20, 20)
        for idx, (lon, lat) in enumerate(vertices):
            pdf.set_xy(_COORD_COL_X, bt + _VTAB_SEC_H + idx * _VTAB_ROW_H)
            pdf.cell(_COORD_COL_W, _VTAB_ROW_H, f"{idx + 1}.  {_to_mgrs(lat, lon)}")

    # ── Side bearings column ──
    if bearings:
        pdf.set_font("Helvetica", "B", 7)
        pdf.set_text_color(80, 80, 80)
        pdf.set_xy(_BEARING_COL_X, bt + 1)
        pdf.cell(_BEARING_COL_W, _VTAB_SEC_H - 1, "Side Bearings")

        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(20, 20, 20)
        for idx, b_str in enumerate(bearings):
            pdf.set_xy(_BEARING_COL_X, bt + _VTAB_SEC_H + idx * _VTAB_ROW_H)
            pdf.cell(_BEARING_COL_W, _VTAB_ROW_H, b_str)

    return bytes(pdf.output())
