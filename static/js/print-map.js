/**
 * print-map.js
 * Opens the map preview popup and sends assignment data via postMessage.
 */

export function printAssignmentMap(asgn) {
  if (!asgn.geometry) {
    alert("No geometry available for this assignment.");
    return;
  }

  const popup = window.open("/static/print-map-preview.html", "_blank");
  const onReady = (e) => {
    if (e.source === popup && e.data === "print-map-ready") {
      window.removeEventListener("message", onReady);
      popup.postMessage({ type: "asgn", data: asgn }, "*");
    }
  };
  window.addEventListener("message", onReady);
}
