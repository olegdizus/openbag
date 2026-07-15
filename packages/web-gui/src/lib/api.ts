// web-ui/lib/api.ts — strict rewrite of web-ui/js/api.js's `window.api`.
//
// Same JSON-aware fetch() wrapper (credentials=include, 401 → bounce to login),
// but FIXES the bug where wrong-password errors on /api/auth/login and
// /api/auth/signup were swallowed because the 401-to-/login bounce happened
// before the caller could show an inline error message.
//
// Used by every Phase-3 Web Component. The bundles in
// `web-ui/c/<page>.js` re-export `api()` and `api.toast()`.

interface ToastOptions {
  /** kind=success → green; anything else → red (default). */
  ok?: boolean;
  /** Auto-dismiss after this many ms. Default 4000. */
  duration?: number;
}

function ensureToastContainer(): HTMLElement {
  let region = document.querySelector<HTMLElement>("toast-region");
  if (!region) {
    region = document.createElement("toast-region") as unknown as HTMLElement;
    document.body.appendChild(region);
  }
  return region;
}

function toast(msg: string, opts: ToastOptions = {}): void {
  const region = ensureToastContainer();
  const el = document.createElement("div");
  el.className = `toast ${opts.ok ? "toast-success" : "toast-error"}`;
  el.textContent = msg;
  region.appendChild(el);
  // Remove after the duration. The custom element ships its own animation
  // (slide-in / fade-out) via CSS.
  window.setTimeout(() => {
    el.classList.add("toast-leave");
    window.setTimeout(() => el.remove(), 250);
  }, opts.duration ?? 4000);
}

interface FetchOpts {
  method?: string;
  body?: unknown | FormData;
  headers?: Record<string, string>;
}

/** If `path` is the auth endpoint, the 401-handler should NOT auto-bounce. */
const AUTH_PATHS = new Set(["/api/auth/login", "/api/auth/signup"]);

/**
 * Same contract as the legacy window.api(): returns parsed JSON (or text/null),
 * shows a toast on non-2xx, and throws. Crucially, 401s on /api/auth/login or
 * /api/auth/signup are NOT bounced — they're surfaced to the caller so the
 * login page can show the inline error.
 */
export async function api<T = any>(path: string, opts: FetchOpts = {}): Promise<T> {
  const fetchOpts: RequestInit = {
    method: opts.method || "GET",
    credentials: "same-origin",
    headers: { ...(opts.headers || {}) },
  };

  if (opts.body !== undefined && !(opts.body instanceof FormData)) {
    fetchOpts.body = JSON.stringify(opts.body);
    (fetchOpts.headers as Record<string, string>)["content-type"] = "application/json";
  } else if (opts.body instanceof FormData) {
    fetchOpts.body = opts.body;
  }

  let res: Response;
  try {
    res = await fetch(path, fetchOpts);
  } catch (e) {
    toast(`Network error: ${(e as Error).message}`);
    throw e;
  }

  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    // Preserve where the user was so login can bounce back.
    try {
      sessionStorage.setItem("login_next", location.pathname + location.search);
    } catch { /* sessionStorage disabled in private mode — best effort */ }
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }

  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (ct.includes("application/json")) {
      try {
        const err = (await res.json()) as { error?: { message?: string } | string | unknown };
        if (err?.error && typeof err.error === "object" && (err.error as { message?: string }).message) {
          msg = (err.error as { message: string }).message;
        } else if (typeof err?.error === "string") {
          msg = err.error;
        }
      } catch { /* leave the default msg */ }
    }
    toast(msg);
    throw new Error(msg);
  }

  if (ct.includes("application/json")) return res.json() as Promise<T>;
  const text = await res.text();
  // Empty body → null per the JSON contract; T may be a permissive type that
  // the caller has passed, so cast through `unknown`.
  return (text === "" ? null : text) as unknown as T;
}

api.toast = toast;

// Make accessible to non-bundled scripts while still exporting for esbuild.
if (typeof window !== "undefined") {
  (window as any).api = api;
  (window as any).toast = toast;
}

export { toast };
