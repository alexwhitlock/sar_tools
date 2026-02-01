/* geometry-utils.js
 * Pure geometry generation (authoritative)
 */

const EARTH_RADIUS_M = 6371000;

/* ===============================
   Destination point
   =============================== */

function destPoint(latDeg, lonDeg, distM, bearingDeg) {
  const φ1 = latDeg * Math.PI / 180;
  const λ1 = lonDeg * Math.PI / 180;
  const θ = bearingDeg * Math.PI / 180;
  const δ = distM / EARTH_RADIUS_M;

  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);

  const sinφ2 =
    sinφ1 * Math.cos(δ) +
    cosφ1 * Math.sin(δ) * Math.cos(θ);

  const φ2 = Math.asin(sinφ2);

  const y = Math.sin(θ) * Math.sin(δ) * cosφ1;
  const x = Math.cos(δ) - sinφ1 * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);

  return {
    lat: φ2 * 180 / Math.PI,
    lon: ((λ2 * 180 / Math.PI + 540) % 360) - 180
  };
}

/* ===============================
   Rectangle
   =============================== */

function buildRectangle(lat, lon, length, width, bearing) {
  const p0 = { lat, lon };
  const p1 = destPoint(lat, lon, length, bearing);
  const p2 = destPoint(p1.lat, p1.lon, width, bearing + 90);
  const p3 = destPoint(lat, lon, width, bearing + 90);

  return [
    [p0.lon, p0.lat],
    [p1.lon, p1.lat],
    [p2.lon, p2.lat],
    [p3.lon, p3.lat],
    [p0.lon, p0.lat]
  ];
}

/* ===============================
   Grid generator
   =============================== */

function generateGrid(payload) {
  let { lat, lon, length, width, bearing, rows, cols, mode } = payload;

  if (mode === "center") {
    const halfCols = cols / 2;
    const halfRows = rows / 2;

    const p1 = destPoint(lat, lon, halfCols * width, bearing - 90);
    const p2 = destPoint(p1.lat, p1.lon, halfRows * length, bearing + 180);
    lat = p2.lat;
    lon = p2.lon;
  }

  const shapes = [];
  const coords = [];
  let index = 1;

  for (let c = 0; c < cols; c++) {
    const col = destPoint(lat, lon, c * width, bearing + 90);
    for (let r = 0; r < rows; r++) {
      const cell = destPoint(col.lat, col.lon, r * length, bearing);
      const rect = buildRectangle(
        cell.lat,
        cell.lon,
        length,
        width,
        bearing
      );

      coords.push(rect);
      shapes.push({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [rect] },
        properties: {
          title: `API${index}`
        }
      });

      index++;
    }
  }

  return { shapes, coords };
}

/* ===============================
   Public API
   =============================== */

window.GeometryUtils = {
  generate: generateGrid
};
