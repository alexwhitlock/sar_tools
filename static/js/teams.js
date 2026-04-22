import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";

const TEAM_STATUSES = [
  "Out of Service",
  "Staged",
  "Briefed",
  "Travelling to Assignment",
  "On Assignment",
  "Returning from Assignment",
  "Awaiting Debrief",
  "Retired",
];

const IN_PROGRESS_TEAM_STATES = new Set([
  "Briefed",
  "Travelling to Assignment",
  "On Assignment",
  "Returning from Assignment",
  "Awaiting Debrief",
]);

const KANBAN_COL_LABEL = {
  "Travelling to Assignment":  "Travelling To",
  "Returning from Assignment": "Returning From",
};

const STATUS_BADGE_CLASS = {
  "Out of Service":            "ts-badge-oos",
  "Staged":                    "ts-badge-staged",
  "Briefed":                   "ts-badge-briefed",
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
let currentView = "table";        // "table" | "kanban" | "card"
let kanbanAssignments = [];       // CalTopo assignment data (optional)
const collapsedStatuses = new Set(); // statuses whose kanban column is collapsed

// Card view personnel cache
let cardPersonnel = [];

// Touch drag-and-drop state (kanban)
let _touchTeamId         = null;
let _touchGhost          = null;
let _touchTargetCol      = null;
let _touchOffsetX        = 0;
let _touchOffsetY        = 0;
let _dragActive          = false;
let _touchScrolled       = false;
let _touchLongPressTimer = null;

// Touch drag-and-drop state (card view)
let _cvPersonId     = null;
let _cvFromTeamId   = null;
let _cvIsTl         = false;
let _cvGhost        = null;
let _cvTargetZone   = null;
let _cvOffsetX      = 0;
let _cvOffsetY      = 0;
let _cvDragActive   = false;
let _cvScrolled     = false;
let _cvLongPress    = null;

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
 * Returns true if the team is Out of Service and has members not yet checked in.
 */
function hasUncheckedMembers(team) {
  if (team.status !== "Out of Service") return false;
  const memberIds = new Set(parseMemberData(team.memberData).map(m => String(m.id)));
  return allPersonnel.some(p => memberIds.has(String(p.id)) && p.status !== "Checked In");
}

/**
 * Validate a proposed team status change against assignment rules.
 * Returns an error string if the change should be blocked, null if OK.
 */
function validateTeamStatusChange(team, newStatus) {
  const hasInProgress = getInProgressAssignmentsForTeam(team.name).length > 0;

  // Can't put a team in service until all members are checked in
  if (team.status === "Out of Service" && newStatus !== "Out of Service") {
    const memberIds = new Set(parseMemberData(team.memberData).map(m => String(m.id)));
    const notCheckedIn = allPersonnel
      .filter(p => memberIds.has(String(p.id)) && p.status !== "Checked In")
      .map(p => p.name);
    if (notCheckedIn.length)
      return `Cannot put Team ${team.name} in service — the following members are not checked in: ${notCheckedIn.join(", ")}.`;
  }

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

class ConflictError extends Error {
  constructor() { super("Modified by another user"); this.name = "ConflictError"; }
}

async function apiPost(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 409) throw new ConflictError();
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

  const unchecked = hasUncheckedMembers(t)
    ? ` <span class="team-unchecked-warn">⚠ Some members not checked in</span>`
    : "";

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${escapeHtml(t.name)}${unchecked}</td>
    <td><span class="ts-badge ${badgeClass}">${escapeHtml(t.status)}</span></td>
    <td>${escapeHtml(t.teamLeaderName || "—")}</td>
    <td title="${memberTooltip(t)}" style="cursor:help">${t.memberCount ?? 0}</td>
    <td class="col-members">${memberListHtml(t)}</td>
    <td>${assignmentHtml}</td>
    <td class="col-notes" title="${escapeHtml(t.notes ?? "")}">${escapeHtml(t.notes ?? "")}</td>
    <td class="actions-cell">
      <button
        type="button"
        class="team-menu-btn"
        data-team-id="${escapeHtml(t.id)}"
        title="Actions"
        aria-label="Actions">⋮</button>
    </td>
  `;
  tr.addEventListener("dblclick", async (e) => {
    if (e.target.closest(".team-menu-btn")) return;
    const teamId = tr.querySelector(".team-menu-btn")?.dataset.teamId;
    const team = teamId ? findTeamInCache(teamId) : null;
    if (team) await openTeamModal("edit", team);
  });
  return tr;
}

/* ===============================
   Data loading
   =============================== */

export async function loadTeams() {
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

    try {
      allPersonnel = await apiLoadPersonnel(incidentName);
    } catch (_) {
      allPersonnel = [];
    }
    cardPersonnel = allPersonnel;

    if (currentView === "table") {
      teamsTable.setData(teams);
    } else if (currentView === "kanban") {
      renderKanban(teams);
    } else {
      renderCardView(teams, allPersonnel);
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
   Mouse hold-to-drag (kanban)
   =============================== */

function wireMouseDnd(card, team) {
  let timer     = null;
  let active    = false;
  let scrolled  = false;
  let ghost     = null;
  let targetCol = null;
  let offX = 0, offY = 0;

  function cleanup() {
    clearTimeout(timer); timer = null;
    active = false; scrolled = false;
    if (ghost) { ghost.remove(); ghost = null; }
    card.style.opacity = ""; card.style.cursor = "";
    document.body.classList.remove("kanban-grabbing");
    document.querySelectorAll("#teams-kanban-view .kanban-col.drag-over")
      .forEach(c => c.classList.remove("drag-over"));
    targetCol = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",   onUp);
  }

  function onMove(e) {
    if (!active) {
      clearTimeout(timer); timer = null; scrolled = true; return;
    }
    ghost.style.left = `${e.clientX - offX}px`;
    ghost.style.top  = `${e.clientY - offY}px`;
    ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    ghost.style.visibility = "";
    const col = el?.closest("#teams-kanban-view .kanban-col");
    document.querySelectorAll("#teams-kanban-view .kanban-col.drag-over")
      .forEach(c => c.classList.remove("drag-over"));
    if (col) { col.classList.add("drag-over"); targetCol = col; }
    else      { targetCol = null; }
  }

  async function onUp() {
    const col       = targetCol;
    const wasDrag   = active;
    const wasScroll = scrolled;
    cleanup();
    if (!wasDrag && !wasScroll) { await openTeamModal("edit", team); return; }
    if (!col) return;
    const newStatus    = col.dataset.status;
    if (team.status === newStatus) return;
    const incidentName = getCurrentIncidentName();
    if (!incidentName) return;
    const err = validateTeamStatusChange(team, newStatus);
    if (err) { teamsMessage.show(`⚠ ${err}`, "error"); return; }
    try {
      const oldStatus = team.status;
      await apiPost("/api/teams/update", { incidentName, teamId: parseInt(team.id), status: newStatus, expectedUpdatedAt: team.updatedAt });
      team.status = newStatus;
      renderKanban(teamsCache);
    } catch (err) {
      if (err instanceof ConflictError) {
        teamsMessage.show("⚠ Team was modified by another user — reloading.", "warning", 6000);
        await loadTeams();
      } else {
        teamsMessage.show(`Failed to update status: ${err.message}`, "error");
      }
    }
  }

  card.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    active = false; scrolled = false;

    timer = setTimeout(() => {
      active = true;
      document.body.classList.add("kanban-grabbing");
      ghost = card.cloneNode(true);
      Object.assign(ghost.style, {
        position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, margin: "0", pointerEvents: "none",
        opacity: "0.85", zIndex: "9999",
        boxShadow: "0 6px 16px rgba(0,0,0,0.25)", transform: "rotate(2deg)",
      });
      document.body.appendChild(ghost);
      card.style.opacity = "0.3";
    }, 400);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  });
}


/* ===============================
   Touch drag-and-drop
   =============================== */

function _touchCleanup(card) {
  clearTimeout(_touchLongPressTimer);
  _touchLongPressTimer = null;
  _dragActive    = false;
  _touchScrolled = false;
  if (_touchGhost) { _touchGhost.remove(); _touchGhost = null; }
  if (card) { card.style.opacity = ""; card.style.touchAction = ""; }
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
    _dragActive   = false;

    // Start long-press timer — don't preventDefault yet so scroll works normally
    _touchLongPressTimer = setTimeout(() => {
      _dragActive = true;
      card.style.touchAction = "none";
      _touchGhost = card.cloneNode(true);
      Object.assign(_touchGhost.style, {
        position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, margin: "0", pointerEvents: "none",
        opacity: "0.85", zIndex: "9999",
        boxShadow: "0 6px 16px rgba(0,0,0,0.25)", transform: "rotate(2deg)",
      });
      document.body.appendChild(_touchGhost);
      card.style.opacity = "0.3";
    }, 400);
  }, { passive: true });

  card.addEventListener("touchmove", (e) => {
    if (_dragActive) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      _touchGhost.style.left = `${touch.clientX - _touchOffsetX}px`;
      _touchGhost.style.top  = `${touch.clientY - _touchOffsetY}px`;

      _touchGhost.style.visibility = "hidden";
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      _touchGhost.style.visibility = "";

      const col = el?.closest(".kanban-col");
      document.querySelectorAll(".kanban-col.drag-over").forEach(c => c.classList.remove("drag-over"));
      if (col) { col.classList.add("drag-over"); _touchTargetCol = col; }
      else      { _touchTargetCol = null; }
      e.preventDefault();
    } else {
      // Cancel drag if finger moved enough to be a scroll, not a tap
      const touch = e.touches[0];
      const rect  = card.getBoundingClientRect();
      const moved = Math.abs(touch.clientX - (rect.left + _touchOffsetX)) > 8
                 || Math.abs(touch.clientY - (rect.top  + _touchOffsetY)) > 8;
      if (moved) {
        clearTimeout(_touchLongPressTimer);
        _touchLongPressTimer = null;
        _touchScrolled = true;
      }
    }
  }, { passive: false });

  card.addEventListener("touchend", async (e) => {
    const col      = _touchTargetCol;
    const tId      = _touchTeamId;
    const wasDrag  = _dragActive;
    const wasScroll = _touchScrolled;
    _touchCleanup(card);

    if (!wasDrag && !wasScroll) {
      e.preventDefault();  // suppress synthetic click that would hit the backdrop
      const team = findTeamInCache(tId);
      if (team) await openTeamModal("edit", team);
      return;
    }
    if (!col || !tId) return;

    const newStatus = col.dataset.status;
    const team      = findTeamInCache(tId);
    if (!team || team.status === newStatus) return;

    const incidentName = getCurrentIncidentName();
    if (!incidentName) return;

    const err = validateTeamStatusChange(team, newStatus);
    if (err) { teamsMessage.show(`⚠ ${err}`, "error", 6000); return; }

    try {
      const oldStatus = team.status;
      await apiPost("/api/teams/update", { incidentName, teamId: parseInt(tId), status: newStatus, expectedUpdatedAt: team.updatedAt });
      team.status = newStatus;
      renderKanban(teamsCache);
    } catch (err) {
      if (err instanceof ConflictError) {
        teamsMessage.show("⚠ Team was modified by another user — reloading.", "warning", 6000);
        await loadTeams();
      } else {
        teamsMessage.show(`Failed to update status: ${err.message}`, "error");
      }
    }
  });

  card.addEventListener("touchcancel", () => _touchCleanup(card));
  card.addEventListener("contextmenu", (e) => e.preventDefault());
}


/* ===============================
   Card view
   =============================== */

function makePersonChip(person, fromTeamId, isTl) {
  const chip = document.createElement("div");
  chip.className = "cv-person";
  chip.dataset.personId   = person.id;
  chip.dataset.fromTeamId = fromTeamId != null ? String(fromTeamId) : "";
  chip.dataset.isTl       = isTl ? "1" : "0";

  const full = allPersonnel.find(p => String(p.id) === String(person.id));
  const checkedIn = full?.status === "Checked In";

  const label = document.createElement("span");
  label.textContent = isTl ? `${person.name} (TL)` : person.name;
  chip.appendChild(label);

  if (!checkedIn) {
    const dot = document.createElement("span");
    dot.className = "cv-status-dot cv-status-out";
    dot.title = "Not Checked In";
    chip.appendChild(dot);
  }
  return chip;
}

function _cvDropTarget(el) {
  return el?.closest(".cv-tl-zone, .cv-members-zone, .cv-unassigned-col") ?? null;
}

function _cvClearDragOver() {
  document.querySelectorAll(".cv-tl-zone.drag-over, .cv-members-zone.drag-over, .cv-unassigned-col.drag-over")
    .forEach(z => z.classList.remove("drag-over"));
}

async function applyPersonDrop(personId, fromTeamId, isTl, toTeamId, toZone) {
  const incidentName = getCurrentIncidentName();
  if (!incidentName) return;

  // No-op checks
  if (fromTeamId === null && toTeamId === null) return;  // unassigned → unassigned
  if (fromTeamId != null && fromTeamId === toTeamId) {
    if (toZone === "tl"      &&  isTl) return;
    if (toZone === "members" && !isTl) return;
    // Same team: just change role
    if (toZone === "members" && isTl) {
      await apiPost("/api/teams/update", { incidentName, teamId: fromTeamId, teamLeaderId: null });
    } else {
      await apiPost("/api/teams/update", { incidentName, teamId: fromTeamId, teamLeaderId: personId });
    }
    await loadTeams();
    return;
  }

  // Moving between teams or to/from unassigned
  // Step 1: clear TL if was TL
  if (fromTeamId != null && isTl) {
    await apiPost("/api/teams/update", { incidentName, teamId: fromTeamId, teamLeaderId: null });
  }
  // Step 2: remove from current team
  if (fromTeamId != null) {
    await apiPost("/api/teams/remove-person", { incidentName, personId });
  }
  // Step 3: add to target team
  if (toTeamId != null) {
    await apiPost("/api/teams/assign-person", { incidentName, teamId: toTeamId, personId });
    if (toZone === "tl") {
      await apiPost("/api/teams/update", { incidentName, teamId: toTeamId, teamLeaderId: personId });
    }
  }

  await loadTeams();
}

function wirePersonMouseDnd(chip, personId, fromTeamId, isTl) {
  let timer = null, active = false, scrolled = false;
  let ghost = null, targetZone = null;
  let offX = 0, offY = 0;

  function cleanup() {
    clearTimeout(timer); timer = null;
    active = false; scrolled = false;
    if (ghost) { ghost.remove(); ghost = null; }
    chip.style.opacity = "";
    document.body.classList.remove("kanban-grabbing");
    _cvClearDragOver();
    targetZone = null;
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup",   onUp);
  }

  function onMove(e) {
    if (!active) { clearTimeout(timer); timer = null; scrolled = true; return; }
    ghost.style.left = `${e.clientX - offX}px`;
    ghost.style.top  = `${e.clientY - offY}px`;
    ghost.style.visibility = "hidden";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    ghost.style.visibility = "";
    const zone = _cvDropTarget(el);
    _cvClearDragOver();
    if (zone) { zone.classList.add("drag-over"); targetZone = zone; }
    else       { targetZone = null; }
  }

  async function onUp() {
    const zone   = targetZone;
    const wasDrag = active;
    cleanup();
    if (!wasDrag || !zone) return;
    const toTeamId = zone.dataset.teamId ? parseInt(zone.dataset.teamId) : null;
    const toZone   = zone.dataset.zone || "unassigned";
    try {
      await applyPersonDrop(
        parseInt(personId),
        fromTeamId != null ? parseInt(fromTeamId) : null,
        isTl, toTeamId, toZone
      );
    } catch (err) {
      teamsMessage.show(`Failed to move person: ${err.message}`, "error");
    }
  }

  chip.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const rect = chip.getBoundingClientRect();
    offX = e.clientX - rect.left;
    offY = e.clientY - rect.top;
    active = false; scrolled = false;

    timer = setTimeout(() => {
      active = true;
      document.body.classList.add("kanban-grabbing");
      ghost = chip.cloneNode(true);
      Object.assign(ghost.style, {
        position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, margin: "0", pointerEvents: "none",
        opacity: "0.85", zIndex: "9999",
        boxShadow: "0 6px 16px rgba(0,0,0,0.25)", transform: "rotate(2deg)",
      });
      document.body.appendChild(ghost);
      chip.style.opacity = "0.3";
    }, 400);

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  });
}

function wirePersonTouchDnd(chip, personId, fromTeamId, isTl) {
  chip.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect  = chip.getBoundingClientRect();
    _cvPersonId   = personId;
    _cvFromTeamId = fromTeamId;
    _cvIsTl       = isTl;
    _cvOffsetX    = touch.clientX - rect.left;
    _cvOffsetY    = touch.clientY - rect.top;
    _cvDragActive = false;
    _cvScrolled   = false;

    _cvLongPress = setTimeout(() => {
      _cvDragActive = true;
      chip.style.touchAction = "none";
      _cvGhost = chip.cloneNode(true);
      Object.assign(_cvGhost.style, {
        position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`,
        width: `${rect.width}px`, margin: "0", pointerEvents: "none",
        opacity: "0.85", zIndex: "9999",
        boxShadow: "0 6px 16px rgba(0,0,0,0.25)", transform: "rotate(2deg)",
      });
      document.body.appendChild(_cvGhost);
      chip.style.opacity = "0.3";
    }, 400);
  }, { passive: true });

  chip.addEventListener("touchmove", (e) => {
    if (_cvDragActive) {
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      _cvGhost.style.left = `${touch.clientX - _cvOffsetX}px`;
      _cvGhost.style.top  = `${touch.clientY - _cvOffsetY}px`;
      _cvGhost.style.visibility = "hidden";
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      _cvGhost.style.visibility = "";
      const zone = _cvDropTarget(el);
      _cvClearDragOver();
      if (zone) { zone.classList.add("drag-over"); _cvTargetZone = zone; }
      else       { _cvTargetZone = null; }
      e.preventDefault();
    } else {
      const touch = e.touches[0];
      const rect  = chip.getBoundingClientRect();
      const moved = Math.abs(touch.clientX - (rect.left + _cvOffsetX)) > 8
                 || Math.abs(touch.clientY - (rect.top  + _cvOffsetY)) > 8;
      if (moved) { clearTimeout(_cvLongPress); _cvLongPress = null; _cvScrolled = true; }
    }
  }, { passive: false });

  chip.addEventListener("touchend", async (e) => {
    const zone    = _cvTargetZone;
    const pId     = _cvPersonId;
    const ftId    = _cvFromTeamId;
    const tl      = _cvIsTl;
    const wasDrag = _cvDragActive;
    // cleanup
    clearTimeout(_cvLongPress); _cvLongPress = null;
    _cvDragActive = false; _cvScrolled = false;
    if (_cvGhost) { _cvGhost.remove(); _cvGhost = null; }
    chip.style.opacity = ""; chip.style.touchAction = "";
    _cvClearDragOver(); _cvTargetZone = null;

    if (!wasDrag || !zone) return;
    e.preventDefault();
    const toTeamId = zone.dataset.teamId ? parseInt(zone.dataset.teamId) : null;
    const toZone   = zone.dataset.zone || "unassigned";
    try {
      await applyPersonDrop(
        parseInt(pId),
        ftId != null ? parseInt(ftId) : null,
        tl, toTeamId, toZone
      );
    } catch (err) {
      teamsMessage.show(`Failed to move person: ${err.message}`, "error");
    }
  });

  chip.addEventListener("touchcancel", () => {
    clearTimeout(_cvLongPress); _cvLongPress = null;
    _cvDragActive = false;
    if (_cvGhost) { _cvGhost.remove(); _cvGhost = null; }
    chip.style.opacity = ""; chip.style.touchAction = "";
    _cvClearDragOver(); _cvTargetZone = null;
  });
  chip.addEventListener("contextmenu", (e) => e.preventDefault());
}

