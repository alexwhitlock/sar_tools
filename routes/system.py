import json
import os
from flask import Blueprint, jsonify

bp = Blueprint("system", __name__)

_VERSION_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static", "version.json")


@bp.get("/api/system-info")
def api_system_info():
    version = {}
    try:
        with open(_VERSION_FILE, "r") as f:
            version = json.load(f)
    except Exception:
        pass
    return jsonify({
        "gitHash":  version.get("gitHash",  "unknown"),
        "gitDate":  version.get("gitDate",  "unknown"),
        "hostname": version.get("hostname", "unknown"),
        "dbPath":   version.get("dbPath",   "unknown"),
    })
