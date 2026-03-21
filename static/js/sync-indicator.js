/* sync-indicator.js
 * Drives the top-bar sync countdown element.
 * Whichever tab is currently polling calls syncStart/syncReset/syncStop.
 */

const _el = () => document.getElementById("sync-countdown");

let _ticker = null;
let _secondsLeft = 0;

function _tick() {
  _secondsLeft = Math.max(0, _secondsLeft - 1);
  const el = _el();
  if (el) el.textContent = `Sync in ${_secondsLeft}s`;
}

/** Start the visible countdown. Call when polling begins. */
export function syncStart(intervalMs) {
  syncStop();
  _secondsLeft = Math.round(intervalMs / 1000);
  const el = _el();
  if (el) {
    el.textContent = `Sync in ${_secondsLeft}s`;
    el.classList.remove("hidden");
  }
  _ticker = setInterval(_tick, 1000);
}

/** Reset to full interval. Call immediately after each poll fires. */
export function syncReset(intervalMs) {
  _secondsLeft = Math.round(intervalMs / 1000);
  const el = _el();
  if (el) el.textContent = `Sync in ${_secondsLeft}s`;
}

/** Stop countdown and hide the element. Call when polling stops. */
export function syncStop() {
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  const el = _el();
  if (el) el.classList.add("hidden");
}
