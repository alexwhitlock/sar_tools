import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";

const TEAM_STATUSES = [
  "Out of Service",
  "Staged",
  "Travelling to Assignment",
  "On Assignment",
  "Returning from Assignment",
  "Awaiting Debrief",
  "Retired",
];

const IN_PROGRESS_TEAM_STATES = new Set([
  "Travelling to Assignment",
  "On Assignment",
  "Returning from Assignment",
  "Awaiting Debrief",
]);

const STATUS_BADGE_CLASS = {
  "Out of Service":            "ts-badge-oos",
  "Staged":                    "ts-badge-staged",
  "Travelling to Assignment":  "ts-badge-travelling",
  "On Assignment":             "ts-badge-on-assignment",
  "Returning from Assignment": "ts-badge-returning",
  "Awaiting Debrief":          "ts-badge-debrief",
  "Retired":                   "ts-badge-retired",
};

let teamsTable = null;
let teamsMessage = null;
let teamsCache = [];

// Modal state
let modalMode = "create";   // "create" | "edit"
let activeTeamId = null;
let modalMembers = [];      // [{id, name}] — current member list being edited
let originalMemberIds = new Set();
let allPersonnel = [];      // full incident personnel list (for add-member dropdown)

// View state
let currentView = "table";        // "table" | "kanban"
let kanbanAssignments = [];       // CalTopo assignment data (optional)
const collapsedStatuses = new Set(); // statuses whose kanban column is collapsed

// Touch drag-and-drop state
let _touchTeamId   = null;
let _touchGhost    = null;
let _touchTargetCol = null;
let _touchOffsetX  = 0;
let _touchOffsetY  = 0;

/* ===============================
   Helpers
   =============================== */

function getCurrentIncidentName() {
  const sel = document.getElementById("incidentSelect");
  return sel ? sel.value.trim() : "";
}

function getCurrentMapId() {
  const el = document.getElementById("mapId");
  return el ? el.value.trim() : "";
}

function requireIncidentOrError() {
  const incidentName = getCurrentIncidentName();
  if (!incidentName) {
    if (teamsTable) teamsTable.setData([]);
    if (teamsMessage) {
      teamsMessage.show(
        "No incident selected. Go to Home and select (or create) an incident.",
        "error"
      );
    }
    return "";
  }
  return incidentName;
}

/**
 * Validate a proposed team status change against assignment rules.
 * Returns an error string if the change should be blocked, null if OK.
 */
function validateTeamStatusChange(team, newStatus) {
  const hasInProgress = getInProgressAssignmentsForTeam(team.name).length > 0;

  // Can't enter an in-progress state without an active assignment
  if (IN_PROGRESS_TEAM_STATES.has(newStatus) && !hasInProgress) {
    return `Team ${team.name} cannot be set to "${newStatus}" — they have no in-progress CalTopo assignment.`;
  }

  // Can't leave an in-progress state while still on an active assignment
  if (!IN_PROGRESS_TEAM_STATES.has(newStatus) && IN_PROGRESS_TEAM_STATES.has(team.status) && hasInProgress) {
    return `Team ${team.name} is still assigned to an in-progress assignment. Complete the assignment in CalTopo before changing status to "${newStatus}".`;
  }

  return null;
}

function updateAddButtonEnabled() {
  const btn = document.getElementById("team-add");
  if (btn) btn.disabled = !getCurrentIncidentName();
}

/** Parse "id:name|id:name" member_data string into [{id, name}] array. */
function parseMemberData(memberData) {
  if (!memberData) return [];
  return memberData.split("|").filter(Boolean).map(s => {
    const colon = s.indexOf(":");
    return colon > -1 ? { id: parseInt(s.slice(0, colon)), name: s.slice(colon + 1) } : null;
  }).filter(Boolean);
}

/** Build members tooltip: TL first with "(TL)", rest alphabetically. */
function memberTooltip(team) {
  const members = parseMemberData(team.memberData);
  if (!members.length) return "No members";
  const tlId = team.teamLeaderId ? String(team.teamLeaderId) : null;
  const tl    = tlId ? members.find(m => String(m.id) === tlId) : null;
  const rest  = members
    .filter(m => !tl || String(m.id) !== tlId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    ...(tl   ? [`${tl.name} (TL)`] : []),
    ...rest.map(m => m.name),
  ];
  return lines.map(l => escapeHtml(l)).join("&#10;");
}

