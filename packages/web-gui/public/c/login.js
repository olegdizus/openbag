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

// packages/web-gui/src/entrypoints/login.ts
function show(el, msg, kind = "error") {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${kind}`;
}
function wire(id, apiPath, next) {
  const form = document.getElementById(id);
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = document.getElementById("result");
    show(result, "");
    try {
      const data = await api(apiPath, {
        method: "POST",
        body: {
          username: form.username.value,
          password: form.password.value,
          ...form.email ? { email: form.email.value || void 0 } : {}
        }
      });
      if (data.user) {
        window.location.href = next;
      }
    } catch (err) {
      show(result, err.message || "Could not authenticate");
    }
  });
}
function init() {
  const next = (() => {
    const u = new URL(location.href);
    const raw = u.searchParams.get("next") || "/entries";
    return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/entries";
  })();
  wire("login-form", "/api/auth/login", next);
  wire("signup-form", "/api/auth/signup", next);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
