/* table-core.js
 * Generic sortable / filterable table engine
 */

export function createTable(config) {
  const state = {
    data: [],
    sort: { key: null, dir: 1 },
    filters: {}
  };

  const tableEl = config.tableEl;
  const tbody = tableEl.querySelector("tbody");

  /* ===============================
     Helpers
     =============================== */

  function isBlank(value) {
    return (
      value === null ||
      value === undefined ||
      (typeof value === "string" && value.trim() === "")
    );
  }

  function getColumnType(key) {
    return config.columnTypes?.[key] || "string";
  }

  function compareValues(a, b, key, type, dir) {
    const aBlank = isBlank(a);
    const bBlank = isBlank(b);

    /* --- Blank-last rule (independent of direction) --- */
    if (aBlank && bBlank) return 0;
    if (aBlank) return 1;
    if (bBlank) return -1;

    /* --- Explicit sort order (e.g. status) --- */
    const orderMap = config.sortOrders?.[key];
    if (orderMap) {
      const av = orderMap[a] ?? Number.MAX_SAFE_INTEGER;
      const bv = orderMap[b] ?? Number.MAX_SAFE_INTEGER;
      return (av - bv) * dir;
    }

    /* --- Numeric --- */
    if (type === "number") {
      return (Number(a) - Number(b)) * dir;
    }

    /* --- String (default) --- */
    return String(a).localeCompare(String(b)) * dir;
  }

  /* ===============================
     Filtering
     =============================== */

  function applyFilters(rows) {
    return rows.filter(row =>
      Object.entries(state.filters).every(([key, filter]) => {
        if (!filter || filter.value == null || filter.value === "") {
          return true;
        }

        const cell = row[key];
        const cellStr = String(cell ?? "").toUpperCase();

        /* --- Multi-select support --- */
        if (Array.isArray(filter.value)) {
          if (filter.value.length === 0) return true;

          return filter.value
            .map(v => String(v).toUpperCase())
            .includes(cellStr);
        }

        const filterStr = String(filter.value).toUpperCase();

        switch (filter.type) {
          case "equals":
            return cellStr === filterStr;

          case "startsWith":
            return cellStr.startsWith(filterStr);

          case "contains":
          default:
            return cellStr.includes(filterStr);
        }
      })
    );
  }

  /* ===============================
     Sorting
     =============================== */

  function applySort(rows) {
    const { key, dir } = state.sort;
    if (!key) return rows;

    const primaryType = getColumnType(key);
    const secondaryKeys = config.secondarySort?.[key] || [];

    return [...rows].sort((a, b) => {
      /* --- Primary sort --- */
      const primary = compareValues(
        a[key],
        b[key],
        key,
        primaryType,
        dir
      );

      if (primary !== 0) return primary;

      /* --- Secondary sort(s), always ASC --- */
      for (const secKey of secondaryKeys) {
        const secType = getColumnType(secKey);
        const result = compareValues(
          a[secKey],
          b[secKey],
          secKey,
          secType,
          1
        );

        if (result !== 0) return result;
      }

      return 0;
    });
  }

  /* ===============================
     Rendering
     =============================== */

  function render() {
    tbody.innerHTML = "";

    let rows = applyFilters(state.data);
    rows = applySort(rows);

    rows.forEach(row => {
      tbody.appendChild(config.rowRenderer(row));
    });
  }

  /* ===============================
     Sorting UI
     =============================== */

  function sortBy(key) {
    if (state.sort.key === key) {
      state.sort.dir *= -1;
    } else {
      state.sort = { key, dir: 1 };
    }

    updateSortIndicators();
    render();
  }

  function updateSortIndicators() {
    tableEl.querySelectorAll("th").forEach(th => {
      th.classList.remove("sorted-asc", "sorted-desc");

      if (th.dataset.key === state.sort.key) {
        th.classList.add(
          state.sort.dir === 1 ? "sorted-asc" : "sorted-desc"
        );
      }
    });
  }

  function wireSorting() {
    tableEl.querySelectorAll("th[data-key]").forEach(th => {
      th.classList.add("sortable");
      th.addEventListener("click", () => sortBy(th.dataset.key));
    });
  }

  wireSorting();

  /* ===============================
     Public API
     =============================== */

  return {
    setData(data) {
      state.data = Array.isArray(data) ? data : [];
      render();
    },

    /* ✅ FIXED: proper filter object + cleanup */
    setFilter(key, value, type = "contains") {
      if (
        value == null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      ) {
        delete state.filters[key];
      } else {
        state.filters[key] = { value, type };
      }

      render();
    },

    clearFilters() {
      state.filters = {};
      render();
    },

    render
  };
}
