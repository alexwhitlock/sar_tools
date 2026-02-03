import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";

let personnelTable = null;
let personnelMessage = null;

/* ===============================
   Helpers
   =============================== */

function getCurrentIncidentName() {
  const sel = document.getElementById("incidentSelect");
  return sel ? sel.value.trim() : "";
}

function requireIncidentOrError() {
  const incidentName = getCurrentIncidentName();
  if (!incidentName) {
    // Clear stale data + show hard error
    if (personnelTable) personnelTable.setData([]);
    if (personnelMessage) {
      personnelMessage.show(
        "No incident selected. Go to Home and select (or create) an incident.",
        "error"
      );
    }
    return "";
  }
  return incidentName;
}

function updateAddButtonEnabled() {
  const addBtn = document.getElementById("person-add");
  if (!addBtn) return;
  addBtn.disabled = !getCurrentIncidentName();
}

/* ===============================
   Row renderer
   =============================== */

function renderPersonnelRow(p) {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${p.name ?? ""}</td>
    <td>${p.team ?? ""}</td>
  `;
  return tr;
}

/* ===============================
   Data loading
   =============================== */

async function loadPersonnel() {
  personnelMessage.show("Loading personnel…", "info");
  logMessage("INFO", "Loading personnel");

  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  try {
    const resp = await fetch(`/api/personnel?incidentName=${encodeURIComponent(incidentName)}`);
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }

    logMessage("INFO", "Personnel received", data);

    if (!Array.isArray(data) || !data.length) {
      personnelMessage.show("No personnel yet. Click + Person to add someone.", "info");
      personnelTable.setData([]);
      return;
    }

    personnelMessage.show(`Loaded ${data.length} people.`, "info");
    personnelTable.setData(data);

  } catch (err) {
    logMessage("ERROR", "Failed to load personnel", err.message);
    personnelTable.setData([]);
    personnelMessage.show(`Failed to load personnel: ${err.message}`, "error");
  }
}

/* ===============================
   Add person
   =============================== */

async function addPerson() {
  try {
    const incidentName = requireIncidentOrError();
    if (!incidentName) return;

    const name = (window.prompt("Enter person name:") || "").trim();
    if (!name) return;

    personnelMessage.show("Adding person…", "info");

    const resp = await fetch("/api/personnel/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentName, name })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      throw new Error(data.error || `Add failed (HTTP ${resp.status})`);
    }

    personnelMessage.show("Person added.", "info");
    await loadPersonnel();

  } catch (err) {
    logMessage("ERROR", "Failed to add person", err.message);
    personnelMessage.show(`Failed to add person: ${err.message}`, "error");
  }
}

/* ===============================
   Filters
   =============================== */

function wireFilters(table) {
  const nameInput = document.getElementById("filter-name");
  if (nameInput) {
    nameInput.addEventListener("input", e => {
      table.setFilter("name", e.target.value);
    });
  }

  const teamInput = document.getElementById("filter-team");
  if (teamInput) {
    teamInput.addEventListener("input", e => {
      table.setFilter("team", e.target.value);
    });
  }
}

/* ===============================
   Tab activation watcher
   =============================== */

function watchPersonnelTab() {
  const panel = document.getElementById("personnel");
  if (!panel) return;

  let wasActive = panel.classList.contains("active");

  const observer = new MutationObserver(() => {
    const isActive = panel.classList.contains("active");
    if (isActive && !wasActive) {
      logMessage("INFO", "Personnel tab activated");
      updateAddButtonEnabled();
      loadPersonnel();
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
  const panel = document.getElementById("personnel");
  if (!panel) {
    logMessage("ERROR", "Personnel panel (#personnel) not found in DOM. Are you editing the file Flask is serving?");
    return;
  }

  const tableEl = panel.querySelector(".personnel-data-table");
  if (!tableEl) {
    logMessage("ERROR", "Personnel panel exists, but .personnel-data-table not found inside it");
    return;
  }

  personnelMessage = initMessageBar("personnel-message");
  personnelMessage.show("Select an incident on Home, then open the Personnel tab.", "info");

  personnelTable = createTable({
    tableEl,
    rowRenderer: renderPersonnelRow
  });

  const addBtn = document.getElementById("person-add");
  if (addBtn) addBtn.addEventListener("click", addPerson);

  // Disable + Person until an incident is selected
  updateAddButtonEnabled();

  // If incident changes while app is open, keep Personnel consistent
  const incidentSelect = document.getElementById("incidentSelect");
  if (incidentSelect) {
    incidentSelect.addEventListener("change", () => {
      updateAddButtonEnabled();
      // If Personnel tab is currently active, reload immediately
      if (panel.classList.contains("active")) {
        loadPersonnel();
      }
    });
  }

  wireFilters(personnelTable);
  watchPersonnelTab();
});