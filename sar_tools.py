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


@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp

# ================= Startup =================

def open_browser():
    webbrowser.open("http://localhost:5000")

if __name__ == "__main__":
    threading.Timer(1, open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
