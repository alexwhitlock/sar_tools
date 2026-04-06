import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";

let assignmentsTable = null;
let assignmentsMessage = null;
let assignmentsCache = [];   // last-fetched assignment list
let teamsCache = [];         // last-fetched teams list (for kanban card enrichment)
let currentView = "table";  // "table" | "kanban"

const ASGN_STATUSES = ["DRAFT", "PREPARED", "INPROGRESS", "COMPLETED"];

const STATUS_LABEL = {
  DRAFT:       "Draft",
  PREPARED:    "Prepared",
  INPROGRESS:  "In Progress",
  COMPLETED:   "Completed",
};

const ASGN_STATUS_BADGE = {
  DRAFT:       "asgn-badge-draft",
  PREPARED:    "asgn-badge-prepared",
  INPROGRESS:  "asgn-badge-inprogress",
  COMPLETED:   "asgn-badge-completed",
};

const collapsedStatuses = new Set();

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
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Return the status of the team matching a single-letter team field, or "" if not found. */
function getTeamStatus(teamField) {
  const letters = parseAssignmentTeamLetters(teamField);
  if (!letters.length) return "";
  const letter = letters[0];
  const team = teamsCache.find(t => String(t.name).trim().toUpperCase() === letter);
  return team ? team.status : "";
}

const TS_BADGE_CLASS = {
  "Out of Service":            "ts-badge-oos",
  "Staged":                    "ts-badge-staged",
  "Briefed":                   "ts-badge-briefed",
  "Travelling to Assignment":  "ts-badge-travelling",
  "On Assignment":             "ts-badge-on-assignment",
  "Returning from Assignment": "ts-badge-returning",
  "Awaiting Debrief":          "ts-badge-debrief",
  "Retired":                   "ts-badge-retired",
};

function teamStatusBadge(teamField) {
  const status = getTeamStatus(teamField);
  if (!status) return "";
  const cls = TS_BADGE_CLASS[status] ?? "";
  return `<span class="ts-badge ${cls}">${escapeHtml(status)}</span>`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* ===============================
   CalTopo write
   =============================== */

async function writeToCalTopo({ featureId, status, team }) {
  const mapId       = getCurrentMapId();
  const incidentName = getCurrentIncidentName();
  if (!mapId || !featureId) throw new Error("Map ID or feature ID missing");

  const body = { mapId, featureId, incidentName };
  if (status  !== undefined) body.status = status;
  if (team    !== undefined) body.team   = team;

  assignmentsMessage.show("Writing to CalTopo…", "info");

  const resp = await fetch("/api/caltopo/assignment/update", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || `HTTP ${resp.status}`);
}

/* ===============================
   Row renderer (table view)
   =============================== */

function renderAssignmentRow(a) {
  const tr = document.createElement("tr");
  tr.dataset.featureId = a.id ?? "";

  let numberHtml = String(a.number ?? "");
  if (a.titleConflict) {
    const tip = (a.status || "").toUpperCase() === "COMPLETED"
      ? `Assignment ${a.number}: status is COMPLETED but title has no X prefix.`
      : `Assignment ${a.number}: title has X (completed) but status is ${a.status}.`;
    numberHtml += ` <span class="conflict-warn" title="${escapeHtml(tip)}">⚠</span>`;
  }

  tr.innerHTML = `
    <td>${numberHtml}</td>
    <td>${escapeHtml(a.team ?? "")}</td>
    <td>${escapeHtml(a.assignmentType ?? "")}</td>
    <td>${escapeHtml(a.resourceType ?? "")}</td>
    <td><span class="asgn-badge ${ASGN_STATUS_BADGE[(a.status || "").toUpperCase()] ?? ""}">${escapeHtml(STATUS_LABEL[(a.status || "").toUpperCase()] ?? a.status ?? "")}</span></td>
    <td class="col-team-status">${(a.status || "").toUpperCase() === "INPROGRESS" ? teamStatusBadge(a.team ?? "") : ""}</td>
    <td class="col-op-period">${escapeHtml(a.op ?? "")}</td>
    <td class="actions-cell">
      <button type="button" class="asgn-menu-btn"
        data-feature-id="${escapeHtml(a.id ?? "")}"
        title="Actions" aria-label="Actions">⋮</button>
    </td>
  `;

  tr.querySelector(".asgn-menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    openAsgnMenu(e.currentTarget, a);
  });
  return tr;
}

