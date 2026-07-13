// web-ui/js/settings.js — /settings.html. Config form + feed token management.

(function () {
  var app = window.app;
  var form = document.getElementById("settings-form");
  var feedSection = document.getElementById("feed-section");
  var result = document.getElementById("result");
  if (!form) return;

  function show(msg, kind) {
    if (!result) return;
    result.textContent = msg;
    result.className = "alert alert-" + (kind || "error");
  }

  async function loadConfig() {
    try {
      var cfg = await window.api("/api/config");
      if (!cfg) return;
      ["theme", "items_per_page", "reading_speed", "language"].forEach(function (k) {
        if (form[k]) form[k].value = cfg[k];
      });
      ["action_mark_as_read", "list_mode", "display_thumbnails"].forEach(function (k) {
        if (form[k]) form[k].checked = !!cfg[k];
      });
    } catch (e) {}
  }

  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      show("");
      try {
        await window.api("/api/config", {
          method: "PUT",
          body: {
            theme: form.theme.value,
            items_per_page: parseInt(form.items_per_page.value, 10),
            reading_speed: parseInt(form.reading_speed.value, 10),
            language: form.language.value,
            action_mark_as_read: form["action_mark_as_read"].checked,
            list_mode: form["list_mode"].checked,
            display_thumbnails: form["display_thumbnails"].checked,
          },
        });
        show("Saved.", "success");
      } catch (err) {
        show(err.message);
      }
    });
  }

  // Feed token UI
  var feedSectionEl = feedSection;
  if (feedSectionEl) {
    feedSectionEl.innerHTML =
      '<button type="button" id="token-refresh">Get current token</button>' +
      '<button type="button" id="token-rotate">Rotate token</button>' +
      '<button type="button" class="btn-danger" id="token-revoke">Revoke token</button>' +
      '<pre id="token-out" class="card hidden"></pre>';

    function showToken(data) {
      var out = document.getElementById("token-out");
      if (!out) return;
      out.classList.remove("hidden");
      out.textContent = JSON.stringify(data, null, 2);
    }

    document.getElementById("token-refresh").addEventListener("click", async function () {
      try {
        var data = await window.api("/api/feed/token");
        showToken(data);
      } catch (e) {}
    });
    document.getElementById("token-rotate").addEventListener("click", async function () {
      if (!window.confirm("Generate a new feed token? The old one will stop working.")) return;
      try {
        var data = await window.api("/api/feed/token", { method: "POST" });
        showToken(data);
      } catch (e) {}
    });
    document.getElementById("token-revoke").addEventListener("click", async function () {
      if (!window.confirm("Revoke the feed token?")) return;
      try {
        await window.api("/api/feed/token", { method: "DELETE" });
        showToken({ feed_token: null });
      } catch (e) {}
    });
  }

  app.boot().then(loadConfig);
})();
