/**
 * print-map.js
 * Opens the map preview popup and sends assignment data via postMessage.
 */

export function printAssignmentMap(asgn) {
  if (!asgn.geometry) {
    alert("No geometry available for this assignment.");
    return;
  }

  const params = new URLSearchParams({ asgn: JSON.stringify(asgn) });
  window.open(`/static/print-map-preview.html?${params}`, "_blank");
}