/**
 * Build a single lowercase searchable string for a team covering all
 * meaningful text: name, status, TL, members, in-progress assignments.
 * Called after kanbanAssignments is populated so assignment data is included.
 */
function buildTeamSearchText(team) {
  const memberNames = parseMemberData(team.memberData).map(m => m.name);
  const assignmentNums = getInProgressAssignmentsForTeam(team.name)
    .map(a => `assignment ${a.number ?? ""}`);
  return [
    team.name ? `team ${team.name}` : "",
    team.status || "",
    team.teamLeaderName || "",
    ...memberNames,
    ...assignmentNums,
  ].join(" ").toLowerCase();
}

/** Build members column HTML: TL first with "(TL)", rest alphabetically, one per line. */
function memberListHtml(team) {
  const members = parseMemberData(team.memberData);
  if (!members.length) return "—";
  const tlId = team.teamLeaderId ? String(team.teamLeaderId) : null;
  const tl   = tlId ? members.find(m => String(m.id) === tlId) : null;
  const rest = members
    .filter(m => !tl || String(m.id) !== tlId)
    .sort((a, b) => a.name.localeCompare(b.name));
  const lines = [
    ...(tl   ? [`${tl.name} (TL)`] : []),
    ...rest.map(m => m.name),
  ];
  return lines.map(l => escapeHtml(l)).join("<br>");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function findTeamInCache(teamId) {
  return teamsCache.find(t => String(t.id) === String(teamId)) || null;
}

/* ===============================
   API helpers
   =============================== */

async function apiPost(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return data;
}

async function apiLoadTeams(incidentName) {
  const resp = await fetch(`/api/teams?incidentName=${encodeURIComponent(incidentName)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
  return Array.isArray(data) ? data : [];
}


async function apiLoadPersonnel(incidentName) {
  const resp = await fetch(`/api/personnel?incidentName=${encodeURIComponent(incidentName)}`);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return Array.isArray(data) ? data : [];
}

/* ===============================
   Table row renderer
   =============================== */

function renderTeamRow(t) {
  const badgeClass = STATUS_BADGE_CLASS[t.status] || "ts-badge-oos";
  const inProgress = getInProgressAssignmentsForTeam(t.name);

  let assignmentHtml;
  if (inProgress.length === 0) {
    assignmentHtml = "—";
  } else if (inProgress.length === 1) {
    assignmentHtml = escapeHtml(`Assignment ${inProgress[0].number ?? "?"}`);
  } else {
    const nums = inProgress.map(a => a.number ?? "?").join(", ");
    const tip  = escapeHtml(
      `Team ${t.name} has ${inProgress.length} in-progress assignments (${nums}). Only one should be active at a time.`
    );
    assignmentHtml = `Assignment ${escapeHtml(nums)} <span class="conflict-warn" title="${tip}">⚠</span>`;
  }

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${escapeHtml(t.name)}</td>
    <td><span class="ts-badge ${badgeClass}">${escapeHtml(t.status)}</span></td>
    <td>${escapeHtml(t.teamLeaderName || "—")}</td>
    <td title="${memberTooltip(t)}" style="cursor:help">${t.memberCount ?? 0}</td>
    <td class="col-members">${memberListHtml(t)}</td>
    <td>${assignmentHtml}</td>
    <td class="actions-cell">
      <button
        type="button"
        class="team-menu-btn"
        data-team-id="${escapeHtml(t.id)}"
        title="Actions"
        aria-label="Actions">⋮</button>
    </td>
  `;
  return tr;
}

/* ===============================
   Data loading
   =============================== */

async function loadTeams() {
  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  teamsMessage.show("Loading teams…", "info");

  try {
    const teams = await apiLoadTeams(incidentName);
    teamsCache = teams;

    if (!teams.length) {
      teamsMessage.show("No teams yet. Click + Team to create one.", "info");
    } else {
      // Keep "Loading teams…" until assignment checks are also done
      const countLabel = `${teams.length} team${teams.length !== 1 ? "s" : ""}.`;
      const warnings = [];

      const mapId = getCurrentMapId();
      if (mapId) {
        try {
          const resp = await fetch(`/api/assignments?mapId=${encodeURIComponent(mapId)}`);
          if (resp.ok) kanbanAssignments = await resp.json().catch(() => []);
        } catch (_) { /* assignment enrichment is optional */ }

        const conflicts = findAssignmentConflicts(kanbanAssignments);
        if (conflicts.size > 0) {
          const detail = [...conflicts.entries()]
            .map(([letter, nums]) => `Team ${letter} (assignments ${nums.join(", ")})`)
            .join("; ");
          warnings.push(`Multiple in-progress assignments: ${detail}`);
        }

        const missing = findMissingTeams(kanbanAssignments, teamsCache);
        if (missing.length > 0) {
          warnings.push(`Teams in CalTopo not in database: ${missing.join(", ")}`);
        }

        // Warn if any team is OOS but has an in-progress CalTopo assignment
        const oosWithAssignment = teamsCache.filter(t =>
          t.status === "Out of Service" && getInProgressAssignmentsForTeam(t.name).length > 0
        );
        if (oosWithAssignment.length > 0) {
          const names = oosWithAssignment.map(t => `Team ${t.name}`).join(", ");
          warnings.push(`${names} marked Out of Service but assigned to an in-progress assignment`);
        }
      }

      if (warnings.length > 0) {
        teamsMessage.show(`${countLabel} ⚠ ${warnings.join(" — ")}`, "warning");
      } else {
        teamsMessage.show(countLabel, "info");
      }
    }

    // Build searchText on every team after assignments are available
    teams.forEach(t => { t.searchText = buildTeamSearchText(t); });

    if (currentView === "table") {
      teamsTable.setData(teams);
    } else {
      renderKanban(teams);
    }
  } catch (err) {
    logMessage("ERROR", "Failed to load teams", err.message);
    teamsCache = [];
    if (teamsTable) teamsTable.setData([]);
    teamsMessage.show(`Failed to load teams: ${err.message}`, "error");
  }
}

/* ===============================
   Kanban
   =============================== */

/**
 * Parse a CalTopo assignment team field into individual single-letter codes.
 * Handles "ABC", "A,B,C", "A-B-C", "A, B, C", etc.
 */
function parseAssignmentTeamLetters(teamField) {
  if (!teamField) return [];
  // Strip delimiters (comma, hyphen, space) then split into individual chars
  return [...String(teamField).replace(/[\s,\-]+/g, "")]
    .map(c => c.toUpperCase())
    .filter(c => /[A-Z]/.test(c));
}

/**
 * Return all in-progress assignments for a given single-letter team name.
 * Used by the table view and conflict detection.
 */
function getInProgressAssignmentsForTeam(teamName) {
  if (!kanbanAssignments.length || !teamName) return [];
  const letter = String(teamName).trim().toUpperCase();
  if (letter.length !== 1 || !/[A-Z]/.test(letter)) return [];
  return kanbanAssignments.filter(a => {
    if ((a.status || "").toUpperCase() !== "INPROGRESS") return false;
    return parseAssignmentTeamLetters(a.team).includes(letter);
  });
}

/**
 * Find single-letter team codes referenced in non-completed assignments
 * that don't exist in the local teams DB.
 * Returns sorted string[].
 */
function findMissingTeams(assignments, teams) {
  const dbLetters = new Set(
    teams
      .map(t => String(t.name).trim().toUpperCase())
      .filter(n => n.length === 1 && /[A-Z]/.test(n))
  );
  const missing = new Set();
  for (const a of (assignments || [])) {
    if ((a.status || "").toUpperCase() === "COMPLETED") continue;
    for (const letter of parseAssignmentTeamLetters(a.team)) {
      if (!dbLetters.has(letter)) missing.add(letter);
    }
  }
  return [...missing].sort();
}

/**
 * Find single-letter teams that appear in more than one INPROGRESS assignment.
 * Returns Map<letter, number[]>.
 */
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


/* ===============================
   Touch drag-and-drop
   =============================== */

function _touchCleanup(card) {
  if (_touchGhost) { _touchGhost.remove(); _touchGhost = null; }
  if (card) card.style.opacity = "";
  document.querySelectorAll(".kanban-col.drag-over").forEach(c => c.classList.remove("drag-over"));
  _touchTargetCol = null;
  _touchTeamId   = null;
}

function wireTouchDnd(card, teamId) {
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect  = card.getBoundingClientRect();

    _touchTeamId  = String(teamId);
    _touchOffsetX = touch.clientX - rect.left;
    _touchOffsetY = touch.clientY - rect.top;

    _touchGhost = card.cloneNode(true);
    Object.assign(_touchGhost.style, {
      position:      "fixed",
      left:          `${rect.left}px`,
      top:           `${rect.top}px`,
      width:         `${rect.width}px`,
      margin:        "0",
      pointerEvents: "none",
      opacity:       "0.85",
      zIndex:        "9999",
      boxShadow:     "0 6px 16px rgba(0,0,0,0.25)",
      transform:     "rotate(2deg)",
    });
    document.body.appendChild(_touchGhost);
    card.style.opacity = "0.3";

    e.preventDefault();
  }, { passive: false });

  card.addEventListener("touchmove", (e) => {
    if (!_touchGhost || e.touches.length !== 1) return;
    const touch = e.touches[0];

    _touchGhost.style.left = `${touch.clientX - _touchOffsetX}px`;
    _touchGhost.style.top  = `${touch.clientY - _touchOffsetY}px`;

    // Briefly hide ghost so elementFromPoint sees what's underneath
    _touchGhost.style.visibility = "hidden";
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    _touchGhost.style.visibility = "";

    const col = el?.closest(".kanban-col");
    document.querySelectorAll(".kanban-col.drag-over").forEach(c => c.classList.remove("drag-over"));
    if (col) { col.classList.add("drag-over"); _touchTargetCol = col; }
    else      { _touchTargetCol = null; }

    e.preventDefault();
  }, { passive: false });

  card.addEventListener("touchend", async () => {
    const col    = _touchTargetCol;
    const teamId = _touchTeamId;
    _touchCleanup(card);
    if (!col || !teamId) return;

    const newStatus    = col.dataset.status;
    const team         = findTeamInCache(teamId);
    if (!team || team.status === newStatus) return;

    const incidentName = getCurrentIncidentName();
    if (!incidentName) return;

    const err = validateTeamStatusChange(team, newStatus);
    if (err) { teamsMessage.show(`⚠ ${err}`, "error", 6000); return; }

    try {
      await apiPost("/api/teams/update", { incidentName, teamId: parseInt(teamId), status: newStatus });
      team.status = newStatus;
      renderKanban(teamsCache);
    } catch (err) {
      teamsMessage.show(`Failed to update status: ${err.message}`, "error");
    }
  });

  card.addEventListener("touchcancel", () => _touchCleanup(card));
}


