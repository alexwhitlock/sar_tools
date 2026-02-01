/* console-toggle.js
 * Hidden debug console toggle (FAB + keyboard)
 */

document.addEventListener("DOMContentLoaded", () => {

  const consoleBtn = document.getElementById("consoleTabBtn");
  const fab = document.getElementById("consoleFab");

  if (!consoleBtn) {
    console.warn("[ConsoleToggle] consoleTabBtn not found");
    return;
  }

  function showConsole() {
    consoleBtn.style.display = "inline-block";

    if (typeof window.openTab === "function") {
      window.openTab("console", consoleBtn);
    } else {
      console.error("[ConsoleToggle] openTab() not available");
    }
  }

  function hideConsole() {
    // Hide the console tab button
    consoleBtn.style.display = "none";

    // Find the left-most visible tab button
    const visibleBtn = Array.from(
      document.querySelectorAll(".tab-button")
    ).find(btn => btn.offsetParent !== null);

    if (!visibleBtn) return;

    // Extract tab id from onclick="openTab('id', this)"
    const match = visibleBtn
      .getAttribute("onclick")
      ?.match(/openTab\('([^']+)'/);

    if (!match) return;

    const tabId = match[1];

    // Activate the fallback tab
    if (typeof window.openTab === "function") {
      window.openTab(tabId, visibleBtn);
    }
  }

  function toggleConsole() {
    const isHidden = consoleBtn.style.display === "none";
    isHidden ? showConsole() : hideConsole();
  }

  /* Keyboard shortcut: Ctrl + ` */
  document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key === "`") {
      e.preventDefault();
      toggleConsole();
    }
  });

});
