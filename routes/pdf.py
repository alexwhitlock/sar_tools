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
PAGE_W, PAGE_H = 297, 210          # A4 landscape
MARGIN         = 10
CONTENT_W      = PAGE_W - 2 * MARGIN   # 277 mm

# Fixed layout heights (mm)
_TITLE_H      = 7.0
_DETAILS_H    = 5.0
_DIVIDER_PAD  = 3.0   # gap after divider line before map
_FOOTER_H     = 5.0   # footer text height
_FOOTER_PAD   = 2.0   # gap between footer text top and page bottom margin
_VTAB_SEC_H   = 6.0   # "Vertex Coordinates" label
_VTAB_ROW_H   = 5.0   # height per coordinate row

# Image rendering
PDF_DPI = 150   # dots per inch for the embedded map raster


# ── Route ─────────────────────────────────────────────────────────────────────

@bp.post("/api/assignment/map-pdf")
def assignment_map_pdf():
    data          = request.get_json(silent=True) or {}
    geometry      = data.get("geometry")
    title         = data.get("title", "Assignment Map")
    details       = data.get("details", "")
    center        = data.get("center")        # [lon, lat] from Leaflet, or None
    zoom          = data.get("zoom")          # int from Leaflet, or None
    show_vertices = bool(data.get("show_vertices", False))

    if not geometry:
        return jsonify(error="geometry required"), 400

    geom_type   = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if not coordinates:
        return jsonify(error="invalid geometry"), 400

    vertices = []
    if show_vertices and geom_type == "Polygon":
        vertices = coordinates[0][:-1]   # drop repeated closing point

    try:
        layout   = _calc_layout(bool(details), len(vertices))
        map_img, x_center, y_center, render_zoom = _render_map(
            geom_type, coordinates, center, zoom,
            img_w=_mm_to_px(CONTENT_W),
            img_h=_mm_to_px(layout["map_h"]),
        )

        if vertices:
            map_img = _draw_vertex_markers(
                map_img, vertices, x_center, y_center, render_zoom
            )

        pdf_bytes = _make_pdf(title, details, map_img, vertices, layout)
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

def _calc_layout(has_details, n_verts):
    """Return a dict of vertical positions (all in mm from page top)."""
    map_top = MARGIN + _TITLE_H
    if has_details:
        map_top += _DETAILS_H
    map_top += _DIVIDER_PAD

    footer_line_y = PAGE_H - MARGIN - _FOOTER_H - _FOOTER_PAD

    if n_verts > 0:
        n_rows  = math.ceil(n_verts / 2)
        table_h = _VTAB_SEC_H + n_rows * _VTAB_ROW_H
        table_top  = footer_line_y - table_h - 2
        map_bottom = table_top - 2
    else:
        table_top  = None
        map_bottom = footer_line_y - 2

    return {
        "map_top":      map_top,
        "map_bottom":   map_bottom,
        "map_h":        map_bottom - map_top,
        "table_top":    table_top,
        "footer_line_y": footer_line_y,
        "n_vtab_rows":  math.ceil(n_verts / 2) if n_verts else 0,
    }


def _mm_to_px(mm):
    return int(round(mm / 25.4 * PDF_DPI))


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
    """Fetch OSM tiles and draw geometry. Returns (PIL Image, x_center, y_center, zoom)."""
    m = StaticMap(
        img_w, img_h,
        url_template="https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        headers={"User-Agent": "sar-tools/1.0 (SAR management application)"},
    )

    if geom_type == "Polygon":
        # No fill — draw the closed ring as a thick line
        ring   = coordinates[0]   # already closed (first == last)
        coords = [(pt[0], pt[1]) for pt in ring]
        m.add_line(Line(coords, "#cc5e31", 5, simplify=True))
    elif geom_type == "LineString":
        coords = [(pt[0], pt[1]) for pt in coordinates]
        m.add_line(Line(coords, "#cc5e31", 5, simplify=True))

    render_zoom   = int(zoom)   if zoom   else None
    render_center = center      if center else None

    img = m.render(zoom=render_zoom, center=render_center)

    # Compute tile-space center without relying on staticmap private attributes
    if render_center and render_zoom is not None:
        lon_c, lat_c = render_center
        x_center  = _lon_to_x(lon_c, render_zoom)
        y_center  = _lat_to_y(lat_c, render_zoom)
        final_zoom = render_zoom
    else:
        src = coordinates[0] if geom_type == "Polygon" else coordinates
        lons = [p[0] for p in src]
        lats = [p[1] for p in src]
        lon_c = (min(lons) + max(lons)) / 2
        lat_c = (min(lats) + max(lats)) / 2
        final_zoom = getattr(m, "_zoom", getattr(m, "zoom", 14))
        x_center   = _lon_to_x(lon_c, final_zoom)
        y_center   = _lat_to_y(lat_c, final_zoom)

    return img, x_center, y_center, final_zoom


