import { createTable } from "./table/table-core.js";
import { initMessageBar } from "./message-bar.js";

let personnelTable = null;
let personnelMessage = null;

// Keep a local cache of the currently loaded personnel list (for edit lookup)
let personnelCache = [];

// Popup/menu + modal state
let activePersonKey = null; // id or fallback key
let modalMode = "add"; // "add" | "edit"

/* ===============================
   Helpers
   =============================== */

function getCurrentIncidentName() {
  const sel = document.getElementById("incidentSelect");
  return sel ? sel.value.trim() : "";
}

function getCurrentD4hActivityId() {
  const el = document.getElementById("d4h_activity");
  return el ? el.value.trim() : "";
}

function requireIncidentOrError() {
  const incidentName = getCurrentIncidentName();
  if (!incidentName) {
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

function updateAddButtonsEnabled() {
  const incidentOk = !!getCurrentIncidentName();

  const addBtn = document.getElementById("person-add");
  if (addBtn) addBtn.disabled = !incidentOk;

  const d4hBtn = document.getElementById("d4h-add");
  const d4hOk = !!getCurrentD4hActivityId();
  if (d4hBtn) d4hBtn.disabled = !(incidentOk && d4hOk);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/**
 * Choose a stable key for a person record.
 * Prefer id fields if present, else fall back to name (last resort).
 */
function getPersonKey(p) {
  return (
    p.id ??
    p.personId ??
    p.person_id ??
    p.uuid ??
    p.name // fallback (works until you add real ids)
  );
}

/* ===============================
   Row renderer
   =============================== */

function renderPersonnelRow(p) {
  const key = getPersonKey(p);
  const status = p.status || "Added";

  const tr = document.createElement("tr");
  tr.dataset.status = status;
  tr.innerHTML = `
    <td>${escapeHtml(p.name)}</td>
    <td>${escapeHtml(p.team)}</td>
    <td>${escapeHtml(status)}</td>
    <td>${escapeHtml(p.source)}</td>
    <td class="col-d4href">${escapeHtml(p.d4hMemberRef)}</td>
    <td class="col-notes" title="${escapeHtml(p.notes ?? "")}">${escapeHtml(p.notes ?? "")}</td>
    <td class="actions-cell">
      <button
        type="button"
        class="person-menu-btn"
        data-person-key="${escapeHtml(key)}"
        title="Actions"
        aria-label="Actions">⋮</button>
    </td>
  `;
  tr.addEventListener("dblclick", async (e) => {
    if (e.target.closest(".person-menu-btn")) return;
    const key = tr.querySelector(".person-menu-btn")?.dataset.personKey;
    const person = key ? findPersonInCache(key) : null;
    if (person) await openPersonModal("edit", person);
  });
  return tr;
}

/* ===============================
   Data loading
   =============================== */

export async function loadPersonnel() {
  personnelMessage.show("Loading personnel…", "info");
  logMessage("INFO", "Loading personnel");

  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  try {
    const resp = await fetch(
      `/api/personnel?incidentName=${encodeURIComponent(incidentName)}`
    );
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }

    logMessage("INFO", "Personnel received", data);

    // Normalize to array and compute synthetic teamFilter field
    const arr = (Array.isArray(data) ? data : []).map(p => ({
      ...p,
      teamFilter: p.status === "Checked In"
        ? (p.team ? "Assigned" : "Unassigned")
        : "",
    }));
    personnelCache = arr;

    if (!arr.length) {
      personnelMessage.show(
        "No personnel yet. Click + Person to add someone.",
        "info"
      );
      personnelTable.setData([]);
      return;
    }

    const checkedIn  = arr.filter(p => p.status === "Checked In").length;
    const checkedOut = arr.filter(p => p.status === "Checked Out").length;
    const statsEl = document.getElementById("personnel-stats");
    if (statsEl) {
      document.getElementById("stat-total").textContent      = `Total: ${arr.length}`;
      document.getElementById("stat-checkedin").textContent  = `Checked In: ${checkedIn}`;
      document.getElementById("stat-checkedout").textContent = `Checked Out: ${checkedOut}`;
      statsEl.classList.remove("hidden");
    }

    personnelMessage.show(`Last updated ${new Date().toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit",second:"2-digit"})}`, "info");
    personnelTable.setData(arr);
  } catch (err) {
    logMessage("ERROR", "Failed to load personnel", err.message);
    personnelCache = [];
    personnelTable.setData([]);
    personnelMessage.show(`Failed to load personnel: ${err.message}`, "error");
  }
}

/* ===============================
   Modal + Menu wiring
   Requires HTML elements:
     #personMenu
     #personModalBackdrop
     #personModalTitle
     #personModalClose
     #personModalCancel
     #personModalSave
     #personName
   =============================== */

function getUiEls() {
  return {
    menu: document.getElementById("personMenu"),
    backdrop: document.getElementById("personModalBackdrop"),
    titleEl: document.getElementById("personModalTitle"),
    closeBtn: document.getElementById("personModalClose"),
    cancelBtn: document.getElementById("personModalCancel"),
    saveBtn: document.getElementById("personModalSave"),
    nameInput: document.getElementById("personName"),
    teamSelect: document.getElementById("personTeam"),
    notesInput: document.getElementById("personNotes"),
  };
}

function openMenu(anchorBtn, personKey) {
  const { menu } = getUiEls();
  if (!menu) return;

  activePersonKey = personKey;

  const person = findPersonInCache(personKey);
  const status = person?.status ?? "Added";

  function showIf(action, condition) {
    const el = menu.querySelector(`[data-action='${action}']`);
    if (el) el.style.display = condition ? "" : "none";
  }

  const previousStatus = person?.previousStatus ?? null;
  showIf("check-in",      status === "Added" || status === "Checked Out");
  showIf("undo-check-in", status === "Checked In" && previousStatus === "Added");
  showIf("check-out",     status === "Checked In");

  const rect = anchorBtn.getBoundingClientRect();

  // Show menu so we can measure it (safe even if it was hidden)
  menu.classList.remove("hidden");

  // Tight to the LEFT and just BELOW the button
  const gapY = 4; // tune: 0, 2, 4
  const gapX = -2; // tune: -2, 0, 2

  let top = rect.bottom + gapY; // viewport coords (because menu is position: fixed)
  let left = rect.left + gapX;

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  // Keep inside viewport horizontally
  let mRect = menu.getBoundingClientRect();

  if (mRect.right > window.innerWidth - 8) {
    left = window.innerWidth - mRect.width - 8;
    menu.style.left = `${left}px`;
    mRect = menu.getBoundingClientRect();
  }
  if (mRect.left < 8) {
    left = 8;
    menu.style.left = `${left}px`;
    mRect = menu.getBoundingClientRect();
  }

  // Optional: if menu would go off bottom, flip above the button
  if (mRect.bottom > window.innerHeight - 8) {
    top = rect.top - mRect.height - gapY;
    menu.style.top = `${Math.max(8, top)}px`;
  }
}

function closeMenu() {
  const { menu } = getUiEls();
  if (!menu) return;
  menu.classList.add("hidden");
}

async function openPersonModal(mode, person = null) {
  const { backdrop, titleEl, nameInput, teamSelect, notesInput } = getUiEls();
  if (!backdrop || !titleEl || !nameInput) return;

  modalMode = mode;
  const errEl = document.getElementById("personModalError");
  if (errEl) errEl.classList.add("hidden");
  titleEl.textContent = mode === "add" ? "Add Person" : "Edit Person";
  nameInput.value = person?.name ?? "";
  if (notesInput) notesInput.value = person?.notes ?? "";

  // Populate team dropdown
  if (teamSelect) {
    teamSelect.innerHTML = '<option value="">— No Team —</option>';
    const incidentName = getCurrentIncidentName();
    if (incidentName) {
      try {
        const resp = await fetch(`/api/teams?incidentName=${encodeURIComponent(incidentName)}`);
        if (resp.ok) {
          const teams = await resp.json().catch(() => []);
          for (const t of (Array.isArray(teams) ? teams : [])) {
            const opt = document.createElement("option");
            opt.value = t.id;
            opt.textContent = t.name;
            teamSelect.appendChild(opt);
          }
        }
      } catch (_) { /* non-fatal */ }
    }
    // Pre-select current team in edit mode
    teamSelect.value = person?.teamId ? String(person.teamId) : "";
    // If team is set by name but not id, try to match
    if (!teamSelect.value && person?.team) {
      const opt = Array.from(teamSelect.options).find(o => o.textContent === person.team);
      if (opt) teamSelect.value = opt.value;
    }
  }

  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  nameInput.focus();
}

function closePersonModal() {
  const { backdrop } = getUiEls();
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
}

function findPersonInCache(personKey) {
  return (
    personnelCache.find((p) => String(getPersonKey(p)) === String(personKey)) ||
    null
  );
}

/* ===============================
   API actions (Add / Update / Delete)
   =============================== */

async function apiAddPerson({ incidentName, name }) {
  const resp = await fetch("/api/personnel/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, name }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Add failed (HTTP ${resp.status})`);
  }
  return data;
}

async function apiUpdatePerson({ incidentName, personKey, name, notes, expectedUpdatedAt }) {
  const resp = await fetch("/api/personnel/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, personKey, name, notes, expectedUpdatedAt }),
  });

  const data = await resp.json().catch(() => ({}));
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Update failed (HTTP ${resp.status})`);
  }
  return data;
}

async function apiDeletePerson({ incidentName, personKey }) {
  const resp = await fetch("/api/personnel/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, personKey }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Delete failed (HTTP ${resp.status})`);
  }
  return data;
}

