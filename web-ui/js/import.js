// web-ui/js/import.js — /import.html. Two paths:
//   1. Single URL form → POST /api/entries
//   2. Bulk URL list → POST /api/entries/lists

(function () {
  var app = window.app;
  var singleForm = document.getElementById("single-form");
  var bulkForm = document.getElementById("bulk-form");
  var result = document.getElementById("result");

  function show(msg, kind) {
    if (!result) return;
    result.textContent = msg;
    result.className = "alert alert-" + (kind || "error");
  }

  if (singleForm) {
    singleForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      show("");
      var url = singleForm.url.value;
      var title = singleForm.title.value || undefined;
      try {
        var created = await window.api("/api/entries", {
          method: "POST",
          body: Object.assign({ url: url }, title ? { title: title } : {}),
        });
        if (created && created.id) {
          window.location.href = "/entry.html?id=" + created.id;
        } else {
          show("Saved.");
        }
      } catch (err) {
        show(err.message);
      }
    });
  }

  if (bulkForm) {
    bulkForm.addEventListener("submit", async function (e) {
      e.preventDefault();
      show("");
      var raw = bulkForm.urls.value;
      var urls = raw
        .split(/[\s,]+/)
        .map(function (s) {
          return s.trim();
        })
        .filter(Boolean);
      if (!urls.length) {
        show("Paste at least one URL.");
        return;
      }
      try {
        var res = await window.api("/api/entries/lists", {
          method: "POST",
          body: { urls: urls },
        });
        show("Imported " + (res ? res.length : 0) + " entries.", "success");
      } catch (err) {
        show(err.message);
      }
    });
  }

  app.boot();
})();
