/* global-sync.js
 * Real-time sync via Server-Sent Events.
 * Only runs when an incident is selected.
 * EventSource handles reconnection automatically on network drops.
 */

import { loadTeams } from "./teams.js";
import { loadPersonnel } from "./personnel.js";
import { loadAssignments } from "./assignments.js";
import { syncLive, syncStop, onSyncNow } from "./sync-indicator.js";
import { refreshCommsTeams, refreshLogPanels } from "./logging.js";

let _sse = null;

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

function startSSE() {
  if (_sse) return;
  if (!hasIncident()) return;

  syncLive();
  const url = `/api/sync/stream?incidentName=${encodeURIComponent(incidentName())}`;
  _sse = new EventSource(url);

  _sse.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    syncLive(msg.users);
    if (msg.type === "sync" && document.visibilityState !== "hidden") syncAll();
  };
}

function stopSSE() {
  if (_sse) { _sse.close(); _sse = null; }
  syncStop();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && hasIncident()) {
    syncAll();
    if (!_sse) startSSE();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("incidentSelect");
  if (sel) {
    sel.addEventListener("change", () => {
      stopSSE();
      if (hasIncident()) { syncAll(); startSSE(); }
    });
  }

  onSyncNow(() => {
    if (!hasIncident()) return;
    syncAll();
  });

  if (hasIncident()) { syncAll(); startSSE(); }
});
