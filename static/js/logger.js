/* logger.js
 * Global debug / error console with JSON pretty printing
 */

(function () {
  const consoleEl = document.getElementById("globalConsole");

  function isJsonString(str) {
    if (typeof str !== "string") return false;
    try {
      JSON.parse(str);
      return true;
    } catch {
      return false;
    }
  }

  function formatPayload(payload) {
    if (payload === undefined || payload === null) {
      return "";
    }

    // If already an object → pretty print
    if (typeof payload === "object") {
      return JSON.stringify(payload, null, 2);
    }

    // If string that looks like JSON → parse + pretty print
    if (typeof payload === "string" && isJsonString(payload)) {
      return JSON.stringify(JSON.parse(payload), null, 2);
    }

    // Fallback: plain string
    return String(payload);
  }

  window.logMessage = function (level, message, payload) {
    if (!consoleEl) return;

    const ts = new Date().toLocaleTimeString();
    const lines = [];

    lines.push(`[${ts}] [${level}] ${message}`);

    const formatted = formatPayload(payload);
    if (formatted) {
      lines.push(formatted);
    }

    const entry = document.createElement("pre");
    entry.textContent = lines.join("\n");

    consoleEl.appendChild(entry);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  const mapIdInput = document.getElementById("mapId");
  if (!mapIdInput) return;

  mapIdInput.addEventListener("change", () => {
    logMessage("INFO", "Map ID updated", mapIdInput.value.trim());
  });
});