def _draw_vertex_markers(img, vertices, x_center, y_center, zoom):
    """Draw a small dot at each vertex and a numbered label offset above-right."""
    draw  = ImageDraw.Draw(img)
    img_w, img_h = img.size

    font_size = max(18, img_w // 75)
    try:
        font = ImageFont.load_default(size=font_size)
    except TypeError:
        font = ImageFont.load_default()

    dot_r    = max(5, img_w // 280)          # small dot radius
    lbl_dx   = dot_r + 6                     # label offset right of dot
    lbl_dy   = -(font_size + dot_r + 2)      # label offset above dot

    for i, (lon, lat) in enumerate(vertices):
        px, py = _latlon_to_px(lat, lon, x_center, y_center, zoom, img_w, img_h)
        label  = str(i + 1)

        # Small filled dot at exact vertex location
        draw.ellipse([px - dot_r, py - dot_r, px + dot_r, py + dot_r],
                     fill="#cc5e31", outline="white", width=2)

        # Number floating above-right with white stroke for readability on any background
        draw.text(
            (px + lbl_dx, py + lbl_dy),
            label,
            fill="#cc5e31",
            font=font,
            stroke_width=2,
            stroke_fill="white",
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

def _make_pdf(title, details, map_img, vertices, layout):
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(MARGIN, MARGIN, MARGIN)
    pdf.add_page()

    # ── Header ──
    pdf.set_font("Helvetica", "B", 14)
    pdf.set_text_color(204, 94, 49)
    pdf.set_xy(MARGIN, MARGIN)
    pdf.cell(CONTENT_W, _TITLE_H, title)

    if details:
        pdf.set_font("Helvetica", "", 9)
        pdf.set_text_color(68, 68, 68)
        pdf.set_xy(MARGIN, MARGIN + _TITLE_H)
        pdf.cell(CONTENT_W, _DETAILS_H, details)

    divider_y = layout["map_top"] - 1
    pdf.set_draw_color(204, 94, 49)
    pdf.set_line_width(0.4)
    pdf.line(MARGIN, divider_y, PAGE_W - MARGIN, divider_y)

    # ── Footer ──
    fy = layout["footer_line_y"]
    pdf.set_draw_color(200, 200, 200)
    pdf.set_line_width(0.2)
    pdf.line(MARGIN, fy, PAGE_W - MARGIN, fy)
    pdf.set_xy(MARGIN, fy + 1)
    pdf.set_font("Helvetica", "", 7)
    pdf.set_text_color(136, 136, 136)
    pdf.cell(CONTENT_W, _FOOTER_H,
             f"Printed from SAR Tools  \u00b7  {datetime.now().strftime('%Y-%m-%d %H:%M')}")

    # ── Vertex coordinate table ──
    if vertices and layout["table_top"] is not None:
        tt       = layout["table_top"]
        col_w    = CONTENT_W / 2
        content_y = tt + _VTAB_SEC_H

        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(80, 80, 80)
        pdf.set_xy(MARGIN, tt)
        pdf.cell(CONTENT_W, _VTAB_SEC_H - 1, "Vertex Coordinates (MGRS)")

        pdf.set_font("Helvetica", "", 8)
        pdf.set_text_color(50, 50, 50)
        for idx, (lon, lat) in enumerate(vertices):
            col  = idx % 2
            row  = idx // 2
            x    = MARGIN + col * col_w
            y    = content_y + row * _VTAB_ROW_H
            pdf.set_xy(x, y)
            pdf.cell(col_w, _VTAB_ROW_H, f"{idx + 1}.  {_to_mgrs(lat, lon)}")

    # ── Map image (drawn last; natural aspect ratio preserved by omitting h) ──
    img_buf = io.BytesIO()
    map_img.save(img_buf, format="PNG")
    img_buf.seek(0)
    pdf.image(img_buf, x=MARGIN, y=layout["map_top"], w=CONTENT_W)

    return bytes(pdf.output())
