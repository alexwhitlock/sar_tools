import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";


let assignmentsTable = null;
let assignmentsMessage = null;

/* ===============================
   Helpers
   =============================== */

function getCurrentMapId() {
  const el = document.getElementById("mapId");
  return el ? el.value.trim() : "";
}

function getCurrentIncidentName() {
  const sel = document.getElementById("incidentSelect");
  return sel ? sel.value.trim() : "";
}

function findMissingTeams(assignments, dbLetters) {
  const missing = new Set();
  for (const a of (assignments || [])) {
    if ((a.status || "").toUpperCase() === "COMPLETED") continue;
    for (const letter of parseAssignmentTeamLetters(a.team)) {
      if (!dbLetters.has(letter)) missing.add(letter);
    }
  }
  return [...missing].sort();
}

function parseAssignmentTeamLetters(teamField) {
  if (!teamField) return [];
  return [...String(teamField).replace(/[\s,\-]+/g, "")]
    .map(c => c.toUpperCase())
    .filter(c => /[A-Z]/.test(c));
}

function findAssignmentConflicts(assignments) {
  const map = new Map();
  for (const a of (assignments || [])) {
    if ((a.status || "").toUpperCase() !== "INPROGRESS") continue;
    for (const letter of parseAssignmentTeamLetters(a.team)) {
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter).push(a.number ?? "?");
    }
  }
  return new Map([...map].filter(([, nums]) => nums.length > 1));
}

function getTimeHHMMSS() {
  const d = new Date();
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}



/* ===============================
   Row renderer
   =============================== */

function renderAssignmentRow(a) {
  const tr = document.createElement("tr");

  let numberHtml = String(a.number ?? "");
  if (a.titleConflict) {
    const tip = (a.status || "").toUpperCase() === "COMPLETED"
      ? `Assignment ${a.number}: status is COMPLETED but title has no X prefix.`
      : `Assignment ${a.number}: title has X (completed) but status is ${a.status}.`;
    numberHtml += ` <span class="conflict-warn" title="${tip}">⚠</span>`;
  }

  tr.innerHTML = `
    <td>${numberHtml}</td>
    <td>${a.team ?? ""}</td>
    <td>${a.assignmentType ?? ""}</td>
    <td>${a.resourceType ?? ""}</td>
    <td class="status-${(a.status || "").toLowerCase()}">
      ${a.status ?? ""}
    </td>
    <td class="col-op-period">${a.op ?? ""}</td>
  `;

  return tr;
}

/* ===============================
   Data loading
   =============================== */

async function loadAssignments() {
  // 🚫 HARD STOP if offline
  if (!navigator.onLine) {
    assignmentsMessage.show("Offline.", "error");
    assignmentsTable.setData([]);
    logMessage("ERROR", "Offline — assignments load aborted");
    return;
  }

  const mapId = getCurrentMapId();

  if (!mapId) {
    assignmentsTable.setData([]);
    assignmentsMessage.show(
      "Enter a CalTopo Map ID to load assignments.",
      "error"
    );
    logMessage("ERROR", "Map ID is required to load assignments");
    return;
  }

  assignmentsMessage.show("Loading assignments…", "info");
  logMessage("INFO", "Loading assignments", mapId);

  try {
    const resp = await fetch(
      `/api/assignments?mapId=${encodeURIComponent(mapId)}`
    );

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    const data = await resp.json();

    logMessage("INFO", "Assignments received", data);

    if (!data.length) {
      assignmentsMessage.show("No assignments found on this map.", "info");
    } else {
      const warnings = [];

      const conflicts = findAssignmentConflicts(data);
      if (conflicts.size > 0) {
        const detail = [...conflicts.entries()]
          .map(([letter, nums]) => `Team ${letter} (assignments ${nums.join(", ")})`)
          .join("; ");
        warnings.push(`Multiple in-progress assignments: ${detail}`);
      }

      // Title/status mismatch: X prefix vs COMPLETED status disagree
      const titleConflicts = data.filter(a => a.titleConflict);
      if (titleConflicts.length > 0) {
        const nums = titleConflicts.map(a => a.number ?? "?").join(", ");
        warnings.push(`Title/status mismatch on assignment${titleConflicts.length > 1 ? "s" : ""} ${nums} — check X prefix vs status`);
      }

      // Best-effort: check for team letters not in the DB + OOS teams on active assignments
      const incidentName = getCurrentIncidentName();
      if (incidentName) {
        try {
          const teamsResp = await fetch(`/api/teams?incidentName=${encodeURIComponent(incidentName)}`);
          if (teamsResp.ok) {
            const teams = await teamsResp.json().catch(() => []);
            const teamArr = Array.isArray(teams) ? teams : [];

            const dbLetters = new Set(
              teamArr
                .map(t => String(t.name).trim().toUpperCase())
                .filter(n => n.length === 1 && /[A-Z]/.test(n))
            );
            const missing = findMissingTeams(data, dbLetters);
            if (missing.length > 0) {
              warnings.push(`Teams in CalTopo not in database: ${missing.join(", ")}`);
            }

            // Warn if any OOS team has an in-progress assignment
            const inProgressLetters = new Set();
            for (const a of data) {
              if ((a.status || "").toUpperCase() === "INPROGRESS") {
                for (const letter of parseAssignmentTeamLetters(a.team)) {
                  inProgressLetters.add(letter);
                }
              }
            }
            const oosWithAssignment = teamArr.filter(t => {
              const letter = String(t.name).trim().toUpperCase();
              return t.status === "Out of Service" && inProgressLetters.has(letter);
            });
            if (oosWithAssignment.length > 0) {
              const names = oosWithAssignment.map(t => `Team ${t.name}`).join(", ");
              warnings.push(`${names} marked Out of Service but assigned to an in-progress assignment`);
            }
          }
        } catch (_) { /* non-fatal */ }
      }

      if (warnings.length > 0) {
        assignmentsMessage.show(`⚠ ${warnings.join(" — ")}`, "warning");
      } else {
        assignmentsMessage.show(`Last updated ${getTimeHHMMSS()}`, "info");
      }
    }

    assignmentsTable.setData(data);

  } catch (err) {
    logMessage("ERROR", "Failed to load assignments", err.message);
    assignmentsTable.setData([]);
    assignmentsMessage.show(
      "Failed to load assignments. See console for details.",
      "error"
    );
  }
}

