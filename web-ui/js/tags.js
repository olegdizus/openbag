// web-ui/js/tags.js — /tags.html. Simple list + delete.

(function () {
  var app = window.app;
  var list = document.getElementById("tags");
  if (!list) return;

  // The API doesn't expose a dedicated /api/tags list endpoint we re-port here;
  // walk entry_tags → tags instead via search?  Simpler: piggyback on entries.
  async function load() {
    list.innerHTML = '<p class="text-muted">Loading tags…</p>';
    try {
      // Fetch a wide page of entries and pull their tags client-side.
      var data = await window.api("/api/entries?page=1&perPage=200");
      var items = (data._embedded && data._embedded.items) || [];
      var bySlug = {};
      items.forEach(function (e) {
        (e.tags || []).forEach(function (t) {
          bySlug[t.slug] = t;
        });
      });
      var tags = Object.values(bySlug).sort(function (a, b) {
        return a.label.localeCompare(b.label);
      });
      if (!tags.length) {
        list.innerHTML = '<p class="text-muted">No tags yet.</p>';
        return;
      }
      list.innerHTML =
        '<ul>' +
        tags
          .map(function (t) {
            return (
              '<li><span class="tag">' +
              app.esc(t.label) +
              "</span> <button type='button' class='btn-sm btn-danger' data-label='" +
              app.esc(t.label) +
              "'>delete</button></li>"
            );
          })
          .join("") +
        "</ul>";
      list.querySelectorAll("[data-label]").forEach(function (btn) {
        btn.addEventListener("click", async function () {
          var label = btn.getAttribute("data-label");
          if (!window.confirm("Delete tag '" + label + "' from all entries?")) return;
          try {
            await window.api("/api/tag/label?tag=" + encodeURIComponent(label), {
              method: "DELETE",
            });
            load();
          } catch (e) {}
        });
      });
    } catch (e) {
      list.innerHTML = '<p class="alert alert-error">Could not load tags.</p>';
    }
  }

  app.boot().then(load);
})();
