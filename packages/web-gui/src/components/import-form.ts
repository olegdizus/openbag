// web-ui/components/import-form.ts — `<import-form>` island.
//
// Progressive enhancement: live URL count for the bulk textarea + per-URL
// status during import. Without JS the forms still POST to /ui/import/* natively.

class ImportForm extends HTMLElement {
  connectedCallback(): void {
    const bulk = this.querySelector<HTMLTextAreaElement>("#bulk-urls");
    if (bulk) {
      bulk.addEventListener("input", () => this.updateCount(bulk));
      // Initial count in case the user reloads with a draft.
      this.updateCount(bulk);
    }

    const single = this.querySelector<HTMLFormElement>("#single-form");
    const bulkForm = this.querySelector<HTMLFormElement>("#bulk-form");

    single?.addEventListener("submit", (e) => this.onSingleSubmit(e, single));
    bulkForm?.addEventListener("submit", (e) => this.onBulkSubmit(e, bulkForm));
  }

  private updateCount(textarea: HTMLTextAreaElement): void {
    const count = textarea.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).length;
    let counter = this.querySelector<HTMLElement>("#bulk-count");
    if (!counter) {
      counter = document.createElement("p");
      counter.id = "bulk-count";
      counter.className = "text-muted";
      textarea.parentElement?.appendChild(counter);
    }
    counter.textContent = count === 0 ? "" : `${count} URL${count === 1 ? "" : "s"} ready`;
  }

  private async onSingleSubmit(e: Event, form: HTMLFormElement): Promise<void> {
    e.preventDefault();
    const url = (form.elements.namedItem("url") as HTMLInputElement)?.value?.trim();
    if (!url) return;
    try {
      const created = await fetch("/api/entries", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", origin: location.origin },
        body: JSON.stringify({ url }),
      });
      if (created.ok) {
        const entry = (await created.json()) as { id?: number };
        if (entry?.id) {
          window.location.href = `/entry?id=${entry.id}`;
          return;
        }
      }
      this.showError("Could not save URL.");
    } catch {
      this.showError("Network error.");
    }
  }

  private async onBulkSubmit(e: Event, form: HTMLFormElement): Promise<void> {
    e.preventDefault();
    const ta = form.elements.namedItem("urls") as HTMLTextAreaElement;
    const urls = ta.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) {
      this.showError("Paste at least one URL.");
      return;
    }
    try {
      const res = await fetch("/api/entries/lists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", origin: location.origin },
        body: JSON.stringify({ urls }),
      });
      if (res.ok) {
        const arr = await res.json();
        this.showSuccess(`Imported ${Array.isArray(arr) ? arr.length : 0} entries.`);
        ta.value = "";
      } else {
        this.showError("Import failed.");
      }
    } catch {
      this.showError("Network error.");
    }
  }

  private showError(msg: string): void {
    const result = this.querySelector<HTMLElement>("#result");
    if (result) {
      result.className = "alert alert-error";
      result.textContent = msg;
    }
  }
  private showSuccess(msg: string): void {
    const result = this.querySelector<HTMLElement>("#result");
    if (result) {
      result.className = "alert alert-success";
      result.textContent = msg;
    }
  }
}

customElements.define("import-form", ImportForm);
