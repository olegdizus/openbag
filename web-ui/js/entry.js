// web-ui/js/entry.js — entry detail page (/entry.html?id=N).
// Renders the article, archive/star/public toggles, delete, and the
// WYSIWYG editor + reset (Phase 3 port of packages/web/public/editor.js).

(function () {
  var app = window.app;
  var root = document.getElementById("entry");
  if (!root) return;
  var q = new URLSearchParams(location.search);
  var id = parseInt(q.get("id") || "", 10);
  if (!id) {
    root.innerHTML = '<p class="alert alert-error">Missing entry id.</p>';
    return;
  }

  var currentEntry = null;

  async function loadEntry() {
    try {
      currentEntry = await window.api("/api/entries/" + id);
    } catch (e) {
      root.innerHTML = '<p class="alert alert-error">Could not load entry.</p>';
      return;
    }
    render();
  }

  function render() {
    var e = currentEntry;
    if (!e) return;
    root.innerHTML =
      '<article class="entry">' +
      "<h1>" +
      app.esc(e.title || "(untitled)") +
      "</h1>" +
      '<p class="entry-meta"><a href="' +
      app.esc(e.url) +
      '" target="_blank" rel="noopener">' +
      app.esc(e.url) +
      "</a> · " +
      app.esc(app.fmtDateTime(e.created_at)) +
      " · " +
      (e.reading_time || 0) +
      " min read</p>" +
      '<div class="actions" id="entry-actions"></div>' +
      (e.tags && e.tags.length
        ? '<div class="entry-tags">' +
        e.tags
          .map(function (t) {
            return '<span class="tag">' + app.esc(t.label) + "</span>";
          })
          .join("") +
        "</div>"
        : "") +
      '<button type="button" id="entry-edit-btn" class="btn-edit">Edit content</button>' +
      '<div id="entry-content" data-entry-id="' +
      e.id +
      '"' +
      (e.content_raw !== null && e.content_raw !== undefined
        ? ' data-has-raw="1"'
        : ' data-has-raw="0"') +
      ">" +
      (e.content || "") +
      "</div>" +
      "</article>";
    wireActions();
  }

  function wireActions() {
    var actions = document.getElementById("entry-actions");
    if (!actions) return;
    actions.innerHTML =
      "<button type='button' class='btn-toggle' id='btn-arch'>" +
      (currentEntry.is_archived ? "✓ Archived" : "Archive") +
      "</button> " +
      "<button type='button' class='btn-star " +
      (currentEntry.is_starred ? "is-on" : "") +
      "' id='btn-star'>" +
      (currentEntry.is_starred ? "★ Starred" : "☆ Star") +
      "</button> " +
      "<button type='button' class='btn-toggle' id='btn-delete'>Delete</button>";

    document.getElementById("btn-arch").addEventListener("click", async function () {
      try {
        currentEntry = await window.api("/api/entries/" + id, {
          method: "PATCH",
          body: { archive: !currentEntry.is_archived },
        });
        currentEntry.is_archived = currentEntry.is_archived ? 1 : 0;
        render();
      } catch (e) { }
    });
    document.getElementById("btn-star").addEventListener("click", async function () {
      try {
        currentEntry = await window.api("/api/entries/" + id, {
          method: "PATCH",
          body: { starred: !currentEntry.is_starred },
        });
        currentEntry.is_starred = currentEntry.is_starred ? 1 : 0;
        render();
      } catch (e) { }
    });
    document.getElementById("btn-delete").addEventListener("click", async function () {
      if (!window.confirm("Delete this entry permanently?")) return;
      try {
        await window.api("/api/entries/" + id, { method: "DELETE" });
        window.location.href = "/entries";
      } catch (e) { }
    });

    // Hook the editor
    var btn = document.getElementById("entry-edit-btn");
    if (btn) btn.addEventListener("click", startEditing);
  }

  // ----- inline WYSIWYG editor (ported from packages/web/public/editor.js) -----
  // Uses contenteditable + document.execCommand (deprecated but ubiquitous).
  var editing = false;
  var toolbar = null;

  async function startEditing() {
    if (editing) return;
    editing = true;
    var contentEl = document.getElementById("entry-content");
    contentEl.classList.add("editing");
    contentEl.setAttribute("contenteditable", "true");
    contentEl.focus();

    toolbar = document.createElement("div");
    toolbar.className = "entry-edit-toolbar";
    toolbar.setAttribute("role", "toolbar");
    helperButtons(toolbar, contentEl);

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn-save";
    saveBtn.textContent = "Save";
    saveBtn.addEventListener("click", save);

    var discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "btn-danger";
    discardBtn.textContent = "Reset to original";
    discardBtn.title =
      "Discard your edits and restore the original parsed content";
    discardBtn.addEventListener("click", reset);

    var status = document.createElement("span");
    status.className = "edit-status";

    var spacer = document.createElement("span");
    spacer.className = "spacer";

    toolbar.appendChild(spacer);
    toolbar.appendChild(status);
    toolbar.appendChild(discardBtn);
    toolbar.appendChild(saveBtn);
    contentEl.parentNode.insertBefore(toolbar, contentEl);
  }

  function helperButtons(bar, contentEl) {
    function exec(cmd, value) {
      document.execCommand(cmd, false, value || null);
      contentEl.focus();
    }
    function btn(label, title, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      return b;
    }
    bar.appendChild(btn("P", "Paragraph", function () {
      exec("formatBlock", "P");
    }));
    bar.appendChild(btn("H2", "Heading 2", function () {
      exec("formatBlock", "H2");
    }));
    bar.appendChild(btn("H3", "Heading 3", function () {
      exec("formatBlock", "H3");
    }));
    bar.appendChild(btn("❝", "Blockquote", function () {
      exec("formatBlock", "BLOCKQUOTE");
    }));
    bar.appendChild(btn("B", "Bold", function () {
      exec("bold");
    }));
    bar.appendChild(btn("I", "Italic", function () {
      exec("italic");
    }));
    bar.appendChild(btn("U", "Underline", function () {
      exec("underline");
    }));
    bar.appendChild(btn("🔗", "Add link", function () {
      var sel = window.getSelection();
      if (!sel || sel.toString().trim() === "") {
        appStatus("Select text first", true);
        return;
      }
      var url = window.prompt("Link URL", "https://");
      if (url) exec("createLink", url);
    }));
  }

  function appStatus(msg, isError) {
    var el = toolbar ? toolbar.querySelector(".edit-status") : null;
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("err", !!isError);
  }

  async function save() {
    var contentEl = document.getElementById("entry-content");
    var newHtml = contentEl.innerHTML;
    try {
      currentEntry = await window.api("/api/entries/" + id, {
        method: "PATCH",
        body: { content: newHtml },
      });
      // Reload the article area with the sanitized content the server persisted.
      editing = false;
      render();
    } catch (e) {
      appStatus("Save failed", true);
    }
  }

  async function reset() {
    if (!window.confirm("Reset content to the original parsed version?")) return;
    try {
      currentEntry = await window.api("/api/entries/" + id + "/content/reset", {
        method: "POST",
      });
      editing = false;
      render();
    } catch (e) {
      appStatus(e.message, true);
    }
  }

  app.boot().then(function () {
    loadEntry();
    // Poll for content if the entry hasn't been parsed yet.
    pollWhilePending();
  });

  // If the entry is still being fetched server-side, poll and reload.
  function pollWhilePending() {
    if (!currentEntry) {
      setTimeout(pollWhilePending, 2000);
      return;
    }
    if (currentEntry.is_not_parsed) {
      setTimeout(async function () {
        try {
          var fresh = await window.api("/api/entries/" + id);
          if (fresh && !fresh.is_not_parsed && fresh.content) {
            currentEntry = fresh;
            render();
          } else if (fresh && fresh.is_not_parsed) {
            setTimeout(pollWhilePending, 2000);
          }
        } catch (e) {
          // ignore; will retry
        }
      }, 2000);
    }
  }
})();
