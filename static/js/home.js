import { initMessageBar } from "./message-bar.js";
import { logUserEvent } from "./logging.js";

console.log("[home.js] LOADED");

function $(id) { return document.getElementById(id); }

let incidentMsg = null;
let caltopoMsg  = null;
let d4hMsg      = null;

// ===============================
// Incident list
// ===============================

async function loadIncidents(selectName = "") {
  const sel = $("incidentSelect");
  if (!sel) return;

  try {
    const res = await fetch("/api/get_incidents");
    if (!res.ok) throw new Error(`GET /api/get_incidents failed (${res.status})`);
    const data = await res.json();

    // Only clear and repopulate once the fetch succeeds, so a failed fetch
    // (e.g. while offline) never wipes the current incident selection.
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— Select an incident —";
    sel.appendChild(ph);

    const incidents = data.incidents || [];
    for (const inc of incidents) {
      const name = inc.incidentName;
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    }

    if (selectName && [...sel.options].some(o => o.value === selectName)) {
      sel.value = selectName;
      sel.dataset.prev = selectName;
      incidentMsg.show(`Active: ${selectName}`, "info");
    } else {
      sel.value = "";
      sel.dataset.prev = "";
      if (!incidents.length) incidentMsg.show("No incidents yet. Create one.", "warning");
      else incidentMsg.clear();
    }
  } catch (e) {
    console.error(e);
    incidentMsg.show(`Incident list error: ${e.message}`, "error");
  }
}

async function openIncident(incidentName) {
  const res = await fetch("/api/incident/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || "Failed to open incident");
  }
  return data;
}

async function createIncident() {
  const nameInput = $("incidentNewName");
  const btn = $("incidentCreateBtn");

  const name = (nameInput?.value || "").trim();
  if (!name) {
    incidentMsg.show("Enter an incident name.", "warning");
    return;
  }

  btn.disabled = true;
  incidentMsg.show("Creating incident...", "info");

  try {
    const res = await fetch("/api/incident/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentName: name })
    });

    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Create failed");
    }

    nameInput.value = "";
    await loadIncidents(data.incidentId);

    try {
      await openIncident(data.incidentId);
    } catch (e) {
      console.error(e);
      incidentMsg.show(`Created, but open failed: ${e.message}`, "error");
      return;
    }

    incidentMsg.show(`Active: ${data.incidentId}`, "info");
    updateLinkCheckboxVisibility();
    await loadIncidentSettings(data.incidentId);
  } catch (e) {
    console.error(e);
    incidentMsg.show(e.message, "error");
  } finally {
    btn.disabled = false;
  }
}

// ===============================
// Link checkbox visibility
// ===============================

function getCurrentIncident() {
  const sel = $("incidentSelect");
  return sel ? sel.value.trim() : "";
}

function updateLinkCheckboxVisibility() {
  const hasIncident = !!getCurrentIncident();
  const caltopoLinkRow = $("caltopoLinkRow");
  const d4hLinkRow = $("d4hLinkRow");
  if (caltopoLinkRow) caltopoLinkRow.style.display = hasIncident ? "" : "none";
  if (d4hLinkRow) d4hLinkRow.style.display = hasIncident ? "" : "none";
}

// ===============================
// Input lock helpers
// ===============================

function setCaltopoLinked(linked) {
  const input = $("mapId");
  const check = $("caltopoLinkCheck");
  const btn   = $("mapIdLookupBtn");
  if (input) input.disabled = linked;
  if (check) check.checked  = linked;
  if (btn)   btn.disabled   = linked;
}

function setD4hLinked(linked) {
  const input = $("d4h_activity");
  const check = $("d4hLinkCheck");
  const btn   = $("d4hLookupBtn");
  if (input) input.disabled = linked;
  if (check) check.checked  = linked;
  if (btn)   btn.disabled   = linked;
}

// ===============================
// Name hint lookups
// ===============================

async function fetchCaltopoMapName(mapId) {
  if (!mapId) { caltopoMsg.clear(); return; }
  caltopoMsg.show("Looking up map…", "info");
  try {
    const res = await fetch(`/api/caltopo/map/${encodeURIComponent(mapId)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      caltopoMsg.show(data.error || "Map not found.", "error");
      return;
    }
    caltopoMsg.show(data.title ? `Current Map: ${data.title}` : "Map found (no title).", "info");
  } catch (e) {
    caltopoMsg.show("Error looking up map.", "error");
  }
}

async function fetchD4hActivityName(activityId) {
  if (!activityId) { d4hMsg.clear(); return; }
  d4hMsg.show("Looking up activity…", "info");
  try {
    const res = await fetch(`/api/d4h/activity/${encodeURIComponent(activityId)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      d4hMsg.show(data.error || "Activity not found.", "error");
      return;
    }
    d4hMsg.show(data.title ? `Current Activity: ${data.title}` : "Activity found (no title).", "info");
  } catch (e) {
    d4hMsg.show("Error looking up activity.", "error");
  }
}

// ===============================
// Incident settings (link/unlink)
// ===============================

async function saveSetting(key, value) {
  const incident = getCurrentIncident();
  if (!incident) return;
  await fetch("/api/incident/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName: incident, key, value }),
  });
}

