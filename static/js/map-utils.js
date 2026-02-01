/* map-utils.js
 * Shared Leaflet helpers (offline-aware, dynamic)
 */

let map = null;
let previewLayerGroup = null;
let gridLayerGroup = null;      // 🔴 NEW
let tileLayer = null;
let originMarker = null;
let lastOrigin = null;          // 🔴 NEW


function enableOfflineMode() {
  if (!map) return;

  if (tileLayer && map.hasLayer(tileLayer)) {
    map.removeLayer(tileLayer);
  }

  setOfflineBadge(true);

  refreshOfflineGrid(); 

  console.info("[MapUtils] Offline mode enabled");
}

function enableOnlineMode() {
  if (!map) return;

  if (tileLayer && !map.hasLayer(tileLayer)) {
    tileLayer.addTo(map);
  }

  setOfflineBadge(false);
  
  refreshOfflineGrid(); 

  console.info("[MapUtils] Online mode enabled");
}


function setOfflineBadge(visible) {
  const badge = document.getElementById("offlineBadge");
  if (!badge) return;

  badge.style.display = visible ? "block" : "none";
}


/* Initialize map (call once) */
function initMap(containerId) {
  if (map) return map;

  map = L.map(containerId, {
    zoomControl: true,
    attributionControl: false
  }).setView([45, -75], 7);

  tileLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 18 }
  );

  /* Tile failure → switch to offline mode */
  tileLayer.on("tileerror", () => {
    enableOfflineMode();
  });

  previewLayerGroup = L.featureGroup().addTo(map);
  gridLayerGroup = L.featureGroup().addTo(map);   // 🔴 NEW

  /* Keep grid synced on pan / zoom */
  map.on("moveend zoomend", refreshOfflineGrid);  // 🔴 NEW

  /* Initial state */
  navigator.onLine ? enableOnlineMode() : enableOfflineMode();

  /* React to connectivity changes */
  window.addEventListener("offline", enableOfflineMode);
  window.addEventListener("online", enableOnlineMode);

  return map;
}

/* ===============================
   Preview polygons
   =============================== */

function drawPolygons(coords, style = {}) {
  if (!map || !previewLayerGroup) return;

  previewLayerGroup.clearLayers();

  coords.forEach(c => {
    L.polygon(
      c.map(pt => [pt[1], pt[0]]),
      {
        color: style.color || "#f4271c",
        fillOpacity: style.fillOpacity ?? 0.20,
        weight: style.weight || 2
      }
    ).addTo(previewLayerGroup);
  });
}

/* ===============================
   Origin marker
   =============================== */

function setOriginMarker(lat, lon) {
  if (!map) return;

  if (originMarker) {
    map.removeLayer(originMarker);
    originMarker = null;
  }

  originMarker = L.circleMarker(
    [lat, lon],
    {
      radius: 6,
      color: "#f4271c",
      weight: 2,
      fillColor: "#f4271c",
      fillOpacity: 1
    }
  ).addTo(map);

  lastOrigin = { lat, lon };     // 🔴 track for grid
  refreshOfflineGrid();          // 🔴 redraw grid
}

/* ===============================
   Offline reference grid
   =============================== */

function drawOfflineGrid(lat, lon, spacingM = 100) {
  if (!map || !gridLayerGroup) return;

  gridLayerGroup.clearLayers();

  const bounds = map.getBounds();
  const north = bounds.getNorth();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const west = bounds.getWest();

  // meters → degrees (local approximation, fine for reference grid)
  const latStep = spacingM / 111320;
  const lonStep = spacingM / (111320 * Math.cos(lat * Math.PI / 180));

  const style = {
    color: "#999",
    weight: 1,
    opacity: 0.6
  };

  const lines = 50; // number of lines each direction

  for (let i = -lines; i <= lines; i++) {
    // Vertical grid lines (constant lon)
    const lonLine = lon + i * lonStep;
    L.polyline(
      [
        [south, lonLine],
        [north, lonLine]
      ],
      style
    ).addTo(gridLayerGroup);

    // Horizontal grid lines (constant lat)
    const latLine = lat + i * latStep;
    L.polyline(
      [
        [latLine, west],
        [latLine, east]
      ],
      style
    ).addTo(gridLayerGroup);
  }
}

function refreshOfflineGrid() {
  if (!lastOrigin) return;

  // Only show vector grid when offline
  if (navigator.onLine) {
    if (gridLayerGroup) gridLayerGroup.clearLayers();
    return;
  }

  drawOfflineGrid(lastOrigin.lat, lastOrigin.lon);
}


/* ===============================
   Critical Leaflet fix
   =============================== */

function refreshMap() {
  if (!map) return;

  setTimeout(() => {
    map.invalidateSize();
    if (previewLayerGroup.getLayers().length) {
      map.fitBounds(previewLayerGroup.getBounds());
    }
  }, 50);
}

/* ===============================
   Public API
   =============================== */

window.MapUtils = {
  initMap,
  drawPolygons,
  setOriginMarker,
  refreshMap,
  drawOfflineGrid          // 🔴 exposed if needed later
};
