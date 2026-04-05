import json
import time
from flask import Blueprint, Response, request
from db.database import get_connection

bp = Blueprint("sync", __name__)

_POLL_INTERVAL = 0.3   # seconds between DB version checks inside the SSE loop
_CONNECT_DELAY = 0.5  # wait before sending init so just-disconnected clients clean up first

# In-memory connection registry: incident_name -> connected client count.
# Safe without locks under gevent (cooperative multitasking; no yields between reads/writes).
_connections: dict = {}


def get_connected_incidents() -> list:
    """Return incident names that currently have at least one SSE client connected."""
    return [name for name, count in _connections.items() if count > 0]


def _on_connect(incident_name: str):
    _connections[incident_name] = _connections.get(incident_name, 0) + 1


def _on_disconnect(incident_name: str):
    count = _connections.get(incident_name, 0) - 1
    if count <= 0:
        _connections.pop(incident_name, None)
    else:
        _connections[incident_name] = count


def _get_version(incident_name: str) -> int:
    with get_connection(incident_name) as conn:
        return conn.execute("SELECT version FROM sync_state WHERE id = 1").fetchone()[0]


def _msg(type: str, **kwargs) -> str:
    return f"data: {json.dumps({'type': type, **kwargs})}\n\n"


def _event_stream(incident_name: str):
    _on_connect(incident_name)
    try:
        # Brief pause: lets any just-disconnected client (refresh/tab switch) clean up
        # before we count, so init reports the correct user count.
        time.sleep(_CONNECT_DELAY)

        last_version = _get_version(incident_name)
        last_users = _connections.get(incident_name, 1)
        yield _msg("init", users=last_users)

        while True:
            time.sleep(_POLL_INTERVAL)

            version = _get_version(incident_name)
            users = _connections.get(incident_name, 1)

            if version != last_version:
                last_version = version
                last_users = users
                yield _msg("sync", users=users)
            elif users != last_users:
                last_users = users
                yield _msg("users", users=users)
            else:
                # Always yield every poll cycle so client disconnects are detected
                # within _POLL_INTERVAL rather than waiting for the next real event.
                yield ": k\n\n"
    finally:
        _on_disconnect(incident_name)


@bp.route("/api/sync/stream")
def stream():
    incident_name = request.args.get("incidentName", "").strip()
    if not incident_name:
        return {"error": "incidentName required"}, 400

    return Response(
        _event_stream(incident_name),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering if behind a proxy
        },
    )
