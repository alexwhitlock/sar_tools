/**
 * logging.js — Incident Log tab
 *
 * Exports:
 *   watchLoggingTab()         — call once on DOMContentLoaded
 *   logSystemEvent(name, msg) — fire-and-forget system log from other modules
 */

// ─── state ────────────────────────────────────────────────────────────────────

let _incident = null;
let _lastSelectedTeam = null;   // { id, name } of last-clicked team button

// ─── auto-transition config ───────────────────────────────────────────────────

const TRIGGER_STATUS_MAP = {
  "LEAVING FOR ASSIGNMENT":    "Travelling to Assignment",
  "ARRIVED AT ASSIGNMENT":     "On Assignment",
  "RETURNING FROM ASSIGNMENT": "Returning from Assignment",
  "ARRIVED AT ICP":            "Awaiting Debrief",
};

function _parseTeamLetters(teamField) {
  if (!teamField) return [];
  return [...String(teamField).replace(/[\s,\-]+/g, "")]
    .map(c => c.toUpperCase())
    .filter(c => /[A-Z]/.test(c));
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function _getIncident() {
  return document.getElementById("incidentSelect")?.value?.trim() || null;
}

/** SQLite timestamp "YYYY-MM-DD HH:MM:SS" (UTC) → local yyyy-mm-dd hh:mm:ss */
function _fmtDateTime(ts) {
  try {
    const d = new Date(ts.replace(" ", "T") + "Z");
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  } catch {
    return ts || "";
  }
}

/** SQLite timestamp "YYYY-MM-DD HH:MM:SS" (UTC) → local time string */
function _fmtTime(ts, showSeconds = true) {
  try {
    const d = new Date(ts.replace(" ", "T") + "Z");
    const opts = showSeconds
      ? { hour: "2-digit", minute: "2-digit", second: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
    return d.toLocaleTimeString("en-GB", opts);
  } catch {
    return ts || "";
  }
}

function _esc(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── sub-tab switching ────────────────────────────────────────────────────────

function _initSubtabs() {
  document.querySelectorAll(".logging-subtab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".logging-subtab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".logging-subtab-panel").forEach(p => p.classList.add("hidden"));
      btn.classList.add("active");
      const panel = document.getElementById(`subtab-${btn.dataset.subtab}`);
      if (panel) panel.classList.remove("hidden");
      if (btn.dataset.subtab === "view-log") _loadViewLog();
      if (btn.dataset.subtab === "comms-log") _loadCommsLog();
    });
  });
}

// ─── role toggle buttons ──────────────────────────────────────────────────────

function _initRoleButtons() {
  document.querySelectorAll(".role-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".role-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      _setDefaultType(btn.dataset.role);
    });
  });
}

function _getSelectedRole() {
  return document.querySelector(".role-btn.active")?.dataset.role || "COMMS";
}

