// /login + /signup. 401 here is surfaced inline (NOT bounced) — see lib/api.ts.

import "../components/toast-region";
import "../components/site-shell";
import { api } from "../lib/api";

function show(el: HTMLElement | null, msg: string, kind: "error" | "success" = "error") {
  if (!el) return;
  el.textContent = msg;
  el.className = `alert alert-${kind}`;
}

interface AuthResponse {
  user?: { username: string };
}

function wire(id: string, apiPath: string, next: string): void {
  const form = document.getElementById(id) as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = document.getElementById("result");
    show(result, "");
    try {
      const data = await api<AuthResponse>(apiPath, {
        method: "POST",
        body: {
          username: form.username.value,
          password: form.password.value,
          ...(form.email ? { email: form.email.value || undefined } : {}),
        },
      });
      if (data.user) {
        window.location.href = next;
      }
    } catch (err) {
      show(result, (err as Error).message || "Could not authenticate");
    }
  });
}

function init() {
  const next = (() => {
    const u = new URL(location.href);
    return u.searchParams.get("next") || "/entries";
  })();
  wire("login-form", "/api/auth/login", next);
  wire("signup-form", "/api/auth/signup", next);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