function renderCardView(teams, personnel) {
  const container = document.getElementById("teams-card-view");
  if (!container) return;

  const searchVal = (document.getElementById("teams-search")?.value || "").toLowerCase();
  container.innerHTML = "";

  // Unassigned column
  const unassigned = personnel
    .filter(p => !p.team)
    .sort((a, b) => a.name.localeCompare(b.name));

  const unassignedCol = document.createElement("div");
  unassignedCol.className  = "cv-unassigned-col";
  unassignedCol.dataset.zone = "unassigned";

  const unassignedHdr = document.createElement("div");
  unassignedHdr.className = "cv-col-header";
  unassignedHdr.innerHTML = `Unassigned <span class="cv-col-count">${unassigned.length}</span>`;
  unassignedCol.appendChild(unassignedHdr);

  const unassignedList = document.createElement("div");
  unassignedList.className = "cv-col-persons";
  unassigned.forEach(p => {
    const chip = makePersonChip(p, null, false);
    if (searchVal && !p.name.toLowerCase().includes(searchVal)) chip.classList.add("cv-hidden");
    wirePersonMouseDnd(chip, p.id, null, false);
    wirePersonTouchDnd(chip, p.id, null, false);
    unassignedList.appendChild(chip);
  });
  unassignedCol.appendChild(unassignedList);
  container.appendChild(unassignedCol);

  // Teams grid
  const grid = document.createElement("div");
  grid.className = "cv-teams-grid";

  const sorted = [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  for (const team of sorted) {
    const members = parseMemberData(team.memberData);
    const tlId    = team.teamLeaderId ? String(team.teamLeaderId) : null;
    const tl      = tlId ? members.find(m => String(m.id) === tlId) : null;
    const rest    = members
      .filter(m => String(m.id) !== tlId)
      .sort((a, b) => a.name.localeCompare(b.name));

    const card = document.createElement("div");
    card.className = "cv-team-card";
    card.dataset.teamId = team.id;
    card.dataset.status = team.status;

    const hdr = document.createElement("div");
    hdr.className = "cv-team-header";
    hdr.innerHTML = `Team ${escapeHtml(team.name)} <span class="cv-col-count">${members.length}</span>`;


    // TL zone
    const tlZone = document.createElement("div");
    tlZone.className = "cv-tl-zone";
    tlZone.dataset.teamId = team.id;
    tlZone.dataset.zone   = "tl";
    if (tl) {
      const chip = makePersonChip(tl, team.id, true);
      if (searchVal && !tl.name.toLowerCase().includes(searchVal)) chip.classList.add("cv-hidden");
      wirePersonMouseDnd(chip, tl.id, team.id, true);
      wirePersonTouchDnd(chip, tl.id, team.id, true);
      tlZone.appendChild(chip);
    }

    // Members zone
    const membersZone = document.createElement("div");
    membersZone.className = "cv-members-zone";
    membersZone.dataset.teamId = team.id;
    membersZone.dataset.zone   = "members";
    rest.forEach(m => {
      const chip = makePersonChip(m, team.id, false);
      if (searchVal && !m.name.toLowerCase().includes(searchVal)) chip.classList.add("cv-hidden");
      wirePersonMouseDnd(chip, m.id, team.id, false);
      wirePersonTouchDnd(chip, m.id, team.id, false);
      membersZone.appendChild(chip);
    });

    card.appendChild(hdr);
    card.appendChild(tlZone);
    card.appendChild(membersZone);
    grid.appendChild(card);
  }

  container.appendChild(grid);
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
        <span class="kanban-col-label">${escapeHtml(KANBAN_COL_LABEL[status] ?? status)}</span>
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
      card.dataset.teamId = team.id;

      if (searchVal && !(team.searchText || "").includes(searchVal)) {
        card.classList.add("search-hidden");
      }

      const kanbanUnchecked = hasUncheckedMembers(team)
        ? `<div class="team-unchecked-warn">⚠ Some members not checked in</div>`
        : "";

      card.innerHTML = `
        <div class="kanban-card-header">
          <span class="kanban-card-name">Team ${escapeHtml(team.name)}</span>
          <span class="kanban-card-members" title="${memberTooltip(team)}">${team.memberCount ?? 0} Members</span>
        </div>
        <div class="kanban-card-tl">TL: ${escapeHtml(team.teamLeaderName || "None")}</div>
        <div class="kanban-card-assignment">${assignmentHtml}</div>
        ${kanbanUnchecked}
      `;

      wireMouseDnd(card, team);
      wireTouchDnd(card, team.id);

      cardsEl.appendChild(card);
    }

    container.appendChild(col);
  }
}