async function apiCheckName({ incidentName, name }) {
  const resp = await fetch("/api/personnel/check-name", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, name }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || "Check failed");
  return data; // { exact: [...], similar: [...] }
}

async function apiCheckNames({ incidentName, members }) {
  const resp = await fetch("/api/personnel/check-names", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, members }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || "Batch check failed");
  return data; // { results: [...] }
}


class ConflictError extends Error {
  constructor() { super("Modified by another user"); this.name = "ConflictError"; }
}

async function apiUpdatePersonStatus({ incidentName, personKey, status, expectedUpdatedAt }) {
  const resp = await fetch("/api/personnel/status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, personKey, status, expectedUpdatedAt }),
  });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 409) throw new ConflictError();
  if (!resp.ok || data.ok === false) throw new Error(data.error || `Status update failed (HTTP ${resp.status})`);
  return data;
}

async function apiLinkD4h({ incidentName, personId, d4hRef, name }) {
  const resp = await fetch("/api/personnel/link-d4h", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, personId, d4hRef, name }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || "Link failed");
  return data;
}

/* ===============================
   Add person (now modal-based)
   =============================== */

async function addPerson() {
  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  activePersonKey = null;
  await openPersonModal("add", null);
}

/* ===============================
   Add from D4H — two-phase import
   =============================== */

