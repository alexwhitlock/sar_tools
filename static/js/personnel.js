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

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${escapeHtml(p.name)}</td>
    <td>${escapeHtml(p.team)}</td>
    <td class="actions-cell">
      <button
        type="button"
        class="person-menu-btn"
        data-person-key="${escapeHtml(key)}"
        title="Actions"
        aria-label="Actions">⋮</button>
    </td>
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
    const resp = await fetch(
      `/api/personnel?incidentName=${encodeURIComponent(incidentName)}`
    );
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(data.error || `HTTP ${resp.status}`);
    }

    logMessage("INFO", "Personnel received", data);

    // Normalize to array
    const arr = Array.isArray(data) ? data : [];
    personnelCache = arr;

    if (!arr.length) {
      personnelMessage.show(
        "No personnel yet. Click + Person to add someone.",
        "info"
      );
      personnelTable.setData([]);
      return;
    }

    personnelMessage.show(`Loaded ${arr.length} people.`, "info");
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
  };
}

function openMenu(anchorBtn, personKey) {
  const { menu } = getUiEls();
  if (!menu) return;

  activePersonKey = personKey;

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

function openPersonModal(mode, person = null) {
  const { backdrop, titleEl, nameInput } = getUiEls();
  if (!backdrop || !titleEl || !nameInput) return;

  modalMode = mode;
  titleEl.textContent = mode === "add" ? "Add Person" : "Edit Person";

  nameInput.value = person?.name ?? "";

  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");

  // Focus first input
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

async function apiUpdatePerson({ incidentName, personKey, name }) {
  const resp = await fetch("/api/personnel/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incidentName, personKey, name }),
  });

  const data = await resp.json().catch(() => ({}));
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

/* ===============================
   Add person (now modal-based)
   =============================== */

function addPerson() {
  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  activePersonKey = null;
  openPersonModal("add", null);
}

/* ===============================
   Add from D4H (stub for now)
   =============================== */

function addFromD4h() {
  const incidentName = requireIncidentOrError();
  if (!incidentName) return;

  const activityId = getCurrentD4hActivityId();
  if (!activityId) {
    // Should be disabled already, but keep safety
    personnelMessage.show("Enter a D4H Activity ID on Home first.", "error");
    return;
  }

  personnelMessage.show(
    `D4H import for activity ${activityId} not wired yet.`,
    "info"
  );
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

  const teamInput = document.getElementById("filter-team");
  if (teamInput) {
    teamInput.addEventListener("input", (e) => {
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

    if (action === "edit") {
      const person = findPersonInCache(activePersonKey);
      if (!person) {
        personnelMessage.show("Could not find that person record.", "error");
        return;
      }
      openPersonModal("edit", person);
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

  // Escape closes both
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      closePersonModal();
    }
  });

  // Save (Add or Edit)
  saveBtn.addEventListener("click", async () => {
    const incidentName = requireIncidentOrError();
    if (!incidentName) return;

    const name = nameInput.value.trim();

    if (!name) {
      window.alert("Name is required.");
      nameInput.focus();
      return;
    }

    try {
      personnelMessage.show(
        modalMode === "add" ? "Adding person…" : "Saving changes…",
        "info"
      );

      if (modalMode === "add") {
        await apiAddPerson({ incidentName, name });
      } else {
        await apiUpdatePerson({
          incidentName,
          personKey: activePersonKey,
          name,
        });
      }

      closePersonModal();
      await loadPersonnel();
      personnelMessage.show(
        modalMode === "add" ? "Person added." : "Changes saved.",
        "info"
      );
    } catch (err) {
      logMessage("ERROR", "Failed to save person", err.message);
      personnelMessage.show(`Failed to save: ${err.message}`, "error");
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
});