// packages/web-gui/src/components/toast-region.ts
var TOAST_EVENT = "app:toast";
var ToastRegion = class extends HTMLElement {
  constructor() {
    super();
    this.addEventListener("click", (e) => {
      const t = e.target.closest(".toast");
      if (t) t.remove();
    });
    document.addEventListener(TOAST_EVENT, (e) => {
      const detail = e.detail || { msg: "" };
      this.show(detail.msg, detail.kind === "ok", detail.duration);
    });
  }
  show(msg, ok = false, duration = 4e3) {
    const el = document.createElement("div");
    el.className = `toast ${ok ? "toast-success" : "toast-error"}`;
    el.textContent = msg;
    this.appendChild(el);
    window.setTimeout(() => {
      el.classList.add("toast-leave");
      window.setTimeout(() => el.remove(), 250);
    }, duration);
  }
};
customElements.define("toast-region", ToastRegion);

// packages/web-gui/src/lib/api.ts
function ensureToastContainer() {
  let region = document.querySelector("toast-region");
  if (!region) {
    region = document.createElement("toast-region");
    document.body.appendChild(region);
  }
  return region;
}
function toast(msg, opts = {}) {
  const region = ensureToastContainer();
  const el = document.createElement("div");
  el.className = `toast ${opts.ok ? "toast-success" : "toast-error"}`;
  el.textContent = msg;
  region.appendChild(el);
  window.setTimeout(() => {
    el.classList.add("toast-leave");
    window.setTimeout(() => el.remove(), 250);
  }, opts.duration ?? 4e3);
}
var AUTH_PATHS = /* @__PURE__ */ new Set(["/api/auth/login", "/api/auth/signup"]);
async function api(path, opts = {}) {
  const fetchOpts = {
    method: opts.method || "GET",
    credentials: "same-origin",
    headers: { ...opts.headers || {} }
  };
  if (opts.body !== void 0 && !(opts.body instanceof FormData)) {
    fetchOpts.body = JSON.stringify(opts.body);
    fetchOpts.headers["content-type"] = "application/json";
  } else if (opts.body instanceof FormData) {
    fetchOpts.body = opts.body;
  }
  let res;
  try {
    res = await fetch(path, fetchOpts);
  } catch (e) {
    toast(`Network error: ${e.message}`);
    throw e;
  }
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    try {
      sessionStorage.setItem("login_next", location.pathname + location.search);
    } catch {
    }
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (ct.includes("application/json")) {
      try {
        const err = await res.json();
        if (err?.error && typeof err.error === "object" && err.error.message) {
          msg = err.error.message;
        } else if (typeof err?.error === "string") {
          msg = err.error;
        }
      } catch {
      }
    }
    toast(msg);
    throw new Error(msg);
  }
  if (ct.includes("application/json")) return res.json();
  const text = await res.text();
  return text === "" ? null : text;
}
api.toast = toast;
if (typeof window !== "undefined") {
  window.api = api;
  window.toast = toast;
}

// packages/web-gui/src/components/site-shell.ts
function wireLogoutButton() {
  const btn = document.getElementById("logout-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (err) {
    }
    window.location.href = "/login";
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireLogoutButton);
} else {
  wireLogoutButton();
}

// packages/web-gui/src/components/import-form.ts
var ImportForm = class extends HTMLElement {
  connectedCallback() {
    const bulk = this.querySelector("#bulk-urls");
    if (bulk) {
      bulk.addEventListener("input", () => this.updateCount(bulk));
      this.updateCount(bulk);
    }
    const single = this.querySelector("#single-form");
    const bulkForm = this.querySelector("#bulk-form");
    single?.addEventListener("submit", (e) => this.onSingleSubmit(e, single));
    bulkForm?.addEventListener("submit", (e) => this.onBulkSubmit(e, bulkForm));
  }
  updateCount(textarea) {
    const count = textarea.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).length;
    let counter = this.querySelector("#bulk-count");
    if (!counter) {
      counter = document.createElement("p");
      counter.id = "bulk-count";
      counter.className = "text-muted";
      textarea.parentElement?.appendChild(counter);
    }
    counter.textContent = count === 0 ? "" : `${count} URL${count === 1 ? "" : "s"} ready`;
  }
  async onSingleSubmit(e, form) {
    e.preventDefault();
    const url = form.elements.namedItem("url")?.value?.trim();
    if (!url) return;
    try {
      const created = await fetch("/api/entries", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", origin: location.origin },
        body: JSON.stringify({ url })
      });
      if (created.ok) {
        const entry = await created.json();
        if (entry?.id) {
          window.location.href = `/entry?id=${entry.id}`;
          return;
        }
      }
      this.showError("Could not save URL.");
    } catch {
      this.showError("Network error.");
    }
  }
  async onBulkSubmit(e, form) {
    e.preventDefault();
    const ta = form.elements.namedItem("urls");
    const urls = ta.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) {
      this.showError("Paste at least one URL.");
      return;
    }
    try {
      const res = await fetch("/api/entries/lists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", origin: location.origin },
        body: JSON.stringify({ urls })
      });
      if (res.ok) {
        const arr = await res.json();
        this.showSuccess(`Imported ${Array.isArray(arr) ? arr.length : 0} entries.`);
        ta.value = "";
      } else {
        this.showError("Import failed.");
      }
    } catch {
      this.showError("Network error.");
    }
  }
  showError(msg) {
    const result = this.querySelector("#result");
    if (result) {
      result.className = "alert alert-error";
      result.textContent = msg;
    }
  }
  showSuccess(msg) {
    const result = this.querySelector("#result");
    if (result) {
      result.className = "alert alert-success";
      result.textContent = msg;
    }
  }
};
customElements.define("import-form", ImportForm);
