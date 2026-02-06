# routes/caltopo.py
import base64
import hashlib
import hmac
import json
import time
import requests
from flask import Blueprint, jsonify, request, current_app

bp = Blueprint("caltopo", __name__)

caltopo_base_url = "https://caltopo.com"

# ===============================
# API Routes
# ===============================

@bp.get("/api/assignments")
def api_assignments():
    map_id = (request.args.get("mapId") or "").strip()
    if not map_id:
        return jsonify(error="mapId required"), 400

    try:
        assignments = get_assignments_for_map(map_id)
        return jsonify(assignments)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.post("/upload")
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
            ok = (status == 200)
            if not ok:
                failures += 1

            if i == 0 and status != 200:
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


# ===============================
# Helpers
# ===============================

def _cfg(key):
    val = (current_app.config.get(key) or "").strip()
    if not val:
        raise RuntimeError(f"Missing config value: {key}")
    return val


def sign_request(method, endpoint, expires_ms, payload_str):
    cred_secret_b64 = _cfg("CRED_SECRET_B64")
    msg = f"{method} {endpoint}\n{expires_ms}\n{payload_str}"
    key = base64.b64decode(cred_secret_b64)
    sig = hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(sig).decode("ascii")


def post_shape_to_caltopo(map_id, shape):
    cred_id = _cfg("CRED_ID")

    endpoint = f"/api/v1/map/{map_id}/Shape"
    payload_str = json.dumps(shape, separators=(",", ":"))
    expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
    signature = sign_request("POST", endpoint, expires_ms, payload_str)

    params = {
        "id": cred_id,
        "expires": str(expires_ms),
        "signature": signature,
        "json": payload_str,
    }

    resp = requests.post(caltopo_base_url + endpoint, data=params, timeout=20)
    try:
        body = resp.json()
    except Exception:
        body = resp.text

    return resp.status_code, body


def get_from_caltopo(endpoint):
    cred_id = _cfg("CRED_ID")

    expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
    payload_str = ""
    signature = sign_request("GET", endpoint, expires_ms, payload_str)

    params = {
        "id": cred_id,
        "expires": str(expires_ms),
        "signature": signature,
    }

    resp = requests.get(caltopo_base_url + endpoint, params=params, timeout=20)
    resp.raise_for_status()
    return resp.json().get("result", {})


def _is_number(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def validate_shapes(shapes):
    if not isinstance(shapes, list) or not shapes:
        raise ValueError("shapes must be a non-empty array")

    validated = []

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

        for p_i, pt in enumerate(ring, start=1):
            if (
                not isinstance(pt, list)
                or len(pt) != 2
                or not _is_number(pt[0])
                or not _is_number(pt[1])
            ):
                raise ValueError(f"Shape #{idx} point #{p_i} must be [lon, lat] numbers")

        if ring[0] != ring[-1]:
            raise ValueError(f"Shape #{idx} polygon ring is not closed (first != last)")

        props = shape.get("properties")
        if props is None:
            shape["properties"] = {}
        elif not isinstance(props, dict):
            raise ValueError(f"Shape #{idx} properties must be an object if provided")

        validated.append(shape)

    return validated


def get_assignments_for_map(map_id):
    endpoint = f"/api/v1/map/{map_id}/since/0"
    data = get_from_caltopo(endpoint)

    features = data.get("state", {}).get("features", [])

    # Build lookup: OperationalPeriod feature id -> useful fields
    op_lookup = {}
    for f in features:
        props = f.get("properties", {})
        if props.get("class") == "OperationalPeriod":
            op_lookup[f.get("id")] = {
                "title": props.get("title"),
                "updated": props.get("updated"),
            }

    assignments = []

    for f in features:
        props = f.get("properties", {})
        if props.get("class") != "Assignment":
            continue

        geometry = f.get("geometry", {}) or {}
        geom_type = geometry.get("type")

        if geom_type == "Polygon":
            assignment_type = "Area"
        elif geom_type == "LineString":
            assignment_type = "Line"
        else:
            assignment_type = "Other"

        letter_raw = (props.get("letter") or "").strip()
        team = letter_raw.replace("X", "").strip() or ""

        op_id = props.get("operationalPeriodId")
        op_info = op_lookup.get(op_id, {})

        assignments.append({
            "id": f.get("id"),
            "number": props.get("number"),
            "team": team,
            "assignmentType": assignment_type,
            "resourceType": props.get("resourceType"),
            "status": props.get("status"),
            "op": op_info.get("title"),
        })

    return assignments
