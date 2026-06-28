// Wallabag CF — entry content editor
// Loaded only on GET /entries/:id when there is content to edit.
// Progressive enhancement: without this script the article is read-only but
// fully readable, and the rest of the page (archive/star/delete) still works.
(function () {
  "use strict";

  var BLOCK_SEL = "p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, li, pre, figure, figcaption, img, table, thead, tbody, tfoot, tr, td, th, div, hr, video, audio";
  var entryIdMatch = location.pathname.match(/\/entries\/(\d+)/);
  var entryId = entryIdMatch ? entryIdMatch[1] : null;

  var editBtn = document.getElementById("entry-edit-btn");
  if (!editBtn || !entryId) return;

  var snapshot = "";
  var toolbar = null;
  var selected = null;
  var editing = false;

  function getContent() {
    return document.getElementById("entry-content");
  }

  function clearSelection() {
    if (selected) selected.classList.remove("entry-edit-selected");
    selected = null;
  }

  function setStatus(msg, isError) {
    var el = toolbar ? toolbar.querySelector(".edit-status") : null;
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("err", !!isError);
  }

  function exec(cmd, value) {
    document.execCommand(cmd, false, value || null);
    getContent().focus();
  }

  function setBlock(tag) {
    exec("formatBlock", tag);
  }

  function makeLink() {
    var sel = window.getSelection();
    if (!sel || sel.toString().trim() === "") {
      setStatus("Select text first", true);
      return;
    }
    var url = window.prompt("Link URL", "https://");
    if (url) exec("createLink", url);
  }

  function removeSelected() {
    if (!selected) {
      setStatus("Click an element first to select it", true);
      return;
    }
    selected.remove();
    selected = null;
  }

  function buildToolbar() {
    var bar = document.createElement("div");
    bar.className = "entry-edit-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Article editing tools");

    function grp() { var g = document.createElement("span"); g.className = "grp"; return g; }
    function btn(label, title, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = title;
      b.addEventListener("click", fn);
      return b;
    }

    var fmt = grp();
    fmt.appendChild(btn("P", "Paragraph", function () { setBlock("P"); }));
    fmt.appendChild(btn("H2", "Heading 2", function () { setBlock("H2"); }));
    fmt.appendChild(btn("H3", "Heading 3", function () { setBlock("H3"); }));
    fmt.appendChild(btn("❝", "Blockquote", function () { setBlock("BLOCKQUOTE"); }));
    bar.appendChild(fmt);

    var inline = grp();
    inline.appendChild(btn("B", "Bold", function () { exec("bold"); }));
    inline.appendChild(btn("I", "Italic", function () { exec("italic"); }));
    inline.appendChild(btn("U", "Underline", function () { exec("underline"); }));
    inline.appendChild(btn("🔗", "Add link", makeLink));
    bar.appendChild(inline);

    var align = grp();
    align.appendChild(btn("⬅", "Align left", function () { exec("justifyLeft"); }));
    align.appendChild(btn("⬌", "Align center", function () { exec("justifyCenter"); }));
    align.appendChild(btn("➡", "Align right", function () { exec("justifyRight"); }));
    bar.appendChild(align);

    var hist = grp();
    hist.appendChild(btn("↶", "Undo", function () { exec("undo"); }));
    hist.appendChild(btn("↷", "Redo", function () { exec("redo"); }));
    bar.appendChild(hist);

    var rm = grp();
    rm.appendChild(btn("🗑", "Remove selected element", removeSelected));
    bar.appendChild(rm);

    var spacer = document.createElement("span");
    spacer.className = "spacer";
    bar.appendChild(spacer);

    var status = document.createElement("span");
    status.className = "edit-status";
    bar.appendChild(status);

    var resetBtn = null;
    if (getContent().getAttribute("data-has-raw") === "1") {
      resetBtn = btn("Reset", "Restore original content", doReset);
      resetBtn.className = "btn-danger";
      bar.appendChild(resetBtn);
    }

    var cancelBtn = btn("Cancel", "Discard changes", cancelEdit);
    bar.appendChild(cancelBtn);

    var saveBtn = btn("Save", "Save changes", saveEdit);
    saveBtn.className = "btn-save";
    bar.appendChild(saveBtn);

    return bar;
  }

  function enterEdit() {
    if (editing) return;
    var content = getContent();
    if (!content) return;
    snapshot = content.innerHTML;
    content.setAttribute("contenteditable", "true");
    content.classList.add("editing");
    toolbar = buildToolbar();
    content.parentNode.insertBefore(toolbar, content);
    editBtn.style.display = "none";
    document.addEventListener("click", onClick, true);
    editing = true;
    content.focus();
  }

  function teardown() {
    var content = getContent();
    if (content) {
      content.removeAttribute("contenteditable");
      content.classList.remove("editing");
    }
    if (toolbar) { toolbar.remove(); toolbar = null; }
    editBtn.style.display = "";
    document.removeEventListener("click", onClick, true);
    clearSelection();
    editing = false;
    setStatus("");
  }

  function cancelEdit() {
    var content = getContent();
    if (content) content.innerHTML = snapshot;
    teardown();
  }

  function onClick(e) {
    var content = getContent();
    if (!content || !editing) return;
    if (toolbar && toolbar.contains(e.target)) return;
    if (!content.contains(e.target)) return;
    var el = e.target.closest(BLOCK_SEL);
    clearSelection();
    if (el && el !== content) {
      selected = el;
      el.classList.add("entry-edit-selected");
    }
  }

  function post(action) {
    var content = getContent();
    var body = action === "reset" ? "" : "content=" + encodeURIComponent(content.innerHTML);
    return fetch("/entries/" + entryId + "/content" + (action === "reset" ? "/reset" : ""), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
      body: body,
      redirect: "follow",
    }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.text();
    });
  }

  function applyReturned(html) {
    var tmp = document.createElement("div");
    tmp.innerHTML = html.trim();
    var next = tmp.firstElementChild;
    var content = getContent();
    if (next && content) content.replaceWith(next);
    teardown();
  }

  function saveEdit() {
    setStatus("Saving…");
    post("save")
      .then(function (html) { applyReturned(html); })
      .catch(function () {
        setStatus("Save failed", true);
        window.alert("Could not save changes. Please try again.");
      });
  }

  function doReset() {
    if (!window.confirm("Restore the article to its original content? Your edits will be lost.")) return;
    setStatus("Resetting…");
    post("reset")
      .then(function (html) { applyReturned(html); })
      .catch(function () { setStatus("Reset failed", true); });
  }

  editBtn.addEventListener("click", enterEdit);
})();
