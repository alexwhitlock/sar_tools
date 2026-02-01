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

  tr.innerHTML = `
    <td>${a.number ?? ""}</td>
    <td>${a.team ?? ""}</td>
    <td>${a.assignmentType ?? ""}</td>
    <td>${a.resourceType ?? ""}</td>
    <td class="status-${(a.status || "").toLowerCase()}">
      ${a.status ?? ""}
    </td>
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
      "info"
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
      assignmentsMessage.show(
        "No assignments found on this map.",
        "info"
      );
    } else {
      const ts = getTimeHHMMSS();
      assignmentsMessage.show(
        `Last updated ${ts}`,
        "info"
      );
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

  /* ---- Pill checkbox groups ---- */
  document.querySelectorAll(".pill-group").forEach(group => {
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
    "info"
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