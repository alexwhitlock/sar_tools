# routes/d4h.py
import json
import requests

from flask import Blueprint, jsonify, request, current_app

from db.database import get_connection, get_db_path_for_incident
from db.migrations import run_migrations

bp = Blueprint("d4h", __name__)

# ===============================
# API Routes
# ===============================

@bp.get("/api/d4h/activity/<activity_id>")
def get_d4h_activity(activity_id):
    """
    Returns the title/name of a D4H activity by ID.
    { "activityId": "330704", "title": "Search Callout – Gatineau Park" }
    """
    try:
        base_url, token, team_id = _get_d4h_config()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

        # D4H separates activities by type — try list endpoints with id filter
        activity_types = ["incidents", "events", "exercises"]
        activity = None
        for atype in activity_types:
            url = f"{base_url}/v3/team/{team_id}/{atype}"
            try:
                data = _d4h_get_json(url, headers=headers, params={"id": str(activity_id)})
                results = data.get("results") or []
                if results:
                    activity = results[0]
                    break
            except RuntimeError:
                continue

        if not activity:
            return jsonify({"error": f"Activity {activity_id} not found"}), 404

        title = (activity.get("referenceDescription") or "").strip()

        return jsonify({"activityId": str(activity_id), "title": title or None})

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.get("/api/d4h/activity/<activity_id>/attending-members")
def get_d4h_attending_members(activity_id):
    """
    Returns:
      {
        "activityId": "330704",
        "count": 12,
        "members": [
          {"name": "Jane Doe", "d4hRef": "1234"},
          ...
        ]
      }
    """
    try:
        base_url, token, team_id = _get_d4h_config()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

        attendance = _fetch_all_attendance_attending(base_url, team_id, headers, activity_id)
        member_ids = _extract_member_ids(attendance)

        members_raw = _fetch_members_by_ids(base_url, team_id, headers, member_ids)

        # index by member id
        members_by_id = {}
        for m in members_raw:
            mid = m.get("id")
            if isinstance(mid, int):
                members_by_id[mid] = m
            elif isinstance(mid, str) and mid.isdigit():
                members_by_id[int(mid)] = m

        out = []
        for mid in member_ids:
            m = members_by_id.get(mid, {})
            name = (m.get("name") or m.get("fullName") or m.get("displayName") or "").strip()
            out.append({
                "name": name or None,
                "d4hRef": str(mid),
                "memberRef": m.get("ref"),
            })

        return jsonify({
            "activityId": str(activity_id),
            "count": len(out),
            "members": out
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ===============================
# Helpers
# ===============================

def _cfg(key):
    val = (current_app.config.get(key) or "").strip()
    if not val:
        raise RuntimeError(f"Missing config value: {key}")
    return val

def _get_d4h_config():
    with open("config.json", "r", encoding="utf-8") as f:
        cfg = json.load(f)

    base_url = _cfg("D4H_BASE_URL")
    token = _cfg("D4H_API_TOKEN")
    team_id = _cfg("D4H_TEAM_ID")

    return base_url, token, team_id


def _d4h_get_json(url: str, headers: dict, params=None) -> dict:
    r = requests.get(url, headers=headers, params=params, timeout=25)
    if r.status_code != 200:
        raise RuntimeError(f"D4H GET failed ({r.status_code}) {url}: {r.text}")
    return r.json() or {}


def _fetch_all_attendance_attending(base_url: str, team_id: str, headers: dict, activity_id: str) -> list[dict]:
    url = f"{base_url}/v3/team/{team_id}/attendance"
    page = 0
    page_size = 100
    all_results: list[dict] = []

    while True:
        params = {
            "activity_id": str(activity_id),
            "status": "ATTENDING",
            "page": page,
            "size": page_size,
            "order": "asc",
            "sort": "id",
        }
        payload = _d4h_get_json(url, headers=headers, params=params)
        chunk = payload.get("results", []) or []
        if not chunk:
            break

        all_results.extend(chunk)

        total = payload.get("totalSize")
        if isinstance(total, int) and len(all_results) >= total:
            break

        page += 1

    # local safety filter
    return [a for a in all_results if a.get("status") == "ATTENDING"]


def _extract_member_ids(attendance: list[dict]) -> list[int]:
    ids = set()
    for a in attendance:
        mid = (a.get("member") or {}).get("id")
        if isinstance(mid, int):
            ids.add(mid)
        elif isinstance(mid, str) and mid.isdigit():
            ids.add(int(mid))
    return sorted(ids)


def _fetch_members_by_ids(base_url: str, team_id: str, headers: dict, member_ids: list[int]) -> list[dict]:
    """
    Bulk fetch members by ID using /members.
    """
    if not member_ids:
        return []

    url = f"{base_url}/v3/team/{team_id}/members"
    params = [("id", str(mid)) for mid in member_ids]
    params += [("page", "0"), ("size", str(max(100, len(member_ids))))]

    payload = _d4h_get_json(url, headers=headers, params=params)
    results = payload.get("results")
    if isinstance(results, list):
        return results
    if isinstance(payload, list):
        return payload
    return []





