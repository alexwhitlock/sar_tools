"""
CalTopo Offline API Explorer
----------------------------
Run this while CalTopo offline server is running at localhost:8080.
It probes endpoints we need and prints what comes back.

Usage:
    python caltopo_offline_tests/explore_api.py
    python caltopo_offline_tests/explore_api.py --map-id ABC123
"""

import argparse
import json
import sys
import requests

BASE = "http://localhost:8080"

# Endpoints used by sar_tools against caltopo.com — test if they exist locally
# Format: (method, path_template, description)
PROBES = [
    # Map info
    ("GET", "/api/v1/map/{map_id}/since/0",        "Map features since 0 (our main fetch)"),
    ("GET", "/rest/map/{map_id}/since/0",           "Map features via /rest/ prefix"),
    ("GET", "/api/v1/map/{map_id}",                 "Map info"),
    ("GET", "/rest/map/{map_id}",                   "Map info via /rest/"),

    # Account / team map list
    ("GET", "/api/v1/acct/{team_id}/since/0",       "Account features (map list)"),
    ("GET", "/rest/acct/{team_id}/since/0",         "Account features via /rest/"),

    # Root / discovery
    ("GET", "/api/v1/",                             "API v1 root"),
    ("GET", "/rest/",                               "REST root"),
    ("GET", "/",                                    "Server root"),
]


def probe(method, path, description, session):
    url = BASE + path
    print(f"\n{'='*60}")
    print(f"  {method} {url}")
    print(f"  {description}")
    print(f"{'='*60}")
    try:
        resp = session.request(method, url, timeout=5)
        print(f"  Status: {resp.status_code}")
        print(f"  Content-Type: {resp.headers.get('Content-Type', '(none)')}")
        try:
            body = resp.json()
            preview = json.dumps(body, indent=2)
            lines = preview.splitlines()
            if len(lines) > 40:
                print("\n".join(lines[:40]))
                print(f"  ... ({len(lines)} lines total)")
            else:
                print(preview)
        except Exception:
            text = resp.text[:1000]
            print(text if text else "(empty body)")
    except requests.exceptions.ConnectionError:
        print("  CONNECTION REFUSED — is the local CalTopo server running?")
    except requests.exceptions.Timeout:
        print("  TIMEOUT")
    except Exception as e:
        print(f"  ERROR: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--map-id",  default="TESTMAP", help="A real map ID to test with")
    parser.add_argument("--team-id", default="TESTTEAM", help="A real team/account ID to test with")
    args = parser.parse_args()

    session = requests.Session()

    print(f"\nCalTopo Offline API Explorer")
    print(f"Base URL : {BASE}")
    print(f"Map ID   : {args.map_id}")
    print(f"Team ID  : {args.team_id}")

    for method, path_tpl, desc in PROBES:
        path = path_tpl.format(map_id=args.map_id, team_id=args.team_id)
        probe(method, path, desc, session)

    print("\n\nDone.")


if __name__ == "__main__":
    main()
