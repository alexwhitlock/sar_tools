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
    const res = await fetch("/api/incidents");
    if (!res.ok) throw new Error(`GET /api/incidents failed (${res.status})`);
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
      setHint(`Active: ${selectName}`);
    } else {
      sel.value = "";
      setHint(incidents.length ? "No incident selected." : "No incidents yet. Create one.");
    }
  } catch (e) {
    console.error(e);
    setHint(`Incident list error: ${e.message}`);
  }
}

async function createIncident() {
  const nameInput = document.getElementById("incidentNewName");
  const btn = document.getElementById("incidentCreateBtn");
  const hint = document.getElementById("incidentHint");

  const name = nameInput.value.trim();
  if (!name) {
    hint.textContent = "Enter an incident name.";
    return;
  }

  btn.disabled = true;
  hint.textContent = "Creating incident...";

  try {
    const res = await fetch("/api/incident/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ incidentName: name })
    });

    const data = await res.json();
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || "Create failed");
    }

    nameInput.value = "";

    // 🔑 reload and auto-select the created incident
    await loadIncidents(data.incidentId);

    hint.textContent = `Active: ${data.incidentId}`;
  } catch (e) {
    console.error(e);
    hint.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}


document.addEventListener("DOMContentLoaded", async () => {
  console.log("[home.js] DOMContentLoaded");

  if (!$("incidentSelect")) {
    console.warn("[home.js] incidentSelect not found");
    return;
  }

  $("incidentSelect").addEventListener("change", (e) => {
    const val = e.target.value.trim();
    setHint(val ? `Active: ${val}` : "No incident selected.");
  });

  $("incidentCreateBtn")?.addEventListener("click", () => {
    console.log("[home.js] Create clicked");
    createIncident();
  });

  await loadIncidents("");
});
