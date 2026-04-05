/* sync-indicator.js
 * Drives the top-bar sync pill.
 */

const _pill = () => document.getElementById("sync-pill");
const _label = () => document.getElementById("sync-countdown");
const _btn = () => document.getElementById("sync-now-btn");

let _epoch = 0;

/** Register a callback for the Sync Now button. */
export function onSyncNow(fn) {
  const btn = _btn();
  if (btn) btn.addEventListener("click", fn);
}

/** Show pulsing green pill with live user count. */
export function syncLive(users) {
  _epoch++;
  const pill = _pill();
  const label = _label();
  if (!pill) return;
  const word = users === 1 ? "User" : "Users";
  if (label) label.textContent = `LIVE · ${users} ${word}`;
  pill.classList.remove("offline", "hidden");
}

/** Show solid red pill when SSE connection is lost. */
export function syncOffline() {
  _epoch++;
  const pill = _pill();
  const label = _label();
  if (!pill) return;
  if (label) label.textContent = "Offline";
  pill.classList.add("offline");
  pill.classList.remove("hidden");
}

/** Hide the pill entirely (no incident selected). */
export function syncStop() {
  const myEpoch = _epoch;
  setTimeout(() => {
    if (_epoch !== myEpoch) return;
    const pill = _pill();
    if (pill) pill.classList.add("hidden");
  }, 0);
}
