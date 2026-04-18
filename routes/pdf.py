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

# ── Page geometry (mm) ────────────────────────────────────────────────────────
PAGE_W, PAGE_H = 297, 210
MARGIN         = 10
CONTENT_W      = PAGE_W - 2 * MARGIN   # 277 mm

# Fixed layout heights (mm)
_TITLE_H      = 7.0
_DETAILS_H    = 5.0
_DIVIDER_PAD  = 3.0
_FOOTER_H     = 5.0
_FOOTER_PAD   = 2.0
_VTAB_SEC_H   = 6.0   # section label row
_VTAB_ROW_H   = 5.0   # height per data row

# Vertex table column widths (mm)
_COORD_COL_W    = 80.0   # single MGRS column
_BEARING_GAP    = 5.0    # gap between coord col and bearing col
_BEARING_COL_X  = MARGIN + _COORD_COL_W + _BEARING_GAP   # 95 mm from left
_BEARING_COL_W  = CONTENT_W - _COORD_COL_W - _BEARING_GAP  # 192 mm

PDF_DPI = 150


# ── Route ─────────────────────────────────────────────────────────────────────

@bp.post("/api/assignment/map-pdf")
def assignment_map_pdf():
    data           = request.get_json(silent=True) or {}
    geometry       = data.get("geometry")
    title          = data.get("title", "Assignment Map")
    details        = data.get("details", "")
    center         = data.get("center")
    zoom           = data.get("zoom")
    show_vertices  = bool(data.get("show_vertices", False))
    show_bearings  = bool(data.get("show_bearings", False))

    if not geometry:
        return jsonify(error="geometry required"), 400

    geom_type   = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return jsonify(error="invalid geometry"), 400

    # Ring size drives the reserved table space regardless of checkbox state
    ring = coordinates[0][:-1] if geom_type == "Polygon" else []

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
        # Always reserve table rows for the full ring so map height is constant
        layout  = _calc_layout(bool(details), len(ring))
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

def _calc_layout(has_details, n_ring):
    """Layout for a polygon with n_ring vertices.

    Table space is always reserved so the map height is constant for a given
    assignment regardless of which checkboxes are enabled.
    """
    map_top = MARGIN + _TITLE_H
    if has_details:
        map_top += _DETAILS_H
    map_top += _DIVIDER_PAD

    footer_line_y = PAGE_H - MARGIN - _FOOTER_H - _FOOTER_PAD

    if n_ring > 0:
        table_h   = _VTAB_SEC_H + n_ring * _VTAB_ROW_H
        table_top = footer_line_y - table_h - 2
        map_bottom = table_top - 2
    else:
        table_top  = None
        map_bottom = footer_line_y - 2

    return {
        "map_top":       map_top,
        "map_h":         map_bottom - map_top,
        "table_top":     table_top,
        "footer_line_y": footer_line_y,
    }


def _mm_to_px(mm):
    return int(round(mm / 25.4 * PDF_DPI))


# ── Bearing calculation ────────────────────────────────────────────────────────

def _bearing(lat1, lon1, lat2, lon2):
    """True bearing in degrees clockwise from north."""
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
        ring   = coordinates[0]
        coords = [(pt[0], pt[1]) for pt in ring]
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
        label  = str(i + 1)

        draw.ellipse([px - dot_r, py - dot_r, px + dot_r, py + dot_r],
                     fill="#cc0000", outline="white", width=2)
        draw.text(
            (px + lbl_dx, py + lbl_dy), label,
            fill="#cc0000", font=font, stroke_width=2, stroke_fill="white",
        )

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
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    # ── Header ──
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(0, 0, 0)
    pdf.set_xy(MARGIN, MARGIN)
    pdf.cell(CONTENT_W, _TITLE_H, title)

    if details:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(68, 68, 68)
        pdf.set_xy(MARGIN, MARGIN + _TITLE_H)
        pdf.cell(CONTENT_W, _DETAILS_H, details)

    divider_y = layout["map_top"] - 1
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.5)
    pdf.line(MARGIN, divider_y, PAGE_W - MARGIN, divider_y)

    # ── Footer ──
    fy = layout["footer_line_y"]
    pdf.set_draw_color(0, 0, 0)
    pdf.set_line_width(0.3)
    pdf.line(MARGIN, fy, PAGE_W - MARGIN, fy)
    pdf.set_xy(MARGIN, fy + 1)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(0, 0, 0)
    pdf.cell(CONTENT_W, _FOOTER_H,
             f"Printed from SAR Tools  \u00b7  {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # ── Vertex / bearing table ──
    tt = layout["table_top"]
    if tt is not None:
        content_y = tt + _VTAB_SEC_H

        # Section headers
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(0, 0, 0)

        if vertices:
            pdf.set_xy(MARGIN, tt)
            pdf.cell(_COORD_COL_W, _VTAB_SEC_H - 1, "Vertex Coordinates (MGRS)")

        if bearings:
            pdf.set_xy(_BEARING_COL_X, tt)
            pdf.cell(_BEARING_COL_W, _VTAB_SEC_H - 1, "Side Bearings")

        # Coordinate rows
        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(50, 50, 50)
        for idx, (lon, lat) in enumerate(vertices):
            pdf.set_xy(MARGIN, content_y + idx * _VTAB_ROW_H)
            pdf.cell(_COORD_COL_W, _VTAB_ROW_H, f"{idx + 1}.  {_to_mgrs(lat, lon)}")

        # Bearing rows
        for idx, b_str in enumerate(bearings):
            pdf.set_xy(_BEARING_COL_X, content_y + idx * _VTAB_ROW_H)
            pdf.cell(_BEARING_COL_W, _VTAB_ROW_H, b_str)

    # ── Map image ──
    img_buf = io.BytesIO()
    map_img.save(img_buf, format="PNG")
    img_buf.seek(0)
    pdf.image(img_buf, x=MARGIN, y=layout["map_top"], w=CONTENT_W)

    return bytes(pdf.output())
