// packages/web-gui/src/components/toast-region.ts
var TOAST_EVENT = "app:toast";
var ToastRegion = class extends HTMLElement {
  constructor() {
    super();
    this.addEventListener("click", (e) => {
      const t = e.target.closest(".toast");
      if (t) t.remove();
    });
    document.addEventListener(TOAST_EVENT, (e) => {
      const detail = e.detail || { msg: "" };
      this.show(detail.msg, detail.kind === "ok", detail.duration);
    });
  }
  show(msg, ok = false, duration = 4e3) {
    const el = document.createElement("div");
    el.className = `toast ${ok ? "toast-success" : "toast-error"}`;
    el.textContent = msg;
    this.appendChild(el);
    window.setTimeout(() => {
      el.classList.add("toast-leave");
      window.setTimeout(() => el.remove(), 250);
    }, duration);
  }
};
customElements.define("toast-region", ToastRegion);

// packages/web-gui/src/lib/api.ts
function ensureToastContainer() {
  let region = document.querySelector("toast-region");
  if (!region) {
    region = document.createElement("toast-region");
    document.body.appendChild(region);
  }
  return region;
}
function toast(msg, opts = {}) {
  const region = ensureToastContainer();
  const el = document.createElement("div");
  el.className = `toast ${opts.ok ? "toast-success" : "toast-error"}`;
  el.textContent = msg;
  region.appendChild(el);
  window.setTimeout(() => {
    el.classList.add("toast-leave");
    window.setTimeout(() => el.remove(), 250);
  }, opts.duration ?? 4e3);
}
var AUTH_PATHS = /* @__PURE__ */ new Set(["/api/auth/login", "/api/auth/signup"]);
async function api(path, opts = {}) {
  const fetchOpts = {
    method: opts.method || "GET",
    credentials: "same-origin",
    headers: { ...opts.headers || {} }
  };
  if (opts.body !== void 0 && !(opts.body instanceof FormData)) {
    fetchOpts.body = JSON.stringify(opts.body);
    fetchOpts.headers["content-type"] = "application/json";
  } else if (opts.body instanceof FormData) {
    fetchOpts.body = opts.body;
  }
  let res;
  try {
    res = await fetch(path, fetchOpts);
  } catch (e) {
    toast(`Network error: ${e.message}`);
    throw e;
  }
  if (res.status === 401 && !AUTH_PATHS.has(path)) {
    try {
      sessionStorage.setItem("login_next", location.pathname + location.search);
    } catch {
    }
    window.location.href = "/login";
    throw new Error("Not authenticated");
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    if (ct.includes("application/json")) {
      try {
        const err = await res.json();
        if (err?.error && typeof err.error === "object" && err.error.message) {
          msg = err.error.message;
        } else if (typeof err?.error === "string") {
          msg = err.error;
        }
      } catch {
      }
    }
    toast(msg);
    throw new Error(msg);
  }
  if (ct.includes("application/json")) return res.json();
  const text = await res.text();
  return text === "" ? null : text;
}
api.toast = toast;
if (typeof window !== "undefined") {
  window.api = api;
  window.toast = toast;
}

// packages/web-gui/src/components/site-shell.ts
function wireLogoutButton() {
  const btn = document.getElementById("logout-btn");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch (err) {
    }
    window.location.href = "/login";
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wireLogoutButton);
} else {
  wireLogoutButton();
}

// packages/web-gui/src/components/entry-actions.ts
function attrsFrom(node) {
  return {
    id: parseInt(node.dataset.id || "", 10),
    archived: node.dataset.archived === "1",
    starred: node.dataset.starred === "1"
  };
}
var EntryActions = class extends HTMLElement {
  state = { id: 0, archived: false, starred: false };
  connectedCallback() {
    this.state = attrsFrom(this);
    this.render();
  }
  render() {
    const archiveBtn = `<button type="button" class="btn-toggle" data-action="archive">${this.state.archived ? "\u2713 Archived" : "Archive"}</button>`;
    const starBtn = `<button type="button" class="btn-star ${this.state.starred ? "is-on" : ""}" data-action="star">${this.state.starred ? "\u2605 Starred" : "\u2606 Star"}</button>`;
    const deleteBtn = `<button type="button" class="btn-toggle" data-action="delete">Delete</button>`;
    this.innerHTML = `${archiveBtn} ${starBtn} ${deleteBtn}`;
    this.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", this.onClick);
    });
  }
  onClick = async (e) => {
    const btn = e.target;
    const action = btn.dataset.action;
    if (action === "archive") {
      await this.patch({ archive: !this.state.archived });
    } else if (action === "star") {
      await this.patch({ starred: !this.state.starred });
    } else if (action === "delete") {
      if (!window.confirm("Delete this entry permanently?")) return;
      try {
        await api(`/api/entries/${this.state.id}`, { method: "DELETE" });
        window.location.href = "/entries";
      } catch {
      }
    }
  };
  async patch(body) {
    if ("archive" in body) this.state.archived = !!body.archive;
    if ("starred" in body) this.state.starred = !!body.starred;
    this.render();
    try {
      const updated = await api(
        `/api/entries/${this.state.id}`,
        { method: "PATCH", body }
      );
      this.state.archived = !!updated.is_archived;
      this.state.starred = !!updated.is_starred;
      this.dataset.archived = updated.is_archived ? "1" : "0";
      this.dataset.starred = updated.is_starred ? "1" : "0";
    } catch (e) {
      this.state = attrsFrom(this);
      this.render();
    }
  }
};
customElements.define("entry-actions", EntryActions);

