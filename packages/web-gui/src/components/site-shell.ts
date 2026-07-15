// web-ui/components/site-shell.ts — minimal shell enhancement.
//
// Nothing structural hydrates (the header IS server-rendered). The only job of
// this module is intercepting the logout button click so it can fire POST
// /api/auth/logout and redirect without a full page navigation. Without JS,
// the rendered <form action="/api/auth/logout" method="post"> still works.

import { api } from "../lib/api";

function wireLogoutButton(): void {
  const btn = document.getElementById("logout-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", async (e) => {
    // The form still submits if fetch fails — don't preventDefault outside
    // of the success path.
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (err) {
      /* swallow — we bounce to /login either way */
    }
    window.location.href = "/login";
  });
}

// Wire on initial DOMContentLoaded.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireLogoutButton);
} else {
  wireLogoutButton();
}
