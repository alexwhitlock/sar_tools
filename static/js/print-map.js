/**
 * print-map.js
 * Opens the map preview popup and sends assignment data via postMessage.
 */

export function printAssignmentMap(asgn) {
  if (!asgn.geometry) {
    alert("No geometry available for this assignment.");
    return;
  }

  const popup = window.open(
    "/static/print-map-preview.html",
    "_blank",
    "width=1100,height=720"
  );
  if (!popup) {
    alert("Pop-up blocked. Please allow pop-ups for this site.");
    return;
  }

  // Wait for the popup to signal it has loaded, then send the assignment data.
  const onMessage = (e) => {
    if (e.source !== popup) return;
    if (e.data?.type !== "ready") return;
    window.removeEventListener("message", onMessage);
    popup.postMessage({ type: "init", asgn }, window.location.origin);
  };
  window.addEventListener("message", onMessage);
}