/* ===============================
   Filters
   =============================== */

function wireFilters(table) {

  /* ---- Assignment # (text) ---- */
  const numberInput = document.getElementById("filter-number");
  if (numberInput) {
    numberInput.addEventListener("input", e => {
      table.setFilter("number", e.target.value, "startsWith");
    });
  }

  /* ---- Team (text) ---- */
  const teamInput = document.getElementById("filter-team");
  if (teamInput) {
    teamInput.addEventListener("input", e => {
      table.setFilter("team", e.target.value);
    });
  }

    /* ---- Op Period (text) ---- */
  const opInput = document.getElementById("filter-op");
  if (opInput) {
    opInput.addEventListener("input", e => {
      table.setFilter("op", e.target.value);
    });
  }

  /* ---- Op Period column + filter toggle ---- */
  const opToggle = document.getElementById("toggle-op-period");
  if (opToggle) {
    const tableEl = document.querySelector(".assignments-data-table");
    const opGroup = opToggle.closest(".filter-group-check");
    const opInput = document.getElementById("filter-op");
    opToggle.addEventListener("change", () => {
      const on = opToggle.checked;
      if (tableEl) tableEl.classList.toggle("show-op-period", on);
      if (opGroup)  opGroup.classList.toggle("op-expanded", on);
      if (!on && opInput) {
        opInput.value = "";
        table.setFilter("op", "");
      }
    });
  }

  /* ---- Pill checkbox groups (scoped to assignments panel) ---- */
  const assignmentsPanel = document.getElementById("assignments");
  assignmentsPanel?.querySelectorAll(".pill-group").forEach(group => {
    const key = group.dataset.filterKey;
    if (!key) return;

    group.addEventListener("change", () => {
      const values = Array.from(
        group.querySelectorAll("input[type=checkbox]:checked")
      ).map(cb => cb.value);

      table.setFilter(key, values, "in");
    });
  });
}

/* ===============================
   Tab activation watcher
   =============================== */

function watchAssignmentsTab() {
  const panel = document.getElementById("assignments");
  if (!panel) return;

  let wasActive = panel.classList.contains("active");

  const observer = new MutationObserver(() => {
    const isActive = panel.classList.contains("active");
    if (isActive && !wasActive) {
      logMessage("INFO", "Assignments tab activated");
      loadAssignments();
    }
    wasActive = isActive;
  });

  observer.observe(panel, {
    attributes: true,
    attributeFilter: ["class"]
  });
}

/* ===============================
   Init
   =============================== */



document.addEventListener("DOMContentLoaded", () => {

  /* ===============================
     1. Locate required DOM elements
     =============================== */

  const tableEl = document.querySelector(".assignments-data-table");
  if (!tableEl) {
    logMessage("ERROR", "Assignments table not found in DOM");
    return;
  }

  /* ===============================
     2. Initialize message bar
     =============================== */

  assignmentsMessage = initMessageBar("assignments-message");

  // Initial state (no map ID yet)
  assignmentsMessage.show(
    "Enter a CalTopo Map ID to load assignments.",
    "error"
  );

  /* ===============================
     3. Initialize table
     =============================== */

  assignmentsTable = createTable({
    tableEl,
    rowRenderer: renderAssignmentRow,

    columnTypes: {
      number: "number"
    },

    sortOrders: {
      status: {
        DRAFT: 1,
        PREPARED: 2,
        INPROGRESS: 3,
        COMPLETED: 4
      }
    },

    secondarySort: {
      status: ["number"]
    }
  });

  /* ===============================
     4. Wire UI events
     =============================== */

  // Reload button
  const reloadBtn = document.getElementById("assignments-reload");
  if (reloadBtn) {
    reloadBtn.addEventListener("click", loadAssignments);
  }

  // Filters (safe to wire here — DOM now exists)
  wireFilters(assignmentsTable);

  // Tab activation watcher
  watchAssignmentsTab();
});


/* ===============================
   Online / Offline handling
   =============================== */

window.addEventListener("online", loadAssignments);

window.addEventListener("offline", () => {
  assignmentsMessage.show("Offline.", "error");
  assignmentsTable.setData([]);
});