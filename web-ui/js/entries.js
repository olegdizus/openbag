// web-ui/js/entries.js — entries list page (/entries.html).
// Reads query params (page, perPage, archive, starred, sort), fetches
// /api/entries, renders rows + pagination.

(function () {
  var app = window.app;
  var listEl = document.getElementById("entries-list");
  var pagerEl = document.getElementById("pager");
  var q = new URLSearchParams(location.search);

  function href(p) {
    var p2 = new URLSearchParams(q);
    p2.set("page", String(p));
    return "/entries?" + p2.toString();
  }

  async function load() {
    listEl.innerHTML = '<p class="text-muted">Loading…</p>';
    var page = parseInt(q.get("page") || "1", 10);
    var perPage = parseInt(q.get("perPage") || "30", 10);

    var qs = new URLSearchParams();
    qs.set("page", String(page));
    qs.set("perPage", String(perPage));
    ["archive", "starred", "sort", "order"].forEach(function (k) {
      if (q.get(k) != null) qs.set(k, q.get(k));
    });

    var data;
    try {
      data = await window.api("/api/entries?" + qs, {});
    } catch (e) {
      listEl.innerHTML = '<p class="alert alert-error">Could not load entries.</p>';
      return;
    }
    render(data, page, perPage);
  }

  function render(data, page, perPage) {
    if (!data._embedded || !data._embedded.items || !data._embedded.items.length) {
      listEl.innerHTML = '<p class="text-muted">No entries yet. Add one via the import page.</p>';
      pagerEl.innerHTML = "";
      return;
    }
    listEl.innerHTML =
      '<table><thead><tr>' +
      "<th>Title</th><th>Domain</th><th>Created</th><th>Arch</th><th>Star</th>" +
      "</tr></thead><tbody>" +
      data._embedded.items
        .map(function (e) {
          return (
            "<tr>" +
            '<td><a href="/entry?id=' +
            e.id +
            '">' +
            app.esc(e.title || "(untitled)") +
            "</a></td>" +
            "<td>" +
            app.esc(e.domain_name || "") +
            "</td>" +
            "<td>" +
            app.esc(app.fmtDateTime(e.created_at)) +
            "</td>" +
            "<td>" +
            (e.is_archived ? "✓" : "") +
            "</td>" +
            "<td>" +
            (e.is_starred ? "★" : "") +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table>";

    // Pagination controls.
    if (data.pages > 1) {
      var html = '<div class="pagination">';
      html += 'Page <strong>' + data.page + '</strong> of ' + data.pages + ' · ';
      if (data.page > 1) html += '<a href="' + href(1) + '">first</a> ';
      if (data.page > 1) html += '<a href="' + href(data.page - 1) + '">prev</a> ';
      if (data.page < data.pages)
        html += '<a href="' + href(data.page + 1) + '">next</a> ';
      if (data.page < data.pages) html += '<a href="' + href(data.pages) + '">last</a>';
      html += "</div>";
      pagerEl.innerHTML = html;
    } else {
      pagerEl.innerHTML = "";
    }
  }
    pagerEl.innerHTML = html;
  }

  app.boot().then(function () {
    if (listEl) load();
  });
})();