function renderKanban(teams) {
  const container = document.getElementById("teams-kanban-view");
  if (!container) return;

  const searchVal = (document.getElementById("teams-search")?.value || "").toLowerCase();
  container.innerHTML = "";

  for (const status of TEAM_STATUSES.filter(s => s !== "Retired")) {
    const col = document.createElement("div");
    col.className = "kanban-col";
    col.dataset.status = status;
    if (collapsedStatuses.has(status)) col.classList.add("collapsed");

    const statusTeams = teams
      .filter(t => t.status === status)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    col.innerHTML = `
      <div class="kanban-col-header">
        <span class="kanban-col-label">${escapeHtml(status)}</span>
        <span class="kanban-col-count">${statusTeams.length}</span>
      </div>
      <div class="kanban-col-cards"></div>
    `;

    // Toggle collapse on header click
    col.querySelector(".kanban-col-header").addEventListener("click", () => {
      if (collapsedStatuses.has(status)) {
        collapsedStatuses.delete(status);
      } else {
        collapsedStatuses.add(status);
      }
      renderKanban(teamsCache);
    });

    const cardsEl = col.querySelector(".kanban-col-cards");

    for (const team of statusTeams) {
      const inProgress = getInProgressAssignmentsForTeam(team.name);

      let assignmentHtml;
      if (inProgress.length === 0) {
        assignmentHtml = "Not Assigned";
      } else if (inProgress.length === 1) {
        assignmentHtml = escapeHtml(`Assignment ${inProgress[0].number ?? "?"}`);
      } else {
        const nums = inProgress.map(a => a.number ?? "?").join(", ");
        const tip  = escapeHtml(
          `Team ${team.name} has ${inProgress.length} in-progress assignments (${nums}). Only one should be active at a time.`
        );
        assignmentHtml = `Assignment ${escapeHtml(nums)} <span class="conflict-warn" title="${tip}">⚠</span>`;
      }

      const card = document.createElement("div");
      card.className = "kanban-card";
      card.setAttribute("draggable", "true");
      card.dataset.teamId = team.id;

      if (searchVal && !(team.searchText || "").includes(searchVal)) {
        card.classList.add("search-hidden");
      }

      card.innerHTML = `
        <div class="kanban-card-header">
          <span class="kanban-card-name">Team ${escapeHtml(team.name)}</span>
          <span class="kanban-card-members" title="${memberTooltip(team)}">${team.memberCount ?? 0} Members</span>
        </div>
        <div class="kanban-card-tl">TL: ${escapeHtml(team.teamLeaderName || "None")}</div>
        <div class="kanban-card-assignment">${assignmentHtml}</div>
      `;

      // Drag source
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", String(team.id));
        e.dataTransfer.effectAllowed = "move";
        card.classList.add("dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("dragging");
      });

      wireTouchDnd(card, team.id);

      cardsEl.appendChild(card);
    }

    // Drop target
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    });
    col.addEventListener("dragleave", (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove("drag-over");
    });
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const teamId = e.dataTransfer.getData("text/plain");
      const newStatus = col.dataset.status;
      const team = findTeamInCache(teamId);
      if (!team || team.status === newStatus) return;
      const incidentName = getCurrentIncidentName();
      if (!incidentName) return;
      const err = validateTeamStatusChange(team, newStatus);
      if (err) { teamsMessage.show(`⚠ ${err}`, "error"); return; }
      try {
        await apiPost("/api/teams/update", { incidentName, teamId: parseInt(teamId), status: newStatus });
        team.status = newStatus;
        renderKanban(teamsCache);
      } catch (err) {
        teamsMessage.show(`Failed to update status: ${err.message}`, "error");
      }
    });

    container.appendChild(col);
  }
}

