/* global-sync.js
 * Real-time sync via Server-Sent Events.
 * Falls back to 20-second polling if SSE is unavailable or disconnects.
 * Only runs when an incident is selected.
 */

import { loadTeams } from "./teams.js";
import { loadPersonnel } from "./personnel.js";
import { loadAssignments } from "./assignments.js";
import { syncStart, syncReset, syncStop, syncLive, onSyncNow } from "./sync-indicator.js";
import { refreshCommsTeams, refreshLogPanels } from "./logging.js";

const POLL_INTERVAL_MS = 20_000;  // fallback polling interval
const SSE_RETRY_DELAY_MS = 5_000; // how long to wait before re-opening SSE after an error

let _pollTimer = null;
let _sse = null;
let _sseRetryTimer = null;

function hasIncident() {
  const sel = document.getElementById("incidentSelect");
  return sel ? sel.value.trim() !== "" : false;
}

function incidentName() {
  return document.getElementById("incidentSelect")?.value.trim() ?? "";
}

async function syncAll() {
  await Promise.allSettled([loadTeams(), loadPersonnel(), loadAssignments()]);
  refreshCommsTeams();
  refreshLogPanels();
}

// ── Fallback polling (runs only when SSE is not active) ──────────────────────

function startPolling() {
  if (_pollTimer) return;
  if (!hasIncident()) return;
  syncStart(POLL_INTERVAL_MS);
  _pollTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    if (!hasIncident()) { stopPolling(); return; }
    syncReset(POLL_INTERVAL_MS);
    syncAll();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  syncStop();
}

// ── SSE ───────────────────────────────────────────────────────────────────────

function startSSE() {
  if (_sse) return;
  if (!hasIncident()) return;

  // Stop fallback polling while SSE is active
  stopPolling();
  syncLive();

  const url = `/api/sync/stream?incidentName=${encodeURIComponent(incidentName())}`;
  _sse = new EventSource(url);

  // The server sends the current version immediately on connect,
  // then again whenever the version changes. We sync on every message.
  _sse.onmessage = () => {
    if (document.visibilityState === "hidden") return;
    syncReset(POLL_INTERVAL_MS);
    syncAll();
  };

  _sse.onerror = () => {
    // Connection dropped — close cleanly, fall back to polling, schedule reconnect
    closeSSE();
    startPolling();
    _sseRetryTimer = setTimeout(() => {
      _sseRetryTimer = null;
      if (hasIncident()) startSSE();
    }, SSE_RETRY_DELAY_MS);
  };
}

function closeSSE() {
  if (_sse) { _sse.close(); _sse = null; }
  if (_sseRetryTimer) { clearTimeout(_sseRetryTimer); _sseRetryTimer = null; }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function startSync() {
  if (!hasIncident()) return;
  syncAll();
  startSSE();
}

function stopSync() {
  closeSSE();
  stopPolling();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && hasIncident()) {
    // Re-sync immediately after returning to the tab; SSE reconnects on its own
    syncAll();
    if (!_sse) startSSE();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("incidentSelect");
  if (sel) {
    sel.addEventListener("change", () => {
      stopSync();
      if (hasIncident()) startSync();
    });
  }

  // Manual sync button
  onSyncNow(() => {
    if (!hasIncident()) return;
    syncAll();
  });

  // Start immediately if an incident is already selected on load
  if (hasIncident()) startSync();
});
