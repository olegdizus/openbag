import { api } from "../lib/api";

/**
 * `<oauth-client-card>` — intercepts the delete form, confirms, optimistically
 * + rolls back on error. No-JS path: the form 303s to /developer.
 */
class OAuthClientCard extends HTMLElement {
  connectedCallback(): void {
    const form = this.querySelector<HTMLFormElement>(`form[action^="/ui/oauth/clients/"]`);
    form?.addEventListener("submit", this.onSubmit);
  }

  private onSubmit = async (e: Event): Promise<void> => {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    if (!window.confirm("Delete this OAuth client?")) return;
    const id = parseInt(this.dataset.id || "", 10);
    if (!id) return;
    this.style.opacity = "0.5";
    try {
      await api(`/api/oauth/clients/${id}`, { method: "DELETE" });
      this.remove();
    } catch {
      this.style.opacity = "";
      api.toast("Could not delete client");
    }
  };
}

customElements.define("oauth-client-card", OAuthClientCard);
