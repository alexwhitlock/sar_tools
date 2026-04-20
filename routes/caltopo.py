# routes/caltopo.py
import base64
import hashlib
import hmac
import json
import time
import requests
from flask import Blueprint, jsonify, request, current_app
from db.log_repo import insert_log

bp = Blueprint("caltopo", __name__)


def _log(incident_name, message):
    if not incident_name:
        return
    try:
        insert_log(incident_name, "SYSTEM", "user_event", message)
    except Exception:
        pass

CALTOPO_ONLINE_URL  = "https://caltopo.com"
CALTOPO_OFFLINE_URL = "http://localhost:8080"


def _caltopo_base(mode: str) -> str:
    return CALTOPO_OFFLINE_URL if mode == "offline" else CALTOPO_ONLINE_URL

# Simple in-memory cache for account feature list (5-minute TTL)
_acct_cache = {"data": None, "ts": 0}
_ACCT_CACHE_TTL = 300  # seconds

# ===============================
# API Routes
# ===============================

@bp.get("/api/caltopo/map/<map_id>")
def api_caltopo_map_info(map_id):
    """
    Returns the title of a CalTopo map by ID.
    Looks up the map in the team account's feature list (cached 5 min).
    { "mapId": "APC1GE5", "title": "Gatineau Park SAR" }
    """
    try:
        team_id = _cfg("CALTOPO_TEAM_ID")
        features = _get_acct_features(team_id)

        for feat in features:
            if feat.get("id") == map_id:
                title = (feat.get("properties") or {}).get("title", "").strip()
                return jsonify({"mapId": map_id, "title": title or None})

        return jsonify({"error": f"Map {map_id} not found in team account"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _get_acct_features(team_id):
    """Returns cached account features, refreshing if older than TTL."""
    now = time.time()
    if _acct_cache["data"] is not None and (now - _acct_cache["ts"]) < _ACCT_CACHE_TTL:
        return _acct_cache["data"]
    data = get_from_caltopo(f"/api/v1/acct/{team_id}/since/0")
    features = data.get("features") or []
    _acct_cache["data"] = features
    _acct_cache["ts"] = now
    return features


@bp.get("/api/assignments")
def api_assignments():
    map_id        = (request.args.get("mapId")        or "").strip()
    incident_name = (request.args.get("incidentName") or "").strip()
    mode          = (request.args.get("mode")         or "online").strip()
    if not map_id:
        return jsonify(error="mapId required"), 400

    try:
        assignments = get_assignments_for_map(map_id, mode=mode)
        if incident_name:
            from db.assignments_repo import get_assignment_data
            data_map = get_assignment_data(incident_name)
            for a in assignments:
                row = data_map.get(a["id"]) or {}
                a["notes"]       = row.get("notes") or None
                a["asgnType"]    = row.get("type") or None
                a["description"] = row.get("description") or None
        return jsonify(assignments)
    except Exception as e:
        return jsonify(error=str(e)), 500


@bp.post("/api/assignments/data")
def api_assignment_data_update():
    """Save or clear local data (type, description, notes) for a CalTopo assignment."""
    data = request.get_json(force=True) or {}
    incident_name = (data.get("incidentName") or "").strip()
    feature_id    = (data.get("featureId")    or "").strip()
    asgn_type     = (data.get("type")         or "").strip() or None
    description   = (data.get("description")  or "").strip() or None
    notes         = (data.get("notes")        or "").strip() or None
    number        = data.get("number")

    if not incident_name or not feature_id:
        return jsonify(ok=False, error="incidentName and featureId required"), 400

    try:
        from db.assignments_repo import upsert_assignment_data
        upsert_assignment_data(incident_name, feature_id,
                               asgn_type=asgn_type, description=description, notes=notes)
        label = f"Assignment {number}" if number is not None else f"Assignment ({feature_id[:8]}…)"
        parts = []
        if asgn_type:   parts.append(f'type="{asgn_type}"')
        if description: parts.append(f'description="{description}"')
        if notes:       parts.append(f'notes="{notes}"')
        _log(incident_name, f'{label} updated: {", ".join(parts)}' if parts else f'{label} data cleared')
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


@bp.post("/upload")
def upload():
    try:
        data = request.get_json(silent=True) or {}
        map_id    = (data.get("mapId") or "").strip()
        mode      = (data.get("mode")  or "online").strip()
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
            status, body = post_shape_to_caltopo(map_id, shape, mode=mode)
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


def post_shape_to_caltopo(map_id, shape, mode: str = "online"):
    base = _caltopo_base(mode)
    endpoint = f"/api/v1/map/{map_id}/Shape"
    payload_str = json.dumps(shape, separators=(",", ":"))
    if mode == "offline":
        params = {"json": payload_str}
    else:
        cred_id = _cfg("CRED_ID")
        expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
        signature = sign_request("POST", endpoint, expires_ms, payload_str)
        params = {
            "id": cred_id,
            "expires": str(expires_ms),
            "signature": signature,
            "json": payload_str,
        }

    resp = requests.post(base + endpoint, data=params, timeout=20)
    try:
        body = resp.json()
    except Exception:
        body = resp.text

    return resp.status_code, body


def get_from_caltopo(endpoint, mode: str = "online"):
    base = _caltopo_base(mode)
    if mode == "offline":
        resp = requests.get(base + endpoint, timeout=20)
        resp.raise_for_status()
        return resp.json().get("result", {})

    cred_id = _cfg("CRED_ID")
    expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
    payload_str = ""
    signature = sign_request("GET", endpoint, expires_ms, payload_str)
    params = {
        "id": cred_id,
        "expires": str(expires_ms),
        "signature": signature,
    }
    resp = requests.get(base + endpoint, params=params, timeout=20)
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


def _build_assignment_title(completed_x: bool, number, team: str) -> str:
    """Reconstruct a CalTopo assignment title from its parsed components."""
    parts = []
    if completed_x:
        parts.append("X")
    if number is not None:
        parts.append(str(number))
    if team:
        parts.append(str(team).upper())
    return " ".join(parts)


def _post_assignment_update(map_id: str, feature_id: str, feature: dict, mode: str = "online"):
    """POST an updated Assignment feature to CalTopo."""
    base = _caltopo_base(mode)
    endpoint = f"/api/v1/map/{map_id}/Assignment/{feature_id}"
    payload_str = json.dumps(feature, separators=(",", ":"))
    if mode == "offline":
        params = {"json": payload_str}
    else:
        cred_id = _cfg("CRED_ID")
        expires_ms = int(time.time() * 1000) + 2 * 60 * 1000
        signature = sign_request("POST", endpoint, expires_ms, payload_str)
        params = {
            "id": cred_id,
            "expires": str(expires_ms),
            "signature": signature,
            "json": payload_str,
        }
    resp = requests.post(base + endpoint, data=params, timeout=20)
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    return resp.status_code, body


@bp.post("/api/caltopo/assignment/update")
def api_update_assignment():
    """
    Update an assignment's status and/or team in CalTopo.
    Rebuilds the title to keep the X prefix in sync with COMPLETED status.
    Bumps sync_state.version so other SSE clients are notified.
    """
    data = request.get_json(silent=True) or {}
    map_id        = (data.get("mapId")        or "").strip()
    feature_id    = (data.get("featureId")    or "").strip()
    incident_name = (data.get("incidentName") or "").strip()
    mode          = (data.get("mode")         or "online").strip()
    new_status = data.get("status")   # None = don't change
    new_team   = data.get("team")     # None = don't change; "" = clear team

    if not map_id or not feature_id:
        return jsonify(ok=False, error="mapId and featureId required"), 400

    try:
        # Fetch current feature from CalTopo to preserve all fields
        map_data = get_from_caltopo(f"/api/v1/map/{map_id}/since/0", mode=mode)
        features = map_data.get("state", {}).get("features", [])
        feature = next((f for f in features if f.get("id") == feature_id), None)
        if not feature:
            return jsonify(ok=False, error=f"Assignment {feature_id} not found in map"), 404

        # Parse current title into components
        props = dict(feature.get("properties", {}))
        completed_x, number, team = _parse_assignment_title(props.get("title", ""))

        # Apply requested changes
        if new_status is not None:
            props["status"] = str(new_status).strip().upper()
            completed_x = (props["status"] == "COMPLETED")

        if new_team is not None:
            team = str(new_team).strip()

        # Rebuild title keeping X prefix in sync with COMPLETED status
        props["title"] = _build_assignment_title(completed_x, number, team)

        # POST full updated feature back to CalTopo
        updated_feature = {**feature, "properties": props}
        status_code, body = _post_assignment_update(map_id, feature_id, updated_feature, mode=mode)

        if status_code != 200:
            return jsonify(ok=False, error=f"CalTopo returned {status_code}: {body}"), 502

        # Bump sync_state.version to notify other connected SSE clients
        if incident_name:
            try:
                from db.database import get_connection
                with get_connection(incident_name) as conn:
                    conn.execute("UPDATE sync_state SET version = version + 1 WHERE id = 1")
                    conn.commit()
            except Exception:
                pass  # non-fatal

        parts = []
        if new_status is not None: parts.append(f'status="{props["status"]}"')
        if new_team   is not None: parts.append(f'team="{team or "(none)"}"')
        if parts:
            _log(incident_name, f'Assignment {number or feature_id} updated: {", ".join(parts)}')

        return jsonify(ok=True)

    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500


def _parse_assignment_title(title):
    """
    Parse CalTopo assignment title format: [X] <number> [team]

    Examples:
      "1"     -> (False, "1", "")
      "1 A"   -> (False, "1", "A")
      "X 1 A" -> (True,  "1", "A")
      "X 1"   -> (True,  "1", "")
    """
    tokens = (title or "").strip().split()
    if not tokens:
        return False, None, ""
    completed_x = tokens[0].upper() == "X"
    rest = tokens[1:] if completed_x else tokens
    number = rest[0] if rest else None
    team = "".join(rest[1:]) if len(rest) > 1 else ""
    return completed_x, number, team


def get_assignments_for_map(map_id, mode: str = "online"):
    endpoint = f"/api/v1/map/{map_id}/since/0"
    data = get_from_caltopo(endpoint, mode=mode)

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

        title_raw = (props.get("title") or "").strip()
        completed_x, parsed_number, team = _parse_assignment_title(title_raw)

        status = (props.get("status") or "").strip()

        # Flag mismatch: X in title but status isn't COMPLETED, or vice versa
        title_conflict = (
            (completed_x and status.upper() != "COMPLETED") or
            (not completed_x and status.upper() == "COMPLETED")
        )

        op_id = props.get("operationalPeriodId")
        op_info = op_lookup.get(op_id, {})

        assignments.append({
            "id": f.get("id"),
            "number": parsed_number,
            "team": team,
            "assignmentType": assignment_type,
            "resourceType": props.get("resourceType"),
            "status": status,
            "op": op_info.get("title"),
            "titleConflict": title_conflict,
            "geometry": geometry if geometry else None,
        })

    return assignments