async function _doImport(incidentName, members) {
  const resp = await fetch("/api/personnel/import-d4h", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, members }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.ok === false) throw new Error(data.error || "Import failed");
  return data; // { imported, updated, skipped }
}

async function addFromD4h() {
  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  const activityId = getCurrentD4hActivityId();
  if (!activityId) {
    personnelMessage.show("Enter a D4H Activity ID on Home first.", "error");
    return;
  }

  try {
    // Phase 1: fetch D4H attending members
    personnelMessage.show("Fetching D4H members…", "info");
    const membersResp = await fetch(
      `/api/d4h/activity/${encodeURIComponent(activityId)}/attending-members`
    );
    const membersData = await membersResp.json().catch(() => ({}));
    if (!membersResp.ok || membersData.error) {
      throw new Error(membersData.error || `Fetch failed (HTTP ${membersResp.status})`);
    }

    const members = (membersData.members || []).filter(m => m.name && m.d4hRef);
    if (!members.length) {
      personnelMessage.show("No attending members found for that activity.", "info");
      return;
    }

    // Phase 2: batch conflict check
    personnelMessage.show("Checking for conflicts…", "info");
    const checkData = await apiCheckNames({ incidentName, members });
    const results   = checkData.results || [];

    // Build a lookup so memberRef survives the check-names round-trip
    const memberRefByD4hRef = Object.fromEntries(members.map(m => [m.d4hRef, m.memberRef ?? null]));
    const withRef = r => ({ ...r, memberRef: memberRefByD4hRef[r.d4hRef] ?? null });

    const linked    = results.filter(r => r.status === "linked");
    const newOnes   = results.filter(r => r.status === "new").map(withRef);
    const conflicts = results.filter(r => r.status === "name_conflict").map(withRef);

    if (!conflicts.length) {
      // No conflicts — import all new ones directly
      if (!newOnes.length) {
        personnelMessage.show(
          `Nothing new to import. ${linked.length} already linked.`,
          "info"
        );
        return;
      }
      const stats = await _doImport(incidentName, newOnes);
      personnelMessage.show(
        `Imported ${stats.imported}` +
        (linked.length ? `, ${linked.length} already linked` : "") +
        `.`,
        "info"
      );
      await loadPersonnel();
      return;
    }

    // Conflicts found — open resolution modal
    openConflictModal({
      incidentName,
      newOnes,
      linked,
      conflicts,
      onImport: async (resolutions) => {
        const toLink = [];
        const toAdd  = [];

        for (const [d4hRef, choice] of resolutions) {
          if (choice.action === "link") {
            const orig = conflicts.find(c => c.d4hRef === d4hRef);
            toLink.push({ d4hRef, personId: choice.personId, name: orig?.name });
          } else if (choice.action === "add") {
            const orig = conflicts.find(c => c.d4hRef === d4hRef);
            if (orig) toAdd.push({ name: orig.name, d4hRef, memberRef: orig.memberRef ?? null });
          }
          // "skip" → no-op
        }

        // Execute links
        const linkErrors = [];
        for (const { d4hRef, personId, name } of toLink) {
          try {
            await apiLinkD4h({ incidentName, personId, d4hRef, name });
          } catch (err) {
            linkErrors.push(`Link ${d4hRef}: ${err.message}`);
          }
        }

        // Import new + "add as new" resolutions in one call
        const toImport = [...newOnes, ...toAdd];
        let importStats = { imported: 0, updated: 0, skipped: 0 };
        if (toImport.length) {
          importStats = await _doImport(incidentName, toImport);
        }

        await loadPersonnel();

        const totalLinked  = toLink.length - linkErrors.length;
        const totalSkipped = [...resolutions.values()].filter(r => r.action === "skip").length;
        let msg = `Imported ${importStats.imported}`;
        if (totalLinked)      msg += `, linked ${totalLinked}`;
        if (totalSkipped)     msg += `, skipped ${totalSkipped}`;
        if (linked.length)    msg += `, ${linked.length} already linked`;
        msg += ".";

        if (linkErrors.length) {
          personnelMessage.show(`${msg} Errors: ${linkErrors.join("; ")}`, "error");
        } else {
          personnelMessage.show(msg, "info");
        }
      },
    });

  } catch (err) {
    logMessage("ERROR", "D4H import failed", err.message);
    personnelMessage.show(`D4H import failed: ${err.message}`, "error");
  }
}