/* ===============================
   View toggle
   =============================== */

function switchView(view) {
  currentView = view;

  const tableView        = document.getElementById("teams-table-view");
  const kanbanView       = document.getElementById("teams-kanban-view");
  const statusFilterGroup  = document.getElementById("teams-status-filter-group");
  const colTogglesGroup    = document.getElementById("teams-col-toggles");
  const tableBtn           = document.getElementById("view-table-btn");
  const kanbanBtn          = document.getElementById("view-kanban-btn");
  const addBtn             = document.getElementById("team-add");
  const toolbar            = document.querySelector(".teams-toolbar");
  const filtersRow         = document.querySelector(".teams-filters");
  const searchGroup        = document.getElementById("teams-search-group");

  if (view === "table") {
    tableView?.classList.remove("hidden");
    kanbanView?.classList.add("hidden");
    if (statusFilterGroup) statusFilterGroup.style.display = "";
    if (colTogglesGroup)   colTogglesGroup.style.display   = "";
    if (addBtn) addBtn.style.display = "";
    if (filtersRow) filtersRow.style.display = "";
    tableBtn?.classList.add("active");
    kanbanBtn?.classList.remove("active");
    // Move search back into filters row
    if (searchGroup && filtersRow && searchGroup.parentElement !== filtersRow) {
      filtersRow.prepend(searchGroup);
    }
    teamsTable.setData(teamsCache);
  } else {
    tableView?.classList.add("hidden");
    kanbanView?.classList.remove("hidden");
    if (statusFilterGroup) statusFilterGroup.style.display = "none";
    if (colTogglesGroup)   colTogglesGroup.style.display   = "none";
    if (addBtn) addBtn.style.display = "none";
    if (filtersRow) filtersRow.style.display = "none";
    tableBtn?.classList.remove("active");
    kanbanBtn?.classList.add("active");
    // Move search into toolbar (before the view toggle)
    if (searchGroup && toolbar) {
      const toggle = toolbar.querySelector(".view-toggle");
      toolbar.insertBefore(searchGroup, toggle);
    }
    renderKanban(teamsCache);
  }
}

