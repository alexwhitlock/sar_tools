import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";

let personnelTable = null;
let personnelMessage = null;

/* ===============================
   Incident helpers
   =============================== */

const INCIDENT_STORAGE_KEY = "sarTools.incidentName";

function getIncidentName() {
  return (localStorage.getItem(INCIDENT_STORAGE_KEY) || "").trim();
}

function setIncidentName(name) {
  localStorage.setItem(INCIDENT_STORAGE_KEY, name);
}

/* Optional: very simple incident prompt for now */
async function ensureIncidentName() {
  let name = getIncidentName();
  if (name) return name;

  // Keep it minimal: prompt only when a DB-backed tab is activated.
  name = (window.prompt("Enter incident name to create/open the incident database:") || "").trim();
  if (!name) return "";

  // Ask backend to create/open DB + run migrations
  const resp = await fetch("/api/incident/init", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName: name })
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    throw new Error(data.error || `Init failed (HTTP ${resp.status})`);
  }

  setIncidentName(data.incidentName);
  return data.incidentName;
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
  // Unlike CalTopo calls, this is local DB-backed. Offline browser state isn’t very meaningful,
  // but if your Flask server isn’t reachable, fetch will fail and we handle it.

  personnelMessage.show("Loading personnel…", "info");
  logMessage("INFO", "Loading personnel");

  try {
    const incidentName = await ensureIncidentName();
    if (!incidentName) {
      personnelTable.setData([]);
      personnelMessage.show("Personnel requires an incident database. Enter an incident name to continue.", "info");
      return;
    }

    const resp = await fetch(`/api/personnel?incidentName=${encodeURIComponent(incidentName)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    logMessage("INFO", "Personnel received", data);

    if (!data.length) {
      personnelMessage.show("No personnel yet. Click + Person to add someone.", "info");
    } else {
      personnelMessage.show(`Loaded ${data.length} people.`, "info");
    }

    personnelTable.setData(data);

  } catch (err) {
    logMessage("ERROR", "Failed to load personnel", err.message);
    personnelTable.setData([]);
    personnelMessage.show("Failed to load personnel. See console for details.", "error");
  }
}

/* ===============================
   Add person
   =============================== */

async function addPerson() {
  try {
    const incidentName = await ensureIncidentName();
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
    if (!resp.ok || !data.ok) {
      throw new Error(data.error || `Add failed (HTTP ${resp.status})`);
    }

    personnelMessage.show("Person added.", "info");
    await loadPersonnel();

  } catch (err) {
    logMessage("ERROR", "Failed to add person", err.message);
    personnelMessage.show("Failed to add person. See console for details.", "error");
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
  personnelMessage.show("Open the Personnel tab to load incident personnel.", "info");

  personnelTable = createTable({
    tableEl,
    rowRenderer: renderPersonnelRow
  });

  const addBtn = document.getElementById("person-add");
  if (addBtn) addBtn.addEventListener("click", addPerson);

  wireFilters(personnelTable);
  watchPersonnelTab();
});

