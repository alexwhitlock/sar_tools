import time
from flask import Blueprint, Response, request
from db.database import get_connection

bp = Blueprint("sync", __name__)

_POLL_INTERVAL = 0.3   # seconds between DB version checks inside the SSE loop
_KEEPALIVE_INTERVAL = 15  # seconds between SSE keepalive comments


def _get_version(incident_name: str) -> int:
    with get_connection(incident_name) as conn:
        return conn.execute("SELECT version FROM sync_state WHERE id = 1").fetchone()[0]


def _event_stream(incident_name: str):
    last_version = _get_version(incident_name)
    yield f"data: {last_version}\n\n"  # send current version immediately on connect

    last_keepalive = time.monotonic()

    while True:
        time.sleep(_POLL_INTERVAL)

        version = _get_version(incident_name)
        if version != last_version:
            last_version = version
            yield f"data: {version}\n\n"
            last_keepalive = time.monotonic()
        elif time.monotonic() - last_keepalive >= _KEEPALIVE_INTERVAL:
            # SSE comment — keeps the connection alive through proxies/load balancers
            yield ": keepalive\n\n"
            last_keepalive = time.monotonic()


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
