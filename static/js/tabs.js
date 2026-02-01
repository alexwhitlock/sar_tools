function openTab(id, btn) {

  document.querySelectorAll(".tab-panel")
    .forEach(p => p.classList.remove("active"));

  document.querySelectorAll(".tab-button")
    .forEach(b => b.classList.remove("active"));

  const panel = document.getElementById(id);
  if (!panel) return;

  panel.classList.add("active");

  if (btn) {
    btn.classList.add("active");
  }

  /* CRITICAL: Leaflet resize when rectangle tab opens */
  if (id === "rectangle" && window.refreshMap) {
    window.refreshMap();
  }
}

/* expose globally */
window.openTab = openTab;

/* ===============================
   Open left-most visible tab on load
   =============================== */

document.addEventListener("DOMContentLoaded", () => {
  const buttons = Array.from(
    document.querySelectorAll(".tab-button")
  );

  const firstVisibleBtn = buttons.find(btn => {
    return btn.offsetParent !== null; // visible in layout
  });

  if (!firstVisibleBtn) return;

  /* Extract tab id from onclick="openTab('id', this)" */
  const match = firstVisibleBtn
    .getAttribute("onclick")
    ?.match(/openTab\('([^']+)'/);

  if (!match) return;

  const tabId = match[1];
  openTab(tabId, firstVisibleBtn);
});
