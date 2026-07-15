// web-ui/components/tag-row.ts — `<tag-row>` island.
//
// Per-row delete confirm + optimiztic removal. Without JS, the server-rendered
// <form action="/ui/tags/delete" method="post"> still 303s to /tags.

import { api } from "../lib/api";

class TagRow extends HTMLElement {
  connectedCallback(): void {
    const form = this.querySelector<HTMLFormElement>('form[action="/ui/tags/delete"]');
    form?.addEventListener("submit", this.onSubmit);
  }

  private onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const label = this.dataset.label || "";
    if (!window.confirm(`Delete tag '${label}' from all entries?`)) return;
    // Optimistic dim.
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