async function loadIncidentSettings(incidentName) {
  // No incident: unlock everything, clear hints
  if (!incidentName) {
    $("mapId").value = "";
    $("d4h_activity").value = "";
    setCaltopoLinked(false);
    setD4hLinked(false);
    caltopoMsg.clear();
    d4hMsg.clear();
    return;
  }

  try {
    const res = await fetch(`/api/incident/settings?incidentName=${encodeURIComponent(incidentName)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const caltopoMapId    = data.caltopoMapId;
    const d4hActivityId   = data.d4hActivityId;

    if (caltopoMapId) {
      $("mapId").value = caltopoMapId;
      setCaltopoLinked(true);
      fetchCaltopoMapName(caltopoMapId);
    } else {
      $("mapId").value = "";
      setCaltopoLinked(false);
      caltopoMsg.clear();
    }

    if (d4hActivityId) {
      $("d4h_activity").value = d4hActivityId;
      setD4hLinked(true);
      fetchD4hActivityName(d4hActivityId);
    } else {
      $("d4h_activity").value = "";
      setD4hLinked(false);
      d4hMsg.clear();
    }
  } catch (e) {
    console.error("[home.js] loadIncidentSettings error:", e);
  }
}

// ===============================
// Home tab activation watcher
// ===============================

function watchHomeTab() {
  const panel = document.getElementById("home");
  if (!panel) return;

  let wasActive = panel.classList.contains("active");

  const observer = new MutationObserver(() => {
    const isActive = panel.classList.contains("active");
    if (isActive && !wasActive) {
      logMessage("INFO", "Home tab activated");
      const sel = $("incidentSelect");
      const current = sel ? sel.value.trim() : "";
      loadIncidents(current);
    }
    wasActive = isActive;
  });

  observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
}

// ===============================
// Init
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[home.js] DOMContentLoaded");

  if (!$("incidentSelect")) {
    console.warn("[home.js] incidentSelect not found");
    return;
  }

  incidentMsg = initMessageBar("incidentHint");
  caltopoMsg  = initMessageBar("caltopoHint");
  d4hMsg      = initMessageBar("d4hHint");

  // Incident selector
  $("incidentSelect").addEventListener("change", async (e) => {
    const sel = e.target;
    const val = sel.value.trim();
    const prev = sel.dataset.prev || "";

    if (!val) {
      sel.dataset.prev = "";
      incidentMsg.show("No incident selected.", "warning");
      updateLinkCheckboxVisibility();
      await loadIncidentSettings("");
      return;
    }

    incidentMsg.show(`Opening: ${val}…`, "info");

    try {
      await openIncident(val);
      sel.dataset.prev = val;
      incidentMsg.show(`Active: ${val}`, "info");
      updateLinkCheckboxVisibility();
      await loadIncidentSettings(val);
    } catch (err) {
      console.error(err);
      sel.value = prev;
      incidentMsg.show(`Open failed: ${err.message}`, "error");
      updateLinkCheckboxVisibility();
    }
  });

  $("incidentCreateBtn")?.addEventListener("click", () => {
    console.log("[home.js] Create clicked");
    createIncident();
  });

  // CalTopo — lookup on button click or Enter key
  async function doCaltopoLookup() {
    if ($("mapId").disabled) return;
    $("mapIdLookupBtn").disabled = true;
    const mapId = ($("mapId")?.value || "").trim();
    await fetchCaltopoMapName(mapId);
  }
  $("mapIdLookupBtn")?.addEventListener("click", doCaltopoLookup);
  $("mapId")?.addEventListener("keydown", (e) => { if (e.key === "Enter") doCaltopoLookup(); });
  $("mapId")?.addEventListener("input", () => {
    if (!$("mapId").disabled) {
      caltopoMsg.clear();
      $("mapIdLookupBtn").disabled = false;
    }
  });

  // D4H — lookup on button click or Enter key
  async function doD4hLookup() {
    if ($("d4h_activity").disabled) return;
    $("d4hLookupBtn").disabled = true;
    const actId = ($("d4h_activity")?.value || "").trim();
    await fetchD4hActivityName(actId);
  }
  $("d4hLookupBtn")?.addEventListener("click", doD4hLookup);
  $("d4h_activity")?.addEventListener("keydown", (e) => { if (e.key === "Enter") doD4hLookup(); });
  $("d4h_activity")?.addEventListener("input", () => {
    if (!$("d4h_activity").disabled) {
      d4hMsg.clear();
      $("d4hLookupBtn").disabled = false;
    }
  });

  // CalTopo link checkbox
  $("caltopoLinkCheck")?.addEventListener("change", async (e) => {
    const mapId = ($("mapId")?.value || "").trim();
    const incident = getCurrentIncident();
    if (e.target.checked) {
      if (!mapId) { e.target.checked = false; return; }
      await saveSetting("linked_caltopo_map_id", mapId);
      setCaltopoLinked(true);
      logUserEvent(incident, `CalTopo map linked (${mapId})`);
    } else {
      await saveSetting("linked_caltopo_map_id", null);
      setCaltopoLinked(false);
      logUserEvent(incident, "CalTopo map link removed");
    }
  });

  // D4H link checkbox
  $("d4hLinkCheck")?.addEventListener("change", async (e) => {
    const actId = ($("d4h_activity")?.value || "").trim();
    const incident = getCurrentIncident();
    if (e.target.checked) {
      if (!actId) { e.target.checked = false; return; }
      await saveSetting("linked_d4h_activity_id", actId);
      setD4hLinked(true);
      logUserEvent(incident, `D4H activity linked (${actId})`);
    } else {
      await saveSetting("linked_d4h_activity_id", null);
      setD4hLinked(false);
      logUserEvent(incident, "D4H activity link removed");
    }
  });

  watchHomeTab();
  await loadIncidents("");
});
