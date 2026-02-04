console.log("[home.js] LOADED");

function $(id) { return document.getElementById(id); }

function setHint(msg) {
  const el = $("incidentHint");
  if (el) el.textContent = msg;
}

async function loadIncidents(selectName = "") {
  const sel = $("incidentSelect");
  if (!sel) return;

  // Always show placeholder immediately
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "— Select an incident —";
  sel.appendChild(ph);

  try {
    const res = await fetch("/api/get_incidents");
    if (!res.ok) throw new Error(`GET /api/get_incidents failed (${res.status})`);
    const data = await res.json();

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
      sel.dataset.prev = selectName; // remember active
      setHint(`Active: ${selectName}`);
    } else {
      sel.value = "";
      sel.dataset.prev = "";
      setHint(incidents.length ? "No incident selected." : "No incidents yet. Create one.");
    }
  } catch (e) {
    console.error(e);
    setHint(`Incident list error: ${e.message}`);
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
  const hint = $("incidentHint");

  const name = (nameInput?.value || "").trim();
  if (!name) {
    hint.textContent = "Enter an incident name.";
    return;
  }

  btn.disabled = true;
  hint.textContent = "Creating incident...";

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

    // reload and auto-select the created incident
    await loadIncidents(data.incidentId);

    // ensure backend is "opened" too (migrations/readiness)
    try {
      await openIncident(data.incidentId);
    } catch (e) {
      console.error(e);
      // keep UI selection; just surface the backend-open problem
      setHint(`Created, but open failed: ${e.message}`);
      return;
    }

    hint.textContent = `Active: ${data.incidentId}`;
  } catch (e) {
    console.error(e);
    hint.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}

/* ===============================
   Home tab activation watcher
   =============================== */

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
      loadIncidents(current); // refresh list, keep current selection if possible
    }
    wasActive = isActive;
  });

  observer.observe(panel, {
    attributes: true,
    attributeFilter: ["class"]
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("[home.js] DOMContentLoaded");

  if (!$("incidentSelect")) {
    console.warn("[home.js] incidentSelect not found");
    return;
  }

  $("incidentSelect").addEventListener("change", async (e) => {
    const sel = e.target;
    const val = sel.value.trim();
    const prev = sel.dataset.prev || "";

    if (!val) {
      sel.dataset.prev = "";
      setHint("No incident selected.");
      return;
    }

    setHint(`Opening: ${val}...`);

    try {
      await openIncident(val);
      sel.dataset.prev = val;
      setHint(`Active: ${val}`);
    } catch (err) {
      console.error(err);
      sel.value = prev;
      setHint(`Open failed: ${err.message}`);
    }
  });

  $("incidentCreateBtn")?.addEventListener("click", () => {
    console.log("[home.js] Create clicked");
    createIncident();
  });

  watchHomeTab();       // ✅ IMPORTANT: start watching activation
  await loadIncidents("");
});