/* ===============================
   Filters
   =============================== */

function wireFilters(table) {
  const nameInput = document.getElementById("filter-name");
  if (nameInput) {
    nameInput.addEventListener("input", (e) => {
      table.setFilter("name", e.target.value);
    });
  }

  const teamInput = document.getElementById("personnel-filter-team");
  if (teamInput) {
    teamInput.addEventListener("input", (e) => {
      table.setFilter("team", e.target.value);
    });
  }

  // Scope pill queries to the personnel panel to avoid collision with assignments tab
  const personnelPanel = document.getElementById("personnel");

  // Status pill filter
  const statusPillGroup = personnelPanel?.querySelector(".pill-group[data-filter-key='status']");
  if (statusPillGroup) {
    statusPillGroup.addEventListener("change", () => {
      const values = Array.from(statusPillGroup.querySelectorAll("input:checked")).map(cb => cb.value);
      table.setFilter("status", values, "in");
    });
  }

  // Team assignment pills — mutually exclusive + auto-select Checked In
  const teamPillGroup = personnelPanel?.querySelector(".pill-group[data-filter-key='teamFilter']");
  const checkedInPill = statusPillGroup?.querySelector("input[value='Checked In']");
  if (teamPillGroup) {
    teamPillGroup.addEventListener("change", (e) => {
      const clicked = e.target;

      // Mutual exclusion — uncheck the other pill
      teamPillGroup.querySelectorAll("input[type=checkbox]").forEach(cb => {
        if (cb !== clicked) cb.checked = false;
      });

      if (clicked.checked) {
        // Force Checked In pill on — use .click() so browser re-evaluates :has() styles
        if (checkedInPill && !checkedInPill.checked) checkedInPill.click();
        const statusValues = Array.from(statusPillGroup.querySelectorAll("input:checked")).map(cb => cb.value);
        table.setFilter("status", statusValues, "in");
        table.setFilter("teamFilter", [clicked.value], "in");
      } else {
        table.setFilter("teamFilter", [], "in");
      }
    });
  }

  const d4hRefToggle = document.getElementById("toggle-d4href");
  if (d4hRefToggle) {
    const tableEl = document.querySelector(".personnel-data-table");
    d4hRefToggle.addEventListener("change", () => {
      if (tableEl) tableEl.classList.toggle("show-d4href", d4hRefToggle.checked);
    });
  }

  const notesToggle = document.getElementById("toggle-notes-personnel");
  if (notesToggle) {
    const tableEl = document.querySelector(".personnel-data-table");
    notesToggle.addEventListener("change", () => {
      if (tableEl) tableEl.classList.toggle("hide-notes", !notesToggle.checked);
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
      updateAddButtonsEnabled();
      loadPersonnel();
    }
    wasActive = isActive;
  });

  observer.observe(panel, {
    attributes: true,
    attributeFilter: ["class"],
  });
}

