import hashlib
import json
import logging
import time
import gevent
from flask import Blueprint, Response, request, current_app
from db.database import get_connection

log = logging.getLogger(__name__)

bp = Blueprint("sync", __name__)

_POLL_INTERVAL = 0.3    # seconds between DB version checks inside SSE loop
_CONNECT_DELAY = 0.5    # wait before sending init so just-disconnected clients clean up first
_CALTOPO_POLL_INTERVAL = 30  # seconds between CalTopo API polls

# In-memory connection registry: incident_name -> connected client count.
# Safe without locks under gevent (cooperative multitasking; no yields between reads/writes).
_connections: dict = {}

# Per-incident CalTopo poller greenlets: incident_name -> greenlet
_caltopo_pollers: dict = {}


def get_connected_incidents() -> list:
    """Return incident names that currently have at least one SSE client connected."""
    return [name for name, count in _connections.items() if count > 0]


def _get_map_id(incident_name: str) -> str | None:
    """Return the linked CalTopo map ID for this incident, or None if not set."""
    with get_connection(incident_name) as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = 'linked_caltopo_map_id'"
        ).fetchone()
        return row[0] if row else None


def _bump_version(incident_name: str):
    """Increment sync_state.version to signal connected SSE clients to reload."""
    with get_connection(incident_name) as conn:
        conn.execute("UPDATE sync_state SET version = version + 1 WHERE id = 1")
        conn.commit()


def _caltopo_poll_loop(incident_name: str, app):
    """
    Background greenlet: polls CalTopo every _CALTOPO_POLL_INTERVAL seconds.
    Bumps sync_state.version when assignment data changes so SSE clients reload.
    Exits automatically when the last SSE client disconnects from this incident.
    """
    from routes.caltopo import get_assignments_for_map

    last_hash = None

    with app.app_context():
        log.info("[caltopo-poll] started for %s", incident_name)
        while _connections.get(incident_name, 0) > 0:
            time.sleep(_CALTOPO_POLL_INTERVAL)

            if _connections.get(incident_name, 0) <= 0:
                break

            map_id = _get_map_id(incident_name)
            if not map_id:
                log.info("[caltopo-poll] %s: no linked map ID, skipping", incident_name)
                continue

            try:
                assignments = get_assignments_for_map(map_id)
                h = hashlib.md5(
                    json.dumps(assignments, sort_keys=True).encode()
                ).hexdigest()

                if last_hash is not None and h != last_hash:
                    log.info("[caltopo-poll] %s: change detected, bumping version", incident_name)
                    _bump_version(incident_name)
                else:
                    log.info("[caltopo-poll] %s: no change (hash=%s)", incident_name, h[:8])

                last_hash = h
            except Exception as e:
                log.warning("[caltopo-poll] %s: error polling CalTopo: %s", incident_name, e)

        log.info("[caltopo-poll] stopped for %s", incident_name)


def _on_connect(incident_name: str, app):
    _connections[incident_name] = _connections.get(incident_name, 0) + 1

    if incident_name not in _caltopo_pollers:
        _caltopo_pollers[incident_name] = gevent.spawn(
            _caltopo_poll_loop, incident_name, app
        )


def _on_disconnect(incident_name: str):
    count = _connections.get(incident_name, 0) - 1
    if count <= 0:
        _connections.pop(incident_name, None)
        g = _caltopo_pollers.pop(incident_name, None)
        if g:
            g.kill()
    else:
        _connections[incident_name] = count


def _get_version(incident_name: str) -> int:
    with get_connection(incident_name) as conn:
        return conn.execute("SELECT version FROM sync_state WHERE id = 1").fetchone()[0]


def _msg(type: str, **kwargs) -> str:
    return f"data: {json.dumps({'type': type, **kwargs})}\n\n"


def _event_stream(incident_name: str, app):
    _on_connect(incident_name, app)
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

    app = current_app._get_current_object()
    return Response(
        _event_stream(incident_name, app),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering if behind a proxy
        },
    )
