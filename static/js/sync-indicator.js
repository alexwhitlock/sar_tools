/* sync-indicator.js
 * Drives the top-bar sync status element.
 */

const _el = () => document.getElementById("sync-countdown");
const _btn = () => document.getElementById("sync-now-btn");

let _epoch = 0;

/** Register a callback to be called when the sync-now button is clicked. */
export function onSyncNow(fn) {
  const btn = _btn();
  if (btn) btn.addEventListener("click", fn);
}

/** Show "Live" label and sync button when SSE is active. */
export function syncLive() {
  _epoch++;
  const el = _el();
  const btn = _btn();
  if (el) { el.textContent = "Live"; el.classList.remove("hidden"); }
  if (btn) btn.classList.remove("hidden");
}

/** Hide the indicator. Deferred one tick so a concurrent syncLive() wins the race. */
export function syncStop() {
  const myEpoch = _epoch;
  setTimeout(() => {
    if (_epoch !== myEpoch) return;
    const el = _el();
    const btn = _btn();
    if (el) el.classList.add("hidden");
    if (btn) btn.classList.add("hidden");
  }, 0);
}