// packages/web-gui/src/components/entry-poller.ts
var EntryPoller = class extends HTMLElement {
  timer = null;
  connectedCallback() {
    if (this.dataset.isNotParsed !== "1") return;
    const id = parseInt(this.dataset.id || "", 10);
    if (!id) return;
    this.timer = window.setInterval(async () => {
      try {
        const e = await api(`/api/entries/${id}`, {});
        if (!e.is_not_parsed) {
          if (this.timer != null) window.clearInterval(this.timer);
          window.location.reload();
        }
      } catch {
      }
    }, 2e3);
  }
  disconnectedCallback() {
    if (this.timer != null) window.clearInterval(this.timer);
  }
};
customElements.define("entry-poller", EntryPoller);

// packages/web-gui/src/components/entry-editor.ts
var BLOCK_TAGS = ["P", "H2", "H3", "BLOCKQUOTE"];
var TOOLBAR_TEMPLATE = (() => {
  const t = document.createElement("template");
  t.innerHTML = `
    <div class="entry-edit-toolbar" role="toolbar">
      <button type="button" data-cmd="p" title="Paragraph">P</button>
      <button type="button" data-cmd="h2" title="Heading 2">H2</button>
      <button type="button" data-cmd="h3" title="Heading 3">H3</button>
      <button type="button" data-cmd="blockquote" title="Blockquote">\u275D</button>
      <button type="button" data-cmd="strong" title="Bold">B</button>
      <button type="button" data-cmd="em" title="Italic">I</button>
      <button type="button" data-cmd="u" title="Underline">U</button>
      <button type="button" data-cmd="link" title="Add link">\u{1F517}</button>
      <span class="spacer"></span>
      <span class="edit-status"></span>
      <button type="button" class="btn-danger" data-cmd="reset" title="Discard your edits and restore the original parsed content">Reset to original</button>
      <button type="button" class="btn-save" data-cmd="save">Save</button>
    </div>
  `;
  return t;
})();
var CMD_TAG = { p: "P", h2: "H2", h3: "H3", blockquote: "BLOCKQUOTE" };
var EntryEditor = class extends HTMLElement {
  editing = false;
  toolbar = null;
  status = null;
  editButton = null;
  connectedCallback() {
    this.editButton = document.getElementById("entry-edit-btn");
    this.editButton?.addEventListener("click", this.onEdit);
  }
  disconnectedCallback() {
    this.cleanup();
  }
  get contentEl() {
    return this.querySelector("#entry-content");
  }
  get entryId() {
    return parseInt(this.dataset.id || "", 10);
  }
  onEdit = () => {
    if (this.editing) return;
    this.editing = true;
    const editor = this.contentEl;
    if (!editor) return;
    editor.classList.add("editing");
    editor.setAttribute("contenteditable", "true");
    editor.focus();
    this.toolbar = this.buildToolbar();
    editor.parentNode?.insertBefore(this.toolbar, editor);
    if (this.editButton) this.editButton.style.display = "none";
  };
  /** Clones the shared template + wires a single delegated click handler. */
  buildToolbar() {
    const bar = TOOLBAR_TEMPLATE.content.firstElementChild.cloneNode(true);
    this.status = bar.querySelector(".edit-status");
    bar.addEventListener("click", this.onToolbarClick);
    return bar;
  }
  onToolbarClick = (e) => {
    const btn = e.target.closest("button[data-cmd]");
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    switch (cmd) {
      case "p":
      case "h2":
      case "h3":
      case "blockquote":
        this.wrapBlock(CMD_TAG[cmd]);
        break;
      case "strong":
      case "em":
      case "u":
        this.wrapInline(cmd.toUpperCase());
        break;
      case "link":
        this.onLink();
        break;
      case "save":
        void this.onSave();
        break;
      case "reset":
        void this.onReset();
        break;
    }
  };
  getRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0);
  }
  selectionIsInEditor(editor) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    return editor.contains(r.startContainer) && editor.contains(r.endContainer);
  }
  /**
   * Range.surroundContents throws when the range partially spans a non-text
   * node — fall back to a TreeWalker that splits + wraps each text fragment.
   */
  wrapInline(tagName) {
    const editor = this.contentEl;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !this.selectionIsInEditor(editor)) {
      this.setStatus({ ok: false, msg: "Select text first" });
      return;
    }
    const range = sel.getRangeAt(0);
    try {
      const el = document.createElement(tagName);
      range.surroundContents(el);
    } catch {
      const nodes = this.textNodesInRange(editor, range);
      for (const node of nodes) {
        const el = document.createElement(tagName);
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.nodeValue?.length ?? 0;
        if (start === end) continue;
        const fragment = node.nodeValue?.slice(start, end) || "";
        el.textContent = fragment;
        const textNode = node;
        textNode.deleteData(start, end - start);
        textNode.insertData(start, "\0");
        const replacement = document.createTextNode("");
        textNode.parentNode?.insertBefore(el, textNode.splitText(start + 1));
        el.textContent = fragment;
      }
    }
    editor.focus();
    this.setStatus({ ok: true, msg: "" });
  }
  /** Walk text nodes inside the editor that intersect `range`. */
  textNodesInRange(root, range) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    const out = [];
    let n;
    while ((n = walker.nextNode()) != null) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (n.length > 0) out.push(n);
      }
    }
    return out;
  }
  /**
   * Re-wrap the closest block-level ancestor as `<${tagName}>`. Children are
   * preserved; selection restored inside the new element.
   */
  wrapBlock(tagName) {
    const editor = this.contentEl;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      this.setStatus({ ok: false, msg: "Click inside the text first" });
      return;
    }
    const range = sel.getRangeAt(0);
    const target = this.closestBlock(editor, range.commonAncestorContainer);
    if (!target) {
      this.setStatus({ ok: false, msg: "Cursor is not in a block" });
      return;
    }
    if (target.tagName === tagName) return;
    const replacement = document.createElement(tagName);
    while (target.firstChild) replacement.appendChild(target.firstChild);
    target.parentNode?.replaceChild(replacement, target);
    editor.focus();
    this.setStatus({ ok: true, msg: "" });
  }
  closestBlock(editor, node) {
    let n = node;
    while (n && n !== editor) {
      if (n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.includes(n.tagName)) {
        return n;
      }
      n = n.parentNode;
    }
    return null;
  }
  onLink = () => {
    const editor = this.contentEl;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !this.selectionIsInEditor(editor)) {
      this.setStatus({ ok: false, msg: "Select text first" });
      return;
    }
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    const range = sel.getRangeAt(0);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    try {
      range.surroundContents(a);
    } catch {
      const nodes = this.textNodesInRange(editor, range);
      for (const node of nodes) {
        const frag = document.createElement("a");
        frag.href = url;
        frag.target = "_blank";
        frag.rel = "noopener noreferrer";
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.nodeValue?.length ?? 0;
        if (start === end) continue;
        frag.textContent = node.nodeValue?.slice(start, end) || "";
        const textNode = node;
        textNode.deleteData(start, end - start);
        textNode.parentNode?.insertBefore(frag, textNode.splitText(start));
      }
    }
    editor.focus();
    this.setStatus({ ok: true, msg: "" });
  };
  onSave = async () => {
    const editor = this.contentEl;
    if (!editor) return;
    const html = editor.innerHTML;
    this.setStatus({ ok: true, msg: "Saving\u2026" });
    try {
      const updated = await api(`/api/entries/${this.entryId}`, {
        method: "PATCH",
        body: { content: html }
      });
      editor.innerHTML = updated.content || "";
      this.cleanup();
      this.setStatus({ ok: true, msg: "Saved" });
      api.toast("Saved", { ok: true });
    } catch {
      this.setStatus({ ok: false, msg: "Save failed" });
    }
  };
  onReset = async () => {
    if (!window.confirm("Reset content to the original parsed version?")) return;
    const editor = this.contentEl;
    if (!editor) return;
    this.setStatus({ ok: true, msg: "Resetting\u2026" });
    try {
      const updated = await api(
        `/api/entries/${this.entryId}/content/reset`,
        { method: "POST" }
      );
      editor.innerHTML = updated.content || "";
      this.cleanup();
      this.setStatus({ ok: true, msg: "Reset" });
      api.toast("Reset to original", { ok: true });
    } catch (e) {
      this.setStatus({ ok: false, msg: e.message || "Reset failed" });
    }
  };
  cleanup() {
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
    const editor = this.contentEl;
    if (editor) {
      editor.removeAttribute("contenteditable");
      editor.classList.remove("editing");
    }
    if (this.editButton) this.editButton.style.display = "";
    this.editing = false;
  }
  setStatus(s) {
    if (!this.status) return;
    this.status.textContent = s.msg || "";
    this.status.classList.toggle("err", !s.ok && s.msg !== "");
  }
};
customElements.define("entry-editor", EntryEditor);
