/**
 * print-map.js
 * Opens a print-ready popup window with a Leaflet map centred on an assignment polygon.
 */

export function printAssignmentMap(asgn) {
  if (!asgn.geometry) {
    alert("No geometry available for this assignment.");
    return;
  }

  const title   = `Assignment ${asgn.number ?? "?"}`;
  const details = [
    asgn.team         ? `Team: ${asgn.team}`            : null,
    asgn.assignmentType ? `Type: ${asgn.assignmentType}` : null,
    asgn.resourceType ? `Resource: ${asgn.resourceType}` : null,
    asgn.op           ? `Op Period: ${asgn.op}`          : null,
    asgn.status       ? `Status: ${asgn.status}`         : null,
  ].filter(Boolean).join("  ·  ");

  const geomJson = JSON.stringify(asgn.geometry);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: Arial, sans-serif;
    }

    .print-header {
      padding: 10px 14px 8px;
      border-bottom: 2px solid #cc5e31;
    }
    .print-header h1   { font-size: 1.1rem; color: #cc5e31; margin-bottom: 2px; }
    .print-header .details { font-size: 0.8rem; color: #444; }

    /* Fixed pixel height — Leaflet needs this to render tiles */
    #map {
      width: 100%;
      height: 560px;
    }

    .print-footer {
      padding: 4px 14px;
      font-size: 0.7rem;
      color: #888;
      border-top: 1px solid #ddd;
    }

    .print-btn {
      position: fixed;
      top: 10px;
      right: 14px;
      padding: 6px 14px;
      background: #cc5e31;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      z-index: 9999;
    }
    .print-btn:hover    { background: #b04e25; }
    .print-btn:disabled { background: #aaa; cursor: default; }

    @page { size: A4 landscape; margin: 10mm; }

    @media print {
      .print-btn  { display: none; }
      /* header ~18mm + footer ~8mm + margins 20mm = ~46mm used; rest is map */
      #map        { height: 170mm; page-break-inside: avoid; }
      body        { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>${title}</h1>
    <div class="details">${details}</div>
  </div>
  <div id="map"></div>
  <div class="print-footer">Printed from SAR Tools &nbsp;·&nbsp; ${new Date().toLocaleString()}</div>
  <button class="print-btn" id="printBtn" disabled>Loading map…</button>

  <script>
    const geometry = ${geomJson};

    const map = L.map("map", { preferCanvas: true });

    const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
      crossOrigin: true,
    });
    tiles.addTo(map);

    const layer = L.geoJSON(geometry, {
      style: {
        color: "#cc5e31",
        weight: 2.5,
        fillColor: "#cc5e31",
        fillOpacity: 0.15,
      }
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [40, 40] });

    // Enable print button once the map has settled on the initial view
    const btn = document.getElementById("printBtn");
    map.once("moveend", () => {
      btn.disabled = false;
      btn.textContent = "Print / Save PDF";
    });

    btn.addEventListener("click", () => {
      // Invalidate size to ensure map renders correctly before print
      map.invalidateSize();
      setTimeout(() => window.print(), 250);
    });
  <\/script>
</body>
</html>`;

  const popup = window.open("", "_blank", "width=960,height=780");
  if (!popup) {
    alert("Pop-up blocked. Please allow pop-ups for this site.");
    return;
  }
  popup.document.write(html);
  popup.document.close();
}