/* ===============================
   Filters
   =============================== */

function wireFilters() {
  // Search
  const searchInput = document.getElementById("teams-search");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const val = e.target.value;
      if (currentView === "table") {
        teamsTable.setFilter("searchText", val);
      } else {
        const lower = val.toLowerCase();
        const cards = document.querySelectorAll("#teams-kanban-view .kanban-card");
        cards.forEach(card => {
          const team = findTeamInCache(card.dataset.teamId);
          const match = !lower || (team?.searchText || "").includes(lower);
          card.classList.toggle("search-hidden", !match);
        });
      }
    });
  }

  // Members column toggle
  const membersToggle = document.getElementById("toggle-members");
  if (membersToggle) {
    const tableEl = document.querySelector(".teams-data-table");
    membersToggle.addEventListener("change", () => {
      tableEl?.classList.toggle("show-members", membersToggle.checked);
    });
  }

  // Status pills (table only — hidden in kanban)
  const teamsPanel = document.getElementById("teams");
  const statusPillGroup = teamsPanel?.querySelector(".teams-pill-group[data-filter-key='status']");
  if (statusPillGroup) {
    statusPillGroup.addEventListener("change", () => {
      const values = Array.from(statusPillGroup.querySelectorAll("input:checked")).map(cb => cb.value);
      teamsTable.setFilter("status", values, "in");
    });
  }
}

