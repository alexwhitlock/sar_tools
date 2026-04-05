/* sync-indicator.js
 * Drives the top-bar sync countdown element.
 * Whichever tab is currently polling calls syncStart/syncReset/syncStop.
 */

const _el = () => document.getElementById("sync-countdown");
const _btn = () => document.getElementById("sync-now-btn");

let _ticker = null;
let _secondsLeft = 0;
let _epoch = 0;   // incremented by syncStart; lets deferred syncStop hides detect staleness

function _pad(s) {
  return s < 10 ? `0${s}` : `${s}`;
}

function _setText(s) {
  const el = _el();
  if (el) el.textContent = `Sync in ${_pad(s)}s`;
}

function _tick() {
  _secondsLeft = Math.max(0, _secondsLeft - 1);
  _setText(_secondsLeft);
}

/** Register a callback to be called when the sync-now button is clicked. */
export function onSyncNow(fn) {
  const btn = _btn();
  if (btn) btn.addEventListener("click", fn);
}

/** Start the visible countdown. Call when polling begins. */
export function syncStart(intervalMs) {
  _epoch++;
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  _secondsLeft = Math.round(intervalMs / 1000);
  const el = _el();
  const btn = _btn();
  if (el) { _setText(_secondsLeft); el.classList.remove("hidden"); }
  if (btn) btn.classList.remove("hidden");
  _ticker = setInterval(_tick, 1000);
}

/** Reset to full interval. Call immediately after each poll fires. */
export function syncReset(intervalMs) {
  _secondsLeft = Math.round(intervalMs / 1000);
  _setText(_secondsLeft);
}

/** Show button and "Live" label when SSE is active (no countdown needed). */
export function syncLive() {
  _epoch++;
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  const el = _el();
  const btn = _btn();
  if (el) { el.textContent = "Live"; el.classList.remove("hidden"); }
  if (btn) btn.classList.remove("hidden");
}

/** Stop countdown and hide the element. Call when polling stops.
 *  Hide is deferred one tick so a concurrent syncStart() from another
 *  tab's observer wins the race and keeps the countdown visible. */
export function syncStop() {
  if (_ticker) { clearInterval(_ticker); _ticker = null; }
  const myEpoch = _epoch;
  setTimeout(() => {
    if (_epoch !== myEpoch) return; // syncStart() was called after us
    const el = _el();
    const btn = _btn();
    if (el) el.classList.add("hidden");
    if (btn) btn.classList.add("hidden");
  }, 0);
}
