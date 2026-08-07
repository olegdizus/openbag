import { api } from "../lib/api";

/**
 * `<tag-row>` — intercepts the delete form, confirms, optimistically removes
 * the row, rolls back on error. No-JS form 303s to /tags.
 */
class TagRow extends HTMLElement {
  connectedCallback(): void {
    const form = this.querySelector<HTMLFormElement>('form[action="/ui/tags/delete"]');
    form?.addEventListener("submit", this.onSubmit);
  }

  private onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const label = this.dataset.label || "";
    if (!window.confirm(`Delete tag '${label}' from all entries?`)) return;
    this.style.opacity = "0.5";
    try {
      await api(`/api/tag/label?tag=${encodeURIComponent(label)}`, { method: "DELETE" });
      this.remove();
    } catch {
      this.style.opacity = "";
    }
  };
}

customElements.define("tag-row", TagRow);