/* ===============================
   Data loading
   =============================== */

export async function loadAssignments() {
  if (!navigator.onLine) {
    assignmentsMessage.show("Offline.", "error");
    assignmentsTable.setData([]);
    return;
  }

  const mapId = getCurrentMapId();
  if (!mapId) {
    assignmentsTable.setData([]);
    assignmentsMessage.show("Enter a CalTopo Map ID to load assignments.", "error");
    return;
  }

  assignmentsMessage.show("Loading assignments…", "info");

  try {
    const resp = await fetch(`/api/assignments?mapId=${encodeURIComponent(mapId)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    assignmentsCache = Array.isArray(data) ? data : [];

    if (!assignmentsCache.length) {
      assignmentsMessage.show("No assignments found on this map.", "info");
    } else {
      const warnings = [];

      const conflicts = findAssignmentConflicts(assignmentsCache);
      if (conflicts.size > 0) {
        const detail = [...conflicts.entries()]
          .map(([letter, nums]) => `Team ${letter} (assignments ${nums.join(", ")})`)
          .join("; ");
        warnings.push(`Multiple in-progress assignments: ${detail}`);
      }

      const titleConflicts = assignmentsCache.filter(a => a.titleConflict);
      if (titleConflicts.length > 0) {
        const nums = titleConflicts.map(a => a.number ?? "?").join(", ");
        warnings.push(`Title/status mismatch on assignment${titleConflicts.length > 1 ? "s" : ""} ${nums}`);
      }

      const incidentName = getCurrentIncidentName();
      if (incidentName) {
        try {
          const teamsResp = await fetch(`/api/teams?incidentName=${encodeURIComponent(incidentName)}`);
          if (teamsResp.ok) {
            const teams = await teamsResp.json().catch(() => []);
            const teamArr = Array.isArray(teams) ? teams : [];
            teamsCache = teamArr;
            const dbLetters = new Set(
              teamArr.map(t => String(t.name).trim().toUpperCase())
                .filter(n => n.length === 1 && /[A-Z]/.test(n))
            );
            const missing = findMissingTeams(assignmentsCache, dbLetters);
            if (missing.length > 0) {
              warnings.push(`Teams in CalTopo not in database: ${missing.join(", ")}`);
            }
            const inProgressLetters = new Set();
            for (const a of assignmentsCache) {
              if ((a.status || "").toUpperCase() === "INPROGRESS") {
                for (const letter of parseAssignmentTeamLetters(a.team)) inProgressLetters.add(letter);
              }
            }
            const oosWithAssignment = teamArr.filter(t => {
              const letter = String(t.name).trim().toUpperCase();
              return t.status === "Out of Service" && inProgressLetters.has(letter);
            });
            if (oosWithAssignment.length > 0) {
              warnings.push(`${oosWithAssignment.map(t => `Team ${t.name}`).join(", ")} marked Out of Service but assigned to an in-progress assignment`);
            }
          }
        } catch (_) { /* non-fatal */ }
      }

      if (warnings.length > 0) {
        assignmentsMessage.show(`⚠ ${warnings.join(" — ")} — Last updated ${getTimeHHMMSS()}`, "warning");
      } else {
        assignmentsMessage.show(`Last updated ${getTimeHHMMSS()}`, "info");
      }
    }

    if (currentView === "table") {
      assignmentsTable.setData(assignmentsCache);
    } else {
      renderKanban(assignmentsCache);
    }

  } catch (err) {
    assignmentsTable.setData([]);
    assignmentsMessage.show("Failed to load assignments. See console for details.", "error");
  }
}

/* ===============================
   Kanban
   =============================== */

function renderKanban(assignments) {
  const container = document.getElementById("assignments-kanban-view");
  if (!container) return;
  container.innerHTML = "";

  for (const status of ASGN_STATUSES) {
    const col = document.createElement("div");
    col.className = "kanban-col";
    col.dataset.status = status;
    if (collapsedStatuses.has(status)) col.classList.add("collapsed");

    const statusItems = assignments
      .filter(a => (a.status || "").toUpperCase() === status)
      .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0));

    col.innerHTML = `
      <div class="kanban-col-header">
        <span class="kanban-col-label">${escapeHtml(STATUS_LABEL[status] ?? status)}</span>
        <span class="kanban-col-count">${statusItems.length}</span>
      </div>
      <div class="kanban-col-cards"></div>
    `;

    col.querySelector(".kanban-col-header").addEventListener("click", () => {
      if (collapsedStatuses.has(status)) collapsedStatuses.delete(status);
      else collapsedStatuses.add(status);
      renderKanban(assignmentsCache);
    });

    const cardsEl = col.querySelector(".kanban-col-cards");

    for (const a of statusItems) {
      const card = document.createElement("div");
      card.className = "kanban-card";
      card.dataset.featureId = a.id ?? "";

      card.innerHTML = `
        <div class="kanban-card-header">
          <span class="asgn-card-number">Assignment ${escapeHtml(String(a.number ?? "?"))}</span>
        </div>
        <div class="asgn-card-team">
          <span>Team: ${escapeHtml(a.team || "—")}</span>
          ${status === "INPROGRESS" && a.team ? `<span class="asgn-card-team-status">${escapeHtml(getTeamStatus(a.team))}</span>` : ""}
        </div>
        <div class="asgn-card-meta">${escapeHtml(a.assignmentType ?? "")}${a.resourceType ? " · " + escapeHtml(a.resourceType) : ""}</div>
      `;

      wireMouseDnd(card, a);
      wireTouchDnd(card, a);

      cardsEl.appendChild(card);
    }

    container.appendChild(col);
  }
}

/* ===============================
   Mouse hold-to-drag (kanban)
   =============================== */

function wireMouseDnd(card, asgn) {
  let timer    = null;
  let active   = false;
  let scrolled = false;
  let ghost    = null;
  let targetCol = null;
  let offX = 0, offY = 0;

  function cleanup() {
    clearTimeout(timer); timer = null;
    active = false; scrolled = false;
    if (ghost) { ghost.remove(); ghost = null; }
    card.style.opacity = ""; card.style.cursor = "";
    document.body.classList.remove("kanban-grabbing");
    document.querySelectorAll("#assignments-kanban-view .kanban-col.drag-over")
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
    const col = el?.closest("#assignments-kanban-view .kanban-col");
    document.querySelectorAll("#assignments-kanban-view .kanban-col.drag-over")
      .forEach(c => c.classList.remove("drag-over"));
    if (col) { col.classList.add("drag-over"); targetCol = col; }
    else      { targetCol = null; }
  }

  async function onUp() {
    const col      = targetCol;
    const wasDrag  = active;
    const wasScroll = scrolled;
    cleanup();
    if (!wasDrag && !wasScroll) { openEditModal(asgn); return; }
    if (!col) return;
    const newStatus = col.dataset.status;
    const a = assignmentsCache.find(x => x.id === (asgn.id ?? ""));
    if (!a || (a.status || "").toUpperCase() === newStatus) return;
    await doStatusWrite(a, newStatus, card);
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
   Touch drag-and-drop (kanban)
   =============================== */

let _touchFeatureId      = null;
let _touchGhost          = null;
let _touchTargetCol      = null;
let _touchOffsetX        = 0;
let _touchOffsetY        = 0;
let _dragActive          = false;
let _touchScrolled       = false;
let _touchLongPressTimer = null;

function _touchCleanup(card) {
  clearTimeout(_touchLongPressTimer);
  _touchLongPressTimer = null;
  _dragActive   = false;
  _touchScrolled = false;
  if (_touchGhost) { _touchGhost.remove(); _touchGhost = null; }
  if (card) { card.style.opacity = ""; card.style.touchAction = ""; }
  document.querySelectorAll("#assignments-kanban-view .kanban-col.drag-over")
    .forEach(c => c.classList.remove("drag-over"));
  _touchTargetCol = null;
  _touchFeatureId = null;
}

function wireTouchDnd(card, asgn) {
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const rect  = card.getBoundingClientRect();

    _touchFeatureId = asgn.id ?? "";
    _touchOffsetX   = touch.clientX - rect.left;
    _touchOffsetY   = touch.clientY - rect.top;
    _dragActive     = false;

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

      const col = el?.closest("#assignments-kanban-view .kanban-col");
      document.querySelectorAll("#assignments-kanban-view .kanban-col.drag-over")
        .forEach(c => c.classList.remove("drag-over"));
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
    const col       = _touchTargetCol;
    const featureId = _touchFeatureId;
    const wasDrag   = _dragActive;
    const wasScroll = _touchScrolled;
    _touchCleanup(card);

    if (!wasDrag && !wasScroll) {
      e.preventDefault();  // suppress synthetic click that would hit the backdrop
      openEditModal(asgn);
      return;
    }
    if (!col || !featureId) return;

    const newStatus = col.dataset.status;
    const a = assignmentsCache.find(x => x.id === featureId);
    if (!a || (a.status || "").toUpperCase() === newStatus) return;

    await doStatusWrite(a, newStatus, card);
  });

  card.addEventListener("touchcancel", () => _touchCleanup(card));
  card.addEventListener("contextmenu", (e) => e.preventDefault());
}

/* ===============================
   Post-complete team staging prompt
   =============================== */

async function maybeUpdateTeamStatus(teamField, newTeamStatus, promptMsg, skipIfStatuses) {
  if (!teamField) return;
  const letter = parseAssignmentTeamLetters(teamField)[0];
  if (!letter) return;

  const team = teamsCache.find(t => String(t.name).trim().toUpperCase() === letter);
  if (!team || skipIfStatuses.has(team.status)) return;

  if (!window.confirm(promptMsg(letter, team.status))) return;

  const incidentName = getCurrentIncidentName();
  if (!incidentName) return;

  try {
    await fetch("/api/teams/update", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        incidentName,
        teamId:            team.id,
        status:            newTeamStatus,
        expectedUpdatedAt: team.updatedAt,
      }),
    });
  } catch (_) {
    // non-fatal
  }
}

function maybeStageTeam(teamField) {
  return maybeUpdateTeamStatus(
    teamField,
    "Staged",
    (letter) => `Assignment completed. Move Team ${letter} to "Staged"?`,
    new Set(["Staged"])
  );
}

function maybeBriefTeam(teamField) {
  return maybeUpdateTeamStatus(
    teamField,
    "Briefed",
    (letter) => `Assignment in progress. Move Team ${letter} to "Briefed"?`,
    new Set(["Briefed", "Travelling to Assignment", "On Assignment", "Returning from Assignment", "Awaiting Debrief"])
  );
}

/* ===============================
   Status write (kanban drop)
   =============================== */

async function doStatusWrite(asgn, newStatus, cardEl) {
  const validationErr = validateStatusChange(asgn, newStatus);
  if (validationErr) {
    assignmentsMessage.show(`⚠ ${validationErr}`, "error");
    return;
  }
  if (cardEl) cardEl.classList.add("writing");
  try {
    await writeToCalTopo({ featureId: asgn.id, status: newStatus });
    await loadAssignments();
    if (newStatus === "COMPLETED")  await maybeStageTeam(asgn.team);
    if (newStatus === "INPROGRESS") await maybeBriefTeam(asgn.team);
  } catch (err) {
    assignmentsMessage.show(`Failed to update CalTopo: ${err.message}`, "error");
    if (cardEl) cardEl.classList.remove("writing");
  }
}

/* ===============================
   Validation
   =============================== */

const TEAM_REQUIRED_STATUSES = new Set(["INPROGRESS", "COMPLETED"]);

function validateStatusChange(asgn, newStatus) {
  if (TEAM_REQUIRED_STATUSES.has(newStatus) && !(asgn.team || "").trim()) {
    return `Assignment ${asgn.number ?? "?"} must have a team assigned before setting status to "${STATUS_LABEL[newStatus] ?? newStatus}".`;
  }
  return null;
}

/* ===============================
   Popup menu
   =============================== */

let _menuAsgn = null;

function openAsgnMenu(anchorBtn, asgn) {
  const menu = document.getElementById("asgnMenu");
  if (!menu) return;
  _menuAsgn = asgn;
  menu.classList.remove("hidden");

  const rect = anchorBtn.getBoundingClientRect();
  const gapY = 4;
  let top  = rect.bottom + gapY;
  let left = rect.left - 2;
  menu.style.top  = `${top}px`;
  menu.style.left = `${left}px`;

  const mRect = menu.getBoundingClientRect();
  if (mRect.right  > window.innerWidth  - 8) menu.style.left = `${window.innerWidth  - mRect.width  - 8}px`;
  if (mRect.bottom > window.innerHeight - 8) menu.style.top  = `${rect.top - mRect.height - gapY}px`;
}

function closeAsgnMenu() {
  document.getElementById("asgnMenu")?.classList.add("hidden");
}

/* ===============================
   Edit modal
   =============================== */

let _modalAsgn = null;

function openEditModal(asgn) {
  _modalAsgn = asgn;

  const backdrop = document.getElementById("asgnModalBackdrop");
  const infoEl   = document.getElementById("asgnModalInfo");
  const statusEl = document.getElementById("asgnStatus");
  const teamEl   = document.getElementById("asgnTeam");
  const errEl    = document.getElementById("asgnModalError");

  infoEl.textContent = `Assignment ${asgn.number ?? "?"}  ·  ${asgn.assignmentType ?? ""}${asgn.resourceType ? "  ·  " + asgn.resourceType : ""}`;
  statusEl.value     = (asgn.status || "DRAFT").toUpperCase();

  // Populate team dropdown from teamsCache (single-letter teams only)
  const currentTeam = (asgn.team ?? "").trim().toUpperCase();
  teamEl.innerHTML   = '<option value="">— No Team —</option>';
  const teamLetters  = teamsCache
    .map(t => String(t.name).trim().toUpperCase())
    .filter(n => n.length === 1 && /[A-Z]/.test(n))
    .sort();
  for (const letter of teamLetters) {
    const opt = document.createElement("option");
    opt.value       = letter;
    opt.textContent = `Team ${letter}`;
    teamEl.appendChild(opt);
  }
  // If current team isn't in cache (e.g. not yet in DB), add it so we don't lose the value
  if (currentTeam && !teamLetters.includes(currentTeam)) {
    const opt = document.createElement("option");
    opt.value       = currentTeam;
    opt.textContent = `Team ${currentTeam}`;
    teamEl.appendChild(opt);
  }
  teamEl.value = currentTeam;

  errEl.classList.add("hidden");
  errEl.textContent  = "";

  const saveBtn = document.getElementById("asgnModalSave");
  saveBtn.disabled    = false;
  saveBtn.textContent = "Save";

  backdrop.setAttribute("aria-hidden", "false");
  backdrop.classList.remove("hidden");
  statusEl.focus();
}

function closeEditModal() {
  const backdrop = document.getElementById("asgnModalBackdrop");
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  _modalAsgn = null;
}

async function saveEditModal() {
  if (!_modalAsgn) return;

  const statusEl  = document.getElementById("asgnStatus");
  const teamEl    = document.getElementById("asgnTeam");
  const errEl     = document.getElementById("asgnModalError");
  const saveBtn   = document.getElementById("asgnModalSave");
  const cancelBtn = document.getElementById("asgnModalCancel");

  const newStatus = statusEl.value;
  const newTeam   = teamEl.value.trim();

  const changed = newStatus !== (_modalAsgn.status || "").toUpperCase() ||
                  newTeam   !== (_modalAsgn.team   || "");
  if (!changed) { closeEditModal(); return; }

  // Validate team required for INPROGRESS / COMPLETED
  const validationErr = validateStatusChange({ ..._modalAsgn, team: newTeam }, newStatus);
  if (validationErr) {
    errEl.textContent = validationErr;
    errEl.classList.remove("hidden");
    return;
  }

  saveBtn.disabled    = true;
  saveBtn.textContent = "Writing to CalTopo…";
  cancelBtn.disabled  = true;
  errEl.classList.add("hidden");

  try {
    await writeToCalTopo({
      featureId: _modalAsgn.id,
      status:    newStatus,
      team:      newTeam,
    });
    closeEditModal();
    await loadAssignments();
    if (newStatus === "COMPLETED")  await maybeStageTeam(newTeam || _modalAsgn.team);
    if (newStatus === "INPROGRESS") await maybeBriefTeam(newTeam || _modalAsgn.team);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove("hidden");
    saveBtn.disabled    = false;
    saveBtn.textContent = "Save";
    cancelBtn.disabled  = false;
  }
}

/* ===============================
   View toggle
   =============================== */

function switchView(view) {
  currentView = view;

  const tableView   = document.getElementById("assignments-table-view");
  const kanbanView  = document.getElementById("assignments-kanban-view");
  const filtersRow  = document.getElementById("assignments-filters-row");
  const tableBtn    = document.getElementById("asgn-view-table-btn");
  const kanbanBtn   = document.getElementById("asgn-view-kanban-btn");

  if (view === "table") {
    tableView?.classList.remove("hidden");
    kanbanView?.classList.add("hidden");
    if (filtersRow) filtersRow.style.display = "";
    tableBtn?.classList.add("active");
    kanbanBtn?.classList.remove("active");
    assignmentsTable.setData(assignmentsCache);
  } else {
    tableView?.classList.add("hidden");
    kanbanView?.classList.remove("hidden");
    if (filtersRow) filtersRow.style.display = "none";
    tableBtn?.classList.remove("active");
    kanbanBtn?.classList.add("active");
    renderKanban(assignmentsCache);
  }
}

/* ===============================
   Filters
   =============================== */

function wireFilters(table) {
  const numberInput = document.getElementById("filter-number");
  if (numberInput) numberInput.addEventListener("input", e => table.setFilter("number", e.target.value, "startsWith"));

  const teamInput = document.getElementById("filter-team");
  if (teamInput) teamInput.addEventListener("input", e => table.setFilter("team", e.target.value));

  const opInput = document.getElementById("filter-op");
  if (opInput) opInput.addEventListener("input", e => table.setFilter("op", e.target.value));

  const teamStatusToggle = document.getElementById("toggle-team-status");
  if (teamStatusToggle) {
    const tableEl = document.querySelector(".assignments-data-table");
    teamStatusToggle.addEventListener("change", () => {
      tableEl?.classList.toggle("show-team-status", teamStatusToggle.checked);
    });
  }

  const opToggle = document.getElementById("toggle-op-period");
  if (opToggle) {
    const tableEl  = document.querySelector(".assignments-data-table");
    const opGroup  = opToggle.closest(".filter-group-check");
    opToggle.addEventListener("change", () => {
      const on = opToggle.checked;
      if (tableEl) tableEl.classList.toggle("show-op-period", on);
      if (opGroup) opGroup.classList.toggle("op-expanded", on);
      if (!on && opInput) { opInput.value = ""; table.setFilter("op", ""); }
    });
  }

  const assignmentsPanel = document.getElementById("assignments");
  assignmentsPanel?.querySelectorAll(".pill-group").forEach(group => {
    const key = group.dataset.filterKey;
    if (!key) return;
    group.addEventListener("change", () => {
      const values = Array.from(group.querySelectorAll("input[type=checkbox]:checked")).map(cb => cb.value);
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
  new MutationObserver(() => {
    const isActive = panel.classList.contains("active");
    if (isActive && !wasActive) loadAssignments();
    wasActive = isActive;
  }).observe(panel, { attributes: true, attributeFilter: ["class"] });
}

/* ===============================
   Init
   =============================== */

document.addEventListener("DOMContentLoaded", () => {
  const tableEl = document.querySelector(".assignments-data-table");
  if (!tableEl) return;

  assignmentsMessage = initMessageBar("assignments-message");
  assignmentsMessage.show("Enter a CalTopo Map ID to load assignments.", "error");

  assignmentsTable = createTable({
    tableEl,
    rowRenderer: renderAssignmentRow,
    defaultSort: { key: "number", dir: 1 },
    columnTypes: { number: "number" },
    sortOrders: { status: { DRAFT: 1, PREPARED: 2, INPROGRESS: 3, COMPLETED: 4 } },
    secondarySort: { status: ["number"] },
  });

  wireFilters(assignmentsTable);
  watchAssignmentsTab();

  // View toggle
  document.getElementById("asgn-view-table-btn")?.addEventListener("click",  () => switchView("table"));
  document.getElementById("asgn-view-kanban-btn")?.addEventListener("click", () => switchView("kanban"));

  // Popup menu wiring
  document.getElementById("asgnMenu")?.addEventListener("click", (e) => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "edit" && _menuAsgn) openEditModal(_menuAsgn);
    closeAsgnMenu();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#asgnMenu") && !e.target.closest(".asgn-menu-btn")) closeAsgnMenu();
  });

  // Edit modal wiring
  document.getElementById("asgnModalClose")?.addEventListener("click",  closeEditModal);
  document.getElementById("asgnModalCancel")?.addEventListener("click", closeEditModal);
  document.getElementById("asgnModalSave")?.addEventListener("click",   saveEditModal);
  document.getElementById("asgnModalBackdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeEditModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeAsgnMenu(); closeEditModal(); }
  });
});

/* ===============================
   Online / Offline handling
   =============================== */

window.addEventListener("sar:online", loadAssignments);

window.addEventListener("sar:offline", () => {
  assignmentsMessage.show("Offline.", "error");
  assignmentsTable.setData([]);
});
