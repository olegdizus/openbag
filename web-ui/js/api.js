// web-ui/js/api.js — single fetch wrapper for the Worker API.
//
// Every page uses `api()` instead of plain `fetch()` so we get consistent
// cookie handling, JSON parsing, error toasts, and 401 → /login.html redirects.

window.api = (function () {
  /** Show a transient error toast. Creates the container on first use. */
  function toast(msg, opts) {
    opts = opts || {};
    var c = document.getElementById("toast-container");
    if (!c) {
      c = document.createElement("div");
      c.id = "toast-container";
      c.style.cssText =
        "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);" +
        "background:#dc2626;color:#fff;padding:10px 16px;border-radius:6px;" +
        "font-size:0.9rem;z-index:9999;box-shadow:0 2px 8px rgba(0,0,0,0.3);" +
        "max-width:90%;text-align:center";
      document.body.appendChild(c);
    }
    var el = document.createElement("div");
    el.textContent = msg;
    el.style.cssText =
      "margin-top:6px;background:" + (opts.ok ? "#16a34a" : "#dc2626") +
      ";color:#fff;padding:10px 16px;border-radius:4px";
    c.appendChild(el);
    setTimeout(function () {
      el.remove();
      if (!c.hasChildNodes()) c.remove();
    }, opts.duration || 4000);
  }

  /**
   * Fetch the API with credentials. Returns a Promise<JSON|Text|null> on
   * success; throws on non-2xx, in which case a toast is shown and the caller
   * can also `.catch` to handle it.
   *
   * @param {string} path   URL path (relative or absolute).
   * @param {object} opts   fetch() options; method/body/headers.
   * @returns {Promise<any>} JSON if Content-Type is JSON, text otherwise.
   */
  async function api(path, opts) {
    opts = opts || {};
    if (opts.body && typeof opts.body === "object" && !(opts.body instanceof FormData)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers = Object.assign({}, opts.headers || {}, {
        "content-type": "application/json",
      });
    }
    opts.credentials = "same-origin";
    opts.headers = Object.assign({}, opts.headers || {}, {
      // Browsers always set Origin automatically; this is a no-op for same-origin
      // but documents intent (the Worker rejects mismatched origins → CSRF).
    });
    var res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      toast("Network error: " + e.message);
      throw e;
    }
    // 401 → bounce to login. Consumers don't see this.
    if (res.status === 401) {
      // Preserve where the user was so login can bounce back.
      try {
        sessionStorage.setItem("login_next", location.pathname + location.search);
      } catch (e) {}
      window.location.href = "/login";
      throw new Error("Not authenticated");
    }
    var ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      var msg = "HTTP " + res.status;
      if (ct.includes("application/json")) {
        var err;
        try {
          err = await res.json();
          if (err && err.error && err.error.message) msg = err.error.message;
          else if (err && err.error) msg = String(err.error);
          else if (err && typeof err.error === "string") msg = err.error;
        } catch (e) {}
      }
      toast(msg);
      throw new Error(msg);
    }
    if (ct.includes("application/json")) return res.json();
    var text = await res.text();
    if (text === "") return null;
    // Some endpoints return plain text; leave the consumer to parse if needed.
    return text;
  }

  api.toast = toast;
  return api;
})();
