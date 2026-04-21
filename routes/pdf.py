# routes/pdf.py
import io
import math
import re
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import mgrs as mgrs_lib
import utm as _utm_lib
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
_INFO_COL_W    = 70.0              # title / type / timestamp on the left
_DESC_COL_X    = MARGIN + _INFO_COL_W + 2.0   # 84.7 mm
_DESC_COL_W    = 80.0              # description text
_COORD_COL_X   = _DESC_COL_X + _DESC_COL_W + 5.0   # 172.7 mm
_COORD_COL_W   = 50.0              # compact — fits "5.  18T VR 51590 34197"
_BEARING_COL_X = _COORD_COL_X + _COORD_COL_W + 4.0   # 226.7 mm
_BEARING_COL_W = 30.0              # compact — fits "10-1: 359.9°T"

# Bottom-strip row metrics — HDR_Y=bt+1.5, HDR_H=3.5, DATA_Y=bt+5 → 5 rows fit
_VTAB_HDR_H = 4.5
_VTAB_ROW_H = 4.5

PDF_DPI = 150

_TILE_URLS = {
    "osm":     "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    "topo":    "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    "imagery": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
}


# ── Route ─────────────────────────────────────────────────────────────────────

@bp.post("/api/assignment/map-pdf")
def assignment_map_pdf():
    data          = request.get_json(silent=True) or {}
    geometry      = data.get("geometry")
    title         = data.get("title", "Assignment Map")
    center        = data.get("center")
    zoom          = data.get("zoom")
    show_vertices = bool(data.get("show_vertices", False))
    show_bearings = bool(data.get("show_bearings", False))
    show_grid     = bool(data.get("show_grid",     False))
    asgn_type     = data.get("asgn_type",    "")
    description   = data.get("description",  "")
    tile_url      = _TILE_URLS.get(data.get("basemap", "osm"), _TILE_URLS["osm"])
    tz_name       = data.get("tz", "")
    try:
        tz = ZoneInfo(tz_name) if tz_name else timezone.utc
    except ZoneInfoNotFoundError:
        tz = timezone.utc

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
            bearings.append(f"{i + 1}-{(i + 1) % n + 1}: {round(b) % 360:03d}\u00b0")

    grid_zone = ""
    if show_grid and ring:
        lons = [p[0] for p in ring];  lats = [p[1] for p in ring]
        grid_zone = _mgrs_zone_label(sum(lats) / len(lats), sum(lons) / len(lons))

    try:
        layout  = _calc_layout()
        map_img, x_center, y_center, render_zoom = _render_map(
            geom_type, coordinates, center, zoom,
            img_w=_mm_to_px(CONTENT_W),
            img_h=_mm_to_px(layout["map_h"]),
            tile_url=tile_url,
        )

        if show_grid:
            map_img = _draw_mgrs_grid(map_img, x_center, y_center, render_zoom)

        if vertices:
            map_img = _draw_vertex_markers(
                map_img, vertices, x_center, y_center, render_zoom
            )

        pdf_bytes = _make_pdf(title, map_img, vertices, bearings, layout, grid_zone,
                              now=datetime.now(tz), asgn_type=asgn_type, description=description)
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