/* ===============================
   Kebab menu
   =============================== */

let activeMenuTeamId = null;

function openTeamMenu(anchorBtn, teamId) {
  const menu = document.getElementById("teamMenu");
  if (!menu) return;

  activeMenuTeamId = teamId;
  menu.classList.remove("hidden");

  const rect = anchorBtn.getBoundingClientRect();
  const gapY = 4;

  let top = rect.bottom + gapY;
  let left = rect.left - 2;
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  const mRect = menu.getBoundingClientRect();
  if (mRect.right > window.innerWidth - 8) {
    menu.style.left = `${window.innerWidth - mRect.width - 8}px`;
  }
  if (mRect.bottom > window.innerHeight - 8) {
    menu.style.top = `${rect.top - mRect.height - gapY}px`;
  }
}

function closeTeamMenu() {
  const menu = document.getElementById("teamMenu");
  if (menu) menu.classList.add("hidden");
}

/* ===============================
   Modal — member management helpers
   =============================== */

function refreshMemberUI() {
  const listEl = document.getElementById("teamMembersList");
  const leaderSelect = document.getElementById("teamLeader");
  const addSelect = document.getElementById("teamMemberAdd");

  if (!listEl || !leaderSelect || !addSelect) return;

  // Render member rows
  listEl.innerHTML = "";
  for (const m of modalMembers) {
    const row = document.createElement("div");
    row.className = "team-member-row";
    row.dataset.personId = m.id;
    row.innerHTML = `
      <span>${escapeHtml(m.name)}</span>
      <button type="button" class="team-member-remove" data-person-id="${m.id}" title="Remove">✕</button>
    `;
    listEl.appendChild(row);
  }

  // Rebuild TL select
  const currentLeader = leaderSelect.value;
  leaderSelect.innerHTML = '<option value="">— None —</option>';
  for (const m of modalMembers) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.name;
    leaderSelect.appendChild(opt);
  }
  leaderSelect.value = modalMembers.some(m => String(m.id) === currentLeader) ? currentLeader : "";

  // Rebuild add-member select: only Checked In people with no team assignment
  const memberIds = new Set(modalMembers.map(m => String(m.id)));
  addSelect.innerHTML = '<option value="">— Add member —</option>';
  for (const p of allPersonnel) {
    if (memberIds.has(String(p.id))) continue;          // already a member
    if (p.status !== "Checked In") continue;            // must be checked in
    if (p.team) continue;                               // must be unassigned
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    addSelect.appendChild(opt);
  }
}

/* ===============================
   Modal open/close
   =============================== */

async function openTeamModal(mode, team = null) {
  const backdrop = document.getElementById("teamModalBackdrop");
  const titleEl = document.getElementById("teamModalTitle");
  const nameInput = document.getElementById("teamName");
  const statusSelect = document.getElementById("teamStatus");
  if (!backdrop || !titleEl || !nameInput || !statusSelect) return;

  modalMode = mode;
  activeTeamId = team?.id ?? null;

  titleEl.textContent = mode === "create" ? "Create Team" : "Edit Team";
  nameInput.value = team?.name ?? "";
  statusSelect.value = team?.status ?? "Out of Service";

  const incidentName = getCurrentIncidentName();

  // Load all personnel
  try {
    allPersonnel = await apiLoadPersonnel(incidentName);
  } catch (_) {
    allPersonnel = [];
  }

  // Members are already in the team object from list_teams — no extra API call needed
  modalMembers = mode === "edit" ? parseMemberData(team?.memberData) : [];
  originalMemberIds = new Set(modalMembers.map(m => String(m.id)));

  refreshMemberUI();

  // Pre-select TL
  if (team?.teamLeaderId) {
    const leaderSelect = document.getElementById("teamLeader");
    if (leaderSelect) leaderSelect.value = team.teamLeaderId;
  }

  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  nameInput.focus();
}