/* ===============================
   UI event wiring (menu + modal)
   =============================== */

function wireMenuAndModal() {
  const { menu, backdrop, closeBtn, cancelBtn, saveBtn, nameInput } = getUiEls();

  if (!menu) {
    logMessage("ERROR", "Missing #personMenu HTML in Personnel tab.");
    return;
  }
  if (!backdrop || !closeBtn || !cancelBtn || !saveBtn || !nameInput) {
    logMessage("ERROR", "Missing modal HTML elements for Personnel add/edit.");
    return;
  }

  // Kebab click (event delegation so it works after table rerenders)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".person-menu-btn");
    if (!btn) return;

    // Only care when personnel tab exists (avoid cross-tab weirdness)
    const panel = document.getElementById("personnel");
    if (!panel) return;

    e.preventDefault();

    const key = btn.dataset.personKey;
    // toggle menu if clicking same record while open
    const isOpen = !menu.classList.contains("hidden");
    if (isOpen && String(activePersonKey) === String(key)) {
      closeMenu();
      return;
    }

    openMenu(btn, key);
  });

  // Click outside closes menu (ignore kebab + menu clicks)
  document.addEventListener("click", (e) => {
    if (menu.classList.contains("hidden")) return;
    if (e.target.closest("#personMenu")) return;
    if (e.target.closest(".person-menu-btn")) return;
    closeMenu();
  });

  // Menu actions
  menu.addEventListener("click", async (e) => {
    const item = e.target.closest("[data-action]");
    if (!item) return;

    const action = item.dataset.action;
    closeMenu();

    const incidentName = requireIncidentOrError();
    if (!incidentName) return;

    if (action === "check-in" || action === "undo-check-in" || action === "check-out") {
      const newStatus = action === "check-in" ? "Checked In"
                      : action === "check-out" ? "Checked Out"
                      : "Added";
      try {
        personnelMessage.show(`Updating status…`, "info");
        const person = findPersonInCache(activePersonKey);
        await apiUpdatePersonStatus({ incidentName, personKey: activePersonKey, status: newStatus, expectedUpdatedAt: person?.updatedAt });
        await loadPersonnel();
        personnelMessage.show(`Status updated to ${newStatus}.`, "info");
      } catch (err) {
        if (err instanceof ConflictError) {
          personnelMessage.show("⚠ Record was modified by another user — reloading.", "warning", 6000);
          await loadPersonnel();
        } else {
          personnelMessage.show(`Failed to update status: ${err.message}`, "error");
        }
      }
      return;
    }

    if (action === "edit") {
      const person = findPersonInCache(activePersonKey);
      if (!person) {
        personnelMessage.show("Could not find that person record.", "error");
        return;
      }
      await openPersonModal("edit", person);
      return;
    }

    if (action === "delete") {
      const person = findPersonInCache(activePersonKey);
      const label = person?.name ? ` "${person.name}"` : "";
      if (!window.confirm(`Delete${label}? This cannot be undone.`)) return;

      try {
        personnelMessage.show("Deleting person…", "info");
        await apiDeletePerson({ incidentName, personKey: activePersonKey });
        personnelMessage.show("Person deleted.", "info");
        await loadPersonnel();
      } catch (err) {
        logMessage("ERROR", "Failed to delete person", err.message);
        personnelMessage.show(
          `Failed to delete person: ${err.message}`,
          "error"
        );
      }
    }
  });

  // Modal close/cancel
  closeBtn.addEventListener("click", closePersonModal);
  cancelBtn.addEventListener("click", closePersonModal);

  // Click backdrop closes modal
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closePersonModal();
  });

  // Escape closes all overlays
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      closePersonModal();
      closeConflictModal();
    }
  });

  // Save (Add or Edit)
  saveBtn.addEventListener("click", async () => {
    const incidentName = requireIncidentOrError();
    if (!incidentName) return;

    const name = nameInput.value.trim();
    const { teamSelect, notesInput } = getUiEls();
    const notes = notesInput?.value.trim() ?? "";
    const selectedTeamId = teamSelect?.value ? parseInt(teamSelect.value) : null;

    if (!name) {
      window.alert("Name is required.");
      nameInput.focus();
      return;
    }

    const personBefore = modalMode === "edit" ? findPersonInCache(activePersonKey) : null;

    try {
      personnelMessage.show(
        modalMode === "add" ? "Adding person…" : "Saving changes…",
        "info"
      );

      let savedPersonKey = activePersonKey;

      if (modalMode === "add") {
        let dupes;
        try { dupes = await apiCheckName({ incidentName, name }); }
        catch (err) {
          personnelMessage.show(`Check failed: ${err.message}`, "error");
          return;
        }

        if (dupes.exact.length || dupes.similar.length) {
          const names = [...dupes.exact, ...dupes.similar].map(p => `"${p.name}"`).join(", ");
          const label = dupes.exact.length ? "already exists" : "is similar to existing person(s)";
          if (!window.confirm(`"${name}" ${label}: ${names}.\n\nAdd as a separate person anyway?`)) {
            nameInput.focus();
            return;
          }
        }

        const result = await apiAddPerson({ incidentName, name });
        savedPersonKey = result.id;
      } else {
        const person = findPersonInCache(activePersonKey);
        await apiUpdatePerson({ incidentName, personKey: activePersonKey, name, notes, expectedUpdatedAt: person?.updatedAt });
      }

      // Apply team assignment change
      if (savedPersonKey) {
        const person = modalMode === "add" ? null : findPersonInCache(activePersonKey);
        const currentTeamName = person?.team || null;

        // Find current team id by matching name in the teamSelect options
        let currentTeamId = null;
        if (currentTeamName && teamSelect) {
          const opt = Array.from(teamSelect.options).find(o => o.textContent === currentTeamName);
          if (opt?.value) currentTeamId = parseInt(opt.value);
        }

        if (selectedTeamId && selectedTeamId !== currentTeamId) {
          await fetch("/api/teams/assign-person", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentName, teamId: selectedTeamId, personId: savedPersonKey }),
          });
        } else if (!selectedTeamId && currentTeamId) {
          await fetch("/api/teams/remove-person", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ incidentName, personId: savedPersonKey }),
          });
        }
      }

      closePersonModal();
      await loadPersonnel();
      personnelMessage.show(
        modalMode === "add" ? "Person added." : "Changes saved.",
        "info"
      );
    } catch (err) {
      const errEl = document.getElementById("personModalError");
      if (err instanceof ConflictError) {
        if (errEl) { errEl.textContent = "⚠ This record was modified by another user. Close and re-open to see the latest version."; errEl.classList.remove("hidden"); }
        await loadPersonnel();
      } else {
        logMessage("ERROR", "Failed to save person", err.message);
        if (errEl) { errEl.textContent = `Failed to save: ${err.message}`; errEl.classList.remove("hidden"); }
      }
    }
  });
}

