/* message-bar.js
 * Generic message bar controller
 */

export function initMessageBar(id) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[MessageBar] Element not found: ${id}`);
    return null;
  }

  return {
    show(text, level = "info") {
      el.textContent = text;
      el.className = `message-bar ${level}`;
    },

    hide() {
      el.classList.add("hidden");
    },

    clear() {
      el.textContent = "";
      el.className = "message-bar hidden";
    }
  };
}
