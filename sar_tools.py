import json
import os
import threading
import webbrowser
import logging
logging.basicConfig(level=logging.INFO)
from flask import Flask, jsonify, render_template, send_from_directory

# ================= Flask App =================
app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)

@app.after_request
def no_cache(response):
    response.headers["Cache-Control"] = "no-store"
    return response

# ============== Register the blueprints (routes in other files)
from routes.caltopo import bp as caltopo_bp
app.register_blueprint(caltopo_bp)

from routes.incidents import bp as incidents_bp
app.register_blueprint(incidents_bp)

from routes.personnel import bp as personnel_bp
app.register_blueprint(personnel_bp)

from routes.d4h import bp as d4h_bp
app.register_blueprint(d4h_bp)

from routes.teams import bp as teams_bp
app.register_blueprint(teams_bp)

from routes.log import bp as log_bp
app.register_blueprint(log_bp)

from routes.sync import bp as sync_bp
app.register_blueprint(sync_bp)

from routes.pdf import bp as pdf_bp
app.register_blueprint(pdf_bp)

from routes.system import bp as system_bp
app.register_blueprint(system_bp)

from routes.kiosk import bp as kiosk_bp
app.register_blueprint(kiosk_bp)

from routes.snapshot import snapshot_incident_async, snapshot_all_async

# ================= Load Config File =================
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")

try:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
        CRED_ID = config.get("cred_id", "").strip()
        CRED_SECRET_B64 = config.get("cred_secret_b64", "").strip()
        CALTOPO_TEAM_ID = config.get("CALTOPO_TEAM_ID", "").strip()
        D4H_API_TOKEN = config.get("D4H_API_TOKEN", "").strip()
        D4H_TEAM_ID = config.get("D4H_TEAM_ID", "").strip()
        D4H_BASE_URL = config.get("D4H_BASE_URL", "").strip()
        CALTOPO_OFFLINE_URL = config.get("CALTOPO_OFFLINE_URL", "http://localhost:8080").strip()
        if not CRED_ID or not CRED_SECRET_B64 or not D4H_API_TOKEN or not D4H_TEAM_ID or not D4H_BASE_URL:
            raise ValueError("Missing config parameter")
except Exception as e:
    raise RuntimeError(f"Failed to load API config: {e}")

app.config["CRED_ID"] = CRED_ID
app.config["CRED_SECRET_B64"] = CRED_SECRET_B64
app.config["CALTOPO_TEAM_ID"] = CALTOPO_TEAM_ID
app.config["D4H_API_TOKEN"] = D4H_API_TOKEN
app.config["D4H_TEAM_ID"] = D4H_TEAM_ID
app.config["D4H_BASE_URL"] = D4H_BASE_URL
app.config["CALTOPO_OFFLINE_URL"] = CALTOPO_OFFLINE_URL


# ================= Routes =================

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/health")
def health():
    return jsonify(success=True, status="OK")


@app.route("/help/<path:filename>")
def help_files(filename):
    return send_from_directory("help", filename)


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard/incident.html")


@app.route("/checkin")
def checkin():
    return render_template("kiosk/index.html")


@app.route("/checkin/admin")
def checkin_admin():
    return render_template("kiosk/admin.html")


def _make_qr_svg(url):
    import io, qrcode, qrcode.image.svg
    factory = qrcode.image.svg.SvgPathImage
    img = qrcode.make(url, image_factory=factory, box_size=10, border=2)
    svg_io = io.BytesIO()
    img.save(svg_io)
    svg = svg_io.getvalue().decode("utf-8")
    return svg[svg.index("<svg"):]


def _is_local_network_url(url):
    import re
    from urllib.parse import urlparse
    hostname = (urlparse(url).hostname or "").lower()
    return (
        hostname == "localhost"
        or hostname.endswith(".local")
        or bool(re.match(r"^\d+\.\d+\.\d+\.\d+$", hostname))
    )


@app.route("/checkin/qr")
def checkin_qr():
    from urllib.parse import quote
    from flask import request as req

    incident = req.args.get("incidentName", "").strip()
    if not incident:
        return "incidentName is required", 400

    forwarded_host = req.headers.get("X-Forwarded-Host")
    if forwarded_host:
        proto = req.headers.get("X-Forwarded-Proto", "https")
        base = f"{proto}://{forwarded_host}"
    else:
        base = req.host_url.rstrip("/")
    check_in_url = f"{base}/checkin?incidentName={quote(incident)}"

    svg = _make_qr_svg(check_in_url)

    if _is_local_network_url(check_in_url):
        network_warning = '<p class="network-warning">&#9888; Device must be on local network</p>'
    else:
        network_warning = ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>{incident} — Sign In</title>
  <style>
    @page {{ margin: 0.75in; }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #fff;
      color: #111;
      padding: 40px 24px;
    }}
    h1 {{
      font-size: 2.2rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 32px;
      line-height: 1.2;
    }}
    .network-warning {{
      font-size: 1rem;
      font-weight: 600;
      color: #7a5c00;
      background: #fff8e1;
      border: 1.5px solid #ffe082;
      border-radius: 8px;
      padding: 10px 20px;
      text-align: center;
      margin-bottom: 24px;
    }}
    .qr-wrap {{
      width: min(320px, 80vw);
      height: min(320px, 80vw);
    }}
    .qr-wrap svg {{
      width: 100%;
      height: 100%;
    }}
    p {{
      font-size: 1.5rem;
      font-weight: 600;
      color: #444;
      margin-top: 28px;
      letter-spacing: 0.02em;
    }}
    .url {{
      font-size: 0.7rem;
      color: #999;
      margin-top: 16px;
      word-break: break-all;
      text-align: center;
    }}
    @media print {{
      .no-print {{ display: none; }}
    }}
  </style>
</head>
<body>
  <h1>{incident}</h1>
  {network_warning}
  <div class="qr-wrap">{svg}</div>
  <p>Sign In</p>
  <div class="url">{check_in_url}</div>
  <script>window.print();</script>
</body>
</html>"""
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/checkin/qr-svg")
def api_checkin_qr_svg():
    from urllib.parse import quote
    from flask import request as req, jsonify as _jsonify

    # Prefer a client-supplied URL (accurate even behind a reverse proxy)
    url = req.args.get("url", "").strip()
    if not url:
        incident = req.args.get("incidentName", "").strip()
        base = req.host_url.rstrip("/")
        url = f"{base}/checkin?incidentName={quote(incident)}" if incident else f"{base}/checkin"

    try:
        svg = _make_qr_svg(url)
        return _jsonify({"ok": True, "svg": svg, "url": url})
    except Exception as e:
        return _jsonify({"ok": False, "error": str(e)}), 500


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.after_request
def trigger_snapshot(resp):
    from flask import request as req
    if req.method == "GET":
        return resp
    if not (200 <= resp.status_code < 300):
        return resp
    try:
        names = set()
        body = req.get_json(silent=True) or {}
        for key in ("incidentName", "newName"):
            v = (body.get(key) or "").strip()
            if v:
                names.add(v)
        v = (req.args.get("incidentName") or "").strip()
        if v:
            names.add(v)
        for name in names:
            snapshot_incident_async(name)
    except Exception:
        pass
    return resp

# ================= Startup =================

def open_browser():
    webbrowser.open("http://localhost:5000")

if __name__ == "__main__":
    snapshot_all_async()
    threading.Timer(1, open_browser).start()
    app.run(host="0.0.0.0", port=5000, debug=False)
