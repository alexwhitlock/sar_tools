/* global-sync.js
 * Single poller that refreshes all data every 20 seconds,
 * regardless of which tab is active.
 */

import { loadTeams } from "./teams.js";
import { loadPersonnel } from "./personnel.js";
import { syncStart, syncReset, syncStop } from "./sync-indicator.js";

const POLL_INTERVAL_MS = 20_000;

async function syncAll() {
  await Promise.all([loadTeams(), loadPersonnel()]);
}

function start() {
  syncStart(POLL_INTERVAL_MS);
  setInterval(() => {
    if (document.visibilityState === "hidden") return;
    syncReset(POLL_INTERVAL_MS);
    syncAll();
  }, POLL_INTERVAL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    syncAll();
    syncStart(POLL_INTERVAL_MS);
  } else {
    syncStop();
  }
});

document.addEventListener("DOMContentLoaded", start);