/* ===============================
   D4H Conflict Resolution Modal
   =============================== */

let _conflictResolutions = new Map(); // d4hRef → { action: "link"|"add"|"skip", personId? }
let _conflictOnImport = null;

function closeConflictModal() {
  const backdrop = document.getElementById("conflictModalBackdrop");
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  _conflictResolutions = new Map();
  _conflictOnImport = null;
}

function _setConflictResolution(d4hRef, action, topMatch, rowEl) {
  const resolution = { action };
  if (action === "link" && topMatch) {
    resolution.personId = topMatch.id;
  }
  _conflictResolutions.set(d4hRef, resolution);

  rowEl.classList.remove("action-link", "action-add", "action-skip");
  rowEl.classList.add(`action-${action}`);

  rowEl.querySelectorAll(".conflict-action-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.action === action);
  });
}

function _buildConflictRow(result) {
  const row = document.createElement("div");
  row.className = "conflict-row";
  row.dataset.d4hRef = result.d4hRef;

  const similarityLabel = result.similarity === "exact" ? "Exact match" : "Similar match";

  const matchLines = (result.matches || []).map(m => {
    const pct = (m.ratio && m.ratio < 1) ? ` (${Math.round(m.ratio * 100)}%)` : "";
    return `<div>${escapeHtml(m.name)} — ${escapeHtml(m.source)}${escapeHtml(pct)}</div>`;
  }).join("");

  row.innerHTML = `
    <div class="conflict-row-header">
      Incoming: <strong>${escapeHtml(result.name)}</strong>
      <span style="font-weight:400;color:#888;">(D4H ref: ${escapeHtml(result.d4hRef)})</span>
    </div>
    <div class="conflict-row-match">
      ${escapeHtml(similarityLabel)} with existing:
      ${matchLines}
    </div>
    <div class="conflict-row-actions">
      <button type="button" class="conflict-action-btn" data-action="link"
              title="Add D4H ref to the existing person">Link to Existing</button>
      <button type="button" class="conflict-action-btn" data-action="add"
              title="Import as a new separate person">Add as New</button>
      <button type="button" class="conflict-action-btn" data-action="skip"
              title="Don't import this person">Skip</button>
    </div>
  `;

  const topMatch = result.matches?.[0] ?? null;
  const defaultAction =
    (result.similarity === "exact" && (result.matches || []).length === 1) ? "link" : "add";

  row.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => {
      _setConflictResolution(result.d4hRef, btn.dataset.action, topMatch, row);
    });
  });

  _setConflictResolution(result.d4hRef, defaultAction, topMatch, row);
  return row;
}