function closeTeamModal() {
  const backdrop = document.getElementById("teamModalBackdrop");
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  modalMembers = [];
  originalMemberIds = new Set();
  allPersonnel = [];
  activeTeamId = null;
}

/* ===============================
   Modal save
   =============================== */

async function saveTeamModal() {
  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  const name = (document.getElementById("teamName")?.value || "").trim();
  const status = document.getElementById("teamStatus")?.value || "Out of Service";
  const teamLeaderId = document.getElementById("teamLeader")?.value || null;

  if (!name) {
    window.alert("Team name is required.");
    document.getElementById("teamName")?.focus();
    return;
  }

  // Validate status change rules for edits (create always starts at the chosen status with no assignment)
  if (modalMode === "edit") {
    const currentTeam = teamsCache.find(t => t.id === activeTeamId);
    if (currentTeam && currentTeam.status !== status) {
      const err = validateTeamStatusChange(currentTeam, status);
      if (err) {
        teamsMessage.show(`⚠ ${err}`, "error", 6000);
        return;
      }
    }
  }

  teamsMessage.show(modalMode === "create" ? "Creating team…" : "Saving changes…", "info");

  try {
    let teamId = activeTeamId;

    if (modalMode === "create") {
      const result = await apiPost("/api/teams/create", { incidentName, name });
      teamId = result.id;
    } else {
      await apiPost("/api/teams/update", {
        incidentName,
        teamId,
        name,
        status,
        teamLeaderId: teamLeaderId ? parseInt(teamLeaderId) : null,
      });
    }

    // Apply member changes
    const currentMemberIds = new Set(modalMembers.map(m => String(m.id)));

    // Adds: in current but not in original
    for (const id of currentMemberIds) {
      if (!originalMemberIds.has(id)) {
        await apiPost("/api/teams/assign-person", { incidentName, teamId, personId: parseInt(id) });
      }
    }

    // Removes: in original but not in current
    for (const id of originalMemberIds) {
      if (!currentMemberIds.has(id)) {
        await apiPost("/api/teams/remove-person", { incidentName, personId: parseInt(id) });
      }
    }

    // For create: now update with status + TL (can only set after team exists and members assigned)
    if (modalMode === "create") {
      await apiPost("/api/teams/update", {
        incidentName,
        teamId,
        status,
        teamLeaderId: teamLeaderId ? parseInt(teamLeaderId) : null,
      });
    }

    closeTeamModal();
    await loadTeams();
    teamsMessage.show(modalMode === "create" ? "Team created." : "Changes saved.", "info");
  } catch (err) {
    logMessage("ERROR", "Failed to save team", err.message);
    teamsMessage.show(`Failed to save: ${err.message}`, "error");
  }
}

/* ===============================
   Modal event wiring
   =============================== */

function wireModal() {
  const backdrop = document.getElementById("teamModalBackdrop");
  const closeBtn = document.getElementById("teamModalClose");
  const cancelBtn = document.getElementById("teamModalCancel");
  const saveBtn = document.getElementById("teamModalSave");
  const membersList = document.getElementById("teamMembersList");
  const addSelect = document.getElementById("teamMemberAdd");

  if (!backdrop || !closeBtn || !cancelBtn || !saveBtn) {
    logMessage("ERROR", "Missing team modal HTML elements.");
    return;
  }

  closeBtn.addEventListener("click", closeTeamModal);
  cancelBtn.addEventListener("click", closeTeamModal);
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeTeamModal(); });
  saveBtn.addEventListener("click", saveTeamModal);

  // Remove member via delegation
  membersList?.addEventListener("click", (e) => {
    const btn = e.target.closest(".team-member-remove");
    if (!btn) return;
    const personId = String(btn.dataset.personId);
    modalMembers = modalMembers.filter(m => String(m.id) !== personId);
    refreshMemberUI();
  });

  // Add member from select
  addSelect?.addEventListener("change", () => {
    const id = addSelect.value;
    if (!id) return;
    const person = allPersonnel.find(p => String(p.id) === id);
    if (person && !modalMembers.some(m => String(m.id) === id)) {
      modalMembers.push({ id: person.id, name: person.name });
      refreshMemberUI();
    }
    addSelect.value = "";
  });
}

