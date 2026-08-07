// Fetch wrapper used by every WC. 401 → bounce to /login, EXCEPT on
// /api/auth/login|signup (surfaced to the caller for inline error).

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
  // WC ships the slide-in/out animation in CSS.
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

const AUTH_PATHS = new Set(["/api/auth/login", "/api/auth/signup"]);

/** Same contract as the legacy window.api(). */
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
  return (text === "" ? null : text) as unknown as T;
}

api.toast = toast;

if (typeof window !== "undefined") {
  (window as any).api = api;
  (window as any).toast = toast;
}

export { toast };
