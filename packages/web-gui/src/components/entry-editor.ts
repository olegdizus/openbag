import { api } from "../lib/api";

const BLOCK_TAGS = ["P", "H2", "H3", "BLOCKQUOTE"];

interface EditorStatus {
  ok: boolean;
  msg: string;
}

/**
 * Parsed once at module load + cloned per-Edit. Buttons set `data-cmd`; one
 * delegated click handler dispatches (vs the legacy 8-listener pattern).
 */
const TOOLBAR_TEMPLATE = (() => {
  const t = document.createElement("template");
  t.innerHTML = `
    <div class="entry-edit-toolbar" role="toolbar">
      <button type="button" data-cmd="p" title="Paragraph">P</button>
      <button type="button" data-cmd="h2" title="Heading 2">H2</button>
      <button type="button" data-cmd="h3" title="Heading 3">H3</button>
      <button type="button" data-cmd="blockquote" title="Blockquote">❝</button>
      <button type="button" data-cmd="strong" title="Bold">B</button>
      <button type="button" data-cmd="em" title="Italic">I</button>
      <button type="button" data-cmd="u" title="Underline">U</button>
      <button type="button" data-cmd="link" title="Add link">🔗</button>
      <span class="spacer"></span>
      <span class="edit-status"></span>
      <button type="button" class="btn-danger" data-cmd="reset" title="Discard your edits and restore the original parsed content">Reset to original</button>
      <button type="button" class="btn-save" data-cmd="save">Save</button>
    </div>
  `;
  return t;
})();

type ToolbarCmd = "p" | "h2" | "h3" | "blockquote" | "strong" | "em" | "u" | "link" | "reset" | "save";

const CMD_TAG: Record<string, string> = { p: "P", h2: "H2", h3: "H3", blockquote: "BLOCKQUOTE" };

/**
 * `<entry-editor>` — contentEditable WYSIWYG (replaces deprecated
 * `document.execCommand`, ADR-0012). Server-side `sanitizeEntryHtml` is the
 * source of truth for safety.
 */
class EntryEditor extends HTMLElement {
  private editing = false;
  private toolbar: HTMLElement | null = null;
  private status: HTMLElement | null = null;
  private editButton: HTMLElement | null = null;

  connectedCallback(): void {
    this.editButton = document.getElementById("entry-edit-btn");
    this.editButton?.addEventListener("click", this.onEdit);
  }

  disconnectedCallback(): void {
    this.cleanup();
  }

  private get contentEl(): HTMLElement | null {
    return this.querySelector<HTMLElement>("#entry-content");
  }

  private get entryId(): number {
    return parseInt(this.dataset.id || "", 10);
  }

  private onEdit = (): void => {
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
  private buildToolbar(): HTMLElement {
    const bar = TOOLBAR_TEMPLATE.content.firstElementChild!.cloneNode(true) as HTMLElement;
    this.status = bar.querySelector<HTMLElement>(".edit-status");
    bar.addEventListener("click", this.onToolbarClick);
    return bar;
  }

  private onToolbarClick = (e: Event): void => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-cmd]");
    if (!btn) return;
    const cmd = btn.dataset.cmd as ToolbarCmd;
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

  private getRange(): Range | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0);
  }

  private selectionIsInEditor(editor: HTMLElement): boolean {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const r = sel.getRangeAt(0);
    return editor.contains(r.startContainer) && editor.contains(r.endContainer);
  }

  /**
   * Range.surroundContents throws when the range partially spans a non-text
   * node — fall back to a TreeWalker that splits + wraps each text fragment.
   */
  private wrapInline(tagName: string): void {
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
      // Cross-block selection — walk text nodes and wrap each fragment.
      const nodes = this.textNodesInRange(editor, range);
      for (const node of nodes) {
        const el = document.createElement(tagName);
        // Intersect the node's text with the range.
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : node.nodeValue?.length ?? 0;
        if (start === end) continue;
        const fragment = node.nodeValue?.slice(start, end) || "";
        el.textContent = fragment;
        const textNode = node as Text;
        textNode.deleteData(start, end - start);
        textNode.insertData(start, "\u0000"); // placeholder so positions stay sane
        // Insert el at the placeholder position.
        const replacement = document.createTextNode("");
        textNode.parentNode?.insertBefore(el, textNode.splitText(start + 1));
        el.textContent = fragment;
      }
    }
    editor.focus();
    this.setStatus({ ok: true, msg: "" });
  }

  /** Walk text nodes inside the editor that intersect `range`. */
  private textNodesInRange(root: HTMLElement, range: Range): Text[] {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return range.intersectsNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    const out: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode()) != null) {
      if (n.nodeType === Node.TEXT_NODE) {
        // Drop 0-length tails (TreeWalker yields them on edge ranges).
        if ((n as Text).length > 0) out.push(n as Text);
      }
    }
    return out;
  }

  /**
   * Re-wrap the closest block-level ancestor as `<${tagName}>`. Children are
   * preserved; selection restored inside the new element.
   */
  private wrapBlock(tagName: string): void {
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
    if (target.tagName === tagName) return; // no-op
    const replacement = document.createElement(tagName);
    while (target.firstChild) replacement.appendChild(target.firstChild);
    target.parentNode?.replaceChild(replacement, target);
    editor.focus();
    this.setStatus({ ok: true, msg: "" });
  }

  private closestBlock(editor: HTMLElement, node: Node): HTMLElement | null {
    let n: Node | null = node;
    while (n && n !== editor) {
      if (n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.includes((n as HTMLElement).tagName)) {
        return n as HTMLElement;
      }
      n = n.parentNode;
    }
    return null;
  }

  private onLink = (): void => {
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
      // Cross-block selection — wrap each text fragment.
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
        // Replace the slice in-place.
        const textNode = node as Text;
        textNode.deleteData(start, end - start);
        textNode.parentNode?.insertBefore(frag, textNode.splitText(start));
      }
    }
    editor.focus();
    this.setStatus({ ok: true, msg: "" });
  };

  private onSave = async (): Promise<void> => {
    const editor = this.contentEl;
    if (!editor) return;
    const html = editor.innerHTML;
    this.setStatus({ ok: true, msg: "Saving…" });
    try {
      const updated = await api<{ content: string | null }>(`/api/entries/${this.entryId}`, {
        method: "PATCH",
        body: { content: html },
      });
      // Replace the editor body with the server-sanitized output.
      editor.innerHTML = updated.content || "";
      this.cleanup();
      this.setStatus({ ok: true, msg: "Saved" });
      api.toast("Saved", { ok: true });
    } catch {
      this.setStatus({ ok: false, msg: "Save failed" });
    }
  };

  private onReset = async (): Promise<void> => {
    if (!window.confirm("Reset content to the original parsed version?")) return;
    const editor = this.contentEl;
    if (!editor) return;
    this.setStatus({ ok: true, msg: "Resetting…" });
    try {
      const updated = await api<{ content: string | null }>(
        `/api/entries/${this.entryId}/content/reset`,
        { method: "POST" },
      );
      editor.innerHTML = updated.content || "";
      this.cleanup();
      this.setStatus({ ok: true, msg: "Reset" });
      api.toast("Reset to original", { ok: true });
    } catch (e) {
      this.setStatus({ ok: false, msg: (e as Error).message || "Reset failed" });
    }
  };

  private cleanup(): void {
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

  private setStatus(s: EditorStatus): void {
    if (!this.status) return;
    this.status.textContent = s.msg || "";
    this.status.classList.toggle("err", !s.ok && s.msg !== "");
  }
}

customElements.define("entry-editor", EntryEditor);
