function openTab(id, btn) {

  document.querySelectorAll(".tab-panel")
    .forEach(p => p.classList.remove("active"));

  document.querySelectorAll(".tab-button")
    .forEach(b => b.classList.remove("active"));

  // Keep dropdown items in sync (may not exist in sidebar layout)


  const panel = document.getElementById(id);
  if (!panel) return;

  panel.classList.add("active");
  localStorage.setItem("sar_active_tab", id);

  if (btn) {
    btn.classList.add("active");
  }

  // Sync hamburger dropdown item active state
  document.querySelectorAll(".tab-dropdown-item").forEach(item => {
    item.classList.toggle("active", item.dataset.tabId === id);
  });

  // Update hamburger button active state (active if current tab is in dropdown)
  _syncHamburgerActive();

  /* CRITICAL: Leaflet resize when rectangle tab opens */
  if (id === "rectangle" && window.refreshMap) {
    window.refreshMap();
  }
}

/* expose globally */
window.openTab = openTab;

/* ===============================
   Hamburger overflow menu
   =============================== */

function _syncHamburgerActive() {
  const hamburgerBtn = document.getElementById("tabHamburgerBtn");
  if (!hamburgerBtn) return;
  const anyHidden = Array.from(document.querySelectorAll(".tab-button"))
    .some(b => b.classList.contains("active") && b.classList.contains("tab-hidden"));
  hamburgerBtn.classList.toggle("active", anyHidden);
}

function _buildDropdown() {
  const dropdown = document.getElementById("tabDropdown");
  if (!dropdown) return;
  dropdown.innerHTML = "";
  document.querySelectorAll(".tab-button").forEach(btn => {
    if (btn.style.display === "none") return; // skip consoleTabBtn when hidden
    const match = btn.getAttribute("onclick")?.match(/openTab\('([^']+)'/);
    if (!match) return;
    const tabId = match[1];
    const item = document.createElement("button");
    item.type = "button";
    item.className = "tab-dropdown-item" + (btn.classList.contains("active") ? " active" : "");
    item.dataset.tabId = tabId;
    item.textContent = btn.textContent.trim();
    item.addEventListener("click", () => {
      openTab(tabId, btn);
      document.getElementById("tabDropdown")?.classList.add("hidden");
    });
    dropdown.appendChild(item);
  });
}

function _updateTabOverflow() {
  const topBar = document.querySelector(".top-bar");
  const tabsRow = document.getElementById("tabsRow");
  const hamburger = document.getElementById("tabHamburger");
  const hamburgerBtn = document.getElementById("tabHamburgerBtn");
  const controls = document.querySelector(".top-bar-controls");
  if (!topBar || !tabsRow || !hamburger || !controls) return;

  const tabBtns = Array.from(document.querySelectorAll(".tab-button"));

  // Temporarily show all tabs to measure natural width
  tabBtns.forEach(b => b.classList.remove("tab-hidden"));
  hamburger.classList.add("hidden");

  const availableWidth = topBar.offsetWidth - controls.offsetWidth - 48; // 48 = gap + padding
  const tabsNaturalWidth = tabBtns.reduce((sum, b) => {
    if (b.style.display === "none") return sum;
    return sum + b.offsetWidth + 4; // 4px gap
  }, 0);

  if (tabsNaturalWidth > availableWidth) {
    // Switch to hamburger mode — hide all tab buttons, show hamburger
    tabBtns.forEach(b => b.classList.add("tab-hidden"));
    hamburger.classList.remove("hidden");
    _buildDropdown();
  }
  _syncHamburgerActive();
}

document.addEventListener("DOMContentLoaded", () => {
  // Add CSS for tab-hidden
  const style = document.createElement("style");
  style.textContent = ".tab-button.tab-hidden { display: none !important; }";
  document.head.appendChild(style);

  // Hamburger toggle
  document.getElementById("tabHamburgerBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("tabDropdown")?.classList.toggle("hidden");
  });

  // Close dropdown on outside click
  document.addEventListener("click", () => {
    document.getElementById("tabDropdown")?.classList.add("hidden");
  });

  // Watch for resize (only in horizontal tab layout; sidebar layout has no .top-bar)
  const topBarEl = document.querySelector(".top-bar");
  if (topBarEl) new ResizeObserver(_updateTabOverflow).observe(topBarEl);

  // Open last saved tab, falling back to the first tab
  const allBtns = Array.from(document.querySelectorAll(".tab-button"));
  const firstBtn = allBtns[0];
  if (!firstBtn) return;
  const firstMatch = firstBtn.getAttribute("onclick")?.match(/openTab\('([^']+)'/);
  if (!firstMatch) return;

  const savedTab = localStorage.getItem("sar_active_tab");
  const savedBtn = savedTab
    ? allBtns.find(b => b.getAttribute("onclick")?.includes(`'${savedTab}'`))
    : null;
  if (savedTab && savedBtn && document.getElementById(savedTab)) {
    openTab(savedTab, savedBtn);
  } else {
    openTab(firstMatch[1], firstBtn);
  }
});