function openConflictModal({ incidentName: _inc, newOnes, linked, conflicts, onImport }) {
  _conflictResolutions = new Map();
  _conflictOnImport = onImport;

  const backdrop  = document.getElementById("conflictModalBackdrop");
  const summaryEl = document.getElementById("conflictSummary");
  const listEl    = document.getElementById("conflictList");
  if (!backdrop || !summaryEl || !listEl) {
    logMessage("ERROR", "Conflict modal HTML elements missing.");
    return;
  }

  summaryEl.textContent =
    `${conflicts.length} name conflict(s) need your review. ` +
    `${newOnes.length} will import automatically. ` +
    `${linked.length} already linked.`;

  listEl.innerHTML = "";
  for (const result of conflicts) {
    listEl.appendChild(_buildConflictRow(result));
  }

  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
}

function wireConflictModal() {
  const backdrop  = document.getElementById("conflictModalBackdrop");
  const closeBtn  = document.getElementById("conflictModalClose");
  const cancelBtn = document.getElementById("conflictModalCancel");
  const importBtn = document.getElementById("conflictModalImport");

  if (!backdrop || !closeBtn || !cancelBtn || !importBtn) {
    logMessage("ERROR", "Missing conflict modal HTML elements.");
    return;
  }

  closeBtn.addEventListener("click",  closeConflictModal);
  cancelBtn.addEventListener("click", closeConflictModal);
  backdrop.addEventListener("click",  (e) => { if (e.target === backdrop) closeConflictModal(); });

  importBtn.addEventListener("click", async () => {
    if (!_conflictOnImport) return;
    const cb = _conflictOnImport;
    const resolutions = new Map(_conflictResolutions); // snapshot before close clears it
    closeConflictModal();
    try {
      personnelMessage.show("Applying resolutions…", "info");
      await cb(resolutions);
    } catch (err) {
      logMessage("ERROR", "Conflict resolution import failed", err.message);
      personnelMessage.show(`Import error: ${err.message}`, "error");
    }
  });
}

