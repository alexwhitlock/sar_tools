/* rectangle.js – Rectangle Tool */

import { initMessageBar } from "./message-bar.js";
let rectangleMessage = null;

let previewShapes = [];


/* ===============================
  Initialize message bar
=============================== */

document.addEventListener("DOMContentLoaded", () => {
  rectangleMessage = initMessageBar("rectangle-message");
});


/* ===============================
   Action button state (AUTHORITATIVE)
   =============================== */

function updateActionButtons() {
  const hasPreview = previewShapes.length > 0;
  const online = navigator.onLine;

  const exportBtn = document.getElementById("exportBtn");
  const uploadBtn = document.getElementById("uploadBtn");

  if (exportBtn) {
    exportBtn.disabled = !hasPreview;
    exportBtn.title = hasPreview
      ? ""
      : "Generate a preview before exporting";
  }

  if (uploadBtn) {
    const caltopoOffline = document.querySelector('input[name="caltopoMode"][value="offline"]')?.checked ?? false;
    const canUpload = hasPreview && (online || caltopoOffline);
    uploadBtn.disabled = !canUpload;

    if (!hasPreview) {
      uploadBtn.title = "Generate a preview before uploading";
    } else if (!online && !caltopoOffline) {
      uploadBtn.title = "Upload unavailable while offline";
    } else {
      uploadBtn.title = "";
    }
  }
}

/* ===============================
   Timestamp helper
   =============================== */

function getTimestamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, "0");

  return (
    d.getFullYear() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    "_" +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/* ===============================
   Coordinate toggle
   =============================== */

document.getElementById("coordType").addEventListener("change", () => {
  const v = document.getElementById("coordType").value;
  document.getElementById("latlonInputs").style.display =
    v === "latlon" ? "block" : "none";
  document.getElementById("mgrsInputs").style.display =
    v === "mgrs" ? "block" : "none";
});

/* ===============================
   Strict MGRS
   =============================== */

function mgrsToLatLonStrict(raw) {
  if (!raw || !raw.trim())
    throw new Error("MGRS input is required.");

  const s = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const re =
    /^(\d{2})([C-HJ-NP-X]) ([A-HJ-NP-Z]{2}) (\d{5}) (\d{5})$/;

  if (!re.test(s))
    throw new Error("MGRS must be strict: 18T VR 12345 12345");

  let mod = window.mgrs;
  if (mod.default) mod = mod.default;
  const pt = mod.toPoint(s.replace(/ /g, ""));
  return { lat: pt[1], lon: pt[0] };
}

/* ===============================
   Payload
   =============================== */

function getInputPayload() {
  const coordType = document.getElementById("coordType").value;

  let loc;
  if (coordType === "mgrs") {
    loc = mgrsToLatLonStrict(document.getElementById("mgrs").value);
  } else {
    const lat = +document.getElementById("lat").value;
    const lon = +document.getElementById("lon").value;
    if (isNaN(lat) || isNaN(lon))
      throw new Error("Latitude and Longitude are required.");
    loc = { lat, lon };
  }

  return {
    lat: loc.lat,
    lon: loc.lon,
    length: +document.getElementById("length").value,
    width: +document.getElementById("width").value,
    bearing: +document.getElementById("bearing").value,
    rows: +document.getElementById("gridRows").value,
    cols: +document.getElementById("gridCols").value,
    mode: document.getElementById("gridMode").value
  };
}

/* ===============================
   Map init
   =============================== */

MapUtils.initMap("previewMap");

/* ===============================
   Preview
   =============================== */

previewBtn.onclick = () => {
  rectangleMessage.clear()

  try {
    const payload = getInputPayload();

    const { shapes, coords } =
      GeometryUtils.generate(payload);

    previewShapes = shapes;

    MapUtils.drawPolygons(coords);
    MapUtils.setOriginMarker(payload.lat, payload.lon);
    MapUtils.refreshMap();

    updateActionButtons();

    rectangleMessage.show(
      navigator.onLine
        ? "Preview generated."
        : "Preview generated (offline).",
      "success"
    );

    logMessage("SUCCESS", "Preview generated", {
      offline: !navigator.onLine
    });

  } catch (e) {
    rectangleMessage.show(e.message,"error");
    logMessage("ERROR", "Preview failed", e.message);
  }
};


/* ===============================
   Upload
   =============================== */

uploadBtn.onclick = async () => {
  rectangleMessage.clear()

  if (!previewShapes.length) {
    rectangleMessage.show("Generate a preview before uploading.","error");
    return;
  }

  if (!navigator.onLine) {
    rectangleMessage.show("Upload unavailable while offline.","error");
    return;
  }

  const mapId = document.getElementById("mapId").value.trim();
  if (!mapId) {
    rectangleMessage.show("Map ID is required.","error");
    return;
  }

  try {
    rectangleMessage.show("Uploading…","info");

    const mode = document.querySelector('input[name="caltopoMode"]:checked')?.value ?? "online";
    const r = await fetch("/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapId, shapes: previewShapes, mode })
    });

    const d = await r.json();
    if (!r.ok) throw new Error(d.error);

    rectangleMessage.show("Upload complete.","success");
    logMessage("SUCCESS", "Upload complete", d);
  } catch (e) {
    rectangleMessage.show(e.message,"error");
    logMessage("ERROR", "Upload failed", e.message);
  }
};

/* ===============================
   Export
   =============================== */

exportBtn.onclick = () => {
  rectangleMessage.clear()
  
  if (!previewShapes.length) {
    rectangleMessage.show("Generate a preview before exporting.","error");
    return;
  }

  const blob = new Blob(
    [
      JSON.stringify(
        { type: "FeatureCollection", features: previewShapes },
        null,
        2
      )
    ],
    { type: "application/geo+json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `export_${getTimestamp()}.geojson`;
  a.click();

  rectangleMessage.show("GeoJSON exported.","success");
  logMessage("SUCCESS", "GeoJSON exported");
};


/* ===============================
   Initial + connectivity hooks
   =============================== */

window.addEventListener("load", updateActionButtons);
window.addEventListener("online", updateActionButtons);
window.addEventListener("offline", updateActionButtons);
