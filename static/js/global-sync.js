/* global-sync.js
 * Single poller that refreshes all data every 20 seconds,
 * regardless of which tab is active.
 * Only runs when an incident is selected.
 */

import { loadTeams } from "./teams.js";
import { loadPersonnel } from "./personnel.js";
import { loadAssignments } from "./assignments.js";
import { syncStart, syncReset, syncStop, onSyncNow } from "./sync-indicator.js";
import { refreshCommsTeams, refreshLogPanels } from "./logging.js";

const POLL_INTERVAL_MS = 20_000;

let _timer = null;

function hasIncident() {
  const sel = document.getElementById("incidentSelect");
  return sel ? sel.value.trim() !== "" : false;
}

async function syncAll() {
  await Promise.allSettled([loadTeams(), loadPersonnel(), loadAssignments()]);
  refreshCommsTeams();
  refreshLogPanels();
}

function startPolling() {
  if (_timer) return;
  if (!hasIncident()) return;
  syncStart(POLL_INTERVAL_MS);
  _timer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    if (!hasIncident()) { stopPolling(); return; }
    syncReset(POLL_INTERVAL_MS);
    syncAll();
  }, POLL_INTERVAL_MS);
}

function stopPolling() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  syncStop();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && hasIncident()) {
    syncAll();
    startPolling();
  } else if (document.visibilityState === "hidden") {
    stopPolling();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const sel = document.getElementById("incidentSelect");
  if (sel) {
    sel.addEventListener("change", () => {
      if (hasIncident()) {
        syncAll();
        startPolling();
      } else {
        stopPolling();
      }
    });
  }

  // Manual sync button
  onSyncNow(() => {
    if (!hasIncident()) return;
    stopPolling();
    syncAll();
    startPolling();
  });

  // Start immediately if an incident is already selected on load
  if (hasIncident()) startPolling();
});
