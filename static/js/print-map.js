/**
 * print-map.js
 * Opens a preview popup with an interactive Leaflet map and a settings panel.
 * Generates a PDF server-side when the user clicks "Generate PDF".
 */

export function printAssignmentMap(asgn) {
  if (!asgn.geometry) {
    alert("No geometry available for this assignment.");
    return;
  }

  const isArea   = asgn.geometry?.type === "Polygon";
  const title    = `Assignment ${asgn.number ?? "?"}`;
  const detailParts = [
    asgn.team          ? `Team: ${asgn.team}`             : null,
    asgn.assignmentType ? `Type: ${asgn.assignmentType}`  : null,
    asgn.resourceType  ? `Resource: ${asgn.resourceType}` : null,
    asgn.op            ? `Op Period: ${asgn.op}`           : null,
    asgn.status        ? `Status: ${asgn.status}`          : null,
  ].filter(Boolean);
  const detailStr = detailParts.join("  \u00b7  ");
  const geomJson  = JSON.stringify(asgn.geometry);

  const detailRows = detailParts
    .map(d => `<div class="detail-row">${d}</div>`)
    .join("");

  const vertexSection = isArea ? `
    <div class="section">
      <div class="section-title">Options</div>
      <label class="option-label">
        <input type="checkbox" id="showVertices">
        Vertex coordinates
      </label>
    </div>` : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Map: ${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      height: 100%;
      display: flex;
      flex-direction: row;
      overflow: hidden;
      font-family: Arial, sans-serif;
    }

    #map { flex: 1; min-width: 0; }

    #panel {
      width: 230px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      padding: 14px 12px 12px;
      border-left: 2px solid #cc5e31;
      background: #f9f9f9;
      overflow-y: auto;
      gap: 10px;
    }

    .panel-title {
      font-size: 1rem;
      font-weight: 700;
      color: #cc5e31;
      line-height: 1.2;
    }

    .detail-row {
      font-size: 0.75rem;
      color: #555;
    }

    .section {
      border-top: 1px solid #ddd;
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .section-title {
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #888;
    }

    .option-label {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 0.83rem;
      color: #333;
      cursor: pointer;
    }

    .spacer { flex: 1; }

    #generateBtn {
      padding: 10px;
      background: #cc5e31;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
    }
    #generateBtn:hover    { background: #b04e25; }
    #generateBtn:disabled { background: #aaa; cursor: default; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="panel">
    <div class="panel-title">${title}</div>
    ${detailRows}
    ${vertexSection}
    <div class="spacer"></div>
    <button id="generateBtn">Generate PDF</button>
  </div>

  <script>
    const geometry  = ${geomJson};
    const isArea    = ${isArea};
    const title     = ${JSON.stringify(title)};
    const detailStr = ${JSON.stringify(detailStr)};

    // --- Map setup ---
    const map = L.map("map");
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "\u00a9 OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const layer = L.geoJSON(geometry, {
      style: { color: "#cc5e31", weight: 2.5, fillColor: "#cc5e31", fillOpacity: 0.15 },
    }).addTo(map);
    map.fitBounds(layer.getBounds(), { padding: [40, 40] });

    // --- Vertex markers (Area only) ---
    const vertexLayer = L.layerGroup().addTo(map);
    const vertices    = isArea ? geometry.coordinates[0].slice(0, -1) : [];

    function setVertexMarkers(show) {
      vertexLayer.clearLayers();
      if (!show) return;
      vertices.forEach(([lon, lat], i) => {
        const n    = i + 1;
        const icon = L.divIcon({
          className: "",
          html: '<div style="width:22px;height:22px;border-radius:50%;'
              + 'background:#cc5e31;color:#fff;font-size:11px;font-weight:700;'
              + 'display:flex;align-items:center;justify-content:center;'
              + 'border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)">'
              + n + "<\\/div>",
          iconSize:   [22, 22],
          iconAnchor: [11, 11],
        });
        L.marker([lat, lon], { icon }).addTo(vertexLayer);
      });
    }

    const checkbox = document.getElementById("showVertices");
    checkbox?.addEventListener("change", () => setVertexMarkers(checkbox.checked));

    // --- Generate PDF ---
    document.getElementById("generateBtn").addEventListener("click", async () => {
      const btn = document.getElementById("generateBtn");
      btn.disabled    = true;
      btn.textContent = "Generating\u2026";

      const center       = map.getCenter();
      const zoom         = Math.round(map.getZoom());
      const showVertices = checkbox?.checked ?? false;

      try {
        const resp = await fetch("/api/assignment/map-pdf", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            geometry,
            title,
            details:       detailStr,
            center:        [center.lng, center.lat],
            zoom,
            show_vertices: showVertices,
          }),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          alert("Failed to generate PDF: " + (err.error ?? resp.statusText));
          return;
        }

        const blob     = await resp.blob();
        const url      = URL.createObjectURL(blob);
        const filename = title.replace(/\s+/g, "_") + ".pdf";

        // Trigger download and also open in a new tab for viewing
        const a    = document.createElement("a");
        a.href     = url;
        a.download = filename;
        a.click();

        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } finally {
        btn.disabled    = false;
        btn.textContent = "Generate PDF";
      }
    });
  <\/script>
</body>
</html>`;

  const popup = window.open("", "_blank", "width=1100,height=720");
  if (!popup) {
    alert("Pop-up blocked. Please allow pop-ups for this site.");
    return;
  }
  popup.document.write(html);
  popup.document.close();
}