function _initTypeButtons() {
  document.querySelectorAll(".type-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

function _getSelectedType() {
  return document.querySelector(".type-btn.active")?.dataset.type || "comms";
}

function _setDefaultType(role) {
  const defaultType = role === "COMMS" ? "comms" : "note";
  document.querySelectorAll(".type-btn").forEach(b => b.classList.remove("active"));
  document.querySelector(`.type-btn[data-type="${defaultType}"]`)?.classList.add("active");
}

// ─── comms log ────────────────────────────────────────────────────────────────

async function _loadCommsLog() {
  const incident = _getIncident();
  const container = document.getElementById("comms-log-entries");
  if (!container) return;

  if (!incident) {
    container.innerHTML = '<div class="log-empty">No incident selected.</div>';
    return;
  }

  try {
    const res = await fetch(`/incidents/${encodeURIComponent(incident)}/log?type=comms,system`);
    const data = await res.json();
    if (!data.success) return;
    _renderCommsEntries(container, data.log);
  } catch (err) {
    console.error("Failed to load comms log", err);
  }
}

function _renderCommsEntries(container, entries) {
  if (!entries.length) {
    container.innerHTML = '<div class="log-empty">No comms entries yet. Start logging below.</div>';
    return;
  }
  container.innerHTML = entries.map(e => {
    const important = e.flags && e.flags.includes("important");
    return `<div class="log-entry${important ? " log-entry-important" : ""}">
      <span class="log-time">${_fmtTime(e.timestamp, false)}</span>
      <span class="log-role log-role-${_esc(e.role.toLowerCase())}">${_esc(e.role)}</span>
      <span class="log-message">${_esc(e.message)}</span>
    </div>`;
  }).join("");
}

async function _autoTransitionTeam(incident, team, newStatus) {
  try {
    // Get caltopoMapId for this incident
    const settRes = await fetch(`/api/incident/settings?incidentName=${encodeURIComponent(incident)}`);
    const settData = await settRes.json();
    const mapId = settData.caltopoMapId;
    if (!mapId) return;

    // Fetch assignments and check for INPROGRESS assignment for this team
    const aRes = await fetch(`/api/assignments?mapId=${encodeURIComponent(mapId)}`);
    const assignments = await aRes.json();
    if (!Array.isArray(assignments)) return;

    const teamLetter = String(team.name).toUpperCase();
    const hasInProgress = assignments.some(a =>
      (a.status || "").toUpperCase() === "INPROGRESS" &&
      _parseTeamLetters(a.team).includes(teamLetter)
    );
    if (!hasInProgress) return;

    // Update team status
    await fetch("/api/teams/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentName: incident, teamId: team.id, status: newStatus }),
    });

    // Log system message
    await logSystemEvent(incident, `Team ${team.name} status changed to ${newStatus}`);
  } catch (err) {
    console.error("Auto-transition failed", err);
  }
}

async function _submitCommsLog() {
  const incident = _getIncident();
  if (!incident) return;

  const input = document.getElementById("comms-message-input");
  if (!input) return;

  const message = input.value.trim();
  if (!message) return;

  const role = _getSelectedRole();

  try {
    const important = document.getElementById("comms-important-star")?.classList.contains("active");
    const res = await fetch(`/incidents/${encodeURIComponent(incident)}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, type: _getSelectedType(), message, flags: important ? "important" : null }),
    });
    const data = await res.json();
    if (data.success) {
      input.value = "";
      input.style.height = "";   // reset any manual resize
      const clearBtn = document.getElementById("comms-clear-btn");
      if (clearBtn) clearBtn.disabled = true;
      const star = document.getElementById("comms-important-star");
      if (star) { star.classList.remove("active"); star.textContent = "☆"; }

      // Show the new entry immediately, before auto-transition fires
      await _loadCommsLog();

      // Auto-transition team status if enabled
      const autoChk = document.getElementById("auto-transition-chk");
      if (autoChk?.checked && _lastSelectedTeam) {
        const upperMsg = message.toUpperCase();
        for (const [trigger, newStatus] of Object.entries(TRIGGER_STATUS_MAP)) {
          if (upperMsg.includes(trigger)) {
            await _autoTransitionTeam(incident, _lastSelectedTeam, newStatus);
            await _loadCommsLog();   // pick up the system message once it's written
            break;
          }
        }
      }
    }
  } catch (err) {
    console.error("Failed to submit log entry", err);
  }
}

// ─── comms builder ────────────────────────────────────────────────────────────

function _initBuilder() {
  // Insert-text buttons (excludes role-btn — handled separately)
  document.querySelectorAll(".builder-btn:not(.role-btn)").forEach(btn => {
    btn.addEventListener("click", () => {
      const input = document.getElementById("comms-message-input");
      if (!input || !btn.dataset.insert) return;
      input.value += btn.dataset.insert;
    });
  });
}

const INACTIVE_STATUSES = new Set(["Retired"]);

async function _populateTeamButtons() {
  const incident = _getIncident();
  const list = document.getElementById("comms-teams-list");
  if (!list || !incident) return;

  try {
    const res = await fetch(`/api/teams?incidentName=${encodeURIComponent(incident)}`);
    const teams = await res.json();
    if (!Array.isArray(teams)) return;

    list.innerHTML = "";

    const active = teams.filter(t => !INACTIVE_STATUSES.has(t.status));

    if (!active.length) {
      list.innerHTML = '<div class="log-empty" style="font-size:0.72rem">No active teams</div>';
      return;
    }

    active.forEach(t => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "builder-btn team-col-btn";
      btn.dataset.insert = `TEAM ${t.name} `;
      btn.textContent = `Team ${t.name}`;
      btn.addEventListener("click", () => {
        const input = document.getElementById("comms-message-input");
        if (input) input.value += btn.dataset.insert;
        _lastSelectedTeam = { id: t.id, name: t.name };
      });
      list.appendChild(btn);
    });
  } catch (err) {
    console.error("Failed to load teams for builder", err);
  }
}

// ─── view log ─────────────────────────────────────────────────────────────────

async function _loadViewLog() {
  const incident = _getIncident();
  const tbody = document.getElementById("viewlog-body");
  if (!tbody) return;

  if (!incident) {
    tbody.innerHTML = '<tr><td colspan="4" class="log-empty-cell">No incident selected.</td></tr>';
    return;
  }

  const search = document.getElementById("viewlog-search")?.value || "";
  const typeFilter = document.getElementById("viewlog-type-filter")?.value || "";
  const roleFilter = document.getElementById("viewlog-role-filter")?.value || "";

  let url = `/incidents/${encodeURIComponent(incident)}/log`;
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (typeFilter) params.set("type", typeFilter);
  if (roleFilter) params.set("role", roleFilter);
  params.set("order", "desc");
  if (params.toString()) url += `?${params}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) return;
    _renderViewLog(tbody, data.log);
  } catch (err) {
    console.error("Failed to load view log", err);
  }
}

function _renderViewLog(tbody, entries) {
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="log-empty-cell">No log entries.</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(e => {
    const important = e.flags && e.flags.includes("important");
    return `<tr class="${important ? "log-row-important" : ""}">
      <td class="log-col-star"><button class="row-star-btn${important ? " active" : ""}" data-log-id="${e.id}">${important ? "★" : "☆"}</button></td>
      <td class="log-col-time">${_fmtDateTime(e.timestamp)}</td>
      <td class="log-col-role log-role-${_esc(e.role.toLowerCase())}">${_esc(e.role)}</td>
      <td class="log-col-type">${_esc(e.type)}</td>
      <td>${_esc(e.message)}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll(".row-star-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const incident = _getIncident();
      if (!incident) return;
      await fetch(`/incidents/${encodeURIComponent(incident)}/log/${btn.dataset.logId}/important`, { method: "POST" });
      _loadViewLog();
      _loadCommsLog();
    });
  });
}

function _exportCSV() {
  const incident = _getIncident();
  if (!incident) return;
  window.open(`/incidents/${encodeURIComponent(incident)}/log/export`, "_blank");
}

// ─── public API ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: write a SYSTEM-role log entry from any other JS module.
 * Usage: import { logSystemEvent } from "./logging.js";
 *        logSystemEvent(incidentName, "Team Alpha status → On Assignment");
 */
/** Called by global-sync after each team refresh */
export function refreshCommsTeams() {
  _populateTeamButtons();
}

/** Called by global-sync to refresh log panels */
export function refreshLogPanels() {
  _loadCommsLog();
  const viewPanel = document.getElementById("subtab-view-log");
  if (viewPanel && !viewPanel.classList.contains("hidden")) _loadViewLog();
}

export async function logSystemEvent(incidentName, message) {
  if (!incidentName) return;
  try {
    await fetch(`/incidents/${encodeURIComponent(incidentName)}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "SYSTEM", type: "system", message }),
    });
  } catch {
    // best-effort; never throw
  }
}

