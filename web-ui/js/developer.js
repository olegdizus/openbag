// web-ui/js/developer.js — /developer.html. OAuth client management UI.

(function () {
  var app = window.app;
  var listEl = document.getElementById("clients");
  var createBtn = document.getElementById("create-btn");
  var draftEl = document.getElementById("draft-name");
  var result = document.getElementById("result");
  if (!listEl) return;

  function esc(s) {
    return app.esc(s);
  }

  function show(msg, kind) {
    if (!result) return;
    result.textContent = msg;
    result.className = "alert alert-" + (kind || "error");
  }

  async function load() {
    listEl.innerHTML = '<p class="text-muted">Loading…</p>';
    try {
      var data = await window.api("/api/oauth/clients");
      render(data.items || []);
    } catch (e) {
      listEl.innerHTML = '<p class="alert alert-error">Could not load clients.</p>';
    }
  }

  function fmtJson(arr) {
    if (!arr) return "[]";
    var a;
    try {
      a = typeof arr === "string" ? JSON.parse(arr) : arr;
    } catch (e) {
      a = arr;
    }
    if (!Array.isArray(a)) return JSON.stringify(arr);
    return a.join(", ");
  }

  function render(items) {
    if (!items.length) {
      listEl.innerHTML =
        '<p class="text-muted">No OAuth clients yet. Create one to use the Wallabag API.</p>';
      return;
    }
    listEl.innerHTML = items
      .map(function (c) {
        // Client id used for OAuth protocol is `<dbId>_<random_id>`.
        var clientId = c.id + "_" + (c.random_id || "");
        return (
          '<div class="client-card" data-id="' +
          c.id +
          '">' +
          "<h3>" +
          esc(c.name) +
          "</h3>" +
          '<div class="cred-row"><strong>Client ID:</strong><code>' +
          esc(clientId) +
          "</code></div>" +
          '<div class="cred-row"><strong>Secret:</strong><code>' +
          esc(c.secret) +
          "</code></div>" +
          '<div class="cred-row"><strong>Redirect URIs:</strong><code>' +
          esc(fmtJson(c.redirect_uris)) +
          "</code></div>" +
          '<div class="cred-row"><strong>Grant types:</strong><code>' +
          esc(fmtJson(c.allowed_grant_types)) +
          "</code></div>" +
          '<div class="client-actions">' +
          '<button type="button" class="btn-danger" data-delete="' +
          c.id +
          '">Delete</button>' +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    // Wire delete buttons
    listEl.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var id = btn.getAttribute("data-delete");
        if (!window.confirm("Delete this OAuth client?")) return;
        try {
          await window.api("/api/oauth/clients/" + id, { method: "DELETE" });
          load();
        } catch (e) {}
      });
    });
  }

  if (createBtn) {
    createBtn.addEventListener("click", async function () {
      show("");
      var name = (draftEl && draftEl.value || "").trim();
      if (!name) {
        show("Enter a name first.");
        return;
      }
      try {
        await window.api("/api/oauth/clients", {
          method: "POST",
          body: { name: name },
        });
        draftEl.value = "";
        load();
      } catch (e) {}
    });
  }

  app.boot().then(load);
})();
