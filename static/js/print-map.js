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

    html, body {
      height: 100%;
      overflow: hidden;
      font-family: Arial, sans-serif;
      display: flex;
      flex-direction: column;
    }

    .print-header {
      padding: 10px 14px 8px;
      border-bottom: 2px solid #cc5e31;
    }
    .print-header h1   { font-size: 1.1rem; color: #cc5e31; margin-bottom: 2px; }
    .print-header .details { font-size: 0.8rem; color: #444; }

    .print-header { flex-shrink: 0; }
    .print-footer { flex-shrink: 0; }

    /* Map fills all remaining space */
    #map { flex: 1; min-height: 0; }

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

    @page { size: A4 landscape; margin: 8mm; }

    @media print {
      .print-btn   { display: none; }
      body         { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .print-header { page-break-after: avoid; padding: 4px 14px 4px; }
      .print-header h1 { font-size: 0.95rem; }
      .print-header .details { font-size: 0.72rem; }
      html, body   { overflow: visible; height: auto; display: block; }
      #map         { height: 155mm; page-break-inside: avoid; page-break-after: avoid; }
      .print-footer { page-break-before: avoid; padding: 2px 14px; }
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

    const btn = document.getElementById("printBtn");
    btn.disabled = false;
    btn.textContent = "Print / Save PDF";

    const bounds = layer.getBounds();

    // Before printing, resize map div to match physical print area so
    // Leaflet re-fits the bounds at the same aspect ratio as the printed page.
    // A4 landscape @ 8mm margins: 281mm × 194mm print area.
    // Header ~28px + footer ~18px leaves ~148mm for map → but we set 155mm in CSS.
    // At 96 dpi: 281mm ≈ 1063px wide, 155mm ≈ 586px tall.
    window.addEventListener("beforeprint", () => {
      const mapEl = document.getElementById("map");
      mapEl.style.width  = "1063px";
      mapEl.style.height = "586px";
      map.invalidateSize({ animate: false });
      map.fitBounds(bounds, { padding: [20, 20], animate: false });
    });

    window.addEventListener("afterprint", () => {
      const mapEl = document.getElementById("map");
      mapEl.style.width  = "";
      mapEl.style.height = "";
      map.invalidateSize({ animate: false });
      map.fitBounds(bounds, { padding: [40, 40], animate: false });
    });

    btn.addEventListener("click", () => window.print());
  <\/script>
</body>
</html>`;

  // Open at A4 landscape aspect ratio (1.414:1) so WYSIWYG with print output
  const popup = window.open("", "_blank", "width=1040,height=780");
  if (!popup) {
    alert("Pop-up blocked. Please allow pop-ups for this site.");
    return;
  }
  popup.document.write(html);
  popup.document.close();
}
