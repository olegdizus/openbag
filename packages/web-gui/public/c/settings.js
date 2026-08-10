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

// packages/web-gui/src/components/feed-token-actions.ts
var FeedTokenActions = class extends HTMLElement {
  connectedCallback() {
    this.render();
  }
  get attrs() {
    return {
      hasToken: this.dataset.hasToken === "1",
      token: this.dataset.token || "",
      atomUrl: this.dataset.atomUrl || "",
      rssUrl: this.dataset.rssUrl || ""
    };
  }
  render() {
    const { hasToken, token, atomUrl, rssUrl } = this.attrs;
    const out = document.createElement("pre");
    out.className = "card";
    if (token) {
      out.innerHTML = `<div class="cred-row"><strong>token:</strong> <code>${escapeHtml(token)}</code></div>` + (atomUrl ? `<div class="cred-row"><strong>Atom:</strong> <code>${escapeHtml(atomUrl)}</code></div>` : "") + (rssUrl ? `<div class="cred-row"><strong>RSS:</strong> <code>${escapeHtml(rssUrl)}</code></div>` : "");
    } else if (hasToken) {
      out.textContent = "A feed token is active (hidden). Rotate to generate a new one.";
    } else {
      out.textContent = "No feed token issued.";
    }
    const controls = document.createElement("p");
    controls.innerHTML = '<button type="button" data-action="refresh">Refresh</button> <button type="button" data-action="rotate">Rotate</button> <button type="button" class="btn-danger" data-action="revoke">Revoke</button>';
    this.innerHTML = "";
    this.appendChild(out);
    this.appendChild(controls);
    controls.querySelectorAll("[data-action]").forEach(
      (btn) => btn.addEventListener("click", this.onClick)
    );
  }
  onClick = async (e) => {
    const action = e.target.dataset.action;
    if (action === "rotate" && !window.confirm("Generate a new feed token? The old one will stop working.")) return;
    if (action === "revoke" && !window.confirm("Revoke the feed token?")) return;
    try {
      if (action === "refresh") {
        const data = await api(
          "/api/feed/token",
          {}
        );
        this.dataset.token = data.feed_token ?? "";
        this.dataset.atomUrl = data.atom_url ?? "";
        this.dataset.rssUrl = data.rss_url ?? "";
        this.render();
        api.toast("Token refreshed", { ok: true });
      } else if (action === "rotate") {
        const data = await api(
          "/api/feed/token",
          { method: "POST" }
        );
        this.dataset.token = data.feed_token;
        this.dataset.atomUrl = data.atom_url;
        this.dataset.rssUrl = data.rss_url;
        this.render();
        api.toast("Token rotated", { ok: true });
      } else if (action === "revoke") {
        await api("/api/feed/token", { method: "DELETE" });
        this.dataset.token = "";
        this.dataset.atomUrl = "";
        this.dataset.rssUrl = "";
        this.render();
        api.toast("Token revoked", { ok: true });
      }
    } catch {
    }
  };
};
function escapeHtml(s) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(s ?? "").replace(/[&<>"']/g, (c) => map[c]);
}
customElements.define("feed-token-actions", FeedTokenActions);

// packages/web-gui/src/entrypoints/settings.ts
var form = document.getElementById("settings-form");
if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = document.getElementById("result");
    if (result) result.textContent = "";
    try {
      const body = {
        theme: form.theme?.value,
        items_per_page: parseInt(form.items_per_page?.value || "30", 10),
        reading_speed: parseInt(form.reading_speed?.value || "200", 10),
        language: form.language?.value,
        action_mark_as_read: form.action_mark_as_read?.checked,
        list_mode: form.list_mode?.checked,
        display_thumbnails: form.display_thumbnails?.checked
      };
      await fetch("/api/config", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", origin: location.origin },
        body: JSON.stringify(body)
      });
      if (result) {
        result.textContent = "Saved.";
        result.className = "alert alert-success";
      }
    } catch {
      if (result) {
        result.textContent = "Could not save.";
        result.className = "alert alert-error";
      }
    }
  });
}
