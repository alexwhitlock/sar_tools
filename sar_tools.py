import base64
import hashlib
import hmac
import json
import os
import threading
import time
import webbrowser
from typing import Any, Dict, List, Tuple

import logging
logging.basicConfig(level=logging.INFO)


import requests
from flask import Flask, jsonify, request, render_template, send_from_directory

CALTOPO_BASE_URL = "https://caltopo.com"

# ================= Flask App =================
app = Flask(
    __name__,
    template_folder="templates",
    static_folder="static"
)

# ================= Load Config =================
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config.json")

try:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)
        CRED_ID = config.get("cred_id", "").strip()
        CRED_SECRET_B64 = config.get("cred_secret_b64", "").strip()
        if not CRED_ID or not CRED_SECRET_B64:
            raise ValueError("Missing cred_id or cred_secret_b64")
except Exception as e:
    raise RuntimeError(f"Failed to load API config: {e}")

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

@app.route("/api/assignments")
def api_assignments():
    map_id = (request.args.get("mapId") or "").strip()
    if not map_id:
        return jsonify(error="mapId required"), 400

    try:
        assignments = get_assignments_for_map(map_id)
        return jsonify(assignments)
    except Exception as e:
        return jsonify(error=str(e)), 500


# ================= Signing & Upload =================

def sign_request(method: str, endpoint: str, expires_ms: int, payload_str: str) -> str:
    """
    CalTopo API request signing. Note: payload_str must match what you send.
    """
    msg = f"{method} {endpoint}\n{expires_ms}\n{payload_str}"
    key = base64.b64decode(CRED_SECRET_B64)
    sig = hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(sig).decode("ascii")


def post_shape_to_caltopo(map_id: str, shape: Dict[str, Any]) -> Tuple[int, Any]:
    endpoint = f"/api/v1/map/{map_id}/Shape"
    payload_str = json.dumps(shape, separators=(",", ":"))
    expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
    signature = sign_request("POST", endpoint, expires_ms, payload_str)

    params = {
        "id": CRED_ID,
        "expires": str(expires_ms),
        "signature": signature,
        "json": payload_str,
    }

    resp = requests.post(CALTOPO_BASE_URL + endpoint, data=params, timeout=20)

    try:
        body = resp.json()
    except Exception:
        body = resp.text

    return resp.status_code, body

# ================== GET from CalTopo ==================================
def get_from_caltopo(endpoint: str) -> Dict[str, Any]:
    """
    Signed GET request to CalTopo API.
    """
    expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
    payload_str = ""
    signature = sign_request("GET", endpoint, expires_ms, payload_str)

    params = {
        "id": CRED_ID,
        "expires": str(expires_ms),
        "signature": signature,
    }

    resp = requests.get(
        CALTOPO_BASE_URL + endpoint,
        params=params,
        timeout=20
    )

    resp.raise_for_status()
    return resp.json().get("result", {})

# ================= Validation (Python trust gate only) =================

def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def validate_shapes(shapes: Any) -> List[Dict[str, Any]]:
    """
    Minimal, fast validation to avoid signing/uploading garbage.
    Does NOT regenerate geometry. JS is the source of geometry.
    """
    if not isinstance(shapes, list) or not shapes:
        raise ValueError("shapes must be a non-empty array")

    validated: List[Dict[str, Any]] = []

    for idx, shape in enumerate(shapes, start=1):
        if not isinstance(shape, dict):
            raise ValueError(f"Shape #{idx} must be an object")

        geom = shape.get("geometry")
        if not isinstance(geom, dict):
            raise ValueError(f"Shape #{idx} missing geometry")

        if geom.get("type") != "Polygon":
            raise ValueError(f"Shape #{idx} geometry.type must be 'Polygon'")

        coordinates = geom.get("coordinates")
        if (
            not isinstance(coordinates, list)
            or len(coordinates) != 1
            or not isinstance(coordinates[0], list)
        ):
            raise ValueError(f"Shape #{idx} geometry.coordinates must be [ [ ... ] ]")

        ring = coordinates[0]
        if len(ring) < 4:
            raise ValueError(f"Shape #{idx} polygon ring must have at least 4 points")

        # Each point must be [lon, lat] numbers
        for p_i, pt in enumerate(ring, start=1):
            if (
                not isinstance(pt, list)
                or len(pt) != 2
                or not _is_number(pt[0])
                or not _is_number(pt[1])
            ):
                raise ValueError(f"Shape #{idx} point #{p_i} must be [lon, lat] numbers")

        # Ring must be closed
        if ring[0] != ring[-1]:
            raise ValueError(f"Shape #{idx} polygon ring is not closed (first != last)")

        # Ensure properties exists (CalTopo supports it; JS may set title)
        props = shape.get("properties")
        if props is None:
            shape["properties"] = {}
        elif not isinstance(props, dict):
            raise ValueError(f"Shape #{idx} properties must be an object if provided")

        validated.append(shape)

    return validated