/* ===============================
   View toggle
   =============================== */

function switchView(view) {
  currentView = view;

  const tableView          = document.getElementById("teams-table-view");
  const kanbanView         = document.getElementById("teams-kanban-view");
  const cardView           = document.getElementById("teams-card-view");
  const statusFilterGroup  = document.getElementById("teams-status-filter-group");
  const colTogglesGroup    = document.getElementById("teams-col-toggles");
  const tableBtn           = document.getElementById("view-table-btn");
  const kanbanBtn          = document.getElementById("view-kanban-btn");
  const cardBtn            = document.getElementById("view-card-btn");
  const addBtn             = document.getElementById("team-add");
  const printBtn           = document.getElementById("teams-print-btn");
  const toolbar            = document.querySelector(".teams-toolbar");
  const filtersRow         = document.querySelector(".teams-filters");
  const searchGroup        = document.getElementById("teams-search-group");

  // Reset all active states
  tableBtn?.classList.remove("active");
  kanbanBtn?.classList.remove("active");
  cardBtn?.classList.remove("active");
  tableView?.classList.add("hidden");
  kanbanView?.classList.add("hidden");
  cardView?.classList.add("hidden");
  if (view === "table") {
    tableView?.classList.remove("hidden");
    if (statusFilterGroup) statusFilterGroup.style.display = "";
    if (colTogglesGroup)   colTogglesGroup.style.display   = "";
    if (addBtn)    addBtn.style.display    = "";
    if (printBtn)  printBtn.style.display  = "";
    if (filtersRow) filtersRow.style.display = "";
    tableBtn?.classList.add("active");
    // Move search back into filters row
    if (searchGroup && filtersRow && searchGroup.parentElement !== filtersRow) {
      filtersRow.prepend(searchGroup);
    }
    teamsTable.setData(teamsCache);
  } else {
    // kanban and card share the same chrome: no filters row, search in toolbar
    if (statusFilterGroup) statusFilterGroup.style.display = "none";
    if (colTogglesGroup)   colTogglesGroup.style.display   = "none";
    if (addBtn) addBtn.style.display = "none";
    if (filtersRow) filtersRow.style.display = "none";
    // Move search into toolbar (before the view toggle)
    if (searchGroup && toolbar) {
      const toggle = toolbar.querySelector(".view-toggle");
      toolbar.insertBefore(searchGroup, toggle);
    }

    if (view === "kanban") {
      if (printBtn) printBtn.style.display = "none";
      kanbanView?.classList.remove("hidden");
      kanbanBtn?.classList.add("active");
      renderKanban(teamsCache);
    } else {
      if (printBtn) printBtn.style.display = "";
      cardView?.classList.remove("hidden");
      cardBtn?.classList.add("active");
      loadTeams();
    }
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
      } else if (currentView === "kanban") {
        const lower = val.toLowerCase();
        const cards = document.querySelectorAll("#teams-kanban-view .kanban-card");
        cards.forEach(card => {
          const team = findTeamInCache(card.dataset.teamId);
          const match = !lower || (team?.searchText || "").includes(lower);
          card.classList.toggle("search-hidden", !match);
        });
      } else {
        const lower = val.toLowerCase();
        document.querySelectorAll("#teams-card-view .cv-person").forEach(chip => {
          // Match on name only (strip trailing " (TL)" if present)
          const name = chip.textContent.replace(/ \(TL\)$/, "").toLowerCase();
          chip.classList.toggle("cv-hidden", !!lower && !name.includes(lower));
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

  // Notes column toggle
  const notesToggle = document.getElementById("toggle-notes-teams");
  if (notesToggle) {
    const tableEl = document.querySelector(".teams-data-table");
    notesToggle.addEventListener("change", () => {
      tableEl?.classList.toggle("hide-notes", !notesToggle.checked);
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

  // Rebuild add-member select: unassigned people not already on this team
  const memberIds = new Set(modalMembers.map(m => String(m.id)));
  addSelect.innerHTML = '<option value="">— Add member —</option>';
  for (const p of allPersonnel) {
    if (memberIds.has(String(p.id))) continue;          // already a member
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

  const errEl = document.getElementById("teamModalError");
  if (errEl) errEl.classList.add("hidden");

  titleEl.textContent = mode === "create" ? "Create Team" : "Edit Team";
  nameInput.value = team?.name ?? "";
  statusSelect.value = team?.status ?? "Out of Service";
  const notesInput = document.getElementById("teamNotes");
  if (notesInput) notesInput.value = team?.notes ?? "";

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
  const notes = (document.getElementById("teamNotes")?.value || "").trim();

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

  const currentTeam = modalMode === "edit" ? teamsCache.find(t => t.id === activeTeamId) : null;

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
        notes,
        teamLeaderId: teamLeaderId ? parseInt(teamLeaderId) : null,
        expectedUpdatedAt: currentTeam?.updatedAt,
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
        notes,
        teamLeaderId: teamLeaderId ? parseInt(teamLeaderId) : null,
      });
    }

    // Snapshot before closeTeamModal() clears modalMembers, originalMemberIds, allPersonnel
    const _mode = modalMode;
    const _currentMemberIds = new Set(modalMembers.map(m => String(m.id)));
    const _originalMemberIds = new Set(originalMemberIds);
    const _modalMembers = [...modalMembers];
    const _allPersonnel = [...allPersonnel];

    closeTeamModal();
    await loadTeams();
    teamsMessage.show(_mode === "create" ? "Team created." : "Changes saved.", "info");
  } catch (err) {
    const errEl = document.getElementById("teamModalError");
    if (err instanceof ConflictError) {
      if (errEl) { errEl.textContent = "⚠ This team was modified by another user. Close and re-open to see the latest version."; errEl.classList.remove("hidden"); }
      await loadTeams();
    } else {
      logMessage("ERROR", "Failed to save team", err.message);
      if (errEl) { errEl.textContent = `Failed to save: ${err.message}`; errEl.classList.remove("hidden"); }
    }
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
  document.getElementById("view-table-btn")?.addEventListener("click",  () => switchView("table"));
  document.getElementById("view-kanban-btn")?.addEventListener("click", () => switchView("kanban"));
  document.getElementById("view-card-btn")?.addEventListener("click",   () => switchView("card"));

  // Print
  document.getElementById("teams-print-btn")?.addEventListener("click", () => {
    const incidentName = getCurrentIncidentName() || "";
    const viewLabel = { table: "Table View", kanban: "Kanban View", card: "Card View" }[currentView] || "";
    const header = document.getElementById("teams-print-header");
    if (header) {
      header.querySelector(".tph-title").textContent = `Teams — ${viewLabel}`;
      header.querySelector(".tph-meta").textContent =
        [incidentName, new Date().toLocaleString()].filter(Boolean).join("  ·  ");
    }
    window.print();
  });

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

window.addEventListener("sar:offline", () => {
  if (teamsTable) teamsTable.setData([]);
  if (teamsMessage) teamsMessage.show("Offline.", "error");
  const kanban = document.getElementById("teams-kanban-view");
  if (kanban) kanban.innerHTML = "";
  const card = document.getElementById("teams-card-view");
  if (card) card.innerHTML = "";
});

window.addEventListener("sar:online", loadTeams);
