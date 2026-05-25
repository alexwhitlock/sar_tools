const DURATION_MS    = 4000;
const ANIMATE_OUT_MS = 220;

let container = null;

function getContainer() {
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    document.body.appendChild(container);
  }
  return container;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function showToast(name, action) {
  const isCheckin = action === "checkin";
  const toast = document.createElement("div");
  toast.className = `kiosk-toast ${isCheckin ? "toast-checkin" : "toast-checkout"}`;
  toast.innerHTML =
    `<span><strong>${esc(name)}</strong> ${isCheckin ? "checked in" : "checked out"}</span>` +
    `<div class="toast-bar"></div>`;

  getContainer().appendChild(toast);

  // Two rAF frames so the initial transform is painted before transitioning in.
  // Adding toast-visible also starts the progress bar animation via CSS.
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("toast-visible")));

  setTimeout(() => {
    toast.classList.remove("toast-visible");
    toast.classList.add("toast-hiding");
    setTimeout(() => toast.remove(), ANIMATE_OUT_MS);
  }, DURATION_MS);
}
