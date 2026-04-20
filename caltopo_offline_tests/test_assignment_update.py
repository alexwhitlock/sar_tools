"""
CalTopo Offline Assignment Update Test
---------------------------------------
Tests whether the assignment update POST endpoint works on the local server,
and whether it needs auth or accepts unauthenticated requests.

Usage:
    python caltopo_offline_tests/test_assignment_update.py --map-id ABC123 --feature-id XYZ789
"""

import argparse
import json
import requests

BASE = "http://localhost:8080"


def test_update(map_id, feature_id, session):
    """Try POSTing an assignment update — first without auth, then note what happens."""

    # We'll first fetch the current state of the assignment
    print("\n--- Fetching current assignment state ---")
    url = f"{BASE}/api/v1/map/{map_id}/since/0"
    try:
        resp = session.get(url, timeout=5)
        print(f"Status: {resp.status_code}")
        if resp.ok:
            data = resp.json()
            result = data.get("result", data)
            features = (result.get("state") or {}).get("features", [])
            assignments = [f for f in features if (f.get("properties") or {}).get("class") == "Assignment"]
            print(f"Found {len(assignments)} assignment(s) on map")
            for a in assignments:
                props = a.get("properties", {})
                print(f"  id={a.get('id')}  title={props.get('title')}  status={props.get('status')}")

            # Try to find our target feature
            target = next((f for f in features if f.get("id") == feature_id), None)
            if target:
                print(f"\nTarget feature found: {json.dumps(target, indent=2)[:500]}")
            else:
                print(f"\nFeature ID '{feature_id}' not found on map. Use one of the IDs above.")
                return
    except requests.exceptions.ConnectionError:
        print("CONNECTION REFUSED — is the local CalTopo server running?")
        return

    # Try a no-auth POST to update the assignment
    print("\n--- Attempting unauthenticated assignment update POST ---")
    endpoint = f"/api/v1/map/{map_id}/Assignment/{feature_id}"
    url = BASE + endpoint

    payload = {**target, "properties": {**target.get("properties", {}), "status": "DRAFT"}}
    payload_str = json.dumps(payload, separators=(",", ":"))

    # Try plain JSON body first
    print(f"POST {url}")
    resp = session.post(url, json=payload, timeout=5)
    print(f"Status (JSON body): {resp.status_code}")
    try:
        print(json.dumps(resp.json(), indent=2)[:500])
    except Exception:
        print(resp.text[:500])

    # Try form-encoded like caltopo.com expects
    print(f"\nPOST {url} (form-encoded, no auth params)")
    resp = session.post(url, data={"json": payload_str}, timeout=5)
    print(f"Status (form body, no auth): {resp.status_code}")
    try:
        print(json.dumps(resp.json(), indent=2)[:500])
    except Exception:
        print(resp.text[:500])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--map-id",     required=True, help="CalTopo map ID")
    parser.add_argument("--feature-id", default="",    help="Assignment feature ID to test update on")
    args = parser.parse_args()

    session = requests.Session()
    test_update(args.map_id, args.feature_id, session)


if __name__ == "__main__":
    main()