// ─── bootstrap ────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  watchLoggingTab();
});

export function watchLoggingTab() {
  _initSubtabs();
  _initRoleButtons();
  _initTypeButtons();
  _initBuilder();

  // Important star toggle
  document.getElementById("comms-important-star")?.addEventListener("click", () => {
    const star = document.getElementById("comms-important-star");
    const on = star.classList.toggle("active");
    star.textContent = on ? "★" : "☆";
  });

  // Clear button — enabled/red when input has text
  const _clearBtn = document.getElementById("comms-clear-btn");
  const _msgInput = document.getElementById("comms-message-input");
  function _updateClearBtn() {
    if (_clearBtn) _clearBtn.disabled = !_msgInput?.value.length;
  }
  _msgInput?.addEventListener("input", _updateClearBtn);
  _clearBtn?.addEventListener("click", () => {
    if (_msgInput) { _msgInput.value = ""; _msgInput.style.height = ""; }
    _updateClearBtn();
  });

  // Log button — Ctrl+Enter in textarea also submits
  document.getElementById("comms-log-btn")?.addEventListener("click", _submitCommsLog);
  document.getElementById("comms-message-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) _submitCommsLog();
  });

  // View log: live search & type filter
  document.getElementById("viewlog-search")?.addEventListener("input", _loadViewLog);
  document.getElementById("viewlog-type-filter")?.addEventListener("change", _loadViewLog);
  document.getElementById("viewlog-role-filter")?.addEventListener("change", _loadViewLog);

  // Export
  document.getElementById("viewlog-export-btn")?.addEventListener("click", _exportCSV);

  // React to incident selection
  document.getElementById("incidentSelect")?.addEventListener("change", () => {
    _incident = _getIncident();
    _loadCommsLog();
    _populateTeamButtons();
  });

  // Activate when tab becomes visible
  const panel = document.getElementById("logging");
  if (panel) {
    new MutationObserver(() => {
      if (panel.classList.contains("active")) {
        _incident = _getIncident();
        _loadCommsLog();
        _populateTeamButtons();
        const viewPanel = document.getElementById("subtab-view-log");
        if (viewPanel && !viewPanel.classList.contains("hidden")) _loadViewLog();
      }
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  }
}
