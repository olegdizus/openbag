import { api } from "../lib/api";

/**
 * Wire the rendered logout button to POST /api/auth/logout and redirect
 * without a full page navigation. Nothing structural hydrates (the header IS
 * server-rendered); without JS the rendered `<form action="/api/auth/logout"
 * method="post">` still works.
 */
function wireLogoutButton(): void {
  const btn = document.getElementById("logout-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (err) {
      /* swallow — we bounce to /login either way */
    }
    window.location.href = "/login";
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireLogoutButton);
} else {
  wireLogoutButton();
}
