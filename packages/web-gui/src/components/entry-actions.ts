// web-ui/components/entry-actions.ts — `<entry-actions>` island.
//
// Renders archive/star/delete buttons inline (replacing the SSR placeholder);
// intercepts clicks to PATCH /api/entries/:id and roll back on error.

import { api } from "../lib/api";

interface EntryActionsAttrs {
  id: number;
  archived: boolean;
  starred: boolean;
}

function attrsFrom(node: HTMLElement): EntryActionsAttrs {
  return {
    id: parseInt(node.dataset.id || "", 10),
    archived: node.dataset.archived === "1",
    starred: node.dataset.starred === "1",
  };
}

class EntryActions extends HTMLElement {
  private state: EntryActionsAttrs = { id: 0, archived: false, starred: false };

  connectedCallback(): void {
    this.state = attrsFrom(this);
    this.render();
  }

  private render(): void {
    const archiveBtn = `<button type="button" class="btn-toggle" data-action="archive">${this.state.archived ? "✓ Archived" : "Archive"}</button>`;
    const starBtn = `<button type="button" class="btn-star ${this.state.starred ? "is-on" : ""}" data-action="star">${this.state.starred ? "★ Starred" : "☆ Star"}</button>`;
    const deleteBtn = `<button type="button" class="btn-toggle" data-action="delete">Delete</button>`;
    this.innerHTML = `${archiveBtn} ${starBtn} ${deleteBtn}`;

    this.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((btn) => {
      btn.addEventListener("click", this.onClick);
    });
  }

  private onClick = async (e: Event): Promise<void> => {
    const btn = e.target as HTMLButtonElement;
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
      } catch { /* swallowed */ }
    }
  };

  private async patch(body: Record<string, unknown>): Promise<void> {
    // Optimistic update before the round-trip.
    if ("archive" in body) this.state.archived = !!body.archive;
    if ("starred" in body) this.state.starred = !!body.starred;
    this.render();
    try {
      const updated = await api<{ is_archived: number; is_starred: number }>(
        `/api/entries/${this.state.id}`,
        { method: "PATCH", body },
      );
      this.state.archived = !!updated.is_archived;
      this.state.starred = !!updated.is_starred;
      // Don't re-render — the optimistic UI may already match; trust the server.
      this.dataset.archived = updated.is_archived ? "1" : "0";
      this.dataset.starred = updated.is_starred ? "1" : "0";
    } catch (e) {
      // Roll back: re-read attrs from data-* (they reflect the server state).
      this.state = attrsFrom(this);
      this.render();
    }
  }
}

customElements.define("entry-actions", EntryActions);
