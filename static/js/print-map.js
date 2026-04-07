/**
 * print-map.js
 * Requests a server-rendered PDF for an assignment map and opens it in a new tab.
 */

export async function printAssignmentMap(asgn, triggerEl) {
  if (!asgn.geometry) {
    alert("No geometry available for this assignment.");
    return;
  }

  const title = `Assignment ${asgn.number ?? "?"}`;
  const details = [
    asgn.team          ? `Team: ${asgn.team}`             : null,
    asgn.assignmentType ? `Type: ${asgn.assignmentType}`  : null,
    asgn.resourceType  ? `Resource: ${asgn.resourceType}` : null,
    asgn.op            ? `Op Period: ${asgn.op}`           : null,
    asgn.status        ? `Status: ${asgn.status}`          : null,
  ].filter(Boolean).join("  \u00b7  ");

  // Give the user feedback while we wait for tiles to be fetched server-side
  const original = triggerEl?.textContent;
  if (triggerEl) {
    triggerEl.disabled = true;
    triggerEl.textContent = "Generating…";
  }

  try {
    const resp = await fetch("/api/assignment/map-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ geometry: asgn.geometry, title, details }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert(`Failed to generate PDF: ${err.error ?? resp.statusText}`);
      return;
    }

    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Revoke after a short delay to free memory once the tab has loaded
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } finally {
    if (triggerEl) {
      triggerEl.disabled = false;
      triggerEl.textContent = original;
    }
  }
}
