/* message-bar.js
 * Generic message bar controller
 */

export function initMessageBar(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[MessageBar] Element not found: ${id}`);
    return null;
  }

  let _timer = null;

  return {
    show(text, level = "info", timeout = 0) {
      if (_timer) { clearTimeout(_timer); _timer = null; }
      el.textContent = text;
      el.className = `message-bar ${level}`;
      if (timeout > 0) {
        _timer = setTimeout(() => {
          el.textContent = "";
          el.className = "message-bar hidden";
          _timer = null;
        }, timeout);
      }
    },

    hide() {
      if (_timer) { clearTimeout(_timer); _timer = null; }
      el.classList.add("hidden");
    },

    clear() {
      if (_timer) { clearTimeout(_timer); _timer = null; }
      el.textContent = "";
      el.className = "message-bar hidden";
    }
  };
}