def _render_map(geom_type, coordinates, center, zoom, img_w, img_h,
                tile_url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"):
    m = StaticMap(
        img_w, img_h,
        url_template=tile_url,
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


def _mgrs_zone_label(lat, lon):
    """Return 100 km square identifier, e.g. '18T VR'."""
    raw   = _mgrs.toMGRS(lat, lon, MGRSPrecision=5)
    match = re.match(r'(\d{1,2}[A-Z])([A-Z]{2})', raw)
    return f"{match.group(1)} {match.group(2)}" if match else ""


# ── MGRS grid drawing ─────────────────────────────────────────────────────────

def _draw_mgrs_grid(img, x_center, y_center, zoom):
    """Draw MGRS 100 m grid lines (blue) with 5-digit labels every 1000 m."""
    draw  = ImageDraw.Draw(img)
    img_w, img_h = img.size
    BLUE = (0, 100, 200)

    def _px_to_latlon(px, py):
        tile_x = (px - img_w / 2) / 256 + x_center
        tile_y = (py - img_h / 2) / 256 + y_center
        lon    = tile_x / (2 ** zoom) * 360 - 180
        n      = math.pi - 2 * math.pi * tile_y / (2 ** zoom)
        return math.degrees(math.atan(math.sinh(n))), lon

    # Determine UTM zone from image centre
    lat_c, lon_c = _px_to_latlon(img_w / 2, img_h / 2)
    _, _, zn, zl = _utm_lib.from_latlon(lat_c, lon_c)

    # UTM extents from all four corners
    es, ns = [], []
    for cx, cy in [(0, 0), (img_w, 0), (0, img_h), (img_w, img_h)]:
        lat, lon = _px_to_latlon(cx, cy)
        e, n, _, _ = _utm_lib.from_latlon(lat, lon, force_zone_number=zn)
        es.append(e);  ns.append(n)

    min_e = math.floor(min(es) / 100) * 100
    max_e = math.ceil (max(es) / 100) * 100
    min_n = math.floor(min(ns) / 100) * 100
    max_n = math.ceil (max(ns) / 100) * 100

    lbl_sz = max(14, img_w // 90)
    try:
        font = ImageFont.load_default(size=lbl_sz)
    except TypeError:
        font = ImageFont.load_default()

    # ── Vertical lines (constant easting) ──────────────────────────────────
    for e_int in range(int(min_e), int(max_e) + 1, 100):
        e_val = float(e_int)
        pts = []
        for n_sample in (min_n, (min_n + max_n) / 2, max_n):
            try:
                lat, lon = _utm_lib.to_latlon(e_val, n_sample, zn, zl, strict=False)
                pts.append(_latlon_to_px(lat, lon, x_center, y_center, zoom, img_w, img_h))
            except Exception:
                pass
        if len(pts) >= 2:
            draw.line(pts, fill=BLUE, width=1)
        # Label every line at bottom edge — drop trailing "00" (all multiples of 100)
        if pts:
            draw.text((pts[0][0] + 2, img_h - lbl_sz - 3),
                      f"{(e_int % 100_000) // 100:03d}",
                      fill=BLUE, font=font, stroke_width=2, stroke_fill="white")

    # ── Horizontal lines (constant northing) ───────────────────────────────
    for n_int in range(int(min_n), int(max_n) + 1, 100):
        n_val = float(n_int)
        pts = []
        for e_sample in (min_e, (min_e + max_e) / 2, max_e):
            try:
                lat, lon = _utm_lib.to_latlon(e_sample, n_val, zn, zl, strict=False)
                pts.append(_latlon_to_px(lat, lon, x_center, y_center, zoom, img_w, img_h))
            except Exception:
                pass
        if len(pts) >= 2:
            draw.line(pts, fill=BLUE, width=1)
        # Label every line at left edge — drop trailing "00"
        if pts:
            draw.text((3, pts[0][1] - lbl_sz - 2),
                      f"{(n_int % 100_000) // 100:03d}",
                      fill=BLUE, font=font, stroke_width=2, stroke_fill="white")

    return img


# ── Text helpers ──────────────────────────────────────────────────────────────

def _truncate(pdf, text, max_w):
    """Flatten to one line and truncate with ellipsis to fit max_w mm."""
    text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    if pdf.get_string_width(text) <= max_w:
        return text
    ellipsis = "\u2026"
    while text and pdf.get_string_width(text + ellipsis) > max_w:
        text = text[:-1]
    return text + ellipsis


# ── PDF composition ────────────────────────────────────────────────────────────

def _make_pdf(title, map_img, vertices, bearings, layout, grid_zone="", now=None, asgn_type="", description=""):
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=False)
    pdf.set_margins(0, 0, 0)
    pdf.add_page()

    # ── Map image ──
    img_buf = io.BytesIO()
    map_img.save(img_buf, format="PNG")
    img_buf.seek(0)
    pdf.image(img_buf, x=MARGIN, y=MARGIN, w=CONTENT_W)

    # ── Bottom data strip ──
    bt     = layout["bottom_top"]
    HDR_Y  = bt + 1.5
    DATA_Y = HDR_Y + _VTAB_HDR_H   # bt + 5.0 — leaves room for 5 rows at 4mm

    # ── Left info column: vertical stack ──
    y = bt + 2.0
    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(20, 20, 20)
    pdf.set_xy(MARGIN + 2, y)
    pdf.cell(_INFO_COL_W - 2, 5, title)
    y += 5.5

    if asgn_type:
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(60, 60, 60)
        pdf.set_xy(MARGIN + 2, y)
        pdf.cell(_INFO_COL_W - 2, 4.5, asgn_type)
        y += 4.5

    if grid_zone:
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(60, 60, 60)
        pdf.set_xy(MARGIN + 2, y)
        pdf.cell(_INFO_COL_W - 2, 4.5, f"Grid zone: {grid_zone}")
        y += 4.5

    y = max(y + 1, bt + BOTTOM_H - 10.0)  # push timestamp block toward bottom
    if now is None:
        now = datetime.now(timezone.utc)
    pdf.set_font("Helvetica", "", 10)
    pdf.set_text_color(60, 60, 60)
    pdf.set_xy(MARGIN + 2, y)
    pdf.cell(_INFO_COL_W - 2, 4.5, "Printed from SAR Tools")
    y += 4.5
    pdf.set_xy(MARGIN + 2, y)
    pdf.cell(_INFO_COL_W - 2, 4.5, now.strftime("%Y-%m-%d %H:%M"))

    # ── North arrow (right side of bottom strip) ──
    ax   = PAGE_W - MARGIN - 12    # centre x
    atop = bt + 1.0                # top of "N" label
    tip  = atop + 3.5              # arrowhead tip
    base = tip  + 3.5              # arrowhead base / shaft top (smaller triangle)
    bot  = bt + BOTTOM_H - 2.5    # shaft bottom
    hw   = 2.0                     # half-width of arrowhead

    pdf.set_font("Helvetica", "B", 10)
    pdf.set_text_color(30, 30, 30)
    pdf.set_xy(ax - 2.5, atop)
    pdf.cell(5, 4.5, "N", align="C")

    pdf.set_fill_color(0, 0, 0)
    pdf.polygon([(ax, tip), (ax - hw, base), (ax + hw, base)], style="F")

    pdf.set_draw_color(30, 30, 30)
    pdf.set_line_width(0.5)
    pdf.line(ax, base, ax, bot)    # shaft

    # ── Description column ──
    if description:
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(100, 100, 100)
        pdf.set_xy(_DESC_COL_X, HDR_Y)
        pdf.cell(_DESC_COL_W, _VTAB_HDR_H, "Description")

        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(20, 20, 20)
        pdf.set_xy(_DESC_COL_X, DATA_Y)
        pdf.cell(_DESC_COL_W, _VTAB_ROW_H, _truncate(pdf, description, _DESC_COL_W))

    # ── Table columns (compact, no decorative lines) ──
    if vertices:
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(100, 100, 100)
        pdf.set_xy(_COORD_COL_X, HDR_Y)
        pdf.cell(_COORD_COL_W, _VTAB_HDR_H, "Vertex (MGRS)")

        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(20, 20, 20)
        for idx, (lon, lat) in enumerate(vertices):
            pdf.set_xy(_COORD_COL_X, DATA_Y + idx * _VTAB_ROW_H)
            pdf.cell(_COORD_COL_W, _VTAB_ROW_H, f"{idx + 1}.  {_to_mgrs(lat, lon)}")

    if bearings:
        pdf.set_font("Helvetica", "B", 10)
        pdf.set_text_color(100, 100, 100)
        pdf.set_xy(_BEARING_COL_X, HDR_Y)
        pdf.cell(_BEARING_COL_W, _VTAB_HDR_H, "Bearings")

        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(20, 20, 20)
        for idx, b_str in enumerate(bearings):
            pdf.set_xy(_BEARING_COL_X, DATA_Y + idx * _VTAB_ROW_H)
            pdf.cell(_BEARING_COL_W, _VTAB_ROW_H, b_str)

    return bytes(pdf.output())