# ================= Upload =================

@app.route("/upload", methods=["POST"])
def upload():
    try:
        data = request.get_json(silent=True) or {}
        map_id = (data.get("mapId") or "").strip()
        shapes_in = data.get("shapes")

        if not map_id:
            return jsonify(success=False, error="mapId required"), 400

        try:
            shapes = validate_shapes(shapes_in)
        except Exception as ve:
            return jsonify(success=False, error=f"Invalid shapes: {ve}"), 400

        results = []
        failures = 0

        for i, shape in enumerate(shapes):
            status, body = post_shape_to_caltopo(map_id, shape)
            ok = status == 200
            if not ok:
                failures += 1

            # If the first upload fails, it's often a map access issue or auth issue.
            if i == 0 and status != 200:
                # Keep the message you wanted, but include status for debugging.
                return jsonify(
                    success=False,
                    error=(
                        "Map ID does not exist or is not accessible. "
                        "Check that the map is in the team folder, not the 'Your Data' folder."
                    ),
                    status_code=status,
                    body=body
                ), 400

            results.append({
                "title": shape.get("properties", {}).get("title", ""),
                "status_code": status,
                "success": ok,
                "body": body
            })

        return jsonify(
            success=(failures == 0),
            mapId=map_id,
            count=len(shapes),
            failures=failures,
            results=results
        )

    except Exception as e:
        return jsonify(success=False, error=str(e)), 500

# =============== GET ASSIGNMENTS =============
def get_assignments_for_map(map_id: str) -> List[Dict[str, Any]]:
    """
    Read-only retrieval of assignment data from CalTopo.
    CalTopo remains the source of truth.
    """

    endpoint = f"/api/v1/map/{map_id}/since/0"
    data = get_from_caltopo(endpoint)

    features = data.get("state", {}).get("features", [])
    assignments: List[Dict[str, Any]] = []

    for f in features:
        props = f.get("properties", {})
        if props.get("class") != "Assignment":
            continue

        geometry = f.get("geometry", {})
        geom_type = geometry.get("type")

        if geom_type == "Polygon":
            assignment_type = "Area"
        elif geom_type == "LineString":
            assignment_type = "Line"
        else:
            assignment_type = "Other"

        letter_raw = (props.get("letter") or "").strip()
        team = letter_raw.replace("X", "").strip() or ""

        assignments.append({
            "id": f.get("id"),
            "number": props.get("number"),
            "team": team,
            "assignmentType": assignment_type,
            "resourceType": props.get("resourceType"),
            "status": props.get("status"),
        })

    return assignments

# ==================  Create Incident ===========================
from flask import request, jsonify
from db.database import get_connection, get_db_path_for_incident
from db.migrations import run_migrations
from db.schema_dump import write_schema_dump  # optional

@app.post("/api/incident/init")
def api_incident_init():
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()

    if not incident_name:
        return jsonify({"ok": False, "error": "incidentName is required"}), 400

    # Create/open the DB file, apply schema, and (optionally) write schema dump
    with get_connection(incident_name) as conn:
        run_migrations(conn)
        db_path = get_db_path_for_incident(incident_name)
        try:
            write_schema_dump(conn, db_path, incident_name)
        except Exception:
            # keep it non-fatal; DB init should still succeed
            pass

    return jsonify({"ok": True, "incidentName": incident_name})


# ================= Test Create db ==========================
from db.database import get_connection, get_db_path_for_incident
from db.migrations import run_migrations
from db.schema_dump import write_schema_dump

incident_name = "Blue Lake Search"

with get_connection(incident_name) as conn:
    run_migrations(conn)
    db_path = get_db_path_for_incident(incident_name)
    write_schema_dump(conn, db_path, incident_name)



# ================= Startup =================

def open_browser():
    webbrowser.open("http://localhost:5000")


if __name__ == "__main__":
    threading.Timer(1, open_browser).start()
    app.run(host="127.0.0.1", port=5000, debug=False)