/* ===============================
   Menu + kebab wiring
   =============================== */

function wireMenuAndKebab() {
  const menu = document.getElementById("teamMenu");
  if (!menu) {
    logMessage("ERROR", "Missing #teamMenu HTML.");
    return;
  }

  // Kebab clicks (event delegation — works after re-renders)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".team-menu-btn");
    if (!btn) return;
    const panel = document.getElementById("teams");
    if (!panel) return;
    e.preventDefault();

    const id = btn.dataset.teamId;
    const isOpen = !menu.classList.contains("hidden");
    if (isOpen && String(activeMenuTeamId) === String(id)) {
      closeTeamMenu();
      return;
    }
    openTeamMenu(btn, id);
  });

  // Click outside closes menu
  document.addEventListener("click", (e) => {
    if (menu.classList.contains("hidden")) return;
    if (e.target.closest("#teamMenu")) return;
    if (e.target.closest(".team-menu-btn")) return;
    closeTeamMenu();
  });

  // Menu actions
  menu.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-action]");
    if (!item) return;

    const action = item.dataset.action;
    const teamId = activeMenuTeamId;
    closeTeamMenu();

    const incidentName = requireIncidentOrError();
    if (!incidentName) return;

    if (action === "edit") {
      const team = findTeamInCache(teamId);
      if (!team) return;
      await openTeamModal("edit", team);
      return;
    }

    if (action === "delete") {
      const team = findTeamInCache(teamId);
      const label = team?.name ? ` "${team.name}"` : "";
      if (!window.confirm(`Delete team${label}? This cannot be undone.`)) return;
      try {
        teamsMessage.show("Deleting team…", "info");
        await apiPost("/api/teams/delete", { incidentName, teamId: parseInt(teamId) });
        teamsMessage.show("Team deleted.", "info");
        await loadTeams();
      } catch (err) {
        teamsMessage.show(`Failed to delete: ${err.message}`, "error");
      }
    }
  });
}

/* ===============================
   Tab activation watcher
   =============================== */

function watchTeamsTab() {
  const panel = document.getElementById("teams");
  if (!panel) return;

  let wasActive = panel.classList.contains("active");

  const observer = new MutationObserver(() => {
    const isActive = panel.classList.contains("active");
    if (isActive && !wasActive) {
      logMessage("INFO", "Teams tab activated");
      updateAddButtonEnabled();
      loadTeams();
    }
    wasActive = isActive;
  });

  observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
}

/* ===============================
   Init
   =============================== */

document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("teams");
  if (!panel) {
    logMessage("ERROR", "Teams panel (#teams) not found in DOM.");
    return;
  }

  const tableEl = panel.querySelector(".teams-data-table");
  if (!tableEl) {
    logMessage("ERROR", "teams-data-table not found.");
    return;
  }

  teamsMessage = initMessageBar("teams-message");
  teamsMessage.show("Select an incident on Home, then open the Teams tab.", "info");

  teamsTable = createTable({
    tableEl,
    rowRenderer: renderTeamRow,
    sortOrders: {
      status: Object.fromEntries(TEAM_STATUSES.map((s, i) => [s.toUpperCase().replace(/\s+/g, ""), i + 1])),
    },
  });

  // + Team button
  document.getElementById("team-add")?.addEventListener("click", () => {
    const incidentName = requireIncidentOrError();
    if (!incidentName) return;
    openTeamModal("create");
  });

  // View toggle
  document.getElementById("view-table-btn")?.addEventListener("click", () => switchView("table"));
  document.getElementById("view-kanban-btn")?.addEventListener("click", () => switchView("kanban"));

  // Incident change
  document.getElementById("incidentSelect")?.addEventListener("change", () => {
    updateAddButtonEnabled();
    if (panel.classList.contains("active")) loadTeams();
  });

  // Escape closes all overlays
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeTeamMenu();
      closeTeamModal();
    }
  });

  updateAddButtonEnabled();
  wireFilters();
  wireMenuAndKebab();
  wireModal();
  watchTeamsTab();
});
