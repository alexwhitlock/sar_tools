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

    setTopBarIncident(data.incidentId);
    incidentMsg.show(`Active: ${data.incidentId}`, "info");
    updateLinkCheckboxVisibility();
    await loadIncidentSettings(data.incidentId);
    window.dispatchEvent(new CustomEvent("sar:incident-selected"));
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

function setTopBarIncident(name) {
  const el = $("top-incident-name");
  if (el) {
    el.textContent = name || "—";
    el.classList.toggle("hidden", !name);
  }
  showCommandDashboard(name);
}

function updateLinkCheckboxVisibility() {
  const hasIncident = !!getCurrentIncident();
  const caltopoLinkRow = $("caltopoLinkRow");
  const d4hLinkRow = $("d4hLinkRow");
  if (caltopoLinkRow) caltopoLinkRow.style.display = hasIncident ? "" : "none";
  if (d4hLinkRow) d4hLinkRow.style.display = hasIncident ? "" : "none";
  const exportBtn = $("incidentExportBtn");
  if (exportBtn) exportBtn.disabled = !hasIncident;
  const renameBtn = $("incidentRenameBtn");
  if (renameBtn) renameBtn.disabled = !hasIncident;
  updateDashboardLinks();
}

function updateDashboardLinks() {
  const incident = getCurrentIncident();
  const dashUrl  = incident ? `/dashboard?incidentName=${encodeURIComponent(incident)}` : null;
  const kioskUrl = incident ? `/checkin?incidentName=${encodeURIComponent(incident)}`   : null;

  const snapLink = $("dashboardSnapshotLink");
  if (snapLink) {
    const snapUrl = incident ? `/snapshot/latest?incidentName=${encodeURIComponent(incident)}` : null;
    snapLink.href = snapUrl || "#";
    snapLink.classList.toggle("disabled", !snapUrl);
  }

  const link    = $("dashboardIncidentLink");
  const copyBtn = $("dashboardIncidentCopy");
  if (link)    { link.href = dashUrl || "#"; link.classList.toggle("disabled", !dashUrl); }
  if (copyBtn) copyBtn.disabled = !dashUrl;

  const kioskLink    = $("dashboardKioskLink");
  const kioskCopyBtn = $("dashboardKioskCopy");
  const kioskQrBtn   = $("dashboardKioskQr");
  if (kioskLink)    { kioskLink.href = kioskUrl || "#"; kioskLink.classList.toggle("disabled", !kioskUrl); }
  if (kioskCopyBtn) kioskCopyBtn.disabled = !kioskUrl;
  if (kioskQrBtn)   kioskQrBtn.disabled   = !kioskUrl;

  const hint = $("dashboardHint");
  if (hint) hint.style.display = (dashUrl || kioskUrl) ? "none" : "";
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

async function fetchCaltopoMapName(mapId, selectedOpId = null) {
  if (!mapId) { caltopoMsg.clear(); clearOpPeriods(); return; }
  const mode = document.querySelector('input[name="caltopoMode"]:checked')?.value ?? "online";
  caltopoMsg.show("Looking up map…", "info");
  try {
    const res = await fetch(`/api/caltopo/map/${encodeURIComponent(mapId)}?mode=${encodeURIComponent(mode)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      caltopoMsg.show(data.error || "Map not found.", "error");
      clearOpPeriods();
      return;
    }
    caltopoMsg.show(data.title ? `Current Map: ${data.title}` : "Map found.", "info");
    await fetchOpPeriods(mapId, selectedOpId);
  } catch (e) {
    caltopoMsg.show("Error looking up map.", "error");
    clearOpPeriods();
  }
}

async function fetchOpPeriods(mapId, selectedId = null) {
  const mode = document.querySelector('input[name="caltopoMode"]:checked')?.value ?? "online";
  const row = $("opPeriodRow");
  const sel = $("opSelect");
  if (!sel) return;
  try {
    const res = await fetch(`/api/caltopo/map/${encodeURIComponent(mapId)}/operational-periods?mode=${encodeURIComponent(mode)}`);
    const data = await res.json();
    if (!res.ok || data.error) { clearOpPeriods(); return; }
    const ops = data.operationalPeriods || [];
    sel.innerHTML = '<option value="">— All periods —</option>';
    for (const op of ops) {
      const opt = document.createElement("option");
      opt.value = op.id;
      opt.textContent = op.title || op.id;
      sel.appendChild(opt);
    }
    if (selectedId) sel.value = selectedId;
    if (row) row.style.display = ops.length ? "" : "none";
  } catch (e) {
    clearOpPeriods();
  }
}

function clearOpPeriods() {
  const row = $("opPeriodRow");
  const sel = $("opSelect");
  if (sel) sel.innerHTML = '<option value="">— All periods —</option>';
  if (row) row.style.display = "none";
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
  // No incident: unlock everything, clear hints, reset mode to offline
  if (!incidentName) {
    $("mapId").value = "";
    $("d4h_activity").value = "";
    setCaltopoLinked(false);
    setD4hLinked(false);
    caltopoMsg.clear();
    d4hMsg.clear();
    clearOpPeriods();
    const offlineRadio = document.querySelector('input[name="caltopoMode"][value="offline"]');
    if (offlineRadio) offlineRadio.checked = true;
    return;
  }

  try {
    const res = await fetch(`/api/incident/settings?incidentName=${encodeURIComponent(incidentName)}`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const caltopoMapId    = data.caltopoMapId;
    const d4hActivityId   = data.d4hActivityId;
    const caltopoMode     = data.caltopoMode || "offline";
    const selectedOpId    = data.selectedOpId || null;

    // Restore mode radio
    const modeRadio = document.querySelector(`input[name="caltopoMode"][value="${caltopoMode}"]`);
    if (modeRadio) modeRadio.checked = true;

    if (caltopoMapId) {
      $("mapId").value = caltopoMapId;
      setCaltopoLinked(true);
      fetchCaltopoMapName(caltopoMapId, selectedOpId);
    } else {
      $("mapId").value = "";
      setCaltopoLinked(false);
      caltopoMsg.clear();
      clearOpPeriods();
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
// System info
// ===============================

function formatDeployDate(iso) {
  if (!iso || iso === "unknown") return iso;
  // "2026-05-19T13:17:37-04:00" → "2026-05-19 13:17"
  const [datePart, rest] = iso.split("T");
  if (!rest) return iso;
  const timePart = rest.replace(/[+-]\d{2}:\d{2}$/, "").replace("Z", "");
  return `${datePart} ${timePart.slice(0, 5)}`;
}

async function loadSystemInfo() {
  try {
    const res = await fetch("/api/system-info");
    const data = await res.json();
    const set = (id, val) => { const el = $(id); if (el) el.textContent = val || "unknown"; };
    const hostname = data.hostname === "t3600"
      ? "t3600 (Alex Whitlock's home server)"
      : data.hostname;
    set("sysHostname", hostname);
    set("sysGitHash",  data.gitHash);
    set("sysGitDate",  formatDeployDate(data.gitDate));
  } catch (e) {
    console.warn("[home.js] system info fetch failed:", e);
  }
}


// ===============================
// Command Dashboard
// ===============================

let _dashInterval = null;

function _esc(s) {
  return String(s ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
}

function showCommandDashboard(incidentName) {
  const noInc = $("cmdNoIncident");
  const dash  = $("cmdDashboard");
  if (!noInc || !dash) return;
  if (incidentName) {
    noInc.style.display = "none";
    dash.classList.remove("hidden");
    const nameEl = $("cmdIncidentName");
    if (nameEl) nameEl.textContent = incidentName;
    const nameDisplay = $("incidentNameDisplay");
    if (nameDisplay) nameDisplay.textContent = incidentName;
    loadCommandDashboard(incidentName);
    if (_dashInterval) clearInterval(_dashInterval);
    _dashInterval = setInterval(() => loadCommandDashboard(incidentName), 30000);
  } else {
    noInc.style.display = "";
    dash.classList.add("hidden");
    if (_dashInterval) { clearInterval(_dashInterval); _dashInterval = null; }
    updateOpStrip(null);
  }
}

async function loadCommandDashboard(incidentName) {
  if (!incidentName) return;
  try {
    const res  = await fetch(`/api/command-summary?incidentName=${encodeURIComponent(incidentName)}`);
    const data = await res.json();
    if (!data.ok) return;
    _renderDashStats(data);
    _renderTeams(data.teams || []);
    _renderAssignments(data.assignments || {});
    _renderRecentLog(data.recentLog || []);
    updateOpStrip(data);
  } catch (e) {
    console.warn("[home.js] command summary fetch failed:", e);
  }
}

function _renderDashStats(data) {
  const p = data.personnel || {};
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v ?? "—"; };
  set("cmdStatAvail",    p.available ?? 0);
  set("cmdStatDeployed", p.deployed  ?? 0);
  set("cmdStatReleased", p.released  ?? 0);
  set("cmdStatAdded",    p.added     ?? 0);
}

const _TEAM_BADGE = {
  "Out of Service":             "cmd-ts-badge-oos",
  "Staged":                     "cmd-ts-badge-staged",
  "Briefed":                    "cmd-ts-badge-briefed",
  "Travelling to Assignment":   "cmd-ts-badge-travelling",
  "On Assignment":              "cmd-ts-badge-on-assignment",
  "Returning from Assignment":  "cmd-ts-badge-returning",
  "Awaiting Debrief":           "cmd-ts-badge-debrief",
  "Retired":                    "cmd-ts-badge-retired",
};

function _renderTeams(teams) {
  const el = $("cmdTeamsList");
  const countEl = $("cmdTeamCount");
  if (!el) return;
  if (countEl) countEl.textContent = teams.length ? `${teams.length} team${teams.length !== 1 ? "s" : ""}` : "";
  if (!teams.length) { el.innerHTML = '<div class="cmd-empty">No teams yet.</div>'; return; }
  el.innerHTML = teams.map(t => {
    const bc  = _TEAM_BADGE[t.status] || "cmd-ts-badge-oos";
    const asgnHtml = t.assignment
      ? `<span class="cmd-team-asgn">${_esc(t.assignment)}</span>`
      : `<span class="cmd-team-asgn no-asgn">No assignment</span>`;
    return `<div class="cmd-team-row">
      <span class="cmd-team-name">${_esc(t.name)}</span>
      <span class="cmd-ts-badge ${bc}">${_esc(t.status || "—")}</span>
      ${asgnHtml}
    </div>`;
  }).join("");
}

const _ASGN_LABEL = { DRAFT:"Draft", PREPARED:"Prepared", INPROGRESS:"In Progress", COMPLETED:"Completed" };
const _ASGN_CHIP  = { INPROGRESS:"chip-inprogress", PREPARED:"chip-prepared", COMPLETED:"chip-completed", DRAFT:"chip-draft" };
const _ASGN_ORDER = ["INPROGRESS","PREPARED","DRAFT","COMPLETED"];

function _renderAssignments(counts) {
  const el = $("cmdAsgnBody");
  if (!el) return;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  if (!total) { el.innerHTML = '<div class="cmd-empty">No assignments synced yet.</div>'; return; }
  const completed = counts.COMPLETED || 0;
  const pct = Math.round((completed / total) * 100);
  const chips = Object.entries(counts)
    .sort((a, b) => (_ASGN_ORDER.indexOf(a[0]) + 99) % 99 - (_ASGN_ORDER.indexOf(b[0]) + 99) % 99)
    .map(([s, n]) => `<span class="cmd-asgn-chip ${_ASGN_CHIP[s] || ""}">${n} ${_ASGN_LABEL[s] || s}</span>`)
    .join("");
  el.innerHTML = `
    <div class="cmd-asgn-bar-wrap"><div class="cmd-asgn-bar-fill" style="width:${pct}%"></div></div>
    <div class="cmd-asgn-summary">${completed} of ${total} complete (${pct}%)</div>
    <div class="cmd-asgn-breakdown">${chips}</div>`;
}

const _LOG_ROLE_CLASS = {
  COMMS:"role-comms", OPS:"role-ops", IC:"role-ic", SYSTEM:"role-system", PLANS:"role-plans"
};

function _renderRecentLog(entries) {
  const el = $("cmdLogFeed");
  if (!el) return;
  if (!entries.length) { el.innerHTML = '<div class="cmd-empty">No log entries yet.</div>'; return; }
  el.innerHTML = entries.map(e => {
    const time = (e.timestamp || "").substring(11, 16);
    const role = (e.role || "SYSTEM").toUpperCase();
    const important = (e.flags || "").includes("important") ? " log-important" : "";
    return `<div class="cmd-log-entry${important}">
      <span class="cmd-log-time">${_esc(time)}</span>
      <span class="cmd-log-role ${_LOG_ROLE_CLASS[role] || ""}">${_esc(role)}</span>
      <span class="cmd-log-msg" title="${_esc(e.message || "")}">${_esc(e.message || "")}</span>
    </div>`;
  }).join("");
}

function updateOpStrip(data) {
  const strip = $("opStrip");
  if (!strip) return;
  if (!data) { strip.classList.add("hidden"); return; }
  const p = data.personnel || {};
  const asgn = data.assignments || {};
  const completed  = asgn.COMPLETED || 0;
  const inprogress = (asgn.INPROGRESS || 0) + (asgn.PREPARED || 0);
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set("osAvail",      p.available ?? "—");
  set("osDeployed",   p.deployed  ?? "—");
  set("osReleased",   p.released  ?? "—");
  set("osTeams",      data.teamsActive ?? "—");
  set("osAsgnDone",   completed);
  set("osAsgnActive", inprogress);
  strip.classList.remove("hidden");
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
      localStorage.removeItem("sar_incident");
      setTopBarIncident("");
      incidentMsg.show("No incident selected.", "warning");
      updateLinkCheckboxVisibility();
      await loadIncidentSettings("");
      return;
    }

    incidentMsg.show(`Opening: ${val}…`, "info");

    try {
      await openIncident(val);
      sel.dataset.prev = val;
      localStorage.setItem("sar_incident", val);
      setTopBarIncident(val);
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
      clearOpPeriods();
    }
  });

  // Dashboard copy buttons
  function wireCopyBtn(btnId, buildUrl) {
    $(btnId)?.addEventListener("click", () => {
      const incident = getCurrentIncident();
      if (!incident) return;
      navigator.clipboard.writeText(buildUrl(incident)).then(() => {
        const btn = $(btnId);
        const orig = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = orig; }, 1500);
      });
    });
  }
  wireCopyBtn("dashboardIncidentCopy", inc => `${location.origin}/dashboard?incidentName=${encodeURIComponent(inc)}`);
  wireCopyBtn("dashboardKioskCopy",    inc => `${location.origin}/checkin?incidentName=${encodeURIComponent(inc)}`);

  $("dashboardKioskQr")?.addEventListener("click", () => {
    const inc = getCurrentIncident();
    if (!inc) return;
    window.open(`/checkin/qr?incidentName=${encodeURIComponent(inc)}`, "_blank");
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

  // CalTopo mode radios
  document.querySelectorAll('input[name="caltopoMode"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      const incident = getCurrentIncident();
      if (!incident) return;
      await saveSetting("caltopo_mode", radio.value);
      logUserEvent(incident, `CalTopo mode set to ${radio.value}`);
      const mapId = ($("mapId")?.value || "").trim();
      if (mapId) fetchCaltopoMapName(mapId, $("opSelect")?.value || null);
    });
  });

  $("opSelect")?.addEventListener("change", async (e) => {
    await saveSetting("selected_op_id", e.target.value || null);
    document.dispatchEvent(new CustomEvent("opSelectionChanged"));
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

  // Rename incident
  $("incidentRenameBtn")?.addEventListener("click", async () => {
    const incident = getCurrentIncident();
    if (!incident) return;
    const newName = (window.prompt("New incident name:", incident) || "").trim();
    if (!newName || newName === incident) return;
    incidentMsg.show("Renaming…", "info");
    try {
      const res = await fetch("/api/incident/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentName: incident, newName }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Rename failed");
      await loadIncidents(data.incidentName);
      const sel = $("incidentSelect");
      if (sel) sel.dataset.prev = data.incidentName;
      localStorage.setItem("sar_incident", data.incidentName);
      setTopBarIncident(data.incidentName);
      updateLinkCheckboxVisibility();
      incidentMsg.show(`Renamed to: ${data.incidentName}`, "info");
      window.dispatchEvent(new CustomEvent("sar:incident-selected"));
    } catch (err) {
      console.error(err);
      incidentMsg.show(`Rename failed: ${err.message}`, "error");
    }
  });

  // Export DB
  $("incidentExportBtn")?.addEventListener("click", () => {
    const incident = getCurrentIncident();
    if (!incident) return;
    window.location.href = `/api/incident/export?incidentName=${encodeURIComponent(incident)}`;
  });

  // Import DB
  $("incidentImportBtn")?.addEventListener("click", () => {
    $("incidentImportFile").value = "";
    $("incidentImportFile").click();
  });

  $("incidentImportFile")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    incidentMsg.show("Importing…", "info");
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch("/api/incident/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Import failed");
      await loadIncidents(data.incidentName);
      await openIncident(data.incidentName);
      localStorage.setItem("sar_incident", data.incidentName);
      setTopBarIncident(data.incidentName);
      updateLinkCheckboxVisibility();
      await loadIncidentSettings(data.incidentName);
      incidentMsg.show(`Imported: ${data.incidentName}`, "info");
      window.dispatchEvent(new CustomEvent("sar:incident-selected"));
    } catch (err) {
      console.error(err);
      incidentMsg.show(`Import failed: ${err.message}`, "error");
    }
  });

  // Change Incident button — switches back to selector view
  $("cmdChangeBtn")?.addEventListener("click", () => {
    showCommandDashboard("");
  });

  // Refresh dashboard whenever any module fires a data-change event
  window.addEventListener("sar:incident-selected", () => {
    const inc = getCurrentIncident();
    if (inc) loadCommandDashboard(inc);
  });

  watchHomeTab();
  loadSystemInfo();

  const savedIncident = localStorage.getItem("sar_incident") || "";
  await loadIncidents(savedIncident);
  if (savedIncident && $("incidentSelect")?.value === savedIncident) {
    try {
      await openIncident(savedIncident);
      setTopBarIncident(savedIncident);
      await loadIncidentSettings(savedIncident);
      updateLinkCheckboxVisibility();
      window.dispatchEvent(new CustomEvent("sar:incident-selected"));
    } catch (e) {
      console.warn("[home.js] Failed to restore incident:", e);
      localStorage.removeItem("sar_incident");
    }
  }
});

window.addEventListener("sar:online", () => {
  const sel = $("incidentSelect");
  const current = sel ? sel.value.trim() : "";
  loadIncidents(current);
});