/* ===============================
   Init
   =============================== */

document.addEventListener("DOMContentLoaded", () => {
  const panel = document.getElementById("personnel");
  if (!panel) {
    logMessage(
      "ERROR",
      "Personnel panel (#personnel) not found in DOM. Are you editing the file Flask is serving?"
    );
    return;
  }

  const tableEl = panel.querySelector(".personnel-data-table");
  if (!tableEl) {
    logMessage(
      "ERROR",
      "Personnel panel exists, but .personnel-data-table not found inside it"
    );
    return;
  }

  personnelMessage = initMessageBar("personnel-message");
  personnelMessage.show("Select an incident on Home, then open the Personnel tab.", "info");

  personnelTable = createTable({
    tableEl,
    rowRenderer: renderPersonnelRow,
  });

  const addBtn = document.getElementById("person-add");
  if (addBtn) addBtn.addEventListener("click", addPerson);

  const d4hBtn = document.getElementById("d4h-add");
  if (d4hBtn) d4hBtn.addEventListener("click", addFromD4h);

  // Disable buttons until required fields are set
  updateAddButtonsEnabled();

  // If incident changes while app is open, keep Personnel consistent
  const incidentSelect = document.getElementById("incidentSelect");
  if (incidentSelect) {
    incidentSelect.addEventListener("change", () => {
      updateAddButtonsEnabled();
      if (panel.classList.contains("active")) {
        loadPersonnel();
      }
    });
  }

  // Watch the Home page D4H activity input as well
  const d4hActivityInput = document.getElementById("d4h_activity");
  if (d4hActivityInput) {
    d4hActivityInput.addEventListener("input", () => {
      updateAddButtonsEnabled();
    });
    d4hActivityInput.addEventListener("change", () => {
      updateAddButtonsEnabled();
    });
  }

  wireFilters(personnelTable);
  watchPersonnelTab();

  // menu + modal wiring
  wireMenuAndModal();
  wireConflictModal();
});

window.addEventListener("sar:offline", () => {
  if (personnelTable) personnelTable.setData([]);
  if (personnelMessage) personnelMessage.show("Offline.", "error");
});

window.addEventListener("sar:online", loadPersonnel);