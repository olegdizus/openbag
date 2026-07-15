// web-ui/entrypoints/settings.ts — page bundle for /settings.

import "../components/toast-region";
import "../components/site-shell";
import "../components/feed-token-actions";

// Native (no-JS) form already posts to /ui/settings. With JS enabled,
// intercept and submit via the API for instant validation/feedback.
const form = document.getElementById("settings-form") as HTMLFormElement | null;
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
        display_thumbnails: form.display_thumbnails?.checked,
      };
      await fetch("/api/config", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "content-type": "application/json", origin: location.origin },
        body: JSON.stringify(body),
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
